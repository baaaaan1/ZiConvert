export interface GlyphBitmap {
  codePoint: number
  width: number
  height: number
  pixels: Uint8Array
  advanceWidth?: number
}

export interface ZiV3Options {
  name: string
  width: number
  height: number
  glyphs: GlyphBitmap[]
  codePage?: number
  characterStart?: number
  characterEnd?: number
}

export type ZiVersion = 3 | 5

export interface ZiInspection {
  version: number
  glyphCount: number
  width: number
  height: number
  name: string
}
