import { afterEach, describe, expect, it, vi } from 'vitest'
import { rasterizeCharacters } from './rasterize'

function mockCanvas(touchesAtFontSize: (fontSize: number, character: string) => boolean) {
  let font = ''
  let pixels = new Uint8ClampedArray()
  const context = {
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    set font(value: string) { font = value },
    get font() { return font },
    clearRect: vi.fn((_x: number, _y: number, width: number, height: number) => {
      pixels = new Uint8ClampedArray(width * height * 4)
    }),
    measureText: vi.fn(() => ({ width: 6 })),
    fillText: vi.fn((character: string, _x: number, _y: number) => {
      const fontSize = Number(font.match(/(\d+)px/)?.[1] ?? 0)
      if (touchesAtFontSize(fontSize, character)) pixels[3] = 255
    }),
    getImageData: vi.fn(() => ({ data: pixels })),
  }
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
    }),
  })
  return context
}

afterEach(() => vi.unstubAllGlobals())

describe('rasterizeCharacters adaptive sizing', () => {
  it('preserves the requested size when glyphs fit', () => {
    mockCanvas(() => false)

    const result = rasterizeCharacters('Roboto Mono', 12, 16, [0x41], 16)

    expect(result.fontSize).toBe(16)
    expect(result.clipped).toEqual([])
  })

  it('reduces only a small font that touches the cell boundary', () => {
    mockCanvas((size, character) => character === 'A' && size > 12)

    const result = rasterizeCharacters('Roboto Mono', 12, 16, [0x41], 16)

    expect(result.fontSize).toBe(12)
    expect(result.clipped).toEqual([])
  })

  it('does not adapt font sizes above 30 px', () => {
    mockCanvas(() => true)

    const result = rasterizeCharacters('Roboto Mono', 12, 16, [0x41], 32)

    expect(result.fontSize).toBe(32)
    expect(result.clipped).toEqual([0x41])
  })

  it('passes the selected weight to the canvas font', () => {
    const context = mockCanvas(() => false)

    rasterizeCharacters('Roboto Mono', 12, 16, [0x41], 16, 600)

    expect(context.font).toBe('600 16px "Roboto Mono"')
  })
})
