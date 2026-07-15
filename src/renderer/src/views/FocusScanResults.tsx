import React, { useState } from 'react'
import { CheckCircle, XCircle, ChevronRight, Info, AlertCircle } from 'lucide-react'
import IssueCard from '../components/IssueCard'
import type { ScanResult, ScanIssue, AppStore, ViewName } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

const FEED_GUARD_DOMAINS = ['youtube.com', 'instagram.com', 'x.com', 'twitter.com', 'facebook.com', 'tiktok.com']

interface FocusScanResultsProps {
  results: ScanResult | null
  store: AppStore
  onNavigate: (view: ViewName) => void
  onRefresh: () => void
  onChatWith?: (msg: string) => void
}

type Category = 'apps' | 'feeds' | 'notifications'

const categoryLabels: Record<Category, string> = {
  apps: 'Apps & Websites',
  feeds: 'Algorithmic Feeds',
  notifications: 'Notification Overload',
}

export default function FocusScanResults({ results, onNavigate, onRefresh, onChatWith }: FocusScanResultsProps): React.ReactElement {
  const { colors } = useTheme()
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [fixed, setFixed] = useState<Set<string>>(new Set())
  const [fixingAll, setFixingAll] = useState(false)
  const [infoMsg, setInfoMsg] = useState<string | null>(null)

  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <p style={{ color: colors.textSecondary }}>No scan results. Run a Focus Scan from the Home screen.</p>
        <button className="btn-primary mt-4" onClick={() => onNavigate('home')}>
          Go to Home
        </button>
      </div>
    )
  }

  const applyFix = async (issue: ScanIssue): Promise<void> => {
    switch (issue.fixAction) {
      case 'add-domain-block': {
        const domains =
          results.recentDistractingSites.length > 0
            ? results.recentDistractingSites
            : issue.affectedItem
              ? [issue.affectedItem]
              : []
        for (const d of domains) {
          await api.addDomain(d)
        }
        break
      }
      case 'add-process-block': {
        let procs: string[] = []
        if (issue.id === 'running-distractors') procs = results.runningDistractors
        else if (issue.id === 'installed-distractors') procs = results.installedDistractors
        else if (issue.id === 'startup-distractors') procs = results.startupDistractors
        else if (issue.affectedItem) procs = [issue.affectedItem]
        for (const p of procs) {
          await api.addProcess(p)
        }
        break
      }
      case 'enable-feed-guard': {
        for (const d of FEED_GUARD_DOMAINS) {
          await api.addDomain(d)
        }
        break
      }
      case 'enable-notification-filter': {
        await api.startSession('normal')
        break
      }
      case 'review-extensions': {
        setInfoMsg(
          'Open chrome://extensions (or your browser\'s extension manager) and remove or disable extensions you don\'t actively use. Each extension is a potential distraction vector.',
        )
        return
      }
    }
  }

  const handleFixIssue = async (issue: ScanIssue): Promise<void> => {
    if (fixed.has(issue.id) || fixingId) return
    setFixingId(issue.id)
    try {
      await applyFix(issue)
      setFixed((prev) => new Set(prev).add(issue.id))
      onRefresh()
    } finally {
      setFixingId(null)
    }
  }

  const handleAskAI = (issue: ScanIssue): void => {
    const msgMap: Record<string, string> = {
      'running-distractors': `Block these apps that are running right now and competing for my attention: ${results.runningDistractors.join(', ')}`,
      'installed-distractors': `I have ${results.installedDistractors.length} distracting apps installed (${results.installedDistractors.slice(0, 4).join(', ')}). Help me block them.`,
      'startup-distractors': `These apps auto-start with my computer: ${results.startupDistractors.join(', ')}. Block them during focus sessions.`,
      'recent-history': `I visited these distracting sites today: ${results.recentDistractingSites.slice(0, 5).join(', ')}. Block them for me.`,
      'feed-guard': 'Block all algorithmic feeds: YouTube, Instagram, Twitter/X, TikTok, and Facebook.',
      'extensions': `I have ${results.browserExtensionsFound} browser extensions. Help me identify and remove distracting ones.`,
      'notification-filter': 'Start a focus session to suppress desktop notifications.',
    }
    const msg = msgMap[issue.id] ?? `Help me fix this: ${issue.title}`
    onChatWith?.(msg)
  }

  const handleFixAll = async (): Promise<void> => {
    setFixingAll(true)
    for (const issue of results.issues) {
      if (!fixed.has(issue.id) && issue.fixAction !== 'review-extensions') {
        setFixingId(issue.id)
        try {
          await applyFix(issue)
          setFixed((prev) => new Set(prev).add(issue.id))
        } catch { /* continue */ }
        setFixingId(null)
      }
    }
    setFixingAll(false)
    onRefresh()
  }

  const categories: Category[] = ['apps', 'feeds', 'notifications']
  const issuesByCategory = (cat: Category): ScanIssue[] => results.issues.filter((i) => i.category === cat)
  const unfixedCount = results.issues.filter((i) => !fixed.has(i.id)).length

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h1 className="font-bold text-2xl" style={{ color: colors.textPrimary }}>
              We found{' '}
              <span className="text-accent-orange">{unfixedCount}</span>{' '}
              attention leak{unfixedCount !== 1 ? 's' : ''}
            </h1>
            <p className="text-sm mt-1" style={{ color: colors.textSecondary }}>
              Each issue below has a one-click fix or you can ask Attentify to handle it.
            </p>
          </div>
          <p className="text-xs mt-1" style={{ color: colors.textSecondary }}>
            Scanned {new Date(results.runAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Category stepper */}
        <div className="flex gap-1 mt-5">
          {categories.map((cat, idx) => {
            const catIssues = issuesByCategory(cat)
            const allFixed = catIssues.length > 0 && catIssues.every((i) => fixed.has(i.id))
            const hasIssues = catIssues.length > 0
            const remaining = catIssues.filter((i) => !fixed.has(i.id)).length

            return (
              <React.Fragment key={cat}>
                <div className="flex flex-col items-center gap-1.5 flex-1">
                  <div className="flex items-center gap-2 w-full justify-center">
                    {allFixed ? (
                      <CheckCircle size={16} className="text-accent-green flex-shrink-0" />
                    ) : hasIssues ? (
                      <div className="w-4 h-4 rounded-full bg-accent-orange flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-[9px] font-bold">!</span>
                      </div>
                    ) : (
                      <XCircle size={16} className="flex-shrink-0" style={{ color: colors.textSecondary }} />
                    )}
                    <span
                      className={`text-xs font-semibold truncate ${allFixed ? 'text-accent-green' : hasIssues ? '' : ''}`}
                      style={!allFixed && hasIssues ? { color: colors.textPrimary } : !allFixed && !hasIssues ? { color: colors.textSecondary } : undefined}
                    >
                      {categoryLabels[cat]}
                    </span>
                  </div>
                  <div
                    className="h-0.5 w-full rounded-full"
                    style={{ background: allFixed ? '#34d399' : hasIssues ? '#ff6b35' : colors.border }}
                  />
                  <span
                    className={`text-[10px] ${allFixed ? 'text-accent-green' : hasIssues ? 'text-accent-orange' : ''}`}
                    style={!allFixed && !hasIssues ? { color: colors.textSecondary } : undefined}
                  >
                    {allFixed ? 'Fixed' : hasIssues ? `${remaining} issue${remaining !== 1 ? 's' : ''}` : 'OK'}
                  </span>
                </div>
                {idx < categories.length - 1 && (
                  <div className="flex items-start pt-2 px-1 flex-shrink-0">
                    <ChevronRight size={14} style={{ color: colors.textSecondary }} />
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Info banner for review-extensions */}
      {infoMsg && (
        <div className="mx-6 mb-2 flex-shrink-0 p-3 rounded-xl flex items-start gap-2.5" style={{ background: 'rgba(33,150,243,0.08)', border: '1px solid rgba(33,150,243,0.2)' }}>
          <AlertCircle size={14} className="text-accent-blue flex-shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed flex-1" style={{ color: colors.textSecondary }}>{infoMsg}</p>
          <button onClick={() => setInfoMsg(null)} className="hover:text-white text-xs flex-shrink-0" style={{ color: colors.textSecondary }}>✕</button>
        </div>
      )}

      {/* Issues list */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="space-y-2">
          {results.issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onFix={handleFixIssue}
              onAskAI={onChatWith ? handleAskAI : undefined}
              fixing={fixingId === issue.id || fixingAll}
              fixed={fixed.has(issue.id)}
            />
          ))}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="flex-shrink-0 px-6 pb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, #ff6b35, transparent)' }} />
          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: colors.textSecondary }}>
            <span>These issues are high priority</span>
            <Info size={12} style={{ color: colors.textSecondary }} />
          </div>
        </div>

        <div className="flex items-center justify-center gap-6">
          <button
            onClick={handleFixAll}
            disabled={fixingAll || unfixedCount === 0}
            className="flex items-center gap-2 bg-accent-blue hover:bg-accent-blue-light disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-full transition-colors text-sm"
          >
            {fixingAll ? (
              <>
                <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />
                Fixing…
              </>
            ) : unfixedCount === 0 ? (
              <>
                <CheckCircle size={16} />
                All fixed!
              </>
            ) : (
              `Fix all ${unfixedCount} issue${unfixedCount !== 1 ? 's' : ''}`
            )}
          </button>
          <button
            onClick={() => onNavigate('home')}
            className="text-sm transition-colors underline underline-offset-2"
            style={{ color: colors.textSecondary }}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}
