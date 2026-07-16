import React, { useEffect, useState, useCallback } from 'react'
import { Activity, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import type { CalibrationReport, LearnedAdjustment } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface IssueLite {
  id: string
  kind: string
  category?: string
  title?: string
  description?: string
  ts: number
  context?: { verdict?: { fix?: string }; recovered?: boolean }
}

// The user-facing window into the classifier's self-evaluation: is it well calibrated, what
// has it learned to stop blocking, and which decisions it caught as mistakes. This is the
// surface the whole feedback loop was missing — the loop ran silently before.
export default function SelfEvaluationPanel(): React.ReactElement {
  const { colors } = useTheme()
  const [cal, setCal] = useState<CalibrationReport | null>(null)
  const [adjustments, setAdjustments] = useState<LearnedAdjustment[]>([])
  const [mistakes, setMistakes] = useState<IssueLite[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [reviewNote, setReviewNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [c, a, issues] = await Promise.all([
        api.getClassifierCalibration?.(30),
        api.getLearnedAdjustments?.(50),
        api.getIssues?.(100),
      ])
      if (c) setCal(c as CalibrationReport)
      if (a) setAdjustments(a as LearnedAdjustment[])
      const list = (issues as IssueLite[] | undefined) ?? []
      setMistakes(list.filter((i) => i.kind === 'classifier_mistake' || i.kind === 'ai_friction').slice(0, 8))
    } catch { /* panel is best-effort */ }
  }, [])

  useEffect(() => { void load() }, [load])

  const runReview = async (): Promise<void> => {
    setReviewing(true); setReviewNote(null)
    try {
      const r = await api.reviewClassifierMistakes?.()
      setReviewNote(r ? `Reviewed ${r.reviewed} disagreement${r.reviewed === 1 ? '' : 's'}, found ${r.mistakes} mistake${r.mistakes === 1 ? '' : 's'}.` : 'Review unavailable.')
      await load()
    } catch { setReviewNote('Review failed.') }
    setReviewing(false)
  }

  const card = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }
  const enoughData = cal && cal.totalResolved >= 1

  return (
    <div className="rounded-lg mt-2 p-4" style={card}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={13} style={{ color: colors.accent }} />
          <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>Self-evaluation</p>
        </div>
        <button
          onClick={() => void runReview()}
          disabled={reviewing}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-50"
          style={{ background: colors.accentBg, border: `1px solid ${colors.border}`, color: colors.accent }}
          title="Ask the reviewer to audit recent disagreements now"
        >
          <RefreshCw size={11} className={reviewing ? 'animate-spin' : ''} /> Review now
        </button>
      </div>

      <p className="text-[10px] mb-3" style={{ color: colors.textMuted }}>
        Attentify checks its own automatic decisions against what you actually do. When you undo a block,
        reject a flag, or push past a site, it treats that as a correction and learns to stop repeating it.
        {reviewNote ? <span style={{ color: colors.accent }}> {reviewNote}</span> : null}
      </p>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="Decisions judged" value={cal ? String(cal.totalResolved) : 'n/a'} colors={colors} />
        <Stat label="Corrections learned" value={String(adjustments.length)} colors={colors} />
        <Stat
          label="Worst category"
          value={cal?.worstCategory ? `${cal.worstCategory.category}` : 'none'}
          sub={cal?.worstCategory ? `${Math.round(cal.worstCategory.disagreementRate * 100)}% reversed` : undefined}
          colors={colors}
        />
      </div>

      {/* Calibration bands */}
      {enoughData && cal && cal.buckets.some((b) => b.n > 0) && (
        <div className="mb-3">
          <p className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: colors.textDim }}>Calibration (predicted vs. reversed)</p>
          <div className="flex flex-col gap-1">
            {cal.buckets.filter((b) => b.n > 0).map((b) => {
              const over = b.gap > 0.15
              return (
                <div key={b.band} className="flex items-center gap-2 text-[10px]">
                  <span className="data-value w-16 flex-shrink-0" style={{ color: colors.textSecondary }}>{b.band}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div style={{ width: `${Math.min(100, b.disagreementRate * 100)}%`, height: '100%', background: over ? colors.warning : colors.accent }} />
                  </div>
                  <span className="data-value w-24 flex-shrink-0 text-right" style={{ color: over ? colors.warning : colors.textMuted }}>
                    {Math.round(b.disagreementRate * 100)}% reversed · n={b.n}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="text-[9px] mt-1" style={{ color: colors.textDim }}>
            A well-calibrated band is reversed about as often as (1 − its confidence). Amber = over-confident.
          </p>
        </div>
      )}

      {/* Learned corrections */}
      {adjustments.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: colors.textDim }}>Learned to stop blocking</p>
          <div className="flex flex-col gap-1">
            {adjustments.slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <ShieldCheck size={11} style={{ color: colors.positive, flexShrink: 0 }} />
                <span className="text-[11px] flex-1 truncate" style={{ color: colors.textSecondary }}>
                  {a.target_value ?? a.scope_key}
                  <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded" style={{ background: colors.accentBg, color: colors.accent }}>{a.scope}</span>
                </span>
                {a.support > 1 && <span className="text-[9px] data-value" style={{ color: colors.textDim }}>×{a.support}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent detected mistakes */}
      {mistakes.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: colors.textDim }}>Recently caught</p>
          <div className="flex flex-col gap-1">
            {mistakes.map((m) => (
              <div key={m.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <AlertTriangle size={11} style={{ color: m.context?.recovered ? colors.positive : colors.warning, flexShrink: 0, marginTop: 1 }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] truncate" style={{ color: colors.textSecondary }}>{m.title ?? m.category ?? 'issue'}</p>
                  {m.description && <p className="text-[9px] truncate" style={{ color: colors.textDim }}>{m.description}</p>}
                </div>
                {m.context?.recovered && <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded flex-shrink-0" style={{ background: 'rgba(52,211,153,0.12)', color: colors.positive }}>recovered</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!enoughData && adjustments.length === 0 && mistakes.length === 0 && (
        <p className="text-[10px]" style={{ color: colors.textDim }}>
          No decisions judged yet. As Attentify blocks and flags things and you react, this fills in.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, sub, colors }: { label: string; value: string; sub?: string; colors: ReturnType<typeof useTheme>['colors'] }): React.ReactElement {
  return (
    <div className="rounded-md px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-[9px] uppercase tracking-wider" style={{ color: colors.textDim }}>{label}</p>
      <p className="text-[13px] font-semibold truncate" style={{ color: colors.textPrimary }}>{value}</p>
      {sub && <p className="text-[9px]" style={{ color: colors.textMuted }}>{sub}</p>}
    </div>
  )
}
