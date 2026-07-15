import React, { useState, useEffect } from 'react'
import { Shield, Zap, Bell, Key, CheckCircle, Sparkles, Sun, Moon, TrendingUp, ChevronRight, RotateCcw, History, AlertTriangle, RefreshCw, Cpu, XCircle } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import type { AppStore, UsageState, CloudState, ViewName, ChangeEntry, UpdateStatus, CompatReport, CompatStatus } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface SettingsProps {
  store: AppStore
  onRefresh: () => void
  onNavigate?: (view: ViewName) => void
}

// Semantic status colors (Slate & Violet palette): emerald ok, amber degraded, coral broken.
const COMPAT_COLOR: Record<CompatStatus, string> = { ok: '#34d399', warn: '#fbbf24', fail: '#f87171' }

function CompatIcon({ status }: { status: CompatStatus }): React.ReactElement {
  const color = COMPAT_COLOR[status]
  if (status === 'ok') return <CheckCircle size={12} style={{ color, flexShrink: 0, marginTop: 1 }} />
  if (status === 'warn') return <AlertTriangle size={12} style={{ color, flexShrink: 0, marginTop: 1 }} />
  return <XCircle size={12} style={{ color, flexShrink: 0, marginTop: 1 }} />
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span style={{ color: 'rgba(99,102,241,0.6)' }}>{icon}</span>
      <span
        className="text-[9px] font-bold uppercase tracking-widest"
        style={{ color: 'rgba(99,102,241,0.5)', fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.2em' }}
      >
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.08)' }} />
    </div>
  )
}

export default function SettingsView({ store, onRefresh, onNavigate }: SettingsProps): React.ReactElement {
  const { colors, theme, toggle } = useTheme()
  const currentMode = store.settings.blockingMode ?? 'auto'
  const [apiInput, setApiInput] = useState('')
  const [apiSaved, setApiSaved] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<UsageState | null>(null)
  const [cloud, setCloud] = useState<CloudState | null>(null)
  const [licenseInput, setLicenseInput] = useState('')
  const [licenseBusy, setLicenseBusy] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [version, setVersion] = useState('')
  useEffect(() => { api.getAppVersion?.().then(setVersion).catch(() => {}) }, [])

  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    api.getUpdateStatus?.().then(setUpdate).catch(() => {})
    const off = api.onUpdateStatus?.((s) => setUpdate(s))
    return () => { off?.() }
  }, [])

  // Compatibility — probed on mount so a broken machine surfaces without being asked.
  const [compat, setCompat] = useState<CompatReport | null>(null)
  const [compatBusy, setCompatBusy] = useState(false)
  const runCompat = (): void => {
    setCompatBusy(true)
    api.runCompatCheck?.().then(setCompat).catch(() => {}).finally(() => setCompatBusy(false))
  }
  useEffect(() => { runCompat() }, [])

  // Safety & Recovery
  const [changeCount, setChangeCount] = useState<number | null>(null)
  const [changelog, setChangelog] = useState<ChangeEntry[] | null>(null)
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [revertResult, setRevertResult] = useState<{ ok: boolean; undone: string[]; errors: string[] } | null>(null)

  const refreshSafety = (): void => { api.getSafetyStatus().then((s) => setChangeCount(s.changeCount)).catch(() => {}) }

  const handleRevert = async (): Promise<void> => {
    setReverting(true)
    try {
      const res = await api.revertAllChanges()
      setRevertResult(res)
      setConfirmRevert(false)
      refreshSafety()
      onRefresh()
    } finally { setReverting(false) }
  }

  const toggleLog = async (): Promise<void> => {
    if (changelog) { setChangelog(null); return }
    try { setChangelog(await api.getChangeLog(200)) } catch { setChangelog([]) }
  }

  React.useEffect(() => {
    api.getApiKeyStatus().then((s) => setHasKey(s.hasKey))
    api.getUsage().then(setUsage).catch(() => {})
    api.getCloud().then(setCloud).catch(() => {})
    const off = api.onUsageChanged((u) => setUsage(u))
    return off
  }, [])

  useEffect(() => { refreshSafety() }, [])

  const saveLicense = async (): Promise<void> => {
    if (!licenseInput.trim()) return
    setLicenseBusy(true)
    const state = await api.setCloudLicense(licenseInput.trim())
    setCloud(state)
    setLicenseInput('')
    setLicenseBusy(false)
    api.getUsage().then(setUsage).catch(() => {})
  }

  const clearLicense = async (): Promise<void> => {
    const state = await api.clearCloudLicense()
    setCloud(state)
    api.getUsage().then(setUsage).catch(() => {})
  }

  const subscribe = async (): Promise<void> => {
    setCheckingOut(true)
    try {
      const res = await api.cloudCheckout()
      if (res.url) await api.openExternal(res.url)
    } catch { /* ignore */ }
    setCheckingOut(false)
  }

  const setMode = async (mode: 'auto' | 'ask'): Promise<void> => {
    await api.setStore({ settings: { ...store.settings, blockingMode: mode } })
    onRefresh()
  }

  const saveApiKey = async (): Promise<void> => {
    if (!apiInput.trim()) return
    await api.setApiKey(apiInput.trim())
    setApiInput('')
    setApiSaved(true)
    setHasKey(true)
    setTimeout(() => setApiSaved(false), 2500)
  }

  const deleteApiKey = async (): Promise<void> => {
    await api.deleteApiKey()
    setHasKey(false)
    onRefresh()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: colors.mainBg }}>
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-4"
        style={{ borderBottom: '1px solid rgba(99,102,241,0.08)' }}
      >
        <h1
          className="text-[13px] font-bold uppercase tracking-widest"
          style={{ color: colors.textPrimary, fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.2em' }}
        >
          Settings
        </h1>
        <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>
          Configure how Attentify responds to threats
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">

        {/* Account moved to the title-bar avatar (AccountMenu), always on screen. */}

        {/* ── Appearance ────────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={theme === 'dark' ? <Moon size={11} /> : <Sun size={11} />} label="Appearance" />
          <div
            className="flex items-center justify-between p-4 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div>
              <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>Theme</p>
              <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>
                {theme === 'dark' ? 'Dark, easier on the eyes at night' : 'Light, brighter for daytime'}
              </p>
            </div>
            <button
              onClick={toggle}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-all"
              style={{ background: colors.accentBg, border: `1px solid ${colors.border}`, color: colors.accent }}
            >
              {theme === 'dark' ? <><Sun size={13} /> Switch to light</> : <><Moon size={13} /> Switch to dark</>}
            </button>
          </div>
          {/* The liquid-glass toggle and its opacity slider lived here. Archived
              2026-07-15: the code is intact behind GLASS_EXPERIMENT_ENABLED in
              ThemeContext, so restoring it is flipping that flag and putting these two
              controls back. A toggle that cannot do anything is worse than no toggle,
              so it does not stay on screen while shelved. */}

          {/* Diagnostics sharing */}
          <div className="flex items-center justify-between p-4 rounded-lg mt-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="pr-3">
              <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>Share diagnostics</p>
              <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>
                Sends crash and freeze reports, recent app logs, a short excerpt of recent chat, and token
                usage, linked to your account so problems can be traced and fixed. Never passwords or API keys.
              </p>
            </div>
            <button
              onClick={() => api.setStore({ settings: { ...store.settings, shareDiagnostics: store.settings.shareDiagnostics === false } }).then(onRefresh)}
              className="flex-shrink-0 w-11 h-6 rounded-full transition-colors relative"
              style={{ background: store.settings.shareDiagnostics === false ? colors.border : colors.accent }}
              title="Toggle diagnostics sharing"
            >
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: store.settings.shareDiagnostics === false ? 2 : 22 }} />
            </button>
          </div>
          {/* Updates */}
          <div className="flex items-center justify-between p-4 rounded-lg mt-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="pr-3">
              <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>Updates</p>
              <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>
                Attentify{version ? ` v${version}` : ''} · {
                  update.state === 'ready' ? 'update ready, restart to install'
                  : update.state === 'downloading' ? `downloading${typeof update.percent === 'number' ? ` ${update.percent}%` : '…'}`
                  : update.state === 'available' ? 'update found, downloading'
                  : update.state === 'checking' ? 'checking…'
                  : update.state === 'error' ? 'check failed'
                  : update.state === 'dev' ? 'updates active in the installed app'
                  : 'up to date'
                }
              </p>
            </div>
            {update.state === 'ready' ? (
              <button onClick={() => void api.installUpdate?.()} className="flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-medium" style={{ background: colors.accent, color: '#fff' }}>
                Restart to update
              </button>
            ) : (
              <button onClick={() => { setUpdate({ state: 'checking' }); api.checkForUpdate?.().then(setUpdate).catch(() => {}) }}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium" style={{ background: colors.accentBg, border: `1px solid ${colors.border}`, color: colors.accent }}>
                <RefreshCw size={12} className={update.state === 'checking' ? 'animate-spin' : ''} /> Check now
              </button>
            )}
          </div>
        </section>

        {/* ── Extra modules ─────────────────────────────────────────────────── */}
        {onNavigate && (
          <section>
            <SectionHeader icon={<Sparkles size={11} />} label="Extra Modules" />
            <button
              onClick={() => onNavigate('algo-track')}
              className="w-full flex items-center gap-3 p-4 rounded-lg text-left transition-all hover:brightness-110"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <TrendingUp size={16} style={{ color: colors.accent, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>AlgoTrack</p>
                <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>
                  See how algorithmic feeds pull you in, an optional side module.
                </p>
              </div>
              <ChevronRight size={14} style={{ color: colors.textMuted }} />
            </button>
          </section>
        )}

        {/* ── Blocking Mode ─────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Shield size={11} />} label="Threat Response Mode" />
          <div className="grid grid-cols-2 gap-3">

            {/* Auto-Block */}
            <button
              onClick={() => void setMode('auto')}
              className="relative text-left p-4 transition-all duration-200 hover:scale-[1.01]"
              style={{
                background: currentMode === 'auto' ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.02)',
                border: currentMode === 'auto' ? '1px solid rgba(248,113,113,0.4)' : '1px solid rgba(255,255,255,0.07)',
              }}
            >
              {currentMode === 'auto' && (
                <div className="absolute top-2.5 right-2.5">
                  <CheckCircle size={11} style={{ color: '#f87171' }} />
                </div>
              )}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                  style={{
                    background: currentMode === 'auto' ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.04)',
                    border: currentMode === 'auto' ? '1px solid rgba(248,113,113,0.3)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Zap size={11} style={{ color: currentMode === 'auto' ? '#f87171' : colors.textMuted }} />
                </div>
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{
                    color: currentMode === 'auto' ? '#f87171' : colors.textSecondary,
                    fontFamily: '"Share Tech Mono", monospace',
                  }}
                >
                  Auto-Block
                </span>
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: colors.textMuted }}>
                Sites above the confidence threshold are blocked immediately. No approval needed.
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {['adult', 'gambling', 'social'].map((tag) => (
                  <span
                    key={tag}
                    className="text-[8px] px-1.5 py-0.5 uppercase tracking-wide"
                    style={{
                      background: 'rgba(248,113,113,0.08)',
                      border: '1px solid rgba(248,113,113,0.2)',
                      color: 'rgba(255,100,100,0.7)',
                      fontFamily: '"Share Tech Mono", monospace',
                    }}
                  >
                    {tag}
                  </span>
                ))}
                <span
                  className="text-[8px] px-1.5 py-0.5 uppercase tracking-wide"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: colors.textMuted,
                    fontFamily: '"Share Tech Mono", monospace',
                  }}
                >
                  + more
                </span>
              </div>
            </button>

            {/* Ask First */}
            <button
              onClick={() => void setMode('ask')}
              className="relative text-left p-4 transition-all duration-200 hover:scale-[1.01]"
              style={{
                background: currentMode === 'ask' ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                border: currentMode === 'ask' ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.07)',
              }}
            >
              {currentMode === 'ask' && (
                <div className="absolute top-2.5 right-2.5">
                  <CheckCircle size={11} style={{ color: '#6366f1' }} />
                </div>
              )}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                  style={{
                    background: currentMode === 'ask' ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.04)',
                    border: currentMode === 'ask' ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Bell size={11} style={{ color: currentMode === 'ask' ? '#6366f1' : colors.textMuted }} />
                </div>
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{
                    color: currentMode === 'ask' ? '#6366f1' : colors.textSecondary,
                    fontFamily: '"Share Tech Mono", monospace',
                  }}
                >
                  Ask First
                </span>
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: colors.textMuted }}>
                All detected threats are queued in the Actions tab. You decide what gets blocked.
              </p>
              <div className="mt-3">
                <span
                  className="text-[8px] px-1.5 py-0.5 uppercase tracking-wide"
                  style={{
                    background: 'rgba(99,102,241,0.06)',
                    border: '1px solid rgba(99,102,241,0.18)',
                    color: 'rgba(99,102,241,0.6)',
                    fontFamily: '"Share Tech Mono", monospace',
                  }}
                >
                  Review in Actions →
                </span>
              </div>
            </button>
          </div>

          <div
            className="mt-3 px-3 py-2.5 flex items-center gap-2"
            style={{ background: 'rgba(99,102,241,0.03)', border: '1px solid rgba(99,102,241,0.07)' }}
          >
            <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'rgba(99,102,241,0.4)' }} />
            <p className="text-[9px] leading-relaxed" style={{ color: colors.textMuted }}>
              {currentMode === 'auto'
                ? 'High-confidence threats (adult, gambling, dating ≥85%) are blocked instantly. Lower-confidence items are still queued in Actions for review.'
                : 'All detected threats are queued as pending in the Actions tab regardless of confidence. Nothing is blocked without your approval.'}
            </p>
          </div>
        </section>

        {/* ── Free AI & Cloud ──────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Sparkles size={11} />} label="AI Usage & Cloud" />
          <div
            className="p-4 space-y-3"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {cloud?.active ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold" style={{ color: '#34d399' }}>Cloud active, unlimited AI</p>
                  <p className="text-[9px] mt-0.5" style={{ color: colors.textMuted }}>
                    {cloud.email ? `Subscribed as ${cloud.email}` : 'Subscription active'} · $5/mo
                  </p>
                </div>
                <button
                  onClick={() => void clearLicense()}
                  className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest"
                  style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: 'rgba(248,113,113,0.7)', fontFamily: '"Share Tech Mono", monospace' }}
                >
                  Unlink
                </button>
              </div>
            ) : usage?.hasOwnKey ? (
              <p className="text-[10px]" style={{ color: colors.textSecondary }}>
                Using your own API key, usage is billed directly to you and is never metered here.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold" style={{ color: colors.textPrimary }}>Free AI credit</span>
                  <span className="text-[10px] tabular-nums" style={{ color: usage?.exhausted ? '#f87171' : '#34d399' }}>
                    ${(usage?.usedUsd ?? 0).toFixed(2)} / ${(usage?.limitUsd ?? 1).toFixed(2)} used
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.round(((usage?.usedUsd ?? 0) / (usage?.limitUsd || 1)) * 100))}%`,
                      background: usage?.exhausted ? '#ff5252' : '#34d399',
                    }}
                  />
                </div>
                <p className="text-[9px]" style={{ color: colors.textMuted }}>
                  {usage?.exhausted
                    ? 'Your free AI credit is used up. Subscribe to Cloud for $5/mo to keep using AI features, or add your own key below.'
                    : 'The app includes free AI to get you started. When it runs out, subscribe to Cloud ($5/mo) or add your own key.'}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => void subscribe()}
                    disabled={checkingOut}
                    className="flex-1 py-2 text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                    style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399', fontFamily: '"Share Tech Mono", monospace' }}
                  >
                    {checkingOut ? 'Opening…' : 'Subscribe $5/mo'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={licenseInput}
                    onChange={(e) => setLicenseInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void saveLicense()}
                    placeholder="Have a license? pd_live_…"
                    className="flex-1 px-3 py-2 text-[10px] outline-none"
                    style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: colors.textPrimary }}
                  />
                  <button
                    onClick={() => void saveLicense()}
                    disabled={!licenseInput.trim() || licenseBusy}
                    className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest disabled:opacity-40"
                    style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', color: '#6366f1', fontFamily: '"Share Tech Mono", monospace' }}
                  >
                    {licenseBusy ? '…' : 'Link'}
                  </button>
                </div>
                {cloud?.license && !cloud.active && (
                  <p className="text-[9px]" style={{ color: '#ff8866' }}>That license isn’t active yet, check your subscription or re-enter it.</p>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── API Key ────────────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Key size={11} />} label="AI API Key" />
          <div
            className="p-4"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: hasKey ? '#34d399' : '#fbbf24', boxShadow: hasKey ? '0 0 6px #34d399' : '0 0 6px #fbbf24' }}
              />
              <span className="text-[10px]" style={{ color: hasKey ? '#34d399' : '#6366f1' }}>
                {hasKey === null ? 'Checking...' : hasKey ? 'Your own API key configured' : 'Optional. AI already works via included free credit'}
              </span>
            </div>

            {hasKey ? (
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 px-3 py-2 text-[10px]"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', color: colors.textMuted }}
                >
                  ••••••••••••••••••••••••
                </div>
                <button
                  onClick={() => void deleteApiKey()}
                  className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest transition-all hover:scale-105"
                  style={{
                    background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.25)',
                    color: 'rgba(248,113,113,0.7)',
                    fontFamily: '"Share Tech Mono", monospace',
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={apiInput}
                  onChange={(e) => setApiInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveApiKey()}
                  placeholder="sk-ant-... or sk-or-..."
                  className="flex-1 px-3 py-2 text-[10px] outline-none"
                  style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: colors.textPrimary }}
                />
                <button
                  onClick={() => void saveApiKey()}
                  disabled={!apiInput.trim()}
                  className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest transition-all hover:scale-105 disabled:opacity-40"
                  style={{
                    background: 'rgba(99,102,241,0.08)',
                    border: '1px solid rgba(99,102,241,0.25)',
                    color: '#6366f1',
                    fontFamily: '"Share Tech Mono", monospace',
                  }}
                >
                  {apiSaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            )}
            <p className="mt-2 text-[9px]" style={{ color: colors.textMuted }}>
              Anthropic API key (sk-ant-...) or OpenRouter key (sk-or-...). Used for AI inference, guard alerts, and the Attentify assistant.
            </p>
          </div>
        </section>

        {/* ── Elevation ─────────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Shield size={11} />} label="System Protection" />
          <div
            className="p-4"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold" style={{ color: colors.textPrimary }}>Admin Privileges</p>
                <p className="text-[10px] mt-0.5" style={{ color: colors.textMuted }}>
                  {store.elevation === 'full'
                    ? 'Running elevated, hosts-file domain blocking active.'
                    : 'Not elevated, domain blocking requires admin rights.'}
                </p>
              </div>
              <div
                className="flex-shrink-0 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
                style={{
                  background: store.elevation === 'full' ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)',
                  border: `1px solid ${store.elevation === 'full' ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.25)'}`,
                  color: store.elevation === 'full' ? '#34d399' : '#fbbf24',
                  fontFamily: '"Share Tech Mono", monospace',
                }}
              >
                {store.elevation === 'full' ? 'Full' : 'Limited'}
              </div>
            </div>
            {store.elevation !== 'full' && (
              <p className="text-[9px] mt-3" style={{ color: 'rgba(251,191,36,0.6)' }}>
                Run the app as Administrator once, it will register a Task Scheduler entry so future launches are automatically elevated without a UAC prompt.
              </p>
            )}
          </div>
        </section>

        {/* ── Compatibility ─────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<Cpu size={11} />} label="Compatibility" />
          <div
            className="p-4 rounded-lg"
            style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>This device</p>
                <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: colors.textMuted }}>
                  Checks that this PC can actually run every part of Attentify, so a capability
                  that is silently unavailable shows up here instead of just looking broken.
                </p>
              </div>
              <button
                onClick={runCompat}
                disabled={compatBusy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all hover:brightness-110 disabled:opacity-60 flex-shrink-0"
                style={{ background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.30)', color: '#818cf8' }}
              >
                <RefreshCw size={11} className={compatBusy ? 'animate-spin' : ''} /> {compatBusy ? 'Checking…' : 'Re-check'}
              </button>
            </div>

            {!compat ? (
              <p className="text-[10px]" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                {compatBusy ? 'Running checks…' : 'No results yet.'}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {compat.checks.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-2.5 p-2.5 rounded-md"
                    style={{
                      background: c.status === 'ok' ? 'transparent' : `${COMPAT_COLOR[c.status]}0f`,
                      border: `1px solid ${c.status === 'ok' ? colors.border : `${COMPAT_COLOR[c.status]}40`}`
                    }}
                  >
                    <CompatIcon status={c.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium" style={{ color: colors.textPrimary }}>{c.label}</p>
                      <p
                        className="text-[9px] mt-0.5 break-words"
                        style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}
                      >
                        {c.detail}
                      </p>
                      {c.fix && (
                        <p className="text-[9px] mt-1 leading-relaxed" style={{ color: COMPAT_COLOR[c.status] }}>
                          {c.fix}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Safety & Recovery ─────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={<RotateCcw size={11} />} label="Safety & Recovery" />
          <div
            className="p-4 rounded-lg"
            style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
          >
            <div className="flex items-start gap-3">
              <Shield size={16} style={{ color: '#6366f1', marginTop: 2, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>Restore my system</p>
                <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: colors.textMuted }}>
                  Undo everything Attentify has changed on this device, hosts-file blocks, firewall
                  rules, browser DNS policies and the login startup entry, returning it to how it was
                  before. Every change is recorded, so nothing is guessed at.
                </p>
                <p className="text-[9px] mt-1.5" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                  {changeCount === null ? '' : `${changeCount} change${changeCount === 1 ? '' : 's'} recorded`}
                </p>
              </div>
            </div>

            {/* Result banner */}
            {revertResult && (
              <div
                className="mt-3 p-3 rounded-md"
                style={{
                  background: revertResult.ok ? 'rgba(52,211,153,0.06)' : 'rgba(251,191,36,0.06)',
                  border: `1px solid ${revertResult.ok ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.25)'}`,
                }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <CheckCircle size={11} style={{ color: revertResult.ok ? '#34d399' : '#fbbf24' }} />
                  <p className="text-[10px] font-semibold" style={{ color: revertResult.ok ? '#34d399' : '#fbbf24' }}>
                    {revertResult.ok ? 'System restored' : 'Restored with warnings'}
                  </p>
                </div>
                {revertResult.undone.map((u, i) => (
                  <p key={i} className="text-[9px]" style={{ color: colors.textMuted }}>· {u}</p>
                ))}
                {revertResult.errors.map((e, i) => (
                  <p key={`e${i}`} className="text-[9px]" style={{ color: '#fbbf24' }}>! {e}</p>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 mt-3">
              {!confirmRevert ? (
                <button
                  onClick={() => { setRevertResult(null); setConfirmRevert(true) }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
                  style={{ background: 'rgba(255,90,90,0.10)', border: '1px solid rgba(255,90,90,0.30)', color: '#ff7a7a' }}
                >
                  <RotateCcw size={12} /> Restore my system
                </button>
              ) : (
                <>
                  <button
                    onClick={handleRevert}
                    disabled={reverting}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-60"
                    style={{ background: 'rgba(255,90,90,0.16)', border: '1px solid rgba(255,90,90,0.45)', color: '#ff7a7a' }}
                  >
                    <AlertTriangle size={12} /> {reverting ? 'Restoring…' : 'Yes, undo everything'}
                  </button>
                  <button
                    onClick={() => setConfirmRevert(false)}
                    disabled={reverting}
                    className="px-3 py-2 rounded-lg text-[11px] font-medium transition-all disabled:opacity-60"
                    style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, color: colors.textMuted }}
                  >
                    Cancel
                  </button>
                </>
              )}
              <button
                onClick={toggleLog}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110 ml-auto"
                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', color: '#a5b4fc' }}
              >
                <History size={12} /> {changelog ? 'Hide change log' : 'View change log'}
              </button>
            </div>

            {/* Change log */}
            {changelog && (
              <div
                className="mt-3 rounded-md overflow-y-auto"
                style={{ maxHeight: 220, background: 'rgba(0,0,0,0.18)', border: `1px solid ${colors.border}` }}
              >
                {changelog.length === 0 ? (
                  <p className="text-[10px] p-3" style={{ color: colors.textMuted }}>No changes recorded yet.</p>
                ) : (
                  changelog.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-1.5"
                      style={{ borderBottom: i < changelog.length - 1 ? `1px solid ${colors.border}` : 'none' }}
                    >
                      <span
                        className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(99,102,241,0.08)', color: '#a5b4fc', fontFamily: '"Share Tech Mono", monospace', flexShrink: 0, minWidth: 54, textAlign: 'center' }}
                      >
                        {c.category}
                      </span>
                      <span className="text-[10px] flex-1 min-w-0 truncate" style={{ color: colors.textPrimary }}>
                        {c.action}{c.target ? `: ${c.target}` : ''}{c.detail && !c.target ? `: ${c.detail}` : ''}
                      </span>
                      <span className="text-[9px] flex-shrink-0" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                        {new Date(c.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
