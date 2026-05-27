import React from 'react'
import { AlertCircle, Shield, Rss, Bell, CheckCircle2, Loader, MessageSquare } from 'lucide-react'
import type { ScanIssue } from '@shared/types'

interface IssueCardProps {
  issue: ScanIssue
  onFix?: (issue: ScanIssue) => void
  onAskAI?: (issue: ScanIssue) => void
  fixing?: boolean
  fixed?: boolean
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  apps: <Shield size={18} />,
  feeds: <Rss size={18} />,
  notifications: <Bell size={18} />,
}

const FIX_LABELS: Record<string, string> = {
  'add-domain-block': 'Block Site',
  'add-process-block': 'Block Apps',
  'enable-feed-guard': 'Block All Feeds',
  'enable-notification-filter': 'Start Focus Session',
  'review-extensions': 'Open Extensions',
}

const SEV_COLORS: Record<string, string> = {
  high: '#ef5350',
  medium: '#ffb800',
  low: '#66bb6a',
}

export default function IssueCard({ issue, onFix, onAskAI, fixing, fixed }: IssueCardProps): React.ReactElement {
  const icon = CATEGORY_ICONS[issue.category] ?? <AlertCircle size={18} />
  const sevColor = SEV_COLORS[issue.severity] ?? '#546e7a'
  const fixLabel = FIX_LABELS[issue.fixAction ?? ''] ?? 'Fix Issue'

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl transition-all duration-200"
      style={{
        background: fixed ? 'rgba(76,175,80,0.05)' : 'rgba(17,34,64,0.6)',
        border: fixed ? '1px solid rgba(76,175,80,0.2)' : '1px solid rgba(30,58,95,0.4)',
        opacity: fixed ? 0.6 : 1,
      }}
    >
      {/* Severity indicator + icon */}
      <div className="relative flex-shrink-0 mt-0.5">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: sevColor + '18', color: sevColor }}
        >
          {fixed ? <CheckCircle2 size={18} style={{ color: '#66bb6a' }} /> : icon}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider flex-shrink-0"
            style={{ background: sevColor + '18', color: sevColor }}
          >
            {issue.severity}
          </span>
          <p className="text-white font-semibold text-xs truncate">{issue.title}</p>
        </div>
        <p className="text-navy-400 text-[11px] leading-relaxed mb-2.5">{issue.description}</p>

        {!fixed && (
          <div className="flex items-center gap-2">
            {onFix && (
              <button
                onClick={() => onFix(issue)}
                disabled={fixing}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
                style={{ background: 'rgba(33,150,243,0.15)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.25)' }}
              >
                {fixing ? (
                  <><Loader size={10} className="animate-spin" /> Fixing…</>
                ) : (
                  <><Shield size={10} /> {fixLabel}</>
                )}
              </button>
            )}
            {onAskAI && (
              <button
                onClick={() => onAskAI(issue)}
                className="flex items-center gap-1 text-[11px] text-navy-500 hover:text-accent-blue transition-colors"
              >
                <MessageSquare size={10} /> Ask Daemon
              </button>
            )}
          </div>
        )}

        {fixed && (
          <p className="text-[11px]" style={{ color: '#66bb6a' }}>Fixed — protection applied</p>
        )}
      </div>
    </div>
  )
}
