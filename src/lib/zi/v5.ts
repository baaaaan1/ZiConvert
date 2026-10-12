import type { GlyphBitmap } from './types'

const HEADER_SIZE = 0x2c
const MAGIC = [0x04, 0xff, 0x00]
const ORIENTATION_VERTICAL = 0x0a

export interface ZiV5Options {
  name: string
  width: number
  height: number
  glyphs: GlyphBitmap[]
  codePage?: 1 | 3
  characterStart?: number
  characterEnd?: number
}

export interface ZiV5Inspection {
  version: number
  name: string
  encoding: string
  glyphCount: number
  width: number
  height: number
  validV5: boolean
}

function codePageDetails(codePage: 1 | 3): { encoding: string; start: number; end: number; count: number } {
  return codePage === 1
    ? { encoding: 'ascii', start: 0x20, end: 0x7e, count: 95 }
    : { encoding: 'iso-8859-1', start: 0x20, end: 0xff, count: 224 }
}

function pushRun(output: number[], color: number, count: number): void {
  while (count > 0) {
    const length = Math.min(count, 31)
    output.push(color === 0 ? length : 0x20 | length)
    count -= length
  }
}

export function getV5GlyphWidth(glyph: GlyphBitmap): number {
  const advanceWidth = Math.max(1, Math.min(glyph.width, Math.round(glyph.advanceWidth ?? glyph.width)))
  return glyph.codePoint === 0x20 || glyph.codePoint === 0xa0
    ? Math.max(1, Math.round(advanceWidth / 2))
    : advanceWidth
}

/** Encodes 3-bit alpha pixels using the v5 anti-aliased stream. */
export function encodeV5Glyph(glyph: GlyphBitmap, outputHeight = glyph.height): Uint8Array {
  const output = [0x03]
  const width = getV5GlyphWidth(glyph)
  const height = Math.max(1, Math.min(glyph.height, outputHeight))
  const left = Math.floor((glyph.width - width) / 2)
  let index = 0
  const pixelCount = width * height
  const pixelAt = (position: number) => {
    const x = position % width
    const y = Math.floor(position / width)
    return glyph.pixels[y * glyph.width + left + x]
  }
  while (index < pixelCount) {
    const alpha = Math.max(0, Math.min(7, Math.round(pixelAt(index))))
    if (alpha === 0 || alpha === 7) {
      let count = 1
      while (index + count < pixelCount && Math.max(0, Math.min(7, Math.round(pixelAt(index + count)))) === alpha) count += 1
      pushRun(output, alpha, count)
      index += count
      continue
    }

    const nextAlpha = index + 1 < pixelCount ? Math.max(0, Math.min(7, Math.round(pixelAt(index + 1)))) : 0
    if (index + 1 < pixelCount) {
      output.push(0xc0 | (alpha << 3) | nextAlpha)
      index += 2
    } else {
      output.push(0x80 | alpha)
      index += 1
    }
  }
  return Uint8Array.from(output)
}

export function getV5ContentHeight(glyphs: GlyphBitmap[]): number {
  let contentHeight = 0
  for (const glyph of glyphs) {
    for (let y = glyph.height - 1; y >= contentHeight; y -= 1) {
      let hasInk = false
      for (let x = 0; x < glyph.width; x += 1) {
        if (glyph.pixels[y * glyph.width + x] > 0) {
          contentHeight = y + 1
          hasInk = true
          break
        }
      }
      if (hasInk) break
    }
  }
  return Math.max(1, contentHeight)
}

function validateOptions(options: ZiV5Options): { name: Uint8Array; encoding: Uint8Array; codePage: 1 | 3; start: number; end: number } {
  const codePage = options.codePage ?? 1
  const details = codePageDetails(codePage)
  const start = options.characterStart ?? details.start
  const end = options.characterEnd ?? details.end
  const name = new TextEncoder().encode(options.name)
  const encoding = new TextEncoder().encode(details.encoding)
  if (!options.name || name.length > 255 || name.includes(0)) throw new Error('Font name must contain 1–255 UTF-8 bytes and no null character.')
  if (name.length > 255 - encoding.length) throw new Error('Font name is too long for a ZI v5 header.')
  if (!Number.isInteger(options.width) || options.width < 1 || options.width > 255 || !Number.isInteger(options.height) || options.height < 1 || options.height > 255) {
    throw new Error('ZI v5 cell dimensions must be integers from 1 to 255 pixels.')
  }
  if (start !== details.start || end !== details.end || options.glyphs.length !== details.count) {
    throw new Error('ZI v5 requires the complete ASCII or ISO-8859-1 character set; custom subsets require ZI v6.')
  }
  options.glyphs.forEach((glyph, index) => {
    if (glyph.codePoint !== start + index || glyph.width !== options.width || glyph.height !== options.height || glyph.pixels.length !== options.width * options.height || (glyph.advanceWidth !== undefined && (!Number.isInteger(glyph.advanceWidth) || glyph.advanceWidth < 1 || glyph.advanceWidth > options.width))) {
      throw new Error('ZI v5 glyphs must be ordered continuously and match the configured cell size.')
    }
  })
  return { name, encoding, codePage, start, end }
}

export function encodeZiV5(options: ZiV5Options): Uint8Array {
  const validated = validateOptions(options)
  const contentHeight = getV5ContentHeight(options.glyphs)
  const glyphData = options.glyphs.map(glyph => encodeV5Glyph(glyph, contentHeight))
  const mapLength = glyphData.length * 10
  const variableLength = validated.name.length + validated.encoding.length + mapLength + glyphData.reduce((sum, data) => sum + data.length, 0)
  const output = new Uint8Array(HEADER_SIZE + variableLength)
  const view = new DataView(output.buffer)
  const descriptionLength = validated.name.length + validated.encoding.length
  const mapStart = HEADER_SIZE + descriptionLength
  const dataStart = mapStart + mapLength

  output.set(MAGIC, 0)
  output[3] = ORIENTATION_VERTICAL
  output[4] = validated.codePage
  output[5] = 0
  output[6] = 0
  output[7] = contentHeight
  output[8] = 0
  output[9] = 0
  output[10] = validated.start
  output[11] = validated.codePage === 1 ? validated.end + 1 : 0
  view.setUint32(12, options.glyphs.length, true)
  output[16] = 5
  output[17] = descriptionLength
  view.setUint16(18, 0, true)
  view.setUint32(20, variableLength, true)
  view.setUint32(24, HEADER_SIZE, true)
  output[28] = 0xff
  output[29] = 0
  output[30] = 1
  output[31] = 1
  output[32] = validated.name.length
  output[33] = 0
  view.setUint16(34, 0, true)
  view.setUint32(36, 0, true)
  view.setUint32(40, 0, true)
  output.set(validated.name, HEADER_SIZE)
  output.set(validated.encoding, HEADER_SIZE + validated.name.length)

  let dataOffset = mapLength
  let dataPosition = dataStart
  for (let index = 0; index < glyphData.length; index += 1) {
    const glyph = options.glyphs[index]
    const mapOffset = mapStart + index * 10
    view.setUint16(mapOffset, glyph.codePoint, true)
    output[mapOffset + 2] = getV5GlyphWidth(glyph)
    output[mapOffset + 3] = 0
    output[mapOffset + 4] = 0
    output[mapOffset + 5] = dataOffset & 0xff
    output[mapOffset + 6] = (dataOffset >> 8) & 0xff
    output[mapOffset + 7] = (dataOffset >> 16) & 0xff
    view.setUint16(mapOffset + 8, glyphData[index].length, true)
    output.set(glyphData[index], dataPosition)
    dataOffset += glyphData[index].length
    dataPosition += glyphData[index].length
  }
  return output
}

export function inspectZiV5(bytes: Uint8Array): ZiV5Inspection {
  if (bytes.length < HEADER_SIZE || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== ORIENTATION_VERTICAL) throw new Error('Unrecognized ZI v5 signature or truncated header.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = bytes[16]
  const descriptionLength = bytes[17]
  const nameLength = bytes[32]
  const name = new TextDecoder().decode(bytes.subarray(HEADER_SIZE, HEADER_SIZE + nameLength))
  const encoding = new TextDecoder().decode(bytes.subarray(HEADER_SIZE + nameLength, HEADER_SIZE + descriptionLength))
  const glyphCount = view.getUint32(12, true)
  const mapStart = HEADER_SIZE + descriptionLength
  const mapEnd = mapStart + glyphCount * 10
  const dataStart = mapEnd
  const codePage = bytes[4]
  const charset = codePage === 1 ? codePageDetails(1) : codePage === 3 ? codePageDetails(3) : null
  let validV5 = version === 5 && charset !== null && bytes[5] === 0 && bytes[6] === 0 && bytes[28] === 0xff && bytes[29] === 0 && bytes[30] === 1 && bytes[31] === 1 && nameLength + encoding.length === descriptionLength && view.getUint32(24, true) === HEADER_SIZE && view.getUint32(20, true) === bytes.length - HEADER_SIZE && mapEnd <= bytes.length && glyphCount === charset?.count && bytes[10] === charset.start && bytes[11] === (codePage === 1 ? charset.end + 1 : 0)
  let expectedOffset = glyphCount * 10
  for (let index = 0; validV5 && index < glyphCount; index += 1) {
    const entry = mapStart + index * 10
    const offset = bytes[entry + 5] | (bytes[entry + 6] << 8) | (bytes[entry + 7] << 16)
    const length = view.getUint16(entry + 8, true)
    validV5 = view.getUint16(entry, true) === charset!.start + index && offset === expectedOffset && dataStart + offset - glyphCount * 10 + length <= bytes.length
    expectedOffset = offset + length
  }
  return { version, name, encoding, glyphCount, width: bytes[6], height: bytes[7], validV5 }
}
