import { describe, expect, it } from 'vitest'
import { encodeV5Glyph, encodeZiV5, getV5ContentHeight, getV5GlyphWidth, inspectZiV5 } from './v5'
import type { GlyphBitmap } from './types'

function glyphs(width: number, height: number): GlyphBitmap[] {
  return Array.from({ length: 95 }, (_, index) => ({
    codePoint: 0x20 + index,
    width,
    height,
    pixels: new Uint8Array(width * height),
  }))
}

describe('ZI v5 encoder', () => {
  it('encodes transparent and opaque runs with the v5 stream marker', () => {
    const glyph: GlyphBitmap = { codePoint: 65, width: 8, height: 1, pixels: Uint8Array.from([0, 0, 7, 7, 7, 0, 0, 0]) }
    expect([...encodeV5Glyph(glyph)]).toEqual([0x03, 0x02, 0x23, 0x03])
  })

  it('preserves intermediate 3-bit alpha levels in antialiased runs', () => {
    const glyph: GlyphBitmap = { codePoint: 65, width: 4, height: 1, pixels: Uint8Array.from([0, 2, 5, 7]) }
    expect([...encodeV5Glyph(glyph)]).toEqual([0x03, 0x01, 0xd5, 0x21])
  })

  it('uses each glyph advance width and crops the bitmap to that width', () => {
    const glyph = { ...glyphs(8, 2)[0], codePoint: 0x41, advanceWidth: 3 }
    const encoded = encodeV5Glyph(glyph)
    expect([...encoded]).toEqual([0x03, 0x06])
  })

  it('reduces only space glyph advance to half the font advance', () => {
    const space = { ...glyphs(8, 8)[0], codePoint: 0x20, advanceWidth: 8 }
    const digit = { ...space, codePoint: 0x30 }
    expect(getV5GlyphWidth(space)).toBe(4)
    expect(getV5GlyphWidth(digit)).toBe(8)
    expect([...encodeV5Glyph(space)]).toEqual([0x03, 31, 1])
  })

  it('trims common blank rows from the bottom without cutting glyph ink', () => {
    const chars = glyphs(8, 8)
    chars[1].pixels[8 * 5 + 3] = 1
    expect(getV5ContentHeight(chars)).toBe(6)

    const bytes = encodeZiV5({ name: 'Trimmed', width: 8, height: 8, glyphs: chars })
    expect(inspectZiV5(bytes)).toMatchObject({ height: 6, validV5: true })
  })

  it('writes and validates a complete ASCII v5 file with a character map', () => {
    const ascii = glyphs(8, 8)
    ascii[0].advanceWidth = 4
    const bytes = encodeZiV5({ name: 'Test_8', width: 8, height: 8, glyphs: ascii })
    const details = inspectZiV5(bytes)
    expect(details).toMatchObject({ version: 5, name: 'Test_8', encoding: 'ascii', glyphCount: 95, width: 0, height: 1, validV5: true })
    expect(bytes[3]).toBe(0x0a)
    const firstMapEntry = 0x2c + 'Test_8'.length + 'ascii'.length
    expect(bytes[firstMapEntry + 2]).toBe(2)
    expect(bytes[firstMapEntry + 10 + 2]).toBe(8)
    expect(bytes.length).toBeGreaterThan(0x2c + 95 * 10)
  })

  it('rejects custom subsets because v5 subset files require v6 mode', () => {
    expect(() => encodeZiV5({ name: 'Digits', width: 8, height: 8, glyphs: glyphs(8, 8).slice(16, 26), characterStart: 0x30, characterEnd: 0x39 })).toThrow(/complete ASCII or ISO-8859-1/)
  })
})
