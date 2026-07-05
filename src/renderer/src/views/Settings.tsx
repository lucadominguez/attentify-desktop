import React, { useState } from 'react'
import { Shield, Zap, Bell, Key, CheckCircle, Sparkles, Sun, Moon, TrendingUp, ChevronRight } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import type { AppStore, UsageState, CloudState, ViewName } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface SettingsProps {
  store: AppStore
  onRefresh: () => void
  onNavigate?: (view: ViewName) => void
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span style={{ color: 'rgba(0,200,255,0.6)' }}>{icon}</span>
      <span
        className="text-[9px] font-bold uppercase tracking-widest"
        style={{ color: 'rgba(0,200,255,0.5)', fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.2em' }}
      >
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: 'rgba(0,200,255,0.08)' }} />
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

  React.useEffect(() => {
    api.getApiKeyStatus().then((s) => setHasKey(s.hasKey))
    api.getUsage().then(setUsage).catch(() => {})
    api.getCloud().then(setCloud).catch(() => {})
    const off = api.onUsageChanged((u) => setUsage(u))
    return off
  }, [])

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
        style={{ borderBottom: '1px solid rgba(0,200,255,0.08)' }}
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
                {theme === 'dark' ? 'Dark — easier on the eyes at night' : 'Light — brighter for daytime'}
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
                  See how algorithmic feeds pull you in — an optional side module.
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
                background: currentMode === 'auto' ? 'rgba(255,68,68,0.08)' : 'rgba(255,255,255,0.02)',
                border: currentMode === 'auto' ? '1px solid rgba(255,68,68,0.4)' : '1px solid rgba(255,255,255,0.07)',
              }}
            >
              {currentMode === 'auto' && (
                <div className="absolute top-2.5 right-2.5">
                  <CheckCircle size={11} style={{ color: '#ff4444' }} />
                </div>
              )}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                  style={{
                    background: currentMode === 'auto' ? 'rgba(255,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                    border: currentMode === 'auto' ? '1px solid rgba(255,68,68,0.3)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Zap size={11} style={{ color: currentMode === 'auto' ? '#ff4444' : colors.textMuted }} />
                </div>
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{
                    color: currentMode === 'auto' ? '#ff6666' : colors.textSecondary,
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
                      background: 'rgba(255,68,68,0.08)',
                      border: '1px solid rgba(255,68,68,0.2)',
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
                background: currentMode === 'ask' ? 'rgba(0,200,255,0.06)' : 'rgba(255,255,255,0.02)',
                border: currentMode === 'ask' ? '1px solid rgba(0,200,255,0.35)' : '1px solid rgba(255,255,255,0.07)',
              }}
            >
              {currentMode === 'ask' && (
                <div className="absolute top-2.5 right-2.5">
                  <CheckCircle size={11} style={{ color: '#00c8ff' }} />
                </div>
              )}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-6 h-6 flex items-center justify-center flex-shrink-0"
                  style={{
                    background: currentMode === 'ask' ? 'rgba(0,200,255,0.1)' : 'rgba(255,255,255,0.04)',
                    border: currentMode === 'ask' ? '1px solid rgba(0,200,255,0.3)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Bell size={11} style={{ color: currentMode === 'ask' ? '#00c8ff' : colors.textMuted }} />
                </div>
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{
                    color: currentMode === 'ask' ? '#00c8ff' : colors.textSecondary,
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
                    background: 'rgba(0,200,255,0.06)',
                    border: '1px solid rgba(0,200,255,0.18)',
                    color: 'rgba(0,200,255,0.6)',
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
            style={{ background: 'rgba(0,200,255,0.03)', border: '1px solid rgba(0,200,255,0.07)' }}
          >
            <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'rgba(0,200,255,0.4)' }} />
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
                  <p className="text-[11px] font-bold" style={{ color: '#4caf50' }}>Cloud active — unlimited AI</p>
                  <p className="text-[9px] mt-0.5" style={{ color: colors.textMuted }}>
                    {cloud.email ? `Subscribed as ${cloud.email}` : 'Subscription active'} · $5/mo
                  </p>
                </div>
                <button
                  onClick={() => void clearLicense()}
                  className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest"
                  style={{ background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.25)', color: 'rgba(255,68,68,0.7)', fontFamily: '"Share Tech Mono", monospace' }}
                >
                  Unlink
                </button>
              </div>
            ) : usage?.hasOwnKey ? (
              <p className="text-[10px]" style={{ color: colors.textSecondary }}>
                Using your own API key — usage is billed directly to you and is never metered here.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold" style={{ color: colors.textPrimary }}>Free AI credit</span>
                  <span className="text-[10px] tabular-nums" style={{ color: usage?.exhausted ? '#ff6666' : '#4caf50' }}>
                    ${(usage?.usedUsd ?? 0).toFixed(2)} / ${(usage?.limitUsd ?? 1).toFixed(2)} used
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.round(((usage?.usedUsd ?? 0) / (usage?.limitUsd || 1)) * 100))}%`,
                      background: usage?.exhausted ? '#ff5252' : '#4caf50',
                    }}
                  />
                </div>
                <p className="text-[9px]" style={{ color: colors.textMuted }}>
                  {usage?.exhausted
                    ? 'Your free AI credit is used up. Subscribe to Cloud for $5/mo to keep using AI features — or add your own key below.'
                    : 'The app includes free AI to get you started. When it runs out, subscribe to Cloud ($5/mo) or add your own key.'}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => void subscribe()}
                    disabled={checkingOut}
                    className="flex-1 py-2 text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                    style={{ background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)', color: '#4caf50', fontFamily: '"Share Tech Mono", monospace' }}
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
                    style={{ background: 'rgba(0,200,255,0.08)', border: '1px solid rgba(0,200,255,0.25)', color: '#00c8ff', fontFamily: '"Share Tech Mono", monospace' }}
                  >
                    {licenseBusy ? '…' : 'Link'}
                  </button>
                </div>
                {cloud?.license && !cloud.active && (
                  <p className="text-[9px]" style={{ color: '#ff8866' }}>That license isn’t active yet — check your subscription or re-enter it.</p>
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
                style={{ background: hasKey ? '#4caf50' : '#ffaa00', boxShadow: hasKey ? '0 0 6px #4caf50' : '0 0 6px #ffaa00' }}
              />
              <span className="text-[10px]" style={{ color: hasKey ? '#4caf50' : '#00c8ff' }}>
                {hasKey === null ? 'Checking...' : hasKey ? 'Your own API key configured' : 'Optional — AI already works via included free credit'}
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
                    background: 'rgba(255,68,68,0.08)',
                    border: '1px solid rgba(255,68,68,0.25)',
                    color: 'rgba(255,68,68,0.7)',
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
                    background: 'rgba(0,200,255,0.08)',
                    border: '1px solid rgba(0,200,255,0.25)',
                    color: '#00c8ff',
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
                    ? 'Running elevated — hosts-file domain blocking active.'
                    : 'Not elevated — domain blocking requires admin rights.'}
                </p>
              </div>
              <div
                className="flex-shrink-0 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest"
                style={{
                  background: store.elevation === 'full' ? 'rgba(0,230,118,0.08)' : 'rgba(255,170,0,0.08)',
                  border: `1px solid ${store.elevation === 'full' ? 'rgba(0,230,118,0.25)' : 'rgba(255,170,0,0.25)'}`,
                  color: store.elevation === 'full' ? '#00e676' : '#ffaa00',
                  fontFamily: '"Share Tech Mono", monospace',
                }}
              >
                {store.elevation === 'full' ? 'Full' : 'Limited'}
              </div>
            </div>
            {store.elevation !== 'full' && (
              <p className="text-[9px] mt-3" style={{ color: 'rgba(255,170,0,0.6)' }}>
                Run the app as Administrator once — it will register a Task Scheduler entry so future launches are automatically elevated without a UAC prompt.
              </p>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
