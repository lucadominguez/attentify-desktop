import React, { createContext, useContext, useState, useEffect } from 'react'

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
  blurSm:          'blur(10px) saturate(140%)',
  blurMd:          'blur(20px) saturate(150%)',
  blurLg:          'blur(30px) saturate(160%)',
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
  blurSm:          'blur(10px) saturate(130%)',
  blurMd:          'blur(20px) saturate(140%)',
  blurLg:          'blur(30px) saturate(150%)',
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
}

const ThemeContext = createContext<ThemeCtx>({
  theme: 'dark',
  colors: DARK,
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('pd-theme') as ThemeMode | null
    if (stored === 'dark' || stored === 'light') return stored
    // First run: follow the OS preference.
    try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' } catch { return 'dark' }
  })

  useEffect(() => {
    const colors = theme === 'dark' ? DARK : LIGHT
    applyCssVars(colors)
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('pd-theme', theme)
  }, [theme])

  const toggle = (): void => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  const colors = theme === 'dark' ? DARK : LIGHT

  return (
    <ThemeContext.Provider value={{ theme, colors, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext)
}
