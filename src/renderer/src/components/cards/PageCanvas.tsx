import React, { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import CardCanvas from './CardCanvas'
import { AskAIProvider } from '../MetricDrill'
import { useTheme } from '../../context/ThemeContext'
import type { ActivitySession, CardPage, CustomAnalyticsCard } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

// A whole page, as a canvas of cards.
//
// Every page shares this: load the cards for this page, recompute them locally, let the
// user drag, ask and delete. The wiring lives here once rather than four times, so the
// pages cannot drift apart in how a card behaves.

export default function PageCanvas({
  page, onChatWith, columns = 2, emptyHint,
}: {
  page: CardPage
  onChatWith?: (prompt: string) => void
  columns?: 1 | 2
  /** Example of what to ask for. A blank canvas and "I don't know what to ask" are the
   *  same state, so every page says what it can build. */
  emptyHint?: string
}): React.ReactElement {
  const { colors } = useTheme()
  const [cards, setCards] = useState<CustomAnalyticsCard[]>([])
  const [sessions, setSessions] = useState<ActivitySession[]>([])
  const [items, setItems] = useState<Record<string, { label: string; detail?: string }[]>>({})

  const load = useCallback(() => {
    api.getCustomCards?.()
      .then((all) => {
        // Cards saved before pages existed default to analytics, matching the type.
        const mine = (all ?? []).filter((c) => (c.page ?? 'analytics') === page)
        setCards(mine)
        // Non-activity cards cannot be computed from the session log, so main resolves
        // their items from the DB/store instead.
        const needsItems = mine.filter((c) => c.kind !== 'action' && (c.spec.source ?? 'activity') !== 'activity')
        if (!needsItems.length) return
        Promise.all(needsItems.map((c) =>
          api.getCardItems?.(c.id).then((r) => [c.id, r?.items ?? []] as const).catch(() => [c.id, []] as const),
        )).then((pairs) => setItems(Object.fromEntries(pairs.filter(Boolean) as [string, { label: string }[]][])))
      })
      .catch(() => setCards([]))
  }, [page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Activity only matters for data cards on the activity source.
    api.getActivity?.(31).then((r) => setSessions(r?.sessions ?? [])).catch(() => setSessions([]))
  }, [])

  const run = useCallback((card: CustomAnalyticsCard) => {
    if (card.action?.confirm && !window.confirm(`${card.action.label}?\n\n${card.description ?? card.title}`)) return
    api.runCardAction?.(card.id)
      .then((r) => { if (!r?.ok && r?.error) window.alert(r.error); else load() })
      .catch(() => { /* signed out: the gate already refused it */ })
  }, [load])

  return (
    <AskAIProvider value={onChatWith}>
      <CardCanvas
        cards={cards}
        sessions={sessions}
        itemsByCard={items}
        columns={columns}
        onReorder={(next) => {
          setCards(next)
          api.reorderAnalyticsCards?.(next.map((c) => c.id)).catch(() => { /* signed out: not persisted */ })
        }}
        onDelete={(id) => {
          setCards((prev) => prev.filter((c) => c.id !== id))
          api.deleteCustomCard?.(id).catch(() => load())
        }}
        onRun={run}
        empty={
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center rounded-xl"
            style={{ background: colors.glassMid, backdropFilter: colors.blurSm, border: `1px solid ${colors.glassEdge}` }}>
            <Sparkles size={18} style={{ color: colors.accent, opacity: 0.7 }} />
            <p className="text-[12px] font-medium mt-2" style={{ color: colors.textPrimary }}>Nothing here yet</p>
            <p className="text-[10px] mt-1 max-w-xs leading-relaxed" style={{ color: colors.textMuted }}>
              This page is built from cards. Ask Attentify for what you want to see and it appears here.
            </p>
            {emptyHint && onChatWith && (
              <button onClick={() => onChatWith(emptyHint)}
                className="mt-3 text-[10px] px-2.5 py-1.5 rounded-lg transition-all hover:brightness-110"
                style={{ background: colors.accentBg, border: `1px solid ${colors.borderMid}`, color: colors.accent }}>
                Try: &ldquo;{emptyHint}&rdquo;
              </button>
            )}
          </div>
        }
      />
    </AskAIProvider>
  )
}
