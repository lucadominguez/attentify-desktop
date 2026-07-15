import React, { useState } from 'react'
import {
  Zap, ScanLine, Shield, Cpu, Globe, Rss, Bell, CheckCircle2, Loader,
  Sparkles, ChevronDown, ChevronUp, AlertTriangle, X,
} from 'lucide-react'
import type { AppStore, ScanResult, ScanIssue } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface DeepCleanProps {
  store: AppStore
  onScanComplete?: (results: ScanResult) => void
  onChatWith?: (msg: string) => void
}

interface PlanStep {
  id: string
  label: string
  description: string
  tag: string
  tagColor: string
  execute: () => Promise<void>
  applied: boolean
  skipped: boolean
}

const SEV_COLOR: Record<string, string> = { high: '#f87171', medium: '#fbbf24', low: '#34d399' }
const CAT_ICON: Record<string, React.ReactNode> = {
  apps: <Shield size={13} />,
  feeds: <Rss size={13} />,
  notifications: <Bell size={13} />,
}
const FIX_LABEL: Record<string, string> = {
  'add-domain-block': 'Block Site',
  'add-process-block': 'Block App',
  'enable-feed-guard': 'Block Feeds',
  'enable-notification-filter': 'Start Session',
  'review-extensions': 'Manual Step',
}

const FEED_GUARD = ['youtube.com', 'instagram.com', 'x.com', 'twitter.com', 'facebook.com', 'tiktok.com']

function buildPlan(results: ScanResult): PlanStep[] {
  const steps: PlanStep[] = []

  if (results.recentDistractingSites.length > 0) {
    const sites = results.recentDistractingSites.slice(0, 8)
    steps.push({
      id: 'block-sites',
      label: `Block ${sites.length} distraction site${sites.length !== 1 ? 's' : ''} from browsing history`,
      description: sites.join(', '),
      tag: 'Sites',
      tagColor: '#3b9eff',
      execute: async () => { for (const d of sites) await api.addDomain(d) },
      applied: false,
      skipped: false,
    })
  }

  if (results.runningDistractors.length > 0) {
    steps.push({
      id: 'block-running',
      label: `Kill & block ${results.runningDistractors.length} distraction app${results.runningDistractors.length !== 1 ? 's' : ''} currently running`,
      description: results.runningDistractors.join(', '),
      tag: 'Running',
      tagColor: '#f87171',
      execute: async () => { for (const p of results.runningDistractors) await api.addProcess(p) },
      applied: false,
      skipped: false,
    })
  }

  if (results.installedDistractors.length > 0) {
    const apps = results.installedDistractors.slice(0, 6)
    steps.push({
      id: 'block-installed',
      label: `Block ${apps.length} distracting installed app${apps.length !== 1 ? 's' : ''}`,
      description: apps.join(', '),
      tag: 'Apps',
      tagColor: '#fbbf24',
      execute: async () => { for (const p of apps) await api.addProcess(p) },
      applied: false,
      skipped: false,
    })
  }

  if (results.startupDistractors.length > 0) {
    steps.push({
      id: 'block-startup',
      label: `Block ${results.startupDistractors.length} auto-start app${results.startupDistractors.length !== 1 ? 's' : ''}`,
      description: results.startupDistractors.join(', '),
      tag: 'Startup',
      tagColor: '#ff6b35',
      execute: async () => { for (const p of results.startupDistractors) await api.addProcess(p) },
      applied: false,
      skipped: false,
    })
  }

  const hasFeeds = results.issues.some((i) => i.fixAction === 'enable-feed-guard')
  if (hasFeeds) {
    steps.push({
      id: 'feed-guard',
      label: 'Enable Feed Guard, block all algorithmic feeds',
      description: FEED_GUARD.join(', '),
      tag: 'Feeds',
      tagColor: '#f87171',
      execute: async () => { for (const d of FEED_GUARD) await api.addDomain(d) },
      applied: false,
      skipped: false,
    })
  }

  steps.push({
    id: 'start-session',
    label: 'Start a 2-hour focus session to lock in the changes',
    description: 'Activates your blocklist and blocks new distractions from loading.',
    tag: 'Session',
    tagColor: '#34d399',
    execute: async () => { await api.startSession('normal', 2 * 60 * 60 * 1000) },
    applied: false,
    skipped: false,
  })

  return steps
}

function buildChatMessage(results: ScanResult): string {
  const parts: string[] = ['Focus Scan found the following issues on my system. Help me resolve all of them:\n']
  if (results.recentDistractingSites.length > 0)
    parts.push(`• Visited distraction sites: ${results.recentDistractingSites.slice(0, 6).join(', ')}`)
  if (results.runningDistractors.length > 0)
    parts.push(`• Running distraction apps: ${results.runningDistractors.join(', ')}`)
  if (results.installedDistractors.length > 0)
    parts.push(`• Installed distractors: ${results.installedDistractors.slice(0, 5).join(', ')}`)
  if (results.startupDistractors.length > 0)
    parts.push(`• Auto-start apps: ${results.startupDistractors.join(', ')}`)
  if (results.browserExtensionsFound > 0)
    parts.push(`• ${results.browserExtensionsFound} browser extensions found`)
  parts.push('\nBlock everything that needs blocking and start a deep focus session.')
  return parts.join('\n')
}

export default function DeepClean({ store, onChatWith }: DeepCleanProps): React.ReactElement {
  const { colors } = useTheme()
  const [scanning, setScanning] = useState(false)
  const [scanStep, setScanStep] = useState('')
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ScanResult | null>(store.lastScan ?? null)
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([])
  const [planVisible, setPlanVisible] = useState(false)
  const [planBuilding, setPlanBuilding] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [applyingAll, setApplyingAll] = useState(false)
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set())
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null)

  const runScan = async (): Promise<void> => {
    if (scanning) return
    setScanning(true)
    setPlanVisible(false)
    setPlanSteps([])
    setFixedIds(new Set())
    setProgress(0)

    const steps = [
      'Checking installed applications…',
      'Scanning browser extensions…',
      'Profiling notification patterns…',
      'Identifying engagement traps…',
    ]
    for (let i = 0; i < steps.length; i++) {
      setScanStep(steps[i]!)
      setProgress(Math.round(((i + 1) / steps.length) * 100))
      await new Promise((r) => setTimeout(r, 700))
    }

    const res = await api.runScan()
    setResults(res)
    setScanning(false)
  }

  const generatePlan = async (): Promise<void> => {
    if (!results) return
    setPlanBuilding(true)
    await new Promise((r) => setTimeout(r, 900))
    setPlanSteps(buildPlan(results))
    setPlanBuilding(false)
    setPlanVisible(true)
  }

  const applyStep = async (stepId: string): Promise<void> => {
    const step = planSteps.find((s) => s.id === stepId)
    if (!step || step.applied || applying) return
    setApplying(stepId)
    try {
      await step.execute()
      setPlanSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, applied: true } : s))
      setFixedIds((prev) => new Set(prev).add(stepId))
    } finally {
      setApplying(null)
    }
  }

  const skipStep = (stepId: string): void => {
    setPlanSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, skipped: true } : s))
  }

  const applyAll = async (): Promise<void> => {
    if (applyingAll) return
    setApplyingAll(true)
    for (const step of planSteps) {
      if (!step.applied && !step.skipped) {
        setApplying(step.id)
        try { await step.execute() } catch { /* continue */ }
        setPlanSteps((prev) => prev.map((s) => s.id === step.id ? { ...s, applied: true } : s))
        setFixedIds((prev) => new Set(prev).add(step.id))
        setApplying(null)
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    setApplyingAll(false)
  }

  const appliedCount = planSteps.filter((s) => s.applied).length
  const pendingSteps = planSteps.filter((s) => !s.applied && !s.skipped)

  const fixIssue = async (issue: ScanIssue): Promise<void> => {
    if (!results) return
    switch (issue.fixAction) {
      case 'add-domain-block':
        for (const d of (results.recentDistractingSites.length > 0 ? results.recentDistractingSites : issue.affectedItem ? [issue.affectedItem] : []))
          await api.addDomain(d)
        break
      case 'add-process-block': {
        const procs = issue.id === 'running-distractors' ? results.runningDistractors
          : issue.id === 'installed-distractors' ? results.installedDistractors
          : issue.id === 'startup-distractors' ? results.startupDistractors
          : issue.affectedItem ? [issue.affectedItem] : []
        for (const p of procs) await api.addProcess(p)
        break
      }
      case 'enable-feed-guard':
        for (const d of FEED_GUARD) await api.addDomain(d)
        break
      case 'enable-notification-filter':
        await api.startSession('normal')
        break
    }
    setFixedIds((prev) => new Set(prev).add(issue.id))
  }

  return (
    <div className="p-4 animate-fade-in space-y-3 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-xl flex items-center gap-2" style={{ color: colors.textPrimary }}>
            <Zap size={19} className="text-accent-blue" /> Deep Clean
          </h1>
          <p className="text-[10px] mt-0.5" style={{ color: colors.textSecondary }}>Scan for attention leaks · generate a remediation plan · apply with one click</p>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all disabled:opacity-50 hover:scale-105"
          style={{ background: 'rgba(33,150,243,0.12)', color: '#818cf8', border: '1px solid rgba(33,150,243,0.25)' }}
        >
          {scanning ? <><Loader size={12} className="animate-spin" /> Scanning…</> : <><ScanLine size={12} /> {results ? 'Re-scan' : 'Run Scan'}</>}
        </button>
      </div>

      {/* Scanning progress */}
      {scanning && (
        <div
          className="rounded-xl p-5 flex flex-col items-center text-center"
          style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
        >
          <div className="relative w-14 h-14 mb-4">
            <div className="absolute inset-0 rounded-full border-2 border-accent-blue/20" />
            <div className="absolute inset-0 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <ScanLine size={20} className="text-accent-blue" />
            </div>
          </div>
          <p className="text-sm font-semibold mb-2" style={{ color: colors.textPrimary }}>{scanStep}</p>
          <div className="w-40 rounded-full h-1.5 overflow-hidden" style={{ background: colors.border }}>
            <div className="h-full rounded-full bg-accent-blue transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-[10px] mt-1.5 tabular-nums" style={{ color: colors.textSecondary }}>{progress}%</p>
        </div>
      )}

      {/* No scan yet */}
      {!results && !scanning && (
        <div
          className="rounded-xl p-8 flex flex-col items-center text-center"
          style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
        >
          <div className="w-14 h-14 rounded-xl bg-accent-blue/10 flex items-center justify-center mb-3">
            <Zap size={28} className="text-accent-blue" />
          </div>
          <p className="font-bold text-base mb-1" style={{ color: colors.textPrimary }}>No scan run yet</p>
          <p className="text-xs max-w-xs" style={{ color: colors.textSecondary }}>Scan your system to detect attention leaks, running apps, browsing history, notification overload, and more.</p>
        </div>
      )}

      {/* Scan results */}
      {results && !scanning && (
        <>
          {/* Result summary bar */}
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-4"
            style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}
          >
            <div className="flex items-center gap-2">
              {results.issueCount === 0 ? (
                <CheckCircle2 size={20} className="text-accent-green" />
              ) : (
                <AlertTriangle size={20} className="text-accent-orange" />
              )}
              <div>
                <p className="text-sm font-bold" style={{ color: colors.textPrimary }}>
                  {results.issueCount === 0 ? 'Clean, no issues found' : `${results.issueCount} attention leak${results.issueCount !== 1 ? 's' : ''} found`}
                </p>
                <p className="text-[9px]" style={{ color: colors.textSecondary }}>
                  {new Date(results.runAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                  {new Date(results.runAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            {/* Stats chips */}
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {[
                { label: 'Sites', value: results.recentDistractingSites.length, color: '#3b9eff' },
                { label: 'Running', value: results.runningDistractors.length, color: '#f87171' },
                { label: 'Installed', value: results.installedDistractors.length, color: '#fbbf24' },
                { label: 'Extensions', value: results.browserExtensionsFound, color: '#546e7a' },
              ].map((chip) => chip.value > 0 && (
                <div
                  key={chip.label}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg"
                  style={{ background: chip.color + '15', border: `1px solid ${chip.color}30` }}
                >
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: chip.color }}>{chip.value}</span>
                  <span className="text-[9px]" style={{ color: colors.textSecondary }}>{chip.label}</span>
                </div>
              ))}
            </div>

            {/* AI Plan button */}
            {results.issueCount > 0 && !planVisible && (
              <button
                onClick={generatePlan}
                disabled={planBuilding}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-all hover:scale-105 disabled:opacity-60 flex-shrink-0"
                style={{ background: 'rgba(129,140,248,0.15)', color: '#c7d2fe', border: '1px solid rgba(129,140,248,0.3)' }}
              >
                {planBuilding
                  ? <><Loader size={11} className="animate-spin" /> Building plan…</>
                  : <><Sparkles size={11} /> Generate AI Plan</>}
              </button>
            )}
          </div>

          {/* AI Remediation Plan */}
          {planVisible && planSteps.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(129,140,248,0.3)' }}>
              {/* Plan header */}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ background: 'rgba(129,140,248,0.1)' }}
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-indigo-400" />
                  <p className="text-sm font-semibold" style={{ color: colors.textPrimary }}>Remediation Plan</p>
                  <span className="text-[10px] text-indigo-400">
                    {appliedCount}/{planSteps.length} applied
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {onChatWith && (
                    <button
                      onClick={() => onChatWith(buildChatMessage(results))}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Ask Attentify instead →
                    </button>
                  )}
                  {pendingSteps.length > 0 && (
                    <button
                      onClick={applyAll}
                      disabled={applyingAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all hover:scale-105 disabled:opacity-60"
                      style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}
                    >
                      {applyingAll
                        ? <><Loader size={10} className="animate-spin" /> Applying…</>
                        : `Apply all ${pendingSteps.length} steps`}
                    </button>
                  )}
                  {appliedCount === planSteps.length && (
                    <div className="flex items-center gap-1 text-[11px] text-accent-green font-semibold">
                      <CheckCircle2 size={12} /> All applied
                    </div>
                  )}
                </div>
              </div>

              {/* Steps */}
              <div style={{ background: colors.cardBg }}>
                {planSteps.map((step, i) => (
                  <div
                    key={step.id}
                    className="flex items-start gap-3 px-4 py-3 transition-colors"
                    style={{
                      borderBottom: i < planSteps.length - 1 ? `1px solid ${colors.border}` : 'none',
                      opacity: step.skipped ? 0.4 : 1,
                    }}
                  >
                    {/* Step number / status */}
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold"
                      style={{
                        background: step.applied
                          ? 'rgba(52,211,153,0.2)'
                          : step.skipped
                          ? colors.accentBg
                          : 'rgba(129,140,248,0.2)',
                        color: step.applied ? '#34d399' : step.skipped ? colors.textMuted : '#a5b4fc',
                        border: `1px solid ${step.applied ? 'rgba(52,211,153,0.3)' : step.skipped ? colors.border : 'rgba(129,140,248,0.3)'}`,
                      }}
                    >
                      {step.applied ? '✓' : i + 1}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                          style={{ background: step.tagColor + '20', color: step.tagColor }}
                        >
                          {step.tag}
                        </span>
                        <p className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>{step.label}</p>
                      </div>
                      <p className="text-[10px] truncate" style={{ color: colors.textSecondary }}>{step.description}</p>
                    </div>

                    {/* Actions */}
                    {!step.applied && !step.skipped && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => skipStep(step.id)}
                          className="hover:text-white transition-colors" style={{ color: colors.textSecondary }}
                          title="Skip this step"
                        >
                          <X size={12} />
                        </button>
                        <button
                          onClick={() => applyStep(step.id)}
                          disabled={!!applying || applyingAll}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:scale-105 disabled:opacity-50"
                          style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}
                        >
                          {applying === step.id
                            ? <><Loader size={9} className="animate-spin" /> Applying…</>
                            : <><Shield size={9} /> Apply</>}
                        </button>
                      </div>
                    )}
                    {step.applied && (
                      <div className="flex items-center gap-1 text-[10px] text-accent-green flex-shrink-0">
                        <CheckCircle2 size={11} /> Done
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Issue list */}
          {results.issues.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 px-0.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: colors.textSecondary }}>
                  Detected Issues
                </p>
                {onChatWith && !planVisible && (
                  <button
                    onClick={() => onChatWith(buildChatMessage(results))}
                    className="ml-auto text-[10px] hover:text-accent-blue transition-colors" style={{ color: colors.textSecondary }}
                  >
                    Ask Attentify to handle all →
                  </button>
                )}
              </div>
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
                {results.issues.map((issue, i) => {
                  const sevColor = SEV_COLOR[issue.severity] ?? '#546e7a'
                  const isFixed = fixedIds.has(issue.id)
                  const isExpanded = expandedIssue === issue.id

                  return (
                    <div
                      key={issue.id}
                      style={{
                        background: isFixed ? 'rgba(52,211,153,0.04)' : i % 2 === 0 ? colors.rowEven : colors.rowOdd,
                        borderBottom: i < results.issues.length - 1 ? `1px solid ${colors.border}` : 'none',
                        opacity: isFixed ? 0.6 : 1,
                      }}
                    >
                      <div
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
                        onClick={() => setExpandedIssue(isExpanded ? null : issue.id)}
                      >
                        {/* Icon */}
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: sevColor + '18', color: isFixed ? '#34d399' : sevColor }}
                        >
                          {isFixed ? <CheckCircle2 size={13} style={{ color: '#34d399' }} /> : CAT_ICON[issue.category]}
                        </div>

                        {/* Title */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                              style={{ background: sevColor + '18', color: sevColor }}
                            >
                              {issue.severity}
                            </span>
                            <p className="text-[11px] font-semibold truncate" style={{ color: colors.textPrimary }}>{issue.title}</p>
                          </div>
                        </div>

                        {/* Fix button */}
                        {!isFixed && issue.fixAction !== 'review-extensions' && (
                          <button
                            onClick={async (e) => { e.stopPropagation(); await fixIssue(issue) }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all hover:scale-105 flex-shrink-0"
                            style={{ background: 'rgba(33,150,243,0.12)', color: '#818cf8', border: '1px solid rgba(33,150,243,0.2)' }}
                          >
                            <Shield size={9} /> {FIX_LABEL[issue.fixAction ?? ''] ?? 'Fix'}
                          </button>
                        )}
                        {onChatWith && !isFixed && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onChatWith(`Help me fix this scan issue: ${issue.title}: ${issue.description}`)
                            }}
                            className="text-[10px] hover:text-accent-blue transition-colors flex-shrink-0 ml-1" style={{ color: colors.textSecondary }}
                            title="Ask Attentify"
                          >
                            Ask AI
                          </button>
                        )}
                        <div className="flex-shrink-0 ml-1" style={{ color: colors.textSecondary }}>
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </div>
                      </div>

                      {/* Expanded description */}
                      {isExpanded && (
                        <div
                          className="px-3 pb-3 ml-10 text-[10px] leading-relaxed"
                          style={{ color: colors.textSecondary }}
                        >
                          {issue.description}
                          {isFixed && <span className="ml-2 text-accent-green font-semibold">· Fixed</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Advanced: stop apps from launching at startup */}
      <StartupPanel />
    </div>
  )
}

// ── Startup manager: list auto-run apps and stop them launching at login ─────────
function StartupPanel(): React.ReactElement {
  const { colors } = useTheme()
  const [items, setItems] = useState<import('@shared/types').StartupItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ id: string; text: string } | null>(null)

  const load = React.useCallback(() => {
    api.getStartupItems().then(setItems).catch(() => setItems([]))
  }, [])
  React.useEffect(() => { load() }, [load])

  const disable = async (item: import('@shared/types').StartupItem): Promise<void> => {
    setBusy(item.id); setNote(null)
    try {
      const res = await api.disableStartupItem(item)
      if (res.ok) setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id))
      else setNote({ id: item.id, text: res.error || 'Could not disable this one.' })
    } catch { setNote({ id: item.id, text: 'Could not disable this one.' }) }
    setBusy(null)
  }

  return (
    <div className="rounded-xl p-4 mt-1" style={{ background: colors.cardBg, border: `1px solid ${colors.border}` }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Cpu size={15} style={{ color: colors.accent }} />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>Startup apps</p>
            <p className="text-[10px]" style={{ color: colors.textMuted }}>Stop apps from launching automatically at login, a faster, calmer boot.</p>
          </div>
        </div>
        <button onClick={load} className="text-[10px] px-2 py-1 rounded-lg" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Refresh</button>
      </div>

      {items === null ? (
        <p className="text-[11px] py-3 text-center" style={{ color: colors.textMuted }}>Scanning startup entries…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] py-3 text-center" style={{ color: colors.textMuted }}>No auto-start apps found (or not supported on this OS).</p>
      ) : (
        <div className="space-y-1 mt-2">
          {items.map((item) => (
            <div key={item.id}>
              <div className="flex items-center gap-2 py-1.5">
                <span className="text-[12px] flex-1 truncate" style={{ color: colors.textSecondary }} title={item.command}>{item.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: colors.accentBg, color: colors.textMuted }}>
                  {item.location === 'folder' ? 'Startup folder' : item.location.toUpperCase()}
                </span>
                <button
                  onClick={() => void disable(item)}
                  disabled={busy === item.id}
                  className="text-[10px] px-2.5 py-1 rounded-lg font-medium flex-shrink-0 transition-all disabled:opacity-50"
                  style={{ background: colors.negativeBg, color: colors.negative, border: `1px solid rgba(248,113,113,0.3)` }}
                >
                  {busy === item.id ? 'Working…' : 'Stop auto-start'}
                </button>
              </div>
              {note?.id === item.id && <p className="text-[10px] pb-1" style={{ color: colors.warning }}>{note.text}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
