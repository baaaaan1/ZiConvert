import type { GlyphBitmap } from '../zi/types'

export interface RasterizedFont {
  glyphs: GlyphBitmap[]
  clipped: number[]
  fontSize: number
}

export function rasterizeCharacters(fontFamily: string, width: number, height: number, codePoints: number[], requestedFontSize: number, fontWeight = 400): RasterizedFont {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Browser tidak menyediakan Canvas 2D.')

  const maxFontSize = Math.max(1, requestedFontSize)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#fff'

  let fontSize = maxFontSize
  if (maxFontSize <= 30) {
    for (; fontSize > 1; fontSize -= 1) {
      context.font = `${fontWeight} ${fontSize}px "${fontFamily.replaceAll('"', '')}"`
      const touchesBoundary = codePoints.some(codePoint => {
        context.clearRect(0, 0, width, height)
        context.fillText(String.fromCharCode(codePoint), width / 2, height / 2)
        const rgba = context.getImageData(0, 0, width, height).data
        for (let x = 0; x < width; x += 1) {
          if (rgba[x * 4 + 3] || rgba[((height - 1) * width + x) * 4 + 3]) return true
        }
        for (let y = 1; y < height - 1; y += 1) {
          if (rgba[y * width * 4 + 3] || rgba[(y * width + width - 1) * 4 + 3]) return true
        }
        return false
      })
      if (!touchesBoundary) break
    }
  }
  context.font = `${fontWeight} ${fontSize}px "${fontFamily.replaceAll('"', '')}"`

  const glyphs: GlyphBitmap[] = []
  const clipped: number[] = []
  for (const codePoint of codePoints) {
    context.clearRect(0, 0, width, height)
    const character = String.fromCharCode(codePoint)
    const metrics = context.measureText(character)
    context.fillText(character, width / 2, height / 2)
    const rgba = context.getImageData(0, 0, width, height).data
    const pixels = new Uint8Array(width * height)
    for (let pixel = 0; pixel < pixels.length; pixel += 1) {
      pixels[pixel] = Math.round(rgba[pixel * 4 + 3] * 7 / 255)
    }
    let touchesBoundary = false
    for (let x = 0; x < width && !touchesBoundary; x += 1) {
      touchesBoundary = rgba[x * 4 + 3] > 0 || rgba[((height - 1) * width + x) * 4 + 3] > 0
    }
    for (let y = 1; y < height - 1 && !touchesBoundary; y += 1) {
      touchesBoundary = rgba[y * width * 4 + 3] > 0 || rgba[(y * width + width - 1) * 4 + 3] > 0
    }
    if (touchesBoundary) clipped.push(codePoint)
    glyphs.push({ codePoint, width, height, pixels, advanceWidth: Math.max(1, Math.min(width, Math.round(metrics.width))) })
  }
  return { glyphs, clipped, fontSize }
}
