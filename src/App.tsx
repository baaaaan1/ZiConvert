import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowDownToLine, Check, ChevronDown, FileType2, Github, Heart, Info, Keyboard, LockKeyhole, Moon, MousePointer2, Plus, RotateCcw, Search, Sun, Type, Upload, X } from 'lucide-react'
import { rasterizeCharacters } from './lib/fonts/rasterize'
import { ASCII_END, ASCII_START, encodeZiV3, inspectZi, LATIN1_END, LATIN1_START } from './lib/zi/v3'
import { encodeZiV5, inspectZiV5 } from './lib/zi/v5'
import type { GlyphBitmap } from './lib/zi/types'

type FontFile = { name: string; family: string; url: string; face: FontFace | null; size?: number; source?: string }
type FontsourceFont = { id: string; family: string; version?: string; subsets?: string[]; weights?: number[] }
type CharacterMode = 'ascii' | 'all' | 'custom'
type ZiVersion = 3 | 5

const defaults = { width: 24, height: 32 }
const SIZE_PRESETS = [
  { label: '8 px', width: 8, height: 8, fontSize: 8 },
  { label: '10 px', width: 8, height: 16, fontSize: 10 },
  { label: '12 px', width: 8, height: 16, fontSize: 12 },
  { label: '14 px', width: 12, height: 16, fontSize: 14 },
  { label: '16 px', width: 12, height: 16, fontSize: 16 },
  { label: '18 px', width: 16, height: 24, fontSize: 18 },
  { label: '20 px', width: 16, height: 24, fontSize: 20 },
  { label: '24 px', width: 16, height: 32, fontSize: 24 },
  { label: '28 px', width: 24, height: 40, fontSize: 28 },
  { label: '32 px', width: 24, height: 40, fontSize: 32 },
  { label: '36 px', width: 32, height: 48, fontSize: 36 },
  { label: '40 px', width: 32, height: 48, fontSize: 40 },
  { label: '48 px', width: 40, height: 64, fontSize: 48 },
  { label: '56 px', width: 48, height: 72, fontSize: 56 },
  { label: '64 px', width: 48, height: 80, fontSize: 64 },
]
const SAMPLE_TEXT = 'The quick brown fox jumps over 1234567890.'
type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const savedTheme = localStorage.getItem('ziconvert-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function safeName(name: string): string {
  return name.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'my_font'
}

function makeGlyphCanvas(glyph: GlyphBitmap): string {
  const canvas = document.createElement('canvas')
  canvas.width = glyph.width
  canvas.height = glyph.height
  const context = canvas.getContext('2d')!
  const image = context.createImageData(glyph.width, glyph.height)
  for (let i = 0; i < glyph.pixels.length; i += 1) {
    const value = Math.round(248 - (228 * glyph.pixels[i]) / 7)
    image.data.set([value, value, value, 255], i * 4)
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const fontCatalogRef = useRef<FontsourceFont[] | null>(null)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [donateOpen, setDonateOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [font, setFont] = useState<FontFile | null>(null)
  const [width, setWidth] = useState(defaults.width)
  const [height, setHeight] = useState(defaults.height)
  const [fontSize, setFontSize] = useState(26)
  const [characterMode, setCharacterMode] = useState<CharacterMode>('ascii')
  const [customCharacters, setCustomCharacters] = useState('0123456789')
  const [fontSource, setFontSource] = useState<'local' | 'fontsource'>('local')
  const [fontSearch, setFontSearch] = useState('')
  const [fontResults, setFontResults] = useState<FontsourceFont[]>([])
  const [fontLoading, setFontLoading] = useState(false)
  const [fontName, setFontName] = useState('')
  const [selectedGlyph, setSelectedGlyph] = useState(65)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [glyphData, setGlyphData] = useState<GlyphBitmap[]>([])
  const [clipped, setClipped] = useState<number[]>([])
  const [simulatorText, setSimulatorText] = useState(SAMPLE_TEXT)
  const [simulatorScale, setSimulatorScale] = useState(2)
  const [ziVersion, setZiVersion] = useState<ZiVersion>(5)

  useEffect(() => {
    localStorage.setItem('ziconvert-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!donateOpen && !aboutOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDonateOpen(false)
        setAboutOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [donateOpen, aboutOpen])

  useEffect(() => () => {
    if (font) {
      if (font.face) document.fonts.delete(font.face)
      if (font.url.startsWith('blob:')) URL.revokeObjectURL(font.url)
    }
  }, [font])

  useEffect(() => {
    if (!font) return
    try {
      const codePoints = getCharacterSet(characterMode, customCharacters)
      const result = rasterizeCharacters(font.family, width, height, codePoints, fontSize)
      setGlyphData(result.glyphs)
      setClipped(result.clipped)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The font could not be rendered.')
      setGlyphData([])
    }
  }, [font, width, height, fontSize, characterMode, customCharacters])

  useEffect(() => {
    if (fontSource !== 'fontsource') return
    if (fontSearch.trim().length < 2) {
      setFontResults([])
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setFontLoading(true)
      try {
        const query = fontSearch.trim().toLocaleLowerCase()
        const response = await fetch(`https://api.fontsource.org/v1/fonts?family=${encodeURIComponent(fontSearch.trim())}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Font catalog request failed.')
        const exactMatches = await response.json() as FontsourceFont[]
        if (controller.signal.aborted) return
        if (Array.isArray(exactMatches) && exactMatches.length > 0) {
          setFontResults(exactMatches.slice(0, 12))
          return
        }

        if (!fontCatalogRef.current) {
          const catalogResponse = await fetch('https://api.fontsource.org/v1/fonts?subsets=latin', { signal: controller.signal })
          if (!catalogResponse.ok) throw new Error('Font catalog request failed.')
          const catalog = await catalogResponse.json() as FontsourceFont[]
          fontCatalogRef.current = Array.isArray(catalog) ? catalog : []
        }
        const matches = fontCatalogRef.current.filter(font => font.family.toLocaleLowerCase().includes(query) || font.id.toLocaleLowerCase().includes(query))
        setFontResults(matches.slice(0, 12))
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError('The Fontsource catalog could not be loaded. Check your internet connection.')
      } finally {
        setFontLoading(false)
      }
    }, 300)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [fontSearch, fontSource])

  const preview = useMemo(() => glyphData.find(glyph => glyph.codePoint === selectedGlyph), [glyphData, selectedGlyph])
  const characterSet = useMemo(() => {
    try { return getCharacterSet(characterMode, customCharacters) } catch { return [] }
  }, [characterMode, customCharacters])
  const characterScope = characterMode === 'ascii' ? 'ASCII' : characterMode === 'all' ? 'Latin1' : 'Custom'
  const filenameSuffix = `-${fontSize}px-${characterScope}`
  const outputName = `${safeName(fontName)}${filenameSuffix}`
  const estimatedSize = glyphData.length
    ? ziVersion === 3
      ? Math.ceil(width * height / 8) * glyphData.length + new TextEncoder().encode(outputName).length + 28
      : glyphData.length * 10 + glyphData.length + new TextEncoder().encode(outputName).length + (characterMode === 'all' ? 10 : 5) + 44
    : 0
  const v5Compatible = characterMode !== 'custom' && glyphData.length === characterSet.length
  const simulatorCharacters = Array.from(simulatorText).slice(0, 120)
  const unsupportedCharacters = [...new Set(simulatorCharacters.filter(character => character !== '\n' && !characterSet.includes(character.codePointAt(0)!)))]

  function getCharacterSet(mode: CharacterMode, custom: string): number[] {
    if (mode === 'ascii') return Array.from({ length: ASCII_END - ASCII_START + 1 }, (_, index) => ASCII_START + index)
    if (mode === 'all') return Array.from({ length: LATIN1_END - LATIN1_START + 1 }, (_, index) => LATIN1_START + index)
    const points = [...new Set(Array.from(custom).map(character => character.codePointAt(0)!))].sort((a, b) => a - b)
    if (!points.length) throw new Error('Enter at least one character for custom mode.')
    if (points[0] < LATIN1_START || points[points.length - 1] > LATIN1_END) throw new Error('Custom characters must be in the range U+0020 to U+00FF.')
    return Array.from({ length: points.at(-1)! - points[0] + 1 }, (_, index) => points[0] + index)
  }

  function applyPreset(index: number) {
    const preset = SIZE_PRESETS[index]
    setWidth(preset.width)
    setHeight(preset.height)
    setFontSize(preset.fontSize)
  }

  function clearFont() {
    setFont(current => {
      if (current) {
        if (current.url.startsWith('blob:')) URL.revokeObjectURL(current.url)
        if (current.face) document.fonts.delete(current.face)
      }
      return null
    })
    setGlyphData([])
    setClipped([])
    setNotice('')
  }

  async function loadFile(file?: File) {
    if (!file) return
    if (!/\.(ttf|otf)$/i.test(file.name)) {
      setError('Choose a font file in .ttf or .otf format.')
      return
    }
    const url = URL.createObjectURL(file)
    const family = `ZiFont_${Date.now()}`
    try {
      const face = new FontFace(family, `url(${url})`)
      await face.load()
      document.fonts.add(face)
      setFont(current => {
        if (current) {
          if (current.url.startsWith('blob:')) URL.revokeObjectURL(current.url)
          if (current.face) document.fonts.delete(current.face)
        }
        return { name: file.name, family, url, face, size: file.size }
      })
      setFontName(safeName(file.name.replace(/\.(ttf|otf)$/i, '')))
      setError('')
      setNotice('Font is ready to process in your browser.')
    } catch {
      URL.revokeObjectURL(url)
      setError('The font could not be loaded. Make sure the TTF/OTF file is not corrupted or protected.')
    }
  }

  async function loadFontsource(result: FontsourceFont) {
    const family = `ZiFont_${result.id}_${Date.now()}`
    const subset = 'latin'
    const weight = result.weights?.includes(400) ? 400 : result.weights?.[0] ?? 400
    const version = result.version && /^\d+\.\d+\.\d+$/.test(result.version) ? result.version : 'latest'
    const url = `https://cdn.jsdelivr.net/fontsource/fonts/${result.id}@${version}/${subset}-${weight}-normal.woff2`
    try {
      setError('')
      const face = new FontFace(family, `url(${url})`)
      await face.load()
      document.fonts.add(face)
      setFont(current => {
        if (current) {
          if (current.url.startsWith('blob:')) URL.revokeObjectURL(current.url)
          if (current.face) document.fonts.delete(current.face)
        }
        return { name: result.family, family, url, face, source: 'Fontsource CDN' }
      })
      setFontName(safeName(result.family))
      setNotice(`${result.family} loaded from the Fontsource CDN.`)
    } catch {
      setError(`Font ${result.family} could not be loaded from Fontsource. Try another font or choose a local file.`)
    }
  }

  function exportFont() {
    try {
      if (clipped.length > 0) throw new Error('Reduce the font size or enlarge the cell before exporting; some glyphs are clipped.')
      const codePage = characterSet.at(-1)! > ASCII_END ? 3 : 1
      const bytes = ziVersion === 5
        ? encodeZiV5({ name: outputName, width, height, glyphs: glyphData, codePage, characterStart: characterSet[0], characterEnd: characterSet.at(-1) })
        : encodeZiV3({ name: outputName, width, height, glyphs: glyphData, codePage, characterStart: characterSet[0], characterEnd: characterSet.at(-1) })
      if (ziVersion === 5) {
        const details = inspectZiV5(bytes)
        if (!details.validV5 || details.glyphCount !== glyphData.length) throw new Error('Internal validation of the ZI v5 file failed.')
      } else {
        const details = inspectZi(bytes)
        if (!details.validV3 || details.glyphCount !== glyphData.length) throw new Error('Internal validation of the ZI v3 file failed.')
      }
      const blobBuffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(blobBuffer).set(bytes)
      const blob = new Blob([blobBuffer], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${outputName}-v${ziVersion}.zi`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`ZI v${ziVersion} file (${glyphData.length} characters) created and validated successfully.`)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed.')
    }
  }

  function resetFont() {
    clearFont()
    setError('')
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ZiConvert home">
          <span className="brand-mark"><img src="./favicon.svg" alt="" width="27" height="27" /></span>
          <span>zi<span className="brand-accent">convert</span></span>
        </a>
        <div className="header-actions">
          <button className="about-button" type="button" onClick={() => setAboutOpen(true)}><Info size={15} />About</button>
          <button className="donate-button" type="button" onClick={() => setDonateOpen(true)}><Heart size={15} />Donate</button>
          <button className="theme-toggle" type="button" onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-pressed={theme === 'dark'} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            <span>{theme === 'light' ? 'DARK MODE' : 'LIGHT MODE'}</span>
          </button>
          <div className="topbar-meta"><span className="status-dot" />FONT CONVERTER</div>
        </div>
      </header>

      {donateOpen && <div className="donate-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setDonateOpen(false) }}>
        <section className="donate-dialog" role="dialog" aria-modal="true" aria-labelledby="donate-title" aria-describedby="donate-description">
          <button className="donate-close" type="button" onClick={() => setDonateOpen(false)} aria-label="Close donate panel"><X size={18} /></button>
          <span className="donate-icon"><Heart size={22} /></span>
          <span className="step-label">SUPPORT INDEPENDENT TOOLS</span>
          <h2 id="donate-title">Enjoying ZiConvert?</h2>
          <p id="donate-description">Your voluntary support helps fund hardware prototypes, components, testing, and future improvements. ZiConvert remains free to use.</p>
          <a className="donate-cta" href="https://tako.id/Baaaaan1" target="_blank" rel="noreferrer">Support via Tako <span>↗</span></a>
          <small>Donations are voluntary and do not purchase access, features, or support services.</small>
        </section>
      </div>}

      {aboutOpen && <div className="donate-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setAboutOpen(false) }}>
        <section className="donate-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" aria-describedby="about-description">
          <button className="donate-close" type="button" onClick={() => setAboutOpen(false)} aria-label="Close about panel"><X size={18} /></button>
          <span className="donate-icon"><Info size={22} /></span>
          <span className="step-label">ABOUT THIS PROJECT</span>
          <h2 id="about-title">ZiConvert</h2>
          <p id="about-description">A browser-based font studio for converting desktop fonts into display-ready ZI files for Nextion and USART HMI. Local font files are processed on your device.</p>
          <div className="about-developer"><span>CREATED &amp; MAINTAINED BY</span><b>baaaaan1</b></div>
          <a className="donate-cta" href="https://github.com/baaaaan1" target="_blank" rel="noreferrer"><Github size={16} />Visit developer on GitHub <span>↗</span></a>
          <small>ZI v3 and v5 export · Free to use</small>
        </section>
      </div>}

      <section className="intro" id="top">
        <div className="eyebrow"><span>FONT ENGINEERING</span><span className="eyebrow-line" /><span>01 / 03</span></div>
        <div className="intro-row">
          <div>
            <h1>Make your type<br /><span>Nextion-ready.</span></h1>
            <p className="intro-copy">A focused little studio for turning desktop fonts into display-ready ZI files.</p>
          </div>
          <div className="intro-badge"><span className="badge-icon"><LockKeyhole size={17} /></span><span>Private by design<br /><b>Files stay on this device</b></span></div>
        </div>
      </section>

      <section className="workspace" aria-label="Font converter">
        <div className="control-panel">
          <div className="panel-heading"><div><span className="step-label">STEP 01</span><h2>Your font</h2></div><span className="heading-icon"><Type size={19} /></span></div>
          <div className="font-source-tabs" role="tablist" aria-label="Font source">
            <button role="tab" aria-selected={fontSource === 'local'} className={fontSource === 'local' ? 'source-tab active' : 'source-tab'} onClick={() => setFontSource('local')}><Upload size={14} />Local font</button>
            <button role="tab" aria-selected={fontSource === 'fontsource'} className={fontSource === 'fontsource' ? 'source-tab active' : 'source-tab'} onClick={() => setFontSource('fontsource')}><Search size={14} />Fontsource</button>
          </div>
          {font && (
            <div className="loaded-font"><span className="file-icon"><FileType2 size={21} /></span><span className="loaded-details"><b>{font.name}</b><small>{font.size ? `${(font.size / 1024).toFixed(0)} KB · local` : font.source}</small></span><button className="icon-button" aria-label="Remove font" onClick={resetFont}><X size={17} /></button></div>
          )}
          {fontSource === 'local' && !font && (
            <button className={`dropzone ${dragging ? 'is-dragging' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void loadFile(event.dataTransfer.files[0]) }}>
              <span className="upload-icon"><Upload size={21} /></span><strong>Drop your font here</strong><span>or <u>browse files</u></span><small>TTF / OTF · processed locally</small>
            </button>
          )}
          {fontSource === 'fontsource' && !font && <div className="fontsource-search">
            <label className="field"><span>Search open-source fonts</span><span className="search-input-wrap"><Search size={15} /><input className="text-input" value={fontSearch} onChange={event => setFontSearch(event.target.value)} placeholder="Try Roboto, Inter, Lato..." /></span></label>
            <div className="font-results" aria-live="polite">
              {fontLoading && <span className="font-result-hint">Searching Fontsource catalog...</span>}
              {!fontLoading && fontSearch.trim().length < 2 && <span className="font-result-hint">Search the Fontsource catalog. The chosen font loads directly from its CDN.</span>}
              {!fontLoading && fontSearch.trim().length >= 2 && fontResults.length === 0 && <span className="font-result-hint">No matching fonts. Try another name.</span>}
              {fontResults.map(result => <button type="button" className="font-result" key={result.id} onClick={() => void loadFontsource(result)}><span><b>{result.family}</b><small>{result.weights?.length ? `${result.weights.length} weights` : 'Open-source font'}</small></span><Plus size={16} /></button>)}
            </div>
          </div>}
          <input ref={inputRef} hidden type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = '' }} />

          <div className="section-divider" />
          <div className="panel-heading compact"><div><span className="step-label">STEP 02</span><h2>Character cell</h2></div><span className="mini-pill">FIXED WIDTH</span></div>
          <div className="dimensions-grid">
            <label className="field"><span>Width <small>PX</small></span><span className="number-wrap"><input type="number" min="1" max="255" value={width} onChange={event => setWidth(Number(event.target.value))} /><span>↔</span></span></label>
            <label className="field"><span>Height <small>PX</small></span><span className="number-wrap"><input type="number" min="1" max="255" value={height} onChange={event => setHeight(Number(event.target.value))} /><span>↕</span></span></label>
          </div>
          <label className="field font-size-field"><span>Quick font size <small>PRESET</small></span><select className="text-input preset-select" value={SIZE_PRESETS.findIndex(preset => preset.fontSize === fontSize && preset.width === width && preset.height === height)} onChange={event => applyPreset(Number(event.target.value))}><option value={-1}>Custom dimensions</option>{SIZE_PRESETS.map((preset, index) => <option key={preset.fontSize} value={index}>{preset.label} · cell {preset.width} × {preset.height}</option>)}</select></label>

          <div className="section-divider" />
          <div className="panel-heading compact"><div><span className="step-label">STEP 03</span><h2>Character scope</h2></div><span className="mini-pill">{characterSet.length} GLYPHS</span></div>
          <div className="scope-options" role="radiogroup" aria-label="Character set">
            <button className={characterMode === 'ascii' ? 'scope-option active' : 'scope-option'} role="radio" aria-checked={characterMode === 'ascii'} onClick={() => setCharacterMode('ascii')}><b>ASCII</b><small>95 printable characters</small></button>
            <button className={characterMode === 'all' ? 'scope-option active' : 'scope-option'} role="radio" aria-checked={characterMode === 'all'} onClick={() => setCharacterMode('all')}><b>All Latin-1</b><small>U+0020 to U+00FF</small></button>
            <button className={characterMode === 'custom' ? 'scope-option active' : 'scope-option'} role="radio" aria-checked={characterMode === 'custom'} onClick={() => setCharacterMode('custom')}><b>Custom</b><small>Specify characters</small></button>
          </div>
          {characterMode === 'custom' && <label className="field custom-characters"><span>Characters to include <small>SUPPORTED U+0020–U+00FF</small></span><textarea className="text-input custom-input" value={customCharacters} onChange={event => setCustomCharacters(event.target.value)} placeholder="Type or paste characters..." rows={2} /><small className="field-help">ZI v3 stores a continuous range. Any gaps between selected characters are included in the output.</small></label>}

          <div className="section-divider" />
          <div className="panel-heading compact output-heading"><div><span className="step-label">STEP 04</span><h2>Output format</h2></div><span className="format-label">.ZI</span></div>
          <label className="format-select"><span className="format-version">V{ziVersion}</span><span><b>Nextion / USART HMI ZI v{ziVersion}</b><small>{ziVersion === 5 ? 'Variable-width · 3-bit compressed bitmap · full charset only' : 'Monochrome · contiguous character range'}</small></span><select aria-label="ZI version" value={ziVersion} onChange={event => setZiVersion(Number(event.target.value) as ZiVersion)}><option value={3}>V3</option><option value={5}>V5</option></select><ChevronDown size={16} /></label>
          <label className="field filename-field"><span>Font name <small>IN FILE HEADER</small></span><input className="text-input" value={outputName} maxLength={255} onChange={event => setFontName(safeName(event.target.value.replace(filenameSuffix, '')))} placeholder={`my_font${filenameSuffix}`} /></label>
          <div className="character-info"><span><b>{characterSet.length}</b> glyphs</span><span>U+{(characterSet[0] ?? 0).toString(16).toUpperCase()}–U+{(characterSet.at(-1) ?? 0).toString(16).toUpperCase()}</span><span>~{(estimatedSize / 1024).toFixed(1)} KB</span></div>
          {error && <div className="message error-message" role="alert"><Info size={16} />{error}</div>}
          {notice && !error && <div className="message success-message" role="status"><Check size={15} />{notice}</div>}
          {ziVersion === 5 && !v5Compatible && <div className="message error-message" role="alert"><Info size={16} />ZI v5 requires the complete ASCII or Latin-1 character set. Use V3 in Custom mode.</div>}
          <button className="export-button" disabled={!font || !characterSet.length || glyphData.length !== characterSet.length || clipped.length > 0 || !v5Compatible || width < 1 || height < 1 || width > 255 || height > 255 || (ziVersion === 3 && (width * height) % 8 !== 0)} onClick={exportFont}><ArrowDownToLine size={18} />Export .zi v{ziVersion}<span>↗</span></button>
          <p className="privacy-note"><LockKeyhole size={12} />{font?.size ? 'Local font is never uploaded.' : 'Fontsource fonts load from its CDN.'}</p>
        </div>

        <div className="workspace-main">
        <div className="preview-panel">
          <div className="preview-topline"><div><span className="step-label">LIVE PREVIEW</span><h2>Character map</h2></div><span className="preview-count">{glyphData.length ? `${glyphData.length} / ${characterSet.length} READY` : 'AWAITING FONT'}</span></div>
          <div className="preview-stage">
            <div className="stage-toolbar"><span><span className="stage-dot" />BITMAP OUTPUT</span><span>{width} × {height} PX</span></div>
            <div className="glyph-grid" aria-label="Character preview">
              {glyphData.length ? glyphData.map(glyph => <button key={glyph.codePoint} className={`glyph-tile ${selectedGlyph === glyph.codePoint ? 'selected' : ''} ${clipped.includes(glyph.codePoint) ? 'clipped' : ''}`} onClick={() => setSelectedGlyph(glyph.codePoint)} title={`${String.fromCodePoint(glyph.codePoint)} · U+${glyph.codePoint.toString(16).toUpperCase()}`}>{glyph.codePoint === 0x20 || glyph.codePoint === 0xa0 ? <span className="space-glyph">·</span> : <img src={makeGlyphCanvas(glyph)} alt={String.fromCodePoint(glyph.codePoint)} />}</button>) : <div className="empty-preview"><span className="empty-orbit"><MousePointer2 size={25} /></span><b>Your glyphs will appear here</b><span>Choose a font to build your character map.</span></div>}
            </div>
            {clipped.length > 0 && <div className="clip-warning"><Info size={14} />{clipped.length} glyphs may touch or exceed the cell boundary.</div>}
          </div>
          <div className="detail-row">
            <div className="selected-character"><span className="detail-caption">SELECTED GLYPH</span><span className="large-glyph">{preview && selectedGlyph !== 0x20 && selectedGlyph !== 0xa0 ? <img src={makeGlyphCanvas(preview)} alt="" /> : <i>space</i>}</span><span className="code-label">U+{selectedGlyph.toString(16).toUpperCase().padStart(4, '0')} <b>·</b> {selectedGlyph}</span></div>
            <div className="detail-stats"><div><span>Cell dimensions</span><b>{width} × {height} <small>PX</small></b></div><div><span>Pixel depth</span><b>{ziVersion === 5 ? '3' : '1'} <small>BIT / PX</small></b></div><div><span>Character set</span><b>{characterSet.length} <small>GLYPHS</small></b></div></div>
          </div>
          <div className="preview-footer"><span><span className="footer-check"><Check size={11} /></span>Output is internally validated before download</span><span>ZI FORMAT <b>V{ziVersion}</b></span></div>
        </div>

        <section className="simulator-panel" aria-labelledby="simulator-title">
        <div className="simulator-heading">
          <div><span className="step-label">TRY BEFORE EXPORT</span><h2 id="simulator-title">Typing simulator</h2><p>Type a sample and see how it fits the current character cell.</p></div>
          <span className="simulator-icon"><Keyboard size={19} /></span>
        </div>
        <div className="simulator-layout">
          <div className="simulator-controls">
            <label className="field" htmlFor="simulator-input"><span>Preview text <small>{simulatorCharacters.length} / 120</small></span><textarea id="simulator-input" className="text-input simulator-input" value={simulatorText} maxLength={120} onChange={event => setSimulatorText(event.target.value)} placeholder="Type text to preview..." rows={4} /></label>
            <div className="simulator-actions"><button type="button" className="sample-button" onClick={() => setSimulatorText(SAMPLE_TEXT)}>Sample text</button><button type="button" className="sample-button reset-sample" onClick={() => setSimulatorText('')}><RotateCcw size={13} />Clear</button></div>
            <label className="field simulator-scale"><span>Preview scale <small>{simulatorScale}×</small></span><input type="range" min="1" max="4" step="1" value={simulatorScale} onChange={event => setSimulatorScale(Number(event.target.value))} /></label>
          </div>
          <div className="simulator-output">
            <div className="stage-toolbar"><span><span className="stage-dot" />FIXED CELL · {font ? font.name : 'NO FONT LOADED'}</span><span>{width} × {height} PX</span></div>
            {font ? <div className="typing-cells" aria-label="Typing preview" style={{ '--cell-width': `${width * simulatorScale}px`, '--cell-height': `${height * simulatorScale}px`, '--cell-font-size': `${fontSize * simulatorScale}px`, '--preview-font': font.family } as CSSProperties}>
              {simulatorCharacters.length ? simulatorCharacters.map((character, index) => character === '\n' ? <span className="typing-break" key={`${index}-break`} /> : <span className={`typing-cell ${unsupportedCharacters.includes(character) ? 'unsupported' : ''}`} key={`${index}-${character}`} title={unsupportedCharacters.includes(character) ? `U+${character.codePointAt(0)!.toString(16).toUpperCase()} is outside the selected character set` : undefined}>{character === ' ' ? <i /> : character}</span>) : <span className="simulator-placeholder">Start typing to test your font...</span>}
            </div> : <div className="simulator-empty"><Type size={19} /><span>Load a font to preview your typing.</span></div>}
            <div className="simulator-meta"><span><b>{simulatorCharacters.length}</b> characters</span><span><b>{width} × {height}</b> px cell</span><span className={unsupportedCharacters.length ? 'unsupported-note' : ''}>{unsupportedCharacters.length ? `${unsupportedCharacters.length} character(s) outside character set` : 'All characters included'}</span></div>
          </div>
        </div>
        </section>
        </div>
      </section>

      <section className="bottom-strip"><div><span className="strip-icon"><Info size={16} /></span><span><b>About ZI v{ziVersion}</b><small>{ziVersion === 5 ? 'Variable-width, compressed 3-bit character data for USART HMI.' : 'Fixed-width, 1-bit character data for Nextion displays.'}</small></span></div><span className="roadmap-tag"><span /> V5 AVAILABLE · V6 ON THE ROADMAP</span></section>
      <footer className="footer"><span>ZiConvert <b>·</b> A tiny tool for tiny screens.</span><span>MADE FOR NEXTION <span className="footer-star">✳</span></span></footer>
    </main>
  )
}

export default App
