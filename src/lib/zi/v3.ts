import type { GlyphBitmap, ZiV3Options } from './types'

export const ASCII_START = 0x20
export const ASCII_END = 0x7e
export const ASCII_GLYPH_COUNT = ASCII_END - ASCII_START + 1
export const LATIN1_START = 0x20
export const LATIN1_END = 0xff
export const LATIN1_GLYPH_COUNT = LATIN1_END - LATIN1_START + 1
const HEADER_SIZE = 0x1c
const MAGIC = [0x04, 0xff, 0x00, 0x0a]

function expectedPixelBytes(width: number, height: number): number {
  return (width * height) / 8
}

export function packGlyph(glyph: GlyphBitmap): Uint8Array {
  if (glyph.width < 1 || glyph.height < 1 || glyph.pixels.length !== glyph.width * glyph.height) {
    throw new Error('Glyph dimensions do not match its pixel data.')
  }

  const bytes = new Uint8Array(Math.ceil((glyph.width * glyph.height) / 8))
  glyph.pixels.forEach((pixel, index) => {
    if (pixel) bytes[index >> 3] |= 1 << (7 - (index & 7))
  })
  return bytes
}

function validateOptions(options: ZiV3Options): Uint8Array {
  const { name, width, height, glyphs } = options
  const characterStart = options.characterStart ?? ASCII_START
  const characterEnd = options.characterEnd ?? ASCII_END
  const codePage = options.codePage ?? 1
  const glyphCount = characterEnd - characterStart + 1
  const encodedName = new TextEncoder().encode(name)
  if (!name || encodedName.length > 255 || encodedName.includes(0)) {
    throw new Error('Font name must contain 1–255 UTF-8 bytes and no null character.')
  }
  if (!Number.isInteger(width) || width < 1 || width > 255 || !Number.isInteger(height) || height < 1 || height > 255) {
    throw new Error('ZI v3 cell width and height must be integers from 1 to 255 pixels.')
  }
  if ((width * height) % 8 !== 0) {
    throw new Error('ZI v3 glyph cell must contain a whole number of bytes (width × height divisible by 8).')
  }
  if (!Number.isInteger(characterStart) || !Number.isInteger(characterEnd) || characterStart < LATIN1_START || characterEnd > LATIN1_END || characterStart > characterEnd) {
    throw new Error('ZI v3 character range must be a valid contiguous range from U+0020 through U+00FF.')
  }
  if (codePage !== 1 && codePage !== 3) {
    throw new Error('ZI v3 currently supports ASCII and ISO-8859-1 code pages.')
  }
  if (codePage === 1 && (characterStart < ASCII_START || characterEnd > ASCII_END)) {
    throw new Error('ASCII code page characters must be in range U+0020 through U+007E.')
  }
  if (glyphs.length !== glyphCount) {
    throw new Error(`This character range requires exactly ${glyphCount} glyphs.`)
  }
  glyphs.forEach((glyph, index) => {
    if (glyph.codePoint !== characterStart + index || glyph.width !== width || glyph.height !== height) {
      throw new Error('Glyphs must be ordered continuously across the configured range and match the cell size.')
    }
    if (glyph.pixels.length !== width * height) {
      throw new Error(`Glyph ${String.fromCharCode(glyph.codePoint)} has invalid pixel data.`)
    }
  })
  return encodedName
}

export function encodeZiV3(options: ZiV3Options): Uint8Array {
  const encodedName = validateOptions(options)
  const glyphBytes = expectedPixelBytes(options.width, options.height)
  const characterDataLength = glyphBytes * options.glyphs.length
  const totalDataLength = encodedName.length + characterDataLength
  const output = new Uint8Array(HEADER_SIZE + totalDataLength)
  const view = new DataView(output.buffer)

  output.set(MAGIC, 0)
  view.setUint16(4, options.codePage ?? 1, true)
  output[6] = options.width
  output[7] = options.height
  output[8] = 0
  output[9] = 0
  output[10] = options.characterStart ?? ASCII_START
  output[11] = options.characterEnd ?? ASCII_END
  view.setUint32(12, options.glyphs.length, true)
  output[16] = 3
  output[17] = encodedName.length
  output[18] = encodedName.length
  output[19] = 0
  view.setUint32(20, totalDataLength, true)
  view.setUint32(24, 0, true)
  output.set(encodedName, HEADER_SIZE)

  let offset = HEADER_SIZE + encodedName.length
  for (const glyph of options.glyphs) {
    output.set(packGlyph(glyph), offset)
    offset += glyphBytes
  }
  return output
}

export function inspectZi(bytes: Uint8Array): { version: number; name: string; glyphCount: number; width: number; height: number; validV3: boolean } {
  if (bytes.length < HEADER_SIZE || MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('Unrecognized ZI file signature or truncated header.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = bytes[16]
  const nameLength = bytes[17]
  const nameStart = version >= 5 ? 0x2c : HEADER_SIZE
  const nameBytes = bytes.subarray(nameStart, nameStart + nameLength)
  const name = new TextDecoder().decode(nameBytes).replace(/\0+$/, '')
  const glyphBytes = bytes[6] * bytes[7] / 8
  const characterStart = bytes[10]
  const characterEnd = bytes[11]
  const glyphCount = view.getUint32(12, true)
  const validV3 = version === 3
    && (view.getUint16(4, true) === 1 || view.getUint16(4, true) === 3)
    && characterStart >= LATIN1_START && characterEnd <= LATIN1_END
    && characterStart <= characterEnd
    && glyphCount === characterEnd - characterStart + 1
    && (view.getUint16(4, true) !== 1 || (characterStart >= ASCII_START && characterEnd <= ASCII_END))
    && bytes[18] === nameLength
    && Number.isInteger(glyphBytes)
    && view.getUint32(20, true) === nameLength + glyphBytes * glyphCount
    && bytes.length === HEADER_SIZE + view.getUint32(20, true)
    && nameStart + nameLength <= bytes.length

  return {
    version,
    name,
    glyphCount,
    width: bytes[6],
    height: bytes[7],
    validV3,
  }
}
