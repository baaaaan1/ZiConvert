import type { GlyphBitmap } from '../zi/types'

export interface RasterizedFont {
  glyphs: GlyphBitmap[]
  clipped: number[]
  fontSize: number
}

export function rasterizeCharacters(fontFamily: string, width: number, height: number, codePoints: number[], requestedFontSize: number): RasterizedFont {
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
    for (let attempt = 0; attempt < maxFontSize; attempt += 1) {
      context.font = `${fontSize}px "${fontFamily.replaceAll('"', '')}"`
      const scale = codePoints.reduce((fit, codePoint) => {
        const metrics = context.measureText(String.fromCharCode(codePoint))
        return Math.min(
          fit,
          metrics.actualBoundingBoxLeft > width / 2 ? width / 2 / metrics.actualBoundingBoxLeft : 1,
          metrics.actualBoundingBoxRight > width / 2 ? width / 2 / metrics.actualBoundingBoxRight : 1,
          metrics.actualBoundingBoxAscent > height / 2 ? height / 2 / metrics.actualBoundingBoxAscent : 1,
          metrics.actualBoundingBoxDescent > height / 2 ? height / 2 / metrics.actualBoundingBoxDescent : 1,
        )
      }, 1)
      if (scale >= 1) break
      fontSize = Math.max(1, Math.floor(fontSize * scale))
    }
  }
  context.font = `${fontSize}px "${fontFamily.replaceAll('"', '')}"`

  const glyphs: GlyphBitmap[] = []
  const clipped: number[] = []
  for (const codePoint of codePoints) {
    context.clearRect(0, 0, width, height)
    const character = String.fromCharCode(codePoint)
    const metrics = context.measureText(character)
    if (metrics.actualBoundingBoxLeft > width / 2 || metrics.actualBoundingBoxRight > width / 2 || metrics.actualBoundingBoxAscent > height / 2 || metrics.actualBoundingBoxDescent > height / 2) {
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
  return { glyphs, clipped, fontSize }
}
