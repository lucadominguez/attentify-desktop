import React, { useEffect, useState, useCallback } from 'react'
import { User, LogOut, Mail, Lock, Check, RefreshCw, Github } from 'lucide-react'
import type { AuthState, AuthProvider } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// Brand marks for the social sign-in buttons (inline so nothing loads from the network).
const GoogleIcon = ({ size = 14 }: { size?: number }): React.ReactElement => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
    <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
    <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
    <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
  </svg>
)
const FacebookIcon = ({ size = 14 }: { size?: number }): React.ReactElement => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#1877F2" d="M24 12c0-6.63-5.37-12-12-12S0 5.37 0 12c0 5.99 4.39 10.95 10.13 11.85v-8.38H7.08V12h3.05V9.36c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.68.23 2.68.23v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87V12h3.33l-.53 3.47h-2.8v8.38C19.61 22.95 24 17.99 24 12z" />
  </svg>
)
const MicrosoftIcon = ({ size = 14 }: { size?: number }): React.ReactElement => (
  <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden="true">
    <path fill="#F25022" d="M1 1h10v10H1z" /><path fill="#7FBA00" d="M12 1h10v10H12z" />
    <path fill="#00A4EF" d="M1 12h10v10H1z" /><path fill="#FFB900" d="M12 12h10v10H12z" />
  </svg>
)
const PROVIDER_META: Record<AuthProvider, { label: string; icon: React.ReactElement }> = {
  google: { label: 'Continue with Google', icon: <GoogleIcon /> },
  microsoft: { label: 'Continue with Microsoft', icon: <MicrosoftIcon /> },
  facebook: { label: 'Continue with Facebook', icon: <FacebookIcon /> },
  github: { label: 'Continue with GitHub', icon: <Github size={14} /> },
}

// In-app account: sign in or create an account (email + password) against the cloud
// backend. Establishes identity; subscription/AI gating is handled separately.
export default function AuthPanel({ onChange }: { onChange?: () => void }): React.ReactElement {
  const { colors } = useTheme()
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [providers, setProviders] = useState<AuthProvider[]>([])

  const load = useCallback(() => { api.getAuth?.().then(setAuth).catch(() => setAuth(null)) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { api.getAuthProviders?.().then(setProviders).catch(() => setProviders([])) }, [])

  const providerLogin = async (provider: AuthProvider): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await api.signInWithProvider(provider)
      if (res.ok && res.auth) { setAuth(res.auth); onChange?.() }
      else setError(res.error || 'Sign-in could not be completed.')
    } catch { setError('Sign-in could not be completed. Try again.') }
    setBusy(false)
  }

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = mode === 'signup'
        ? await api.signUp(email.trim(), password)
        : await api.signIn(email.trim(), password)
      if (res.ok && res.auth) {
        setAuth(res.auth); setEmail(''); setPassword(''); onChange?.()
      } else {
        setError(res.error || 'Something went wrong.')
      }
    } catch { setError('Something went wrong. Try again.') }
    setBusy(false)
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try { const res = await api.signOut(); setAuth(res.auth); onChange?.() } catch { /* ignore */ }
    setBusy(false)
  }

  const field = (icon: React.ReactNode, type: string, value: string, set: (v: string) => void, placeholder: string): React.ReactElement => (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: colors.inputBg, border: `1px solid ${colors.border}` }}>
      <span style={{ color: colors.textMuted, flexShrink: 0 }}>{icon}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => { set(e.target.value); setError('') }}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        placeholder={placeholder}
        disabled={busy}
        autoComplete={type === 'password' ? (mode === 'signup' ? 'new-password' : 'current-password') : 'email'}
        className="flex-1 bg-transparent text-[12px] outline-none disabled:opacity-60"
        style={{ color: colors.textPrimary, caretColor: colors.accent }}
      />
    </div>
  )

  // Signed in
  if (auth?.signedIn) {
    const tierLabel = auth.subscribed ? 'Cloud' : (auth.tier || 'Free')
    return (
      <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: colors.accentBg, border: `1px solid ${colors.border}` }}>
            <User size={16} style={{ color: colors.accent }} />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium truncate" style={{ color: colors.textPrimary }}>{auth.email}</p>
            <p className="text-[10px] mt-0.5 flex items-center gap-1.5" style={{ color: colors.textMuted }}>
              Signed in
              <span className="px-1.5 py-0.5 rounded" style={{ background: auth.subscribed ? colors.positiveBg : colors.accentBg, color: auth.subscribed ? colors.positive : colors.accent }}>{tierLabel}</span>
            </p>
          </div>
        </div>
        <button onClick={() => void signOut()} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all disabled:opacity-50 flex-shrink-0"
          style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, color: colors.textMuted }}>
          <LogOut size={12} /> Sign out
        </button>
      </div>
    )
  }

  // Signed out, social sign-in + sign in / create account
  return (
    <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      {providers.length > 0 && (
        <div className="mb-3">
          <div className="space-y-2">
            {providers.map((p) => (
              <button key={p} onClick={() => void providerLogin(p)} disabled={busy}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-medium transition-all disabled:opacity-40 hover:brightness-105"
                style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}>
                {PROVIDER_META[p].icon}
                {PROVIDER_META[p].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 my-3">
            <div className="flex-1 h-px" style={{ background: colors.border }} />
            <span className="text-[9.5px] uppercase tracking-wider" style={{ color: colors.textDim }}>or use email</span>
            <div className="flex-1 h-px" style={{ background: colors.border }} />
          </div>
        </div>
      )}
      <div className="flex items-center gap-1 mb-3">
        {(['signin', 'signup'] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setError('') }}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
            style={{
              background: mode === m ? colors.accentBg : 'transparent',
              border: `1px solid ${mode === m ? colors.borderMid : colors.border}`,
              color: mode === m ? colors.accent : colors.textMuted,
            }}>
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {field(<Mail size={13} />, 'email', email, setEmail, 'you@example.com')}
        {field(<Lock size={13} />, 'password', password, setPassword, mode === 'signup' ? 'Create a password (8+ chars)' : 'Password')}
        {error && <p className="text-[10px]" style={{ color: colors.negative }}>{error}</p>}
        <button onClick={() => void submit()} disabled={busy || !email.trim() || !password}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all disabled:opacity-40"
          style={{ background: colors.accent, color: '#fff' }}>
          {busy ? <><RefreshCw size={13} className="animate-spin" /> Please wait…</>
            : mode === 'signup' ? <><Check size={13} /> Create account</> : <><User size={13} /> Sign in</>}
        </button>
        <p className="text-[9.5px] leading-snug" style={{ color: colors.textDim }}>
          {mode === 'signup'
            ? 'Creating an account syncs your settings and unlocks Cloud when you subscribe. Your password is hashed on the server; it never leaves your device in the clear.'
            : 'Use the same account as the website. Sessions last 30 days.'}
        </p>
      </div>
    </div>
  )
}
