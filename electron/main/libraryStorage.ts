/**
 * Per-record library storage.
 *
 * The library used to live as two whole-file JSON blobs (`parts.json`,
 * `pinout-templates.json`) rewritten in full on every edit. That became slow
 * around a few thousand parts, so each record now gets its own file:
 *
 *   <libDir>/parts/<key>.json
 *   <libDir>/templates/<key>.json
 *
 * `<key>` is the record id when it matches `^[A-Za-z0-9_-]{1,100}$`, otherwise
 * a sha256 of the id (the record still stores its real id, so lookups never
 * need to reverse the hash). Images stay in `<libDir>/images/` untouched.
 *
 * This module is plain Node (`node:fs/promises`, `node:path`, `node:crypto`)
 * with no `electron` import so Vitest can exercise it against a temp directory.
 */
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import type { LibraryChanges, LibraryLoadResult } from '../../src/ipc/contract'

const SAFE_KEY = /^[A-Za-z0-9_-]{1,100}$/

function recordKey(id: string): string {
  return SAFE_KEY.test(id) ? id : createHash('sha256').update(id).digest('hex')
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * Write via a unique temp file + fsync + rename so a crash never leaves a torn
 * file. Shared with the main process for its other JSON/asset writes.
 */
export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(data, null, 2))
}

type ReadOutcome<T> = { ok: true; data: T } | { ok: false; missing: boolean; error: string }

/** Read JSON, telling "missing" apart from "unreadable/corrupt". */
async function readJsonFile<T>(file: string): Promise<ReadOutcome<T>> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
    return { ok: false, missing, error: missing ? 'File not found.' : String((e as Error).message) }
  }
  try {
    return { ok: true, data: JSON.parse(raw) as T }
  } catch (e) {
    return { ok: false, missing: false, error: `Not valid JSON: ${(e as Error).message}` }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** A record is at least a plain object carrying a string id. */
function isRecord(v: unknown): v is { id: string } & Record<string, unknown> {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as { id?: unknown }).id === 'string'
  )
}

/** The record's `updatedAt`, if it carries a numeric one. */
function updatedAtOf(v: unknown): number | undefined {
  if (!isRecord(v)) return undefined
  const u = (v as { updatedAt?: unknown }).updatedAt
  return typeof u === 'number' ? u : undefined
}

/** Whether a record directory already holds any `.json` record files. */
async function dirHasRecords(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    return entries.some((e) => e.endsWith('.json'))
  } catch {
    return false
  }
}

/** Move a damaged file aside so it is preserved but no longer loaded/saved. */
async function moveAside(file: string, kind: 'corrupt' | 'migrated'): Promise<string> {
  const dest = `${file}.${kind}-${stamp()}`
  await fs.rename(file, dest)
  return dest
}

async function loadRecords(
  dir: string,
  label: string
): Promise<{ records: unknown[]; errors: string[] }> {
  const records: unknown[] = []
  const errors: string[] = []
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { records, errors }
    errors.push(`${label}: ${(e as Error).message}`)
    return { records, errors }
  }
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue
    const file = join(dir, entry)
    const r = await readJsonFile<unknown>(file)
    if (!r.ok) {
      const kept = await moveAside(file, 'corrupt')
      errors.push(`${entry}: ${r.error} Moved aside to ${kept}.`)
      continue
    }
    if (!isRecord(r.data)) {
      const kept = await moveAside(file, 'corrupt')
      errors.push(`${entry}: unexpected content. Moved aside to ${kept}.`)
      continue
    }
    records.push(r.data)
  }
  // Deterministic order regardless of the directory listing.
  records.sort((a, b) =>
    String((a as { id: string }).id).localeCompare(String((b as { id: string }).id))
  )
  return { records, errors }
}

/**
 * Split a legacy whole-file store into per-record files, then rename the
 * legacy file aside (never deleted). Corrupt or unexpected legacy content is
 * preserved as `*.corrupt-<timestamp>` and reported.
 *
 * When per-record files already exist (a newer build migrated, an older build
 * then wrote a fresh legacy file, and the user came back), this becomes a
 * merge: a legacy record only overwrites its per-record file when its
 * `updatedAt` is strictly newer (records without `updatedAt` never overwrite
 * an existing record). Missing records are added — the older build may
 * legitimately have created them. Deletions made in the newer build cannot be
 * told apart from additions made in the older build, so we prefer keeping data.
 */
interface LegacyMigration {
  errors: string[]
  merged: number
  skipped: number
  added: number
  /** True when per-record files already existed before this migration. */
  hadExisting: boolean
}

async function migrateLegacyFile(legacy: string, targetDir: string, label: string): Promise<LegacyMigration> {
  const errors: string[] = []
  const hadExisting = await dirHasRecords(targetDir)
  const r = await readJsonFile<unknown>(legacy)
  if (!r.ok) {
    const kept = await moveAside(legacy, 'corrupt')
    errors.push(`${label}: ${r.error} Moved aside to ${kept}.`)
    return { errors, merged: 0, skipped: 0, added: 0, hadExisting }
  }
  if (!Array.isArray(r.data)) {
    const kept = await moveAside(legacy, 'corrupt')
    errors.push(`${label}: unexpected content. Moved aside to ${kept}.`)
    return { errors, merged: 0, skipped: 0, added: 0, hadExisting }
  }
  await fs.mkdir(targetDir, { recursive: true })
  let merged = 0
  let skipped = 0
  let added = 0
  for (const item of r.data) {
    if (!isRecord(item)) {
      errors.push(`${label}: skipped an entry without a valid id.`)
      continue
    }
    const file = join(targetDir, `${recordKey(item.id)}.json`)
    const existing = await readJsonFile<unknown>(file)
    if (!existing.ok) {
      if (existing.missing) {
        await writeJsonAtomic(file, item)
        added++
      } else {
        // Existing file is unreadable/corrupt: leave it for loadRecords to
        // quarantine rather than overwrite it with possibly-stale legacy data.
        skipped++
      }
    } else if (isRecord(existing.data)) {
      const legacyTs = updatedAtOf(item)
      const existingTs = updatedAtOf(existing.data)
      if (legacyTs !== undefined && (existingTs === undefined || legacyTs > existingTs)) {
        await writeJsonAtomic(file, item)
        merged++
      } else {
        skipped++
      }
    } else {
      // Existing file holds unexpected content: leave it for loadRecords.
      skipped++
    }
  }
  await fs.rename(legacy, `${legacy}.migrated-${stamp()}`)
  return { errors, merged, skipped, added, hadExisting }
}

/** Load the whole library, migrating the legacy single-file layout once. */
export async function loadLibrary(dir: string): Promise<LibraryLoadResult> {
  await fs.mkdir(join(dir, 'images'), { recursive: true }).catch(() => {})

  const partsDir = join(dir, 'parts')
  const templatesDir = join(dir, 'templates')
  const legacyParts = join(dir, 'parts.json')
  const legacyTemplates = join(dir, 'pinout-templates.json')

  const [legacyPartsExists, legacyTemplatesExists] = await Promise.all([
    exists(legacyParts),
    exists(legacyTemplates)
  ])

  const problems: string[] = []
  let merged = 0
  let skipped = 0
  let added = 0
  let reMigrated = false
  // Migrate each legacy file once. Because a successful migration renames the
  // legacy file away, re-running after a partial failure is idempotent.
  if (legacyPartsExists) {
    const m = await migrateLegacyFile(legacyParts, partsDir, 'parts.json')
    problems.push(...m.errors)
    merged += m.merged
    skipped += m.skipped
    added += m.added
    reMigrated = reMigrated || m.hadExisting
  }
  if (legacyTemplatesExists) {
    const m = await migrateLegacyFile(legacyTemplates, templatesDir, 'pinout-templates.json')
    problems.push(...m.errors)
    merged += m.merged
    skipped += m.skipped
    added += m.added
    reMigrated = reMigrated || m.hadExisting
  }

  const parts = await loadRecords(partsDir, 'parts')
  const templates = await loadRecords(templatesDir, 'templates')
  problems.push(...parts.errors, ...templates.errors)

  // A genuinely fresh library has no records and no legacy files.
  const isNew = !legacyPartsExists && !legacyTemplatesExists && parts.records.length === 0 && templates.records.length === 0

  let notice: string | undefined
  if (reMigrated && (merged || skipped || added)) {
    const bits: string[] = []
    if (added) bits.push(`${added} record${added === 1 ? '' : 's'} added`)
    if (merged) bits.push(`${merged} record${merged === 1 ? '' : 's'} updated`)
    if (skipped) bits.push(`${skipped} record${skipped === 1 ? '' : 's'} kept (newer edits here)`)
    notice =
      `An older WireWeaver wrote to this library: ${bits.join(', ')}. ` +
      "Deletions made in this version can't be told apart from additions made in " +
      'the older version, so deleted records may have been restored.'
  }

  return {
    parts: parts.records as LibraryLoadResult['parts'],
    templates: templates.records as LibraryLoadResult['templates'],
    isNew,
    notice,
    error: problems.length ? problems.join('\n') : undefined
  }
}

/** Read just the parts records (used by part lookup search). */
export async function loadParts(dir: string): Promise<unknown[]> {
  const { records } = await loadRecords(join(dir, 'parts'), 'parts')
  return records
}

async function removeRecord(file: string): Promise<void> {
  await fs.unlink(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e
  })
}

async function applyChangesInner(dir: string, changes: LibraryChanges): Promise<void> {
  await fs.mkdir(join(dir, 'parts'), { recursive: true })
  await fs.mkdir(join(dir, 'templates'), { recursive: true })

  for (const id of changes.removePartIds) {
    await removeRecord(join(dir, 'parts', `${recordKey(id)}.json`))
  }
  for (const id of changes.removeTemplateIds) {
    await removeRecord(join(dir, 'templates', `${recordKey(id)}.json`))
  }
  for (const part of changes.upsertParts) {
    if (!isRecord(part)) continue
    await writeJsonAtomic(join(dir, 'parts', `${recordKey(part.id)}.json`), part)
  }
  for (const template of changes.upsertTemplates) {
    if (!isRecord(template)) continue
    await writeJsonAtomic(join(dir, 'templates', `${recordKey(template.id)}.json`), template)
  }
}

// Serialize writes per library directory so concurrent applyChanges calls
// cannot interleave file writes and lose an edit.
const chains = new Map<string, Promise<unknown>>()

/** Apply a set of record upserts/removals, writing only what changed. */
export function applyChanges(dir: string, changes: LibraryChanges): Promise<void> {
  const key = resolve(dir)
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(() => applyChangesInner(key, changes))
  chains.set(key, run.catch(() => {}))
  return run
}
