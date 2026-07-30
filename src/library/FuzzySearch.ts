import Fuse from 'fuse.js'
import type { Part } from '../model/types'

const fuseOptions = {
  keys: ['name', 'internalPartNumber', 'manufacturer', 'manufacturerPartNumber', 'supplierPartNumber'],
  threshold: 0.4,
  includeScore: true
}

let _cache: { parts: Part[]; fuse: Fuse<Part> } | null = null

export function fuzzySearch(parts: Part[], query: string): Part[] {
  if (!query.trim()) return parts
  if (_cache?.parts !== parts) {
    _cache = { parts, fuse: new Fuse(parts, fuseOptions) }
  }
  return _cache.fuse.search(query).map((r) => r.item)
}
