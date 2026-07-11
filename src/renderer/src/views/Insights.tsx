import React, { useState } from 'react'
import { Activity, Brain } from 'lucide-react'
import type { HeuristicAlert } from '@shared/types'
import { useTheme } from '../context/ThemeContext'
import Analytics from './Analytics'
import Patterns from './Patterns'

interface InsightsProps {
  heuristicAlerts: HeuristicAlert[]
  onChatWith?: (msg: string) => void
}

type Tab = 'analytics' | 'patterns'

// Insights merges the old "Analytics" and "Patterns" surfaces behind one nav entry.
// A single tab bar switches between the time/focus breakdown and the habit patterns
// the daemon has noticed — they were previously two nav items covering the same
// "understand my behaviour" job.
export default function Insights({ heuristicAlerts, onChatWith }: InsightsProps): React.ReactElement {
  const { colors } = useTheme()
  const [tab, setTab] = useState<Tab>('analytics')

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'analytics', label: 'Time & Focus', icon: <Activity size={13} /> },
    { id: 'patterns',  label: 'Patterns',     icon: <Brain size={13} /> },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — the one shared header for both insight surfaces */}
      <div
        className="flex items-center gap-1 px-4 pt-3 pb-2 flex-shrink-0"
        style={{ borderBottom: `1px solid ${colors.border}` }}
      >
        {tabs.map((t) => {
          const active = tab === t.id
          const alerts = t.id === 'patterns' && heuristicAlerts.some((a) => !a.dismissed)
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
              style={{
                background: active ? colors.accentBg : 'transparent',
                color: active ? colors.accent : colors.textMuted,
                border: `1px solid ${active ? colors.border : 'transparent'}`,
              }}
            >
              {t.icon}
              {t.label}
              {alerts && (
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#fbbf24' }} />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'analytics'
          ? <Analytics onChatWith={onChatWith} />
          : <Patterns heuristicAlerts={heuristicAlerts} onChatWith={onChatWith} />}
      </div>
    </div>
  )
}
