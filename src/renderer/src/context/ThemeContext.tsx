import React, { createContext, useContext, useState, useEffect, useMemo } from 'react'

export type ThemeMode = 'dark' | 'light'

// ── Color tokens ──────────────────────────────────────────────────────────────

export interface ThemeColors {
  rootBg: string
  mainBg: string
  panelBg: string
  cardBg: string
  inputBg: string
  rowEven: string
  rowOdd: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textDim: string
  accent: string
  accentBg: string
  accentGlow: string
  // Semantic palette — harmonized "Slate & Violet" set. Use these instead of raw
  // hex so good/bad cues stay consistent app-wide and adapt to light/dark.
  brand: string        // logo blue — links, brand touches
  positive: string     // focused / good
  positiveBg: string
  warning: string      // caution / mixed
  warningBg: string
  negative: string     // distraction / bad
  negativeBg: string
  border: string
  borderMid: string
  borderHi: string
  label: string
  labelDim: string
  userBubbleBg: string
  userBubbleBorder: string
  userBubbleText: string
  aiBubbleBg: string
  aiBubbleBorder: string
  aiBubbleText: string

  // ── Glass ───────────────────────────────────────────────────────────────────
  // Translucency is what makes glass; blur only keeps what shows through from
  // becoming noise behind text. Surfaces below MUST stay meaningfully transparent,
  // or the blur costs GPU and buys nothing (which is exactly what the overlay did
  // for months at 0.97 alpha).
  //
  // Three depths, used consistently:
  //   glassLow  — the sidebar and other large structural planes
  //   glassMid  — cards and panels floating on the app's backdrop
  //   glassHigh — popovers and modals that float above everything
  glassLow: string
  glassMid: string
  glassHigh: string
  /** Hairline edge. Light catches the top of a pane, so pair with glassTopLight. */
  glassEdge: string
  /** inset highlight along the top edge */
  glassTopLight: string
  /** Blur radii, kept few on purpose: every blurred layer is GPU work in an app that runs 24/7. */
  blurSm: string
  blurMd: string
  blurLg: string
  /** Elevation shadows, tuned per theme (dark needs depth, light needs softness). */
  elevLow: string
  elevMid: string
  elevHigh: string
}

const DARK: ThemeColors = {
  rootBg:          '#020912',
  mainBg:          '#030c1a',
  panelBg:         'rgba(4,11,22,0.97)',
  cardBg:          'rgba(6,14,28,0.92)',
  inputBg:         'rgba(3,9,18,0.98)',
  rowEven:         'rgba(4,11,22,0.8)',
  rowOdd:          'rgba(6,15,28,0.5)',
  textPrimary:     '#e8e8e8',
  textSecondary:   '#9a9a9a',
  textMuted:       '#6a6a6a',
  textDim:         '#4a4a4a',
  accent:          '#6366f1',
  accentBg:        'rgba(99,102,241,0.06)',
  accentGlow:      'rgba(99,102,241,0.4)',
  brand:           '#3b9eff',
  positive:        '#34d399',
  positiveBg:      'rgba(52,211,153,0.10)',
  warning:         '#fbbf24',
  warningBg:       'rgba(251,191,36,0.10)',
  negative:        '#f87171',
  negativeBg:      'rgba(248,113,113,0.10)',
  border:          'rgba(99,102,241,0.16)',
  borderMid:       'rgba(99,102,241,0.35)',
  borderHi:        'rgba(99,102,241,0.65)',
  label:           '#8a8a8a',
  labelDim:        '#5a5a5a',
  userBubbleBg:    'rgba(0,144,180,0.12)',
  userBubbleBorder:'rgba(99,102,241,0.28)',
  userBubbleText:  '#e8e8e8',
  aiBubbleBg:      'rgba(4,11,22,0.97)',
  aiBubbleBorder:  'rgba(99,102,241,0.16)',
  aiBubbleText:    '#d0d0d0',

  glassLow:        'rgba(6,14,28,0.55)',
  glassMid:        'rgba(10,20,38,0.42)',
  glassHigh:       'rgba(12,22,42,0.72)',
  glassEdge:       'rgba(255,255,255,0.10)',
  glassTopLight:   'inset 0 1px 0 rgba(255,255,255,0.12)',
  blurSm:          'blur(12px)',
  blurMd:          'blur(24px)',
  blurLg:          'blur(36px)',
  elevLow:         '0 2px 10px rgba(0,0,0,0.30)',
  elevMid:         '0 10px 30px rgba(0,0,0,0.42)',
  elevHigh:        '0 24px 64px rgba(0,0,0,0.55)',
}

const LIGHT: ThemeColors = {
  rootBg:          '#f4f7fb',
  mainBg:          '#edf1f7',
  panelBg:         'rgba(255,255,255,0.98)',
  cardBg:          'rgba(250,251,253,0.97)',
  inputBg:         'rgba(255,255,255,0.98)',
  rowEven:         'rgba(246,248,252,0.95)',
  rowOdd:          'rgba(238,242,250,0.65)',
  textPrimary:     '#111111',
  textSecondary:   '#555555',
  textMuted:       '#888888',
  textDim:         '#aaaaaa',
  accent:          '#4f46e5',
  accentBg:        'rgba(79,70,229,0.06)',
  accentGlow:      'rgba(79,70,229,0.3)',
  brand:           '#2563eb',
  positive:        '#059669',
  positiveBg:      'rgba(5,150,105,0.10)',
  warning:         '#d97706',
  warningBg:       'rgba(217,119,6,0.10)',
  negative:        '#dc2626',
  negativeBg:      'rgba(220,38,38,0.10)',
  border:          'rgba(0,0,0,0.1)',
  borderMid:       'rgba(0,0,0,0.2)',
  borderHi:        'rgba(0,0,0,0.35)',
  label:           '#444444',
  labelDim:        '#888888',
  userBubbleBg:    'rgba(0,100,180,0.08)',
  userBubbleBorder:'rgba(0,0,0,0.12)',
  userBubbleText:  '#111111',
  aiBubbleBg:      'rgba(255,255,255,0.98)',
  aiBubbleBorder:  'rgba(0,0,0,0.1)',
  aiBubbleText:    '#1a1a1a',

  // Light glass is not dark glass inverted. Frosted white over a light backdrop has
  // far less contrast to work with, so the edge does the load-bearing separation (a
  // soft dark hairline, not a bright rim) and the shadows are cool-tinted and soft
  // rather than black and deep. Alphas sit higher than dark's for the same reason:
  // text needs something to sit on.
  glassLow:        'rgba(255,255,255,0.60)',
  glassMid:        'rgba(255,255,255,0.52)',
  glassHigh:       'rgba(255,255,255,0.82)',
  glassEdge:       'rgba(15,23,42,0.10)',
  glassTopLight:   'inset 0 1px 0 rgba(255,255,255,0.85)',
  blurSm:          'blur(12px)',
  blurMd:          'blur(24px)',
  blurLg:          'blur(36px)',
  elevLow:         '0 2px 10px rgba(15,23,42,0.06)',
  elevMid:         '0 10px 30px rgba(15,23,42,0.10)',
  elevHigh:        '0 24px 64px rgba(15,23,42,0.16)',
}

// CSS variable names mirror the colors object keys (kebab-case)
function applyCssVars(c: ThemeColors): void {
  const el = document.documentElement
  el.style.setProperty('--root-bg',           c.rootBg)
  el.style.setProperty('--main-bg',           c.mainBg)
  el.style.setProperty('--panel-bg',          c.panelBg)
  el.style.setProperty('--card-bg',           c.cardBg)
  el.style.setProperty('--input-bg',          c.inputBg)
  el.style.setProperty('--row-even',          c.rowEven)
  el.style.setProperty('--row-odd',           c.rowOdd)
  el.style.setProperty('--text-primary',      c.textPrimary)
  el.style.setProperty('--text-secondary',    c.textSecondary)
  el.style.setProperty('--text-muted',        c.textMuted)
  el.style.setProperty('--text-dim',          c.textDim)
  el.style.setProperty('--accent',            c.accent)
  el.style.setProperty('--accent-bg',         c.accentBg)
  el.style.setProperty('--accent-glow',       c.accentGlow)
  el.style.setProperty('--glass-low',         c.glassLow)
  el.style.setProperty('--glass-mid',         c.glassMid)
  el.style.setProperty('--glass-high',        c.glassHigh)
  el.style.setProperty('--glass-edge',        c.glassEdge)
  el.style.setProperty('--glass-top-light',   c.glassTopLight)
  el.style.setProperty('--blur-sm',           c.blurSm)
  el.style.setProperty('--blur-md',           c.blurMd)
  el.style.setProperty('--blur-lg',           c.blurLg)
  el.style.setProperty('--elev-low',          c.elevLow)
  el.style.setProperty('--elev-mid',          c.elevMid)
  el.style.setProperty('--elev-high',         c.elevHigh)
  el.style.setProperty('--brand',             c.brand)
  el.style.setProperty('--positive',          c.positive)
  el.style.setProperty('--positive-bg',       c.positiveBg)
  el.style.setProperty('--warning',           c.warning)
  el.style.setProperty('--warning-bg',        c.warningBg)
  el.style.setProperty('--negative',          c.negative)
  el.style.setProperty('--negative-bg',       c.negativeBg)
  el.style.setProperty('--border',            c.border)
  el.style.setProperty('--border-mid',        c.borderMid)
  el.style.setProperty('--border-hi',         c.borderHi)
  el.style.setProperty('--label',             c.label)
  el.style.setProperty('--label-dim',         c.labelDim)
}

// ── Context ───────────────────────────────────────────────────────────────────

interface ThemeCtx {
  theme: ThemeMode
  colors: ThemeColors
  toggle: () => void
  /** The full-glass experiment: every surface translucent, not just the overlays. */
  glass: boolean
  toggleGlass: () => void
  /** 0.15 - 0.9. How solid the glass is; 0.5 is the tuned default. */
  glassOpacity: number
  setGlassOpacity: (v: number) => void
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'dark',
  colors: DARK,
  toggle: () => {},
  glass: false,
  toggleGlass: () => {},
  glassOpacity: 0.5,
  setGlassOpacity: () => {},
})

// ── ARCHIVED: the full-glass experiment ──────────────────────────────────────
//
// Shelved 2026-07-15 at the user's request, not deleted. The mechanism works (the
// window really does go see-through via Windows 11 acrylic; see window:set-glass in
// main/index.ts), but the look was not worth keeping yet.
//
// To bring it back: set this true and restore the toggle + opacity slider in
// views/Settings.tsx (see the commit that archived this). The tokens, withGlass(),
// the CSS in globals.css and the native acrylic path all remain wired.
//
// What was learned, so it is not re-discovered the hard way:
//   • saturate() on a blur of the desktop smears colour everywhere. Never use it.
//   • Only ONE plane may carry backdrop-filter; nested blurs compound into mush.
//   • Coloured ambient washes and a see-through window do not mix.
//   • Below ~0.25 alpha the desktop reads through the text.
//   • backgroundMaterial is only reliably applied when the window is CREATED, so the
//     pref must live in the store where main can read it at construction.
const GLASS_EXPERIMENT_ENABLED = false

// The experiment, in one function.
//
// Full glass is ONE swap: the opaque surface tokens are replaced by the translucent
// ones that already exist, and a CSS rule adds the blur (backdrop-filter cannot ride on
// a colour token). Because every panel in the app reads cardBg/panelBg/inputBg from
// here, that single swap reaches the whole app, and turning it off restores the exact
// original values. That is what makes it genuinely revertible: there is no second
// codebase to unwind, just a boolean.
/** Rewrite an rgba()'s alpha. The glass tokens are all rgba, so opacity is one knob. */
function alpha(rgba: string, mul: number): string {
  const m = rgba.match(/rgba?\(([^)]+)\)/)
  if (!m) return rgba
  const p = m[1]!.split(',').map((x) => x.trim())
  const a = p.length > 3 ? Number(p[3]) : 1
  // Clamped so the slider can never make text unreadable at one end or kill the effect
  // at the other.
  const next = Math.max(0.06, Math.min(0.97, a * mul))
  return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${next.toFixed(3)})`
}

// Glass is ONE neutral tint at one opacity, over a plain blur. Nothing else.
//
// The first attempt layered a tinted rootBg, differently-tinted panels, saturated blurs
// and the coloured ambient wash on top of a see-through window. Every one of those is
// defensible alone; together, over a live desktop, they read as a psychedelic smear
// rather than glass. Cluely's look is restraint: you see your desktop, dimmed, through
// one sheet of frosted dark.
function withGlass(c: ThemeColors, opacity: number, dark: boolean): ThemeColors {
  // The single sheet. Neutral near-black on dark, neutral white on light; the slider is
  // the alpha directly, so what the user sets is what they get.
  const sheet = (a: number): string => (dark
    ? `rgba(8, 12, 20, ${Math.max(0.05, Math.min(0.95, a)).toFixed(3)})`
    : `rgba(248, 250, 252, ${Math.max(0.05, Math.min(0.95, a)).toFixed(3)})`)

  return {
    ...c,
    // Only ONE surface tints: the page. Panels sit on it with a barely-there lift, or
    // each nested pane would darken the one behind it until nothing shows through.
    rootBg: sheet(opacity),
    mainBg: 'transparent',
    panelBg: sheet(Math.min(0.95, opacity + 0.06)),
    cardBg: sheet(Math.min(0.95, opacity + 0.04)),
    inputBg: sheet(Math.min(0.95, opacity + 0.08)),
    rowEven: 'transparent',
    rowOdd: sheet(Math.min(0.95, opacity + 0.03)),
    aiBubbleBg: sheet(Math.min(0.95, opacity + 0.04)),
    glassLow: sheet(Math.min(0.95, opacity + 0.02)),
    glassMid: sheet(Math.min(0.95, opacity + 0.04)),
    // Modals must stay readable: they are the one place the desktop should not show.
    glassHigh: sheet(Math.min(0.96, opacity + 0.35)),
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('pd-theme') as ThemeMode | null
    if (stored === 'dark' || stored === 'light') return stored
    // First run: follow the OS preference.
    try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' } catch { return 'dark' }
  })
  // localStorage, not the store: a look is a per-window view preference, and routing it
  // through IPC would put it behind the sign-in gate.
  const [glass, setGlass] = useState<boolean>(() => GLASS_EXPERIMENT_ENABLED && localStorage.getItem('pd-glass') === '1')
  const [glassOpacity, setGlassOpacity] = useState<number>(() => {
    const v = Number(localStorage.getItem('pd-glass-opacity'))
    return Number.isFinite(v) && v >= 0.25 && v <= 0.9 ? v : 0.6
  })

  const colors = useMemo(() => {
    const base = theme === 'dark' ? DARK : LIGHT
    return glass ? withGlass(base, glassOpacity, theme === 'dark') : base
  }, [theme, glass, glassOpacity])

  // Hydrate from the store, which is what main reads when it creates the window. Without
  // this the renderer and the window could disagree: panels glassy, window still opaque.
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { getStore?: () => Promise<{ settings?: { fullGlass?: boolean; glassOpacity?: number } }> } }).electronAPI
    api?.getStore?.().then((st) => {
      if (GLASS_EXPERIMENT_ENABLED && typeof st?.settings?.fullGlass === 'boolean') setGlass(st.settings.fullGlass)
      const o = st?.settings?.glassOpacity
      if (typeof o === 'number' && o >= 0.25 && o <= 0.9) setGlassOpacity(o)
    }).catch(() => { /* keep the localStorage value */ })
  }, [])

  useEffect(() => {
    applyCssVars(colors)
    document.documentElement.classList.toggle('light', theme === 'light')
    // Drives the blur rule in globals.css. Blur is GPU work on a 24/7 app, so it is
    // opt-in and scoped to panels rather than applied to everything.
    document.documentElement.dataset.glass = glass ? 'full' : 'off'
    // CSS can only ever reveal the app's own background. Seeing the DESKTOP requires the
    // native window to stop painting one, so ask main to switch the window material.
    // Reports false on Windows 10 (acrylic is 11-only); the app just stays opaque there.
    void (window as unknown as { electronAPI?: { setWindowGlass?: (v: boolean) => Promise<unknown> } })
      .electronAPI?.setWindowGlass?.(glass)?.catch?.(() => { /* not supported here */ })
    localStorage.setItem('pd-theme', theme)
    localStorage.setItem('pd-glass', glass ? '1' : '0')
    localStorage.setItem('pd-glass-opacity', String(glassOpacity))
    const api = (window as unknown as { electronAPI?: { getStore?: () => Promise<Record<string, unknown>>; setStore?: (p: Record<string, unknown>) => Promise<unknown> } }).electronAPI
    api?.getStore?.().then((st) => {
      const cur = (st.settings ?? {}) as Record<string, unknown>
      if (cur.fullGlass === glass && cur.glassOpacity === glassOpacity) return
      return api.setStore?.({ settings: { ...cur, fullGlass: glass, glassOpacity } })
    }).catch(() => { /* view pref; localStorage already has it */ })
  }, [theme, glass, glassOpacity, colors])

  const toggle = (): void => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  const toggleGlass = (): void => { if (GLASS_EXPERIMENT_ENABLED) setGlass((g) => !g) }

  return (
    <ThemeContext.Provider value={{ theme, colors, toggle, glass, toggleGlass, glassOpacity, setGlassOpacity }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext)
}
