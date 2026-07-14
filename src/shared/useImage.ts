/**
 * Library images are served by the main process over ww://image/… so Chromium
 * caches them natively — no base64 IPC round-trips. 'thumb' serves the ≤128px
 * WebP generated at import time, falling back to the original for old imports.
 */
export function imageUrl(
  hash: string | undefined,
  variant: 'full' | 'thumb' = 'full'
): string | null {
  return hash ? `ww://image/${variant}/${hash}` : null
}

/** Read a File as a data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Render a ≤max px WebP thumbnail from an image data URL (undefined on failure). */
export function makeThumbDataUrl(
  dataUrl: string,
  max = 128
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(undefined)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/webp', 0.8))
      } catch {
        resolve(undefined)
      }
    }
    img.onerror = () => resolve(undefined)
    img.src = dataUrl
  })
}
