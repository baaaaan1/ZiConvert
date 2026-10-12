import type { GlyphBitmap } from '../zi/types'

export interface RasterizedFont {
  glyphs: GlyphBitmap[]
  clipped: number[]
}

export function rasterizeCharacters(fontFamily: string, width: number, height: number, codePoints: number[], requestedFontSize: number): RasterizedFont {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Browser tidak menyediakan Canvas 2D.')

  const fontSize = Math.max(1, requestedFontSize)
  context.font = `${fontSize}px "${fontFamily.replaceAll('"', '')}"`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#fff'

  const glyphs: GlyphBitmap[] = []
  const clipped: number[] = []
  for (const codePoint of codePoints) {
    context.clearRect(0, 0, width, height)
    const character = String.fromCharCode(codePoint)
    const metrics = context.measureText(character)
    if (metrics.width > width || metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > height) {
      clipped.push(codePoint)
    }
    context.fillText(character, width / 2, height / 2)
    const rgba = context.getImageData(0, 0, width, height).data
    const pixels = new Uint8Array(width * height)
    for (let pixel = 0; pixel < pixels.length; pixel += 1) {
      pixels[pixel] = Math.round(rgba[pixel * 4 + 3] * 7 / 255)
    }
    glyphs.push({ codePoint, width, height, pixels, advanceWidth: Math.max(1, Math.min(width, Math.round(metrics.width))) })
  }
  return { glyphs, clipped }
}
