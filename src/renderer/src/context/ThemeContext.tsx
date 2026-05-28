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
  accent:          '#00c8ff',
  accentBg:        'rgba(0,200,255,0.06)',
  accentGlow:      'rgba(0,200,255,0.4)',
  border:          'rgba(0,200,255,0.16)',
  borderMid:       'rgba(0,200,255,0.35)',
  borderHi:        'rgba(0,200,255,0.65)',
  label:           '#8a8a8a',
  labelDim:        '#5a5a5a',
  userBubbleBg:    'rgba(0,144,180,0.12)',
  userBubbleBorder:'rgba(0,200,255,0.28)',
  userBubbleText:  '#e8e8e8',
  aiBubbleBg:      'rgba(4,11,22,0.97)',
  aiBubbleBorder:  'rgba(0,200,255,0.16)',
  aiBubbleText:    '#d0d0d0',
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
  accent:          '#0077bb',
  accentBg:        'rgba(0,100,180,0.06)',
  accentGlow:      'rgba(0,100,180,0.3)',
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
  const [theme, setTheme] = useState<ThemeMode>(
    () => (localStorage.getItem('pd-theme') as ThemeMode | null) ?? 'dark'
  )

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
