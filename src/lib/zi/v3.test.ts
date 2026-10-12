import { describe, expect, it } from 'vitest'
import { ASCII_GLYPH_COUNT, encodeZiV3, inspectZi, packGlyph } from './v3'
import type { GlyphBitmap } from './types'

function glyphs(width: number, height: number): GlyphBitmap[] {
  return Array.from({ length: ASCII_GLYPH_COUNT }, (_, index) => ({
    codePoint: 0x20 + index,
    width,
    height,
    pixels: new Uint8Array(width * height),
  }))
}

describe('ZI v3 encoder', () => {
  it('packs pixels most-significant bit first and pads final byte', () => {
    const packed = packGlyph({ codePoint: 65, width: 3, height: 3, pixels: Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 0, 1]) })
    expect([...packed]).toEqual([0b10101010, 0b10000000])
  })

  it('writes a valid ASCII header and 95 fixed-size glyphs', () => {
    const bytes = encodeZiV3({ name: 'Test_8', width: 8, height: 8, glyphs: glyphs(8, 8) })
    const details = inspectZi(bytes)
    expect([...bytes.subarray(0, 4)]).toEqual([0x04, 0xff, 0, 0x0a])
    expect(details).toMatchObject({ version: 3, glyphCount: 95, width: 8, height: 8, name: 'Test_8', validV3: true })
    expect(bytes.length).toBe(0x1c + 6 + 95 * 8)
  })

  it('rejects non-ASCII glyph counts, incorrect order, and out-of-range sizes', () => {
    expect(() => encodeZiV3({ name: 'Bad', width: 8, height: 8, glyphs: glyphs(8, 8).slice(1) })).toThrow(/exactly 95/)
    const wrongOrder = glyphs(8, 8)
    wrongOrder[1].codePoint = 0x20
    expect(() => encodeZiV3({ name: 'Bad', width: 8, height: 8, glyphs: wrongOrder })).toThrow(/ordered continuously/)
    expect(() => encodeZiV3({ name: 'Bad', width: 256, height: 8, glyphs: glyphs(256, 8) })).toThrow(/1 to 255/)
    expect(() => encodeZiV3({ name: 'Bad', width: 3, height: 3, glyphs: glyphs(3, 3) })).toThrow(/whole number of bytes/)
  })

  it('marks files invalid when the fixed header and data length disagree', () => {
    const bytes = encodeZiV3({ name: 'Test_8', width: 8, height: 8, glyphs: glyphs(8, 8) })
    bytes[6] = 9
    expect(inspectZi(bytes).validV3).toBe(false)
  })

  it('encodes a contiguous Latin-1 range with the ISO-8859-1 code page', () => {
    const range = Array.from({ length: 16 }, (_, index) => ({
      codePoint: 0xa0 + index,
      width: 8,
      height: 8,
      pixels: new Uint8Array(64),
    }))
    const bytes = encodeZiV3({ name: 'Latin', width: 8, height: 8, glyphs: range, codePage: 3, characterStart: 0xa0, characterEnd: 0xaf })
    const details = inspectZi(bytes)
    expect(bytes[4]).toBe(3)
    expect(details).toMatchObject({ glyphCount: 16, validV3: true })
  })

  it('validates encoded custom ranges from the ASCII code page', () => {
    const range = Array.from({ length: 10 }, (_, index) => ({
      codePoint: 0x30 + index,
      width: 8,
      height: 8,
      pixels: new Uint8Array(64),
    }))
    const bytes = encodeZiV3({ name: 'Digits', width: 8, height: 8, glyphs: range, codePage: 1, characterStart: 0x30, characterEnd: 0x39 })
    expect(inspectZi(bytes)).toMatchObject({ glyphCount: 10, validV3: true })
  })
})
