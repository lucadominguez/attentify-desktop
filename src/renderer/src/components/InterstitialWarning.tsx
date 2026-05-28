import React, { useState, useEffect } from 'react'
import { ShieldAlert, ArrowLeft, Clock, Coffee } from 'lucide-react'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface InterstitialData {
  blocked: string
  type: 'domain' | 'process'
  endsAt?: number
}

const BREAK_OPTIONS = [
  { label: '5 min', ms: 5 * 60 * 1000 },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '30 min', ms: 30 * 60 * 1000 },
]

export default function InterstitialWarning(): React.ReactElement {
  const [data, setData] = useState<InterstitialData | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [proceedReady, setProceedReady] = useState(false)

  useEffect(() => {
    api.onInterstitialData((d) => setData(d))
  }, [])

  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) { setProceedReady(true); return }
    const t = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleProceedRequest = (): void => { setCountdown(30); setProceedReady(false) }
  const handleProceed = (): void => { api.proceedAnyway(); setData(null); setCountdown(null); setProceedReady(false) }
  const handleGoBack = (): void => { api.hideInterstitial(); setData(null); setCountdown(null); setProceedReady(false) }

  const handleBreak = async (ms: number): Promise<void> => {
    await api.startBreak(ms, 'interstitial')
    setData(null)
    setCountdown(null)
    setProceedReady(false)
  }

  const sessionEnd = data?.endsAt
    ? new Date(data.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div
      className="flex flex-col w-screen h-screen overflow-hidden select-none rounded-2xl"
      style={{
        background: 'linear-gradient(160deg, #0d1e35 0%, #080f1e 100%)',
        border: '1px solid rgba(255,107,53,0.25)',
      }}
    >
      {/* Drag region / title bar strip */}
      <div className="titlebar-drag flex items-center justify-end h-7 px-3 flex-shrink-0">
        <button
          onClick={handleGoBack}
          className="text-navy-600 hover:text-navy-400 transition-colors text-xs leading-none"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-col items-center text-center px-8 pb-5 flex-1 min-h-0 justify-between">
        {/* Icon + headline */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(255,107,53,0.12)',
              border: '1.5px solid rgba(255,107,53,0.35)',
              boxShadow: '0 0 24px rgba(255,107,53,0.18)',
            }}
          >
            <ShieldAlert size={26} className="text-accent-orange" />
          </div>

          <div>
            <h1 className="text-xl font-extrabold text-white leading-tight" style={{ letterSpacing: '-0.01em' }}>
              Attention hazard
            </h1>
            <p className="text-navy-400 text-sm mt-1 leading-snug">
              Blocked{' '}
              <span className="text-accent-orange font-semibold">{data?.blocked ?? '…'}</span>
              {' '}— you asked it to.
            </p>
            {sessionEnd && (
              <p className="text-navy-600 text-xs mt-1">
                Focus session ends at <span className="text-navy-400">{sessionEnd}</span>
              </p>
            )}
          </div>
        </div>

        {/* Primary action */}
        <div className="flex flex-col items-center gap-2 w-full">
          <button
            onClick={handleGoBack}
            className="flex items-center gap-2 bg-accent-blue hover:bg-accent-blue-light text-white font-bold px-6 py-2.5 rounded-full text-sm transition-all w-full max-w-[220px] justify-center"
            style={{ boxShadow: '0 0 20px rgba(33,150,243,0.25)' }}
          >
            <ArrowLeft size={15} />
            Go back
          </button>

          {/* Break options */}
          <div className="flex items-center gap-1.5 mt-1">
            <Coffee size={10} className="text-navy-600" />
            <span className="text-navy-700 text-[10px]">Take a break:</span>
            {BREAK_OPTIONS.map((opt) => (
              <button
                key={opt.ms}
                onClick={() => void handleBreak(opt.ms)}
                className="text-navy-600 hover:text-navy-300 text-[10px] transition-colors px-1.5 py-0.5 rounded"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {countdown !== null && !proceedReady ? (
            <div className="flex items-center gap-1.5 text-navy-600 text-xs">
              <Clock size={11} />
              <span>Proceeding in {countdown}s…</span>
            </div>
          ) : proceedReady ? (
            <button onClick={handleProceed} className="text-navy-500 hover:text-navy-300 text-xs transition-colors">
              Proceed to {data?.blocked ?? 'site'}
            </button>
          ) : (
            <button onClick={handleProceedRequest} className="text-navy-700 hover:text-navy-500 text-xs transition-colors">
              Proceed anyway (30s delay)
            </button>
          )}

          <p className="text-navy-700 text-[10px]">The good algorithm is protecting you.</p>
        </div>
      </div>
    </div>
  )
}
