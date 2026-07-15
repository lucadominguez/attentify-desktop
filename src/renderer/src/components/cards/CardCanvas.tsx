import React, { useCallback, useMemo, useState } from 'react'
import Card from './Card'
import CardDetail from './CardDetail'
import type { ActivitySession, CustomAnalyticsCard } from '@shared/types'

// A page is a canvas of cards, not a hand-built layout. Order is the user's, so it is
// persisted on the card itself rather than implied by insertion order.
//
// Drag uses native HTML5 drag events on purpose: no new dependency, and this list is
// short (cards cap at 24). A drag library would be more weight than the feature.

export interface CardCanvasProps {
  cards: CustomAnalyticsCard[]
  sessions?: ActivitySession[]
  /** Resolved items for non-activity cards, keyed by card id. */
  itemsByCard?: Record<string, { label: string; detail?: string }[]>
  onReorder: (ordered: CustomAnalyticsCard[]) => void
  onDelete?: (id: string) => void
  onRun?: (card: CustomAnalyticsCard) => void
  /** Rendered when the canvas is empty. A blank canvas needs a way in. */
  empty?: React.ReactNode
  columns?: 1 | 2
}

/** Absent `order` sorts by creation, so cards saved before ordering existed still work. */
export function sortCards(cards: CustomAnalyticsCard[]): CustomAnalyticsCard[] {
  return [...cards].sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER
    const bo = b.order ?? Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    return a.createdAt - b.createdAt
  })
}

export default function CardCanvas({
  cards, sessions = [], itemsByCard, onReorder, onDelete, onRun, empty, columns = 2,
}: CardCanvasProps): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const ordered = useMemo(() => sortCards(cards), [cards])

  const handleDrop = useCallback((targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return }
    const next = [...ordered]
    const from = next.findIndex((c) => c.id === dragId)
    const to = next.findIndex((c) => c.id === targetId)
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return }
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    // Renumber densely so `order` never drifts into ties or gaps.
    onReorder(next.map((c, i) => ({ ...c, order: i })))
    setDragId(null)
    setOverId(null)
  }, [dragId, ordered, onReorder])

  if (!ordered.length && empty) return <>{empty}</>

  // Masonry, not grid. A CSS grid sizes every row to its tallest card, so a heatmap next
  // to a one-line number leaves a hole under the short one. Columns let each card take
  // its natural height and flow into the gap. The tradeoff is column-major order (1,2 in
  // the left column, 3,4 in the right), which is fine here: the canvas is short and the
  // user sets the order by dragging anyway.
  return (
    <div className={columns === 2 ? 'gap-2.5 [column-count:2] [column-gap:0.625rem]' : 'flex flex-col gap-2.5'}>
      {ordered.map((card) => (
        <div
          key={card.id}
          style={{
            // Only a hint of where it will land; the card itself shows the drag state.
            outline: overId === card.id && dragId !== card.id ? '1px dashed currentColor' : 'none',
            outlineOffset: 3,
            borderRadius: 12,
            // A card must never be split across a column break.
            breakInside: 'avoid',
            WebkitColumnBreakInside: 'avoid',
            marginBottom: columns === 2 ? '0.625rem' : undefined,
          }}
        >
          <Card
            card={card}
            sessions={sessions}
            items={itemsByCard?.[card.id]}
            onDelete={onDelete ? () => onDelete(card.id) : undefined}
            onRun={onRun ? () => onRun(card) : undefined}
            onOpen={() => setOpenId(card.id)}
            isDragging={dragId === card.id}
            dragHandlers={{
              draggable: true,
              onDragStart: (e) => { setDragId(card.id); e.dataTransfer.effectAllowed = 'move' },
              onDragEnd: () => { setDragId(null); setOverId(null) },
              onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverId(card.id) },
              onDragLeave: () => setOverId((p) => (p === card.id ? null : p)),
              onDrop: (e) => { e.preventDefault(); handleDrop(card.id) },
            }}
          />
        </div>
      ))}
      {openId && (() => {
        const c = ordered.find((x) => x.id === openId)
        if (!c) return null
        return <CardDetail card={c} sessions={sessions} items={itemsByCard?.[c.id]} onClose={() => setOpenId(null)} />
      })()}
    </div>
  )
}
