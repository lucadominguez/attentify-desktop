import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Send, Lock, ScanLine, RefreshCw, Activity, Shield, Copy, Check } from 'lucide-react'
import type { AppStore, ChatMessage, ScanResult, ViewName, HeuristicAlert } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface HomeProps {
  store: AppStore
  onNavigate: (view: ViewName) => void
  onScanComplete: (results: ScanResult) => void
  onRefresh: () => void
  latestAlert?: HeuristicAlert | null
  onChatWith?: (msg: string) => void
}

interface TodayStats {
  focusedTime: number
  switchRate: number
  topDistractor: string | null
}

const THINKING_PHASES = ['Parsing intent...', 'Checking your blocklist...', 'Composing response...']

function formatMs(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function renderMarkdown(content: string): React.ReactNode {
  return content.split('\n').map((line, li, arr) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g)
    const nodes = parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>
      if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))
        return <em key={i} style={{ color: '#90a4ae' }}>{part.slice(1, -1)}</em>
      return <span key={i}>{part}</span>
    })
    return (
      <React.Fragment key={li}>
        {nodes}
        {li < arr.length - 1 && <br />}
      </React.Fragment>
    )
  })
}

// ── Switch rate metric ────────────────────────────────────────────────────────
function SwitchRateMetric({ rate }: { rate: number }): React.ReactElement {
  const color  = rate === 0 ? '#7a9ab5' : rate < 20 ? '#4ade80' : rate < 60 ? '#fbbf24' : '#f97316'
  const status = rate === 0 ? 'no data yet' : rate < 20 ? 'deep work' : rate < 60 ? 'moderate' : 'fragmented'
  return (
    <div
      className="flex items-baseline gap-1.5"
      title="Context switches per hour. Knowledge workers avg 60–80/h · Deep work lives below 20/h"
    >
      <span className="text-2xl font-black tabular-nums leading-none" style={{ color }}>
        {rate > 0 ? rate : '—'}
      </span>
      <span className="text-[11px] font-medium leading-none" style={{ color: '#7a9ab5' }}>/h</span>
      <span className="text-[11px] font-semibold leading-none" style={{ color }}>
        {status}
      </span>
    </div>
  )
}

// ── Conversation jump rail ────────────────────────────────────────────────────
interface RailProps {
  messages: ChatMessage[]
  currentId: string | null
  onJump: (id: string) => void
}
function ConversationRail({ messages, currentId, onJump }: RailProps): React.ReactElement | null {
  const userMsgs = messages.filter((m) => m.role === 'user')
  if (userMsgs.length < 3) return null

  return (
    <div
      className="flex flex-col items-center py-3 pt-4 flex-shrink-0 overflow-y-auto"
      style={{ width: 36, borderRight: '1px solid rgba(30,58,95,0.3)', gap: 0 }}
    >
      {userMsgs.map((msg, i) => {
        const isCurrent = currentId === msg.id
        return (
          <React.Fragment key={msg.id}>
            {i > 0 && (
              <div className="w-px flex-shrink-0" style={{ height: 14, background: 'rgba(50,80,130,0.5)' }} />
            )}
            <button
              onClick={() => onJump(msg.id)}
              title={msg.content.length > 72 ? msg.content.slice(0, 72) + '…' : msg.content}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 transition-all duration-150"
              style={{
                background: isCurrent ? 'rgba(59,130,246,0.85)' : 'rgba(38,65,108,0.7)',
                color: isCurrent ? '#fff' : '#8faac4',
                border: `1px solid ${isCurrent ? 'rgba(59,130,246,0.5)' : 'rgba(50,80,130,0.5)'}`,
                boxShadow: isCurrent ? '0 0 8px rgba(59,130,246,0.4)' : 'none',
              }}
            >
              {i + 1}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Home({ store, onNavigate, onScanComplete, onRefresh, latestAlert }: HomeProps): React.ReactElement {
  const [messages, setMessages]         = useState<ChatMessage[]>([])
  const [input, setInput]               = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [phase, setPhase]               = useState<'idle' | 'thinking' | 'streaming'>('idle')
  const [thinkingStep, setThinkingStep] = useState(0)
  const [streamedText, setStreamedText] = useState('')
  const [scanning, setScanning]         = useState(false)
  const [todayStats, setTodayStats]     = useState<TodayStats | null>(null)
  const [relaunching, setRelaunching]   = useState(false)
  const [currentMsgId, setCurrentMsgId] = useState<string | null>(null)
  const [tick, setTick]                 = useState(0)

  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)
  const msgRefs     = useRef<Record<string, HTMLDivElement | null>>({})
  const streamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const thinkTimer  = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAlertId = useRef<string | null>(null)

  const activeSession      = store.sessions.find((s) => s.active)
  const isProcessing       = phase !== 'idle'
  const showQuickCommands  = messages.length === 0 && phase === 'idle'

  useEffect(() => {
    if (!activeSession?.endsAt) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [activeSession?.endsAt])

  const loadStats = useCallback(() => {
    api.getAnalytics().then((data) => {
      const sessions = data.recentSessions ?? []
      const cutoff   = Date.now() - 8 * 3600000
      const today    = sessions.filter((s) => s.startTime > cutoff)
      const totalMs  = today.reduce((s, r) => s + r.duration, 0)
      const hours    = totalMs / 3600000
      const rate     = hours > 0.05 ? Math.round(today.length / hours) : 0
      const byApp    = new Map<string, number>()
      for (const s of sessions.filter((s) => s.isDistraction))
        byApp.set(s.app, (byApp.get(s.app) ?? 0) + s.duration)
      const top = [...byApp.entries()].sort((a, b) => b[1] - a[1])[0]
      setTodayStats({
        focusedTime: data.today.focusedTime,
        switchRate: rate,
        topDistractor: top?.[0] ?? null,
      })
    }).catch(() => {})
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  useEffect(() => {
    if (!latestAlert || latestAlert.id === lastAlertId.current) return
    lastAlertId.current = latestAlert.id
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `**${latestAlert.title}**\n${latestAlert.description}\n\nWant me to help you refocus? I can block the source, start a focus timer, or suggest a habit interrupt.`,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, msg])
  }, [latestAlert])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamedText, thinkingStep])

  useEffect(() => () => {
    if (streamTimer.current) clearTimeout(streamTimer.current)
    if (thinkTimer.current) clearInterval(thinkTimer.current)
  }, [])

  const quickCommands = useMemo(() => {
    const cmds: { label: string; text: string }[] = []
    if (todayStats?.topDistractor) cmds.push({ label: `Block ${todayStats.topDistractor}`, text: `Block ${todayStats.topDistractor}` })
    cmds.push({ label: 'Deep focus 90m', text: 'Start deep focus session for 90 minutes' })
    cmds.push({ label: 'My stats', text: 'What is distracting me most this week?' })
    if (todayStats && todayStats.switchRate > 60)
      cmds.push({ label: 'Fix my switching', text: 'I keep switching between apps. Help me reduce context switching.' })
    else
      cmds.push({ label: 'Block YouTube', text: 'Block YouTube for the rest of the day' })
    return cmds
  }, [todayStats])

  const startStreaming = useCallback((text: string, onDone: () => void) => {
    setPhase('streaming')
    setStreamedText('')
    let i = 0
    const DELAYS: Record<string, number> = { '.': 55, '!': 55, '?': 55, '\n': 65, ',': 25 }
    const tick = () => {
      if (i >= text.length) { onDone(); return }
      i++
      setStreamedText(text.slice(0, i))
      streamTimer.current = setTimeout(tick, DELAYS[text[i - 1] ?? ''] ?? (text[i - 1] === ' ' ? 8 : 11))
    }
    tick()
  }, [])

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || isProcessing) return
    setInput('')

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    setCurrentMsgId(userMsg.id)

    setPhase('thinking')
    setThinkingStep(0)
    let step = 0
    thinkTimer.current = setInterval(() => {
      step++
      if (step < THINKING_PHASES.length) setThinkingStep(step)
      else if (thinkTimer.current) clearInterval(thinkTimer.current)
    }, 420)

    let reply = ''
    try {
      const res = await api.sendMessage(trimmed)
      reply = res.reply
      onRefresh()
      loadStats()
    } catch { reply = 'Something went wrong. Try again.' }

    if (thinkTimer.current) clearInterval(thinkTimer.current)
    await new Promise((r) => setTimeout(r, 200))

    startStreaming(reply, () => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: reply, timestamp: Date.now() }])
      setStreamedText('')
      setPhase('idle')
    })
  }, [isProcessing, onRefresh, loadStats, startStreaming])

  const jumpToMessage = useCallback((id: string) => {
    msgRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setCurrentMsgId(id)
  }, [])

  const handleRunScan = async (): Promise<void> => {
    if (scanning) return
    setScanning(true)
    try { onScanComplete(await api.runScan()) } finally { setScanning(false) }
  }

  const sessionRemaining = activeSession?.endsAt
    ? Math.max(0, activeSession.endsAt - Date.now())
    : null
  void tick

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center px-5"
        style={{ height: 44, background: 'rgba(8,15,30,0.85)', borderBottom: '1px solid rgba(30,58,95,0.35)' }}
      >
        {/* Left: session status */}
        <div className="flex items-center gap-2 min-w-0" style={{ flex: '0 0 auto', maxWidth: 220 }}>
          {activeSession ? (
            <>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#4ade80', boxShadow: '0 0 6px #4ade80' }} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold leading-none" style={{ color: '#4ade80' }}>
                  {activeSession.mode === 'deep' ? 'Deep focus' : 'Focus session'}
                </p>
                {sessionRemaining !== null && (
                  <p className="text-[10px] leading-none mt-0.5" style={{ color: '#7a9ab5' }}>
                    {formatMs(sessionRemaining)} remaining
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'rgba(50,80,130,0.6)' }} />
              <p className="text-[11px]" style={{ color: '#7a9ab5' }}>No active session</p>
            </>
          )}
        </div>

        {/* Center: switch rate */}
        <div className="flex-1 flex justify-center">
          {todayStats !== null
            ? <SwitchRateMetric rate={todayStats.switchRate} />
            : <span className="text-[11px]" style={{ color: '#7a9ab5' }}>Collecting data…</span>}
        </div>

        {/* Right: focused time + scan */}
        <div className="flex items-center gap-3" style={{ flex: '0 0 auto' }}>
          {todayStats !== null && todayStats.focusedTime > 0 && (
            <div className="flex items-center gap-1.5" title="Focused time today">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#3b82f6' }} />
              <span className="text-[11px]" style={{ color: '#8faac4' }}>{formatMs(todayStats.focusedTime)} focused</span>
            </div>
          )}
          <button
            onClick={handleRunScan}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all disabled:opacity-50 hover:scale-105"
            style={{ background: 'rgba(33,150,243,0.1)', color: '#64b5f6', border: '1px solid rgba(33,150,243,0.22)' }}
          >
            <ScanLine size={10} />
            {scanning ? 'Scanning…' : 'Focus Scan'}
          </button>
        </div>
      </div>

      {/* ── Elevation banner ────────────────────────────────────────────────── */}
      {(store.elevation === 'soft' || store.elevation === 'unknown') && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 gap-4"
          style={{ background: 'rgba(255,184,0,0.05)', borderBottom: '1px solid rgba(255,184,0,0.12)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Activity size={12} style={{ color: '#ffb800', flexShrink: 0 }} />
            <p className="text-[11px] font-medium" style={{ color: '#ffb800' }}>
              Soft protection active — app blocking on
              <span className="font-normal" style={{ color: '#8faac4' }}> · site blocking needs admin</span>
            </p>
          </div>
          <button
            onClick={async () => { setRelaunching(true); try { await api.relaunchAsAdmin() } catch { setRelaunching(false) } }}
            disabled={relaunching}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-60"
            style={{ background: 'rgba(255,107,53,0.12)', color: '#ff6b35', border: '1px solid rgba(255,107,53,0.25)' }}
          >
            {relaunching
              ? <><RefreshCw size={9} className="animate-spin" /> Relaunching…</>
              : <><Shield size={9} /> Enable Full</>}
          </button>
        </div>
      )}

      {/* ── Chat area ───────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <ConversationRail messages={messages} currentId={currentMsgId} onJump={jumpToMessage} />

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">

          {/* Empty state */}
          {showQuickCommands && (
            <div className="flex flex-col items-center justify-center h-full gap-5 pb-6">
              <p className="text-sm font-medium" style={{ color: '#8faac4' }}>
                What would you like to focus on today?
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-[480px]">
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd.label}
                    onClick={() => sendMessage(cmd.text)}
                    className="px-3.5 py-2 rounded-xl text-[12px] font-medium transition-all duration-200 hover:scale-105"
                    style={{
                      background: 'rgba(33,150,243,0.09)',
                      border: '1px solid rgba(59,130,246,0.22)',
                      color: '#7eb8f5',
                    }}
                  >
                    {cmd.label}
                  </button>
                ))}
                {!activeSession && (
                  <button
                    onClick={() => onNavigate('deep-focus')}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-medium transition-all duration-200 hover:scale-105"
                    style={{
                      background: 'rgba(129,140,248,0.08)',
                      border: '1px solid rgba(129,140,248,0.22)',
                      color: '#a5b4fc',
                    }}
                  >
                    <Lock size={11} />
                    Deep Focus
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div key={msg.id} ref={(el) => { msgRefs.current[msg.id] = el }}>
              <MessageBubble msg={msg} />
            </div>
          ))}

          {/* Thinking indicator — inline bubble */}
          {phase === 'thinking' && (
            <div className="flex items-start gap-2.5 animate-fade-in">
              <OrbAvatar />
              <div
                className="px-4 py-3 text-[13px]"
                style={{
                  background: 'rgba(14,26,50,0.95)',
                  border: '1px solid rgba(38,65,108,0.65)',
                  borderRadius: '4px 16px 16px 16px',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{ background: '#5b8fd4', animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                  <span className="text-[11px]" style={{ color: '#7a9ab5' }}>
                    {THINKING_PHASES[thinkingStep] ?? THINKING_PHASES[0]}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Streaming message */}
          {phase === 'streaming' && streamedText && (
            <div className="flex items-start gap-2.5 animate-fade-in">
              <OrbAvatar />
              <div
                className="max-w-[84%] px-4 py-3 text-[13px] leading-relaxed"
                style={{
                  background: 'rgba(14,26,50,0.95)',
                  border: '1px solid rgba(38,65,108,0.65)',
                  color: '#c4d4e8',
                  borderRadius: '4px 16px 16px 16px',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
                }}
              >
                {renderMarkdown(streamedText)}
                <span
                  className="inline-block w-0.5 h-3.5 ml-0.5 align-text-bottom animate-pulse"
                  style={{ background: '#5b8fd4' }}
                />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ───────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200"
          style={{
            background: 'rgba(11,20,42,0.97)',
            border: `1px solid ${inputFocused ? 'rgba(59,130,246,0.5)' : 'rgba(38,65,108,0.55)'}`,
            boxShadow: inputFocused ? '0 0 0 3px rgba(59,130,246,0.08), 0 2px 16px rgba(0,0,0,0.3)' : '0 2px 12px rgba(0,0,0,0.2)',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Tell me what you're working on, or ask me to block something…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(input) }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            disabled={isProcessing}
            className="flex-1 bg-transparent text-[13px] outline-none disabled:opacity-40"
            style={{ color: '#e2e8f0', caretColor: '#5b8fd4' }}
            // inline style for placeholder color via CSS custom property trick
            // using a data attribute approach to style placeholder
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isProcessing}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-xl transition-all duration-200 disabled:opacity-25 hover:scale-110 active:scale-95"
            style={{
              background: input.trim() && !isProcessing
                ? 'linear-gradient(135deg, rgba(59,130,246,0.9), rgba(37,99,235,0.95))'
                : 'rgba(30,58,95,0.5)',
              boxShadow: input.trim() && !isProcessing ? '0 0 12px rgba(59,130,246,0.3)' : 'none',
            }}
          >
            {isProcessing
              ? <div className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />
              : <Send size={13} className="text-white" style={{ marginLeft: 1 }} />}
          </button>
        </div>
        {/* Placeholder color fix via global style injection */}
        <style>{`input::placeholder { color: #4e6880; }`}</style>
      </div>
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const isUser = msg.role === 'user'

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(msg.content).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`group flex items-start gap-2.5 animate-fade-in ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <OrbAvatar />}

      <div className="flex flex-col gap-1 max-w-[84%]">
        {/* Bubble */}
        <div
          className="px-4 py-3 text-[13px] leading-relaxed relative"
          style={isUser ? {
            background: 'rgba(46,100,190,0.28)',
            border: '1px solid rgba(70,130,230,0.4)',
            color: '#dce8f8',
            borderRadius: '16px 16px 4px 16px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
          } : {
            background: 'rgba(14,26,50,0.95)',
            border: '1px solid rgba(38,65,108,0.65)',
            color: '#c4d4e8',
            borderRadius: '4px 16px 16px 16px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          }}
        >
          {renderMarkdown(msg.content)}

          {/* Copy button — appears in corner on hover, doesn't overlap text */}
          <button
            onClick={copy}
            className="absolute -top-2.5 opacity-0 group-hover:opacity-100 transition-all duration-150 flex items-center gap-1 px-1.5 py-0.5 rounded-md"
            style={{
              right: isUser ? 4 : 'auto',
              left: isUser ? 'auto' : 4,
              background: 'rgba(12,22,45,0.95)',
              border: '1px solid rgba(50,80,130,0.6)',
              color: copied ? '#4ade80' : '#8faac4',
            }}
            title="Copy"
          >
            {copied ? <Check size={9} /> : <Copy size={9} />}
            <span className="text-[8px] font-medium">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        {/* Timestamp */}
        <span
          className={`text-[10px] px-1 ${isUser ? 'text-right' : 'text-left'}`}
          style={{ color: '#546a80' }}
        >
          {fmtTime(msg.timestamp)}
        </span>
      </div>
    </div>
  )
}

// ── Orb avatar ────────────────────────────────────────────────────────────────
function OrbAvatar(): React.ReactElement {
  return (
    <div
      className="w-6 h-6 rounded-full flex-shrink-0 self-start mt-1"
      style={{
        background: 'radial-gradient(circle at 38% 30%, #bfdbfe, #3b82f6 55%, #1d4ed8)',
        boxShadow: '0 0 8px rgba(59,130,246,0.45)',
      }}
    />
  )
}
