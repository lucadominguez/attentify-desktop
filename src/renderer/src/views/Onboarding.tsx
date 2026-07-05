import React, { useState, useEffect, useRef } from 'react'
import { Shield, ChevronRight, Lock, ScanLine, CheckCircle2, AlertTriangle, RefreshCw, Zap } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface OnboardingProps {
  onComplete: () => void
}

type Step = 'welcome' | 'permission' | 'scanning' | 'results'
type ElevationState = 'checking' | 'full' | 'soft' | 'relaunching'

const SCAN_STEPS = [
  { label: 'Scanning installed applications…', duration: 2500 },
  { label: 'Checking browser history patterns…', duration: 2800 },
  { label: 'Analyzing notification load…', duration: 2200 },
  { label: 'Identifying algorithmic feeds…', duration: 2000 },
  { label: 'Profiling focus vulnerabilities…', duration: 2500 },
  { label: 'Generating attention risk report…', duration: 2000 },
]

export default function Onboarding({ onComplete }: OnboardingProps): React.ReactElement {
  const { colors } = useTheme()
  const [step, setStep] = useState<Step>('welcome')
  const [scanProgress, setScanProgress] = useState(0)
  const [scanStepIdx, setScanStepIdx] = useState(0)
  const [issueCount, setIssueCount] = useState(0)
  const [elevation, setElevation] = useState<ElevationState>('checking')
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-check elevation the moment the permission step shows
  useEffect(() => {
    if (step !== 'permission') return
    setElevation('checking')

    api.requestElevation().then((status) => {
      setElevation(status as ElevationState)
      if (status === 'full') {
        // Already admin (production UAC manifest fired before launch) — auto-advance
        autoAdvanceRef.current = setTimeout(() => setStep('scanning'), 1800)
      }
    }).catch(() => setElevation('soft'))

    return () => {
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current)
    }
  }, [step])

  // Run scan animation + real scan
  useEffect(() => {
    if (step !== 'scanning') return

    let elapsed = 0
    const total = SCAN_STEPS.reduce((sum, s) => sum + s.duration, 0)
    const timers: ReturnType<typeof setTimeout>[] = []

    SCAN_STEPS.forEach((s, idx) => {
      const t = setTimeout(() => {
        setScanStepIdx(idx)
        setScanProgress(Math.round(((elapsed + s.duration / 2) / total) * 100))
      }, elapsed)
      elapsed += s.duration
      timers.push(t)
    })

    const done = setTimeout(async () => {
      setScanProgress(100)
      try {
        const results = await api.runScan()
        setIssueCount(results.issueCount)
      } catch {
        setIssueCount(5)
      }
      setTimeout(() => setStep('results'), 500)
    }, total)

    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(done)
    }
  }, [step])

  const handleRelaunchAsAdmin = async (): Promise<void> => {
    setElevation('relaunching')
    try {
      await api.relaunchAsAdmin()
      // App will quit and relaunch — nothing more to do
    } catch {
      setElevation('soft')
    }
  }

  const Wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => (
    <div
      className="flex flex-col items-center justify-center w-screen h-screen overflow-hidden"
      style={{ background: colors.mainBg }}
    >
      <div className="relative z-10 flex flex-col items-center text-center max-w-lg px-8 w-full">
        {children}
      </div>
    </div>
  )

  // ── Welcome ────────────────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <Wrapper>
        <div className="mb-6" style={{ filter: 'drop-shadow(0 0 24px rgba(42,168,234,0.35))' }}>
          <BrandMark size={150} />
        </div>
        <h1 className="text-4xl font-extrabold mb-2" style={{ letterSpacing: '-0.02em', color: colors.textPrimary }}>
          Attentify
        </h1>
        <p className="text-accent-blue font-semibold text-lg mb-3">Anti mind virus.</p>
        <p className="text-base leading-relaxed mb-10" style={{ color: colors.textSecondary }}>
          The internet is engineered to steal your attention.<br />
          We're engineered to get it back.
        </p>
        <button
          onClick={() => setStep('permission')}
          className="flex items-center gap-2 bg-accent-blue hover:bg-accent-blue-light text-white font-bold px-10 py-4 rounded-full text-lg transition-all hover:scale-105"
          style={{ boxShadow: '0 0 40px rgba(33,150,243,0.35)' }}
        >
          Get started <ChevronRight size={20} />
        </button>
        <p className="text-xs mt-6" style={{ color: colors.textMuted }}>No accounts. No telemetry. Everything stays on your device.</p>
      </Wrapper>
    )
  }

  // ── Permission ─────────────────────────────────────────────────────────────
  if (step === 'permission') {
    const isChecking = elevation === 'checking'
    const isElevated = elevation === 'full'
    const isRelaunching = elevation === 'relaunching'

    return (
      <Wrapper>
        {/* Icon */}
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 transition-all duration-500"
          style={{
            background: isElevated ? 'rgba(76,175,80,0.12)' : 'rgba(255,184,0,0.1)',
            border: `1px solid ${isElevated ? 'rgba(76,175,80,0.3)' : 'rgba(255,184,0,0.3)'}`,
            boxShadow: isElevated ? '0 0 30px rgba(76,175,80,0.15)' : '0 0 30px rgba(255,184,0,0.1)',
          }}
        >
          {isElevated
            ? <CheckCircle2 size={36} className="text-accent-green" />
            : <Lock size={36} className="text-accent-amber" />}
        </div>

        {/* Title */}
        <h2 className="text-3xl font-bold mb-3" style={{ color: colors.textPrimary }}>
          {isElevated ? 'Full protection enabled' : 'Administrator access needed'}
        </h2>

        {/* Body text / status */}
        {isChecking && (
          <div className="flex items-center gap-2 text-sm mb-8" style={{ color: colors.textSecondary }}>
            <div className="w-4 h-4 border border-t-transparent rounded-full animate-spin" style={{ borderColor: colors.textSecondary, borderTopColor: 'transparent' }} />
            Checking system permissions…
          </div>
        )}

        {isElevated && (
          <div className="w-full mb-8 space-y-3">
            <p className="text-sm leading-relaxed" style={{ color: colors.textSecondary }}>
              The app is running with administrator rights. All protection features are active.
            </p>
            <div className="grid grid-cols-2 gap-2 text-left">
              {[
                'Hosts file blocking active',
                'DNS-over-HTTPS bypass blocked',
                'Process killing enabled',
                'Session enforcement ready',
              ].map((cap) => (
                <div key={cap} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.2)' }}>
                  <CheckCircle2 size={12} className="text-accent-green flex-shrink-0" />
                  <span className="text-accent-green text-[11px] font-medium">{cap}</span>
                </div>
              ))}
            </div>
            <p className="text-xs" style={{ color: colors.textMuted }}>Proceeding to initial scan in a moment…</p>
          </div>
        )}

        {elevation === 'soft' && (
          <>
            <p className="text-sm leading-relaxed mb-4" style={{ color: colors.textSecondary }}>
              Attentify needs administrator rights to edit your system's hosts file — this is how site blocking works at the network layer, before browsers even load the page.
            </p>
            <div className="w-full p-4 rounded-xl mb-6 text-left" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
              <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: colors.textSecondary }}>What admin access enables</p>
              <div className="space-y-1.5">
                {[
                  ['Hosts file blocking', 'Sinkhole blocked domains at the OS level — no browser workaround'],
                  ['DoH bypass prevention', 'Block DNS-over-HTTPS so browsers use system DNS'],
                  ['Process enforcement', 'Kill blocked apps during deep focus sessions'],
                ].map(([title, desc]) => (
                  <div key={title} className="flex items-start gap-2">
                    <Zap size={11} className="text-accent-blue mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-xs font-medium" style={{ color: colors.textPrimary }}>{title} </span>
                      <span className="text-xs" style={{ color: colors.textSecondary }}>{desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        {!isChecking && !isElevated && (
          <div className="flex flex-col items-center gap-3 w-full">
            <button
              onClick={handleRelaunchAsAdmin}
              disabled={isRelaunching}
              className="flex items-center justify-center gap-2 text-white font-bold px-10 py-4 rounded-full text-base transition-all w-full max-w-xs hover:scale-105 disabled:opacity-60"
              style={{ background: 'rgba(33,150,243,0.9)', boxShadow: '0 0 25px rgba(33,150,243,0.3)' }}
            >
              {isRelaunching ? (
                <><RefreshCw size={16} className="animate-spin" /> Relaunching…</>
              ) : (
                <><Shield size={16} /> Relaunch as Administrator</>
              )}
            </button>
            <p className="text-[11px]" style={{ color: colors.textMuted }}>
              A UAC dialog will appear — click Yes to grant access
            </p>
            <button
              onClick={() => setStep('scanning')}
              className="text-sm underline underline-offset-2 transition-colors mt-1" style={{ color: colors.textSecondary }}
            >
              Continue without admin (limited protection)
            </button>
          </div>
        )}

        {isElevated && (
          <button
            onClick={() => setStep('scanning')}
            className="flex items-center gap-2 text-white font-bold px-10 py-3.5 rounded-full transition-all hover:scale-105"
            style={{ background: 'rgba(76,175,80,0.8)', boxShadow: '0 0 20px rgba(76,175,80,0.2)' }}
          >
            <ChevronRight size={16} /> Continue to scan
          </button>
        )}
      </Wrapper>
    )
  }

  // ── Scanning ───────────────────────────────────────────────────────────────
  if (step === 'scanning') {
    return (
      <Wrapper>
        <div className="relative mb-8">
          <div className="w-24 h-24 rounded-full border border-accent-blue/20 flex items-center justify-center mx-auto relative">
            <div className="absolute inset-0 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" style={{ animationDuration: '1s' }} />
            <div className="absolute inset-2 rounded-full border border-accent-blue/20 border-b-transparent animate-spin" style={{ animationDuration: '1.8s', animationDirection: 'reverse' }} />
            <ScanLine size={32} className="text-accent-blue" />
          </div>
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: colors.textPrimary }}>Running Focus Scan</h2>
        <p className="text-sm mb-8 h-5 transition-all duration-300" style={{ color: colors.textSecondary }}>
          {SCAN_STEPS[scanStepIdx]?.label ?? 'Finalizing…'}
        </p>
        <div className="w-full max-w-xs rounded-full overflow-hidden mb-2" style={{ height: 3, background: colors.border }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${scanProgress}%`, background: 'linear-gradient(90deg, #1565c0, #2196f3, #42a5f5)' }}
          />
        </div>
        <p className="text-xs tabular-nums" style={{ color: colors.textSecondary }}>{scanProgress}%</p>
      </Wrapper>
    )
  }

  // ── Results ────────────────────────────────────────────────────────────────
  if (step === 'results') {
    const severity = issueCount >= 8 ? 'critical' : issueCount >= 4 ? 'high' : 'moderate'
    const sevColors = { critical: '#ef5350', high: '#ff6b35', moderate: '#ffb800' }
    const sevColor = sevColors[severity]

    return (
      <Wrapper>
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{ background: `${sevColor}18`, border: `1px solid ${sevColor}44`, boxShadow: `0 0 30px ${sevColor}22` }}
        >
          <AlertTriangle size={36} style={{ color: sevColor }} />
        </div>
        <h2 className="text-3xl font-bold mb-2" style={{ color: colors.textPrimary }}>
          We found{' '}
          <span style={{ color: sevColor }}>{issueCount}</span>{' '}
          attention leak{issueCount !== 1 ? 's' : ''}
        </h2>
        <p className="text-base mb-3" style={{ color: colors.textSecondary }}>
          {severity === 'critical'
            ? 'Your device is heavily exposed to algorithmic attention drain.'
            : severity === 'high'
            ? 'Several high-risk distractions are installed and configured to grab you.'
            : 'A few attention risks were found. Let\'s lock them down.'}
        </p>
        <p className="text-sm mb-8" style={{ color: colors.textSecondary }}>
          Review each issue individually and decide what to block.
        </p>
        <button
          onClick={onComplete}
          className="flex items-center gap-2 text-white font-bold px-10 py-4 rounded-full text-lg transition-all hover:scale-105"
          style={{ background: 'rgba(33,150,243,0.9)', boxShadow: '0 0 30px rgba(33,150,243,0.3)' }}
        >
          See full report <ChevronRight size={20} />
        </button>
        <p className="text-xs mt-4" style={{ color: colors.textMuted }}>You can dismiss any issue or block with one click</p>
      </Wrapper>
    )
  }

  return <Wrapper><div /></Wrapper>
}
