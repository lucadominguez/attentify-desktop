import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Send, Lock, RefreshCw, Activity, Shield, Copy, Check, Zap, BarChart2, ScanLine, Key, Eye, EyeOff, X, History, Plus, MessageSquare } from 'lucide-react'
import type { AppStore, ChatMessage, ScanResult, ViewName, HeuristicAlert } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

// ── Thread types ──────────────────────────────────────────────────────────────

interface Thread {
  date: string
  label: string
  preview: string
  messages: ChatMessage[]
  lastTs: number
}

interface RawAgentMsg {
  id: string
  role: string
  content: string
  ts: number
}

function formatDateLabel(dateStr: string): string {
  const today = new Date().toISOString().split('T')[0]!
  const yest  = new Date(Date.now() - 86400000).toISOString().split('T')[0]!
  if (dateStr === today) return 'Today'
  if (dateStr === yest)  return 'Yesterday'
  const d = new Date(dateStr)
  const diff = (Date.now() - d.getTime()) / 86400000
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function buildThreads(raw: RawAgentMsg[]): Thread[] {
  const groups = new Map<string, ChatMessage[]>()
  for (const m of raw) {
    if (m.role === 'tool') continue
    if (m.content.startsWith('[proactive]')) continue
    const date = new Date(m.ts).toISOString().split('T')[0]!
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date)!.push({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content, timestamp: m.ts })
  }
  return [...groups.entries()]
    .map(([date, messages]) => ({
      date,
      label: formatDateLabel(date),
      preview: messages.find((m) => m.role === 'user')?.content.slice(0, 72) ?? '—',
      messages,
      lastTs: Math.max(...messages.map((m) => m.timestamp)),
    }))
    .sort((a, b) => b.lastTs - a.lastTs)
}

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

const THINKING_PHASES = ['Connecting to Claude...', 'Analyzing your context...', 'Composing response...', 'Using tools...', 'Finalizing...']

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  if (m > 0) return `${m}m`
  return '<1m'
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function renderMarkdown(content: string, textPrimary: string, textSecondary: string): React.ReactNode {
  return content.split('\n').map((line, li, arr) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g)
    const nodes = parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i} style={{ color: textPrimary, fontWeight: 600 }}>{part.slice(2, -2)}</strong>
      if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))
        return <em key={i} style={{ color: textSecondary }}>{part.slice(1, -1)}</em>
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


// ── Main component ────────────────────────────────────────────────────────────
export default function Home({ store, onNavigate, onScanComplete: _onScanComplete, onRefresh, latestAlert }: HomeProps): React.ReactElement {
  const [messages, setMessages]         = useState<ChatMessage[]>([])
  const [input, setInput]               = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [phase, setPhase]               = useState<'idle' | 'thinking' | 'streaming'>('idle')
  const [thinkingStep, setThinkingStep] = useState(0)
  const [streamedText, setStreamedText] = useState('')
  const [todayStats, setTodayStats]     = useState<TodayStats | null>(null)
  const [relaunching, setRelaunching]   = useState(false)
  const [currentMsgId, setCurrentMsgId] = useState<string | null>(null)
  const [tick, setTick]                 = useState(0)
  const [greetText, setGreetText]       = useState('')
  const [greetDone, setGreetDone]       = useState(false)
  const [activeToolName, setActiveToolName] = useState<string | null>(null)

  // API key state
  const [hasApiKey, setHasApiKey]       = useState<boolean | null>(null)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)

  // Thread history
  const [threadsOpen, setThreadsOpen]   = useState(false)
  const [allThreads, setAllThreads]     = useState<Thread[]>([])
  const [activeThreadDate, setActiveThreadDate] = useState<string | null>(null)

  const bottomRef    = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const msgRefs      = useRef<Record<string, HTMLDivElement | null>>({})
  const thinkTimer   = useRef<ReturnType<typeof setInterval> | null>(null)
  const greetTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const greetStarted = useRef(false)
  const lastAlertId  = useRef<string | null>(null)
  // Unsubscribe functions for streaming listeners
  const cleanupStream = useRef<(() => void)[]>([])

  const { colors } = useTheme()
  const activeSession     = store.sessions.find((s) => s.active)
  const isProcessing      = phase !== 'idle'
  const showQuickCommands = messages.length === 0 && phase === 'idle'

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

  // ── Check API key on mount ────────────────────────────────────────────────
  useEffect(() => {
    api.getApiKeyStatus().then(({ hasKey }) => setHasApiKey(hasKey)).catch(() => setHasApiKey(false))
  }, [])

  // ── Load thread history from DB ────────────────────────────────────────────
  useEffect(() => {
    api.getAgentHistory?.(200)
      .then((raw: RawAgentMsg[]) => {
        const threads = buildThreads(raw)
        setAllThreads(threads)
        // Seed today's messages into the chat on first load
        const today = threads.find((t) => t.date === new Date().toISOString().split('T')[0])
        if (today && today.messages.length > 0) {
          setMessages(today.messages)
          setActiveThreadDate(today.date)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close thread drawer on Escape ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && threadsOpen) setThreadsOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [threadsOpen])

  // ── Refresh threads when a new message is added ────────────────────────────
  const refreshThreads = useCallback(() => {
    api.getAgentHistory?.(200)
      .then((raw: RawAgentMsg[]) => setAllThreads(buildThreads(raw)))
      .catch(() => {})
  }, [])

  // ── Proactive agent messages ───────────────────────────────────────────────
  useEffect(() => {
    const unsub = api.onAgentProactive?.((evt) => {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), role: 'assistant',
        content: evt.text, timestamp: evt.timestamp,
      }])
    })
    return () => unsub?.()
  }, [])

  // ── Store refresh signal (after agent tool use) ────────────────────────────
  useEffect(() => {
    const unsub = api.onStoreRefresh?.(() => onRefresh())
    return () => unsub?.()
  }, [onRefresh])

  // ── Greeting typewriter ────────────────────────────────────────────────────
  useEffect(() => {
    if (!showQuickCommands || greetStarted.current) return
    greetStarted.current = true

    const rate = todayStats?.switchRate ?? 0
    const text = rate > 40
      ? `${rate}/h context switches — attention is scattered. I'm here to help you lock in. What are we working on?`
      : rate > 0
        ? `Running at ${rate}/h switches — solid discipline. I'm watching your focus in real time. What are we building?`
        : "I'm live and protecting your focus. What will you accomplish today?"

    let i = 0
    const tick = (): void => {
      i++
      setGreetText(text.slice(0, i))
      if (i >= text.length) { setGreetDone(true); return }
      greetTimer.current = setTimeout(tick, i === 1 ? 350 : text[i - 1] === '.' ? 60 : text[i - 1] === ',' ? 30 : 14)
    }
    greetTimer.current = setTimeout(tick, 180)
  }, [showQuickCommands, todayStats]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!latestAlert || latestAlert.id === lastAlertId.current) return
    lastAlertId.current = latestAlert.id
    setMessages((prev) => [...prev, {
      id: crypto.randomUUID(), role: 'assistant',
      content: `**${latestAlert.title}**\n${latestAlert.description}\n\nWant me to help you refocus? I can block the source, start a focus timer, or suggest a habit interrupt.`,
      timestamp: Date.now(),
    }])
  }, [latestAlert])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamedText, thinkingStep])

  useEffect(() => () => {
    if (thinkTimer.current) clearInterval(thinkTimer.current)
    if (greetTimer.current) clearTimeout(greetTimer.current)
    cleanupStream.current.forEach((fn) => fn())
  }, [])

  const quickCommands = useMemo(() => {
    const cmds: { label: string; text: string; icon: React.ReactNode; accent: string }[] = []
    if (todayStats?.topDistractor)
      cmds.push({ label: `Block ${todayStats.topDistractor}`, text: `Block ${todayStats.topDistractor}`, icon: <Shield size={11} />, accent: '#ff4444' })
    cmds.push({ label: 'Deep focus 90m', text: 'Start deep focus session for 90 minutes', icon: <Zap size={11} />, accent: '#00e5c8' })
    cmds.push({ label: 'Analyze my week', text: 'What is distracting me most this week?', icon: <BarChart2 size={11} />, accent: '#00c8ff' })
    cmds.push({
      label: todayStats && todayStats.switchRate > 60 ? 'Fix my switching' : 'Block YouTube',
      text: todayStats && todayStats.switchRate > 60 ? 'I keep switching between apps. Help me reduce context switching.' : 'Block YouTube for the rest of the day',
      icon: <ScanLine size={11} />,
      accent: '#ffaa00',
    })
    return cmds
  }, [todayStats])

  const sendMessage = useCallback((text: string): void => {
    const trimmed = text.trim()
    if (!trimmed || isProcessing) return
    setInput('')
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    setCurrentMsgId(userMsg.id)
    setPhase('thinking')
    setThinkingStep(0)
    setStreamedText('')
    setActiveToolName(null)
    let step = 0
    thinkTimer.current = setInterval(() => {
      step++
      if (step < THINKING_PHASES.length) setThinkingStep(step)
    }, 500)

    // Clean up any previous listeners
    cleanupStream.current.forEach((fn) => fn())
    cleanupStream.current = []

    const unChunk = api.onChatChunk((chunk) => {
      if (thinkTimer.current) { clearInterval(thinkTimer.current); thinkTimer.current = null }
      setPhase('streaming')
      setStreamedText((prev) => prev + chunk)
    })
    const unTool = api.onChatTool?.((toolName) => {
      setActiveToolName(toolName)
    })
    const unDone = api.onChatDone((evt) => {
      cleanupStream.current.forEach((fn) => fn())
      cleanupStream.current = []
      if (thinkTimer.current) { clearInterval(thinkTimer.current); thinkTimer.current = null }
      setMessages((prev) => [...prev, {
        id: evt.id, role: 'assistant', content: evt.content, timestamp: evt.timestamp,
      }])
      setStreamedText('')
      setActiveToolName(null)
      setPhase('idle')
      onRefresh()
      loadStats()
      refreshThreads()
    })
    const unErr = api.onChatError((err) => {
      cleanupStream.current.forEach((fn) => fn())
      cleanupStream.current = []
      if (thinkTimer.current) { clearInterval(thinkTimer.current); thinkTimer.current = null }
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), role: 'assistant',
        content: `Error: ${err}`, timestamp: Date.now(),
      }])
      setStreamedText('')
      setActiveToolName(null)
      setPhase('idle')
    })

    cleanupStream.current = [unChunk, unTool ?? (() => {}), unDone, unErr]

    // Fire and forget
    api.chatStart(trimmed)
  }, [isProcessing, onRefresh, loadStats, refreshThreads])

  const switchThread = useCallback((thread: Thread | null) => {
    if (thread) {
      setMessages(thread.messages)
      setActiveThreadDate(thread.date)
    } else {
      setMessages([])
      setActiveThreadDate(null)
      greetStarted.current = false
      setGreetText('')
      setGreetDone(false)
    }
    setThreadsOpen(false)
    setStreamedText('')
    setPhase('idle')
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  void tick

  const switchColor = todayStats
    ? todayStats.switchRate === 0 ? 'rgba(0,200,255,0.3)'
    : todayStats.switchRate < 20 ? '#00e676'
    : todayStats.switchRate < 60 ? '#ffaa00'
    : '#ff4444'
    : 'rgba(0,200,255,0.2)'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── API Key setup modal ──────────────────────────────────────────────── */}
      {showApiKeyModal && (
        <ApiKeyModal
          onSave={async (key) => {
            await api.setApiKey(key)
            setHasApiKey(true)
            setShowApiKeyModal(false)
          }}
          onClose={() => setShowApiKeyModal(false)}
        />
      )}

      {/* ── Elevation banner ────────────────────────────────────────────────── */}
      {(store.elevation === 'soft' || store.elevation === 'unknown') && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 gap-4"
          style={{ background: 'rgba(255,107,53,0.04)', borderBottom: '1px solid rgba(255,107,53,0.15)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Activity size={11} style={{ color: '#ff6b35', flexShrink: 0 }} />
            <p className="text-[9px] uppercase tracking-widest" style={{ color: '#ff6b35', fontFamily: '"Share Tech Mono", monospace' }}>
              Soft Mode
              <span style={{ color: colors.textMuted }}> · site blocking requires admin</span>
            </p>
          </div>
          <button
            onClick={async () => { setRelaunching(true); try { await api.relaunchAsAdmin() } catch { setRelaunching(false) } }}
            disabled={relaunching}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-60"
            style={{ background: 'rgba(255,107,53,0.1)', color: '#ff6b35', border: '1px solid rgba(255,107,53,0.25)', fontFamily: '"Share Tech Mono", monospace' }}
          >
            {relaunching ? <><RefreshCw size={8} className="animate-spin" /> Relaunching…</> : <><Shield size={8} /> Enable Full</>}
          </button>
        </div>
      )}

      {/* ── API Key banner ──────────────────────────────────────────────────── */}
      {hasApiKey === false && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 gap-4"
          style={{ background: 'rgba(0,200,255,0.04)', borderBottom: `1px solid ${colors.border}` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Key size={10} style={{ color: colors.accent, flexShrink: 0 }} />
            <p className="text-[9px] uppercase tracking-widest" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
              No API key · using local AI
              <span style={{ color: colors.textMuted, opacity: 0.6 }}> · add Anthropic or OpenRouter key for full intelligence</span>
            </p>
          </div>
          <button
            onClick={() => setShowApiKeyModal(true)}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest transition-all"
            style={{ background: colors.accentBg, color: colors.accent, border: `1px solid ${colors.borderMid}`, fontFamily: '"Share Tech Mono", monospace' }}
          >
            <Key size={8} /> Set Key
          </button>
        </div>
      )}

      {/* ── Chat area ───────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">

        {/* ── Thread history rail (36px, left strip) ───────────────────────── */}
        <div
          className="flex flex-col items-center flex-shrink-0 py-2 gap-1.5"
          style={{ width: 36, borderRight: `1px solid ${colors.border}` }}
        >
          {/* History toggle button */}
          <button
            onClick={() => setThreadsOpen((v) => !v)}
            title="Conversation history"
            className="w-6 h-6 flex items-center justify-center transition-all duration-150 relative"
            style={{
              background: threadsOpen ? colors.accentBg : 'transparent',
              color: threadsOpen ? colors.accent : colors.textMuted,
              border: `1px solid ${threadsOpen ? colors.borderMid : 'transparent'}`,
            }}
          >
            <History size={11} />
            {allThreads.length > 1 && (
              <span
                className="absolute -top-1 -right-1 w-3 h-3 flex items-center justify-center text-[7px] font-bold"
                style={{ background: colors.accent, color: colors.mainBg, borderRadius: '50%' }}
              >
                {Math.min(allThreads.length, 9)}
              </span>
            )}
          </button>

          {/* Divider */}
          <div className="w-4 flex-shrink-0" style={{ height: 1, background: colors.border }} />

          {/* New chat button */}
          <button
            onClick={() => switchThread(null)}
            title="New conversation"
            className="w-6 h-6 flex items-center justify-center transition-all duration-150"
            style={{ color: colors.textMuted, border: '1px solid transparent' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.accent; e.currentTarget.style.borderColor = colors.border }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.borderColor = 'transparent' }}
          >
            <Plus size={11} />
          </button>

          {/* Per-message jump dots (current conversation) */}
          {messages.filter((m) => m.role === 'user').length >= 2 && (
            <>
              <div className="w-4" style={{ height: 1, background: colors.border }} />
              <div className="flex flex-col items-center gap-1 overflow-hidden" style={{ maxHeight: 160 }}>
                {messages.filter((m) => m.role === 'user').map((msg, i) => (
                  <button
                    key={msg.id}
                    onClick={() => { msgRefs.current[msg.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setCurrentMsgId(msg.id) }}
                    title={msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content}
                    className="w-4 h-4 flex items-center justify-center text-[8px] font-bold flex-shrink-0 transition-all duration-100"
                    style={{
                      background: currentMsgId === msg.id ? colors.accentBg : 'transparent',
                      color: currentMsgId === msg.id ? colors.accent : colors.textMuted,
                      border: `1px solid ${currentMsgId === msg.id ? colors.borderMid : colors.border}`,
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Thread drawer (overlay, slides in from left over chat) ─────────── */}
        {threadsOpen && (
          <ThreadsDrawer
            threads={allThreads}
            activeDate={activeThreadDate}
            onSelect={switchThread}
            onNewChat={() => switchThread(null)}
            onClose={() => setThreadsOpen(false)}
          />
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 bg-grid relative">

          {/* ── Empty / welcome state ──────────────────────────────────────── */}
          {showQuickCommands && (
            <div className="flex flex-col items-center justify-center h-full pb-6 animate-fade-in relative">

              {/* Radial backdrop glow */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 42%, rgba(0,200,255,0.05) 0%, transparent 70%)' }}
              />

              {/* ── Animated diamond ──────────────────────────────────────── */}
              <div className="relative flex items-center justify-center flex-shrink-0 mb-6" style={{ width: 72, height: 72 }}>
                {/* Outermost pulse ring */}
                <div
                  className="absolute pointer-events-none animate-ping"
                  style={{
                    width: 100, height: 100,
                    border: '1px solid rgba(0,200,255,0.1)',
                    borderRadius: '50%',
                    animationDuration: '2.4s',
                  }}
                />
                {/* Mid ring */}
                <div
                  className="absolute pointer-events-none animate-pulse-slow"
                  style={{
                    width: 84, height: 84,
                    border: '1px solid rgba(0,200,255,0.2)',
                    borderRadius: '50%',
                  }}
                />
                {/* Inner ring */}
                <div
                  className="absolute pointer-events-none animate-glow-pulse"
                  style={{
                    width: 68, height: 68,
                    border: '1px solid rgba(0,200,255,0.35)',
                    borderRadius: '50%',
                  }}
                />
                {/* Diamond */}
                <svg viewBox="0 0 40 40" width={40} height={40} style={{ filter: 'drop-shadow(0 0 8px rgba(0,200,255,0.4))' }}>
                  <polygon points="20,2 38,20 20,38 2,20" fill="rgba(0,200,255,0.1)" stroke="rgba(0,200,255,0.85)" strokeWidth="1.5" />
                  <polygon points="20,8 32,20 20,32 8,20" fill="rgba(0,200,255,0.06)" stroke="rgba(0,200,255,0.4)" strokeWidth="1" />
                  <circle cx="20" cy="20" r="3" fill="#00c8ff" />
                </svg>
              </div>

              {/* ── Greeting text ──────────────────────────────────────────── */}
              <div className="text-center z-10 mb-5 px-8" style={{ maxWidth: 460 }}>
                <p
                  className="text-[9px] uppercase tracking-widest mb-3"
                  style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.22em' }}
                >
                  Daemon Online
                </p>
                <div className="min-h-[2.5rem] flex items-start justify-center">
                  <p style={{ color: colors.textPrimary, fontSize: 14, lineHeight: 1.65, fontWeight: 400, textAlign: 'center' }}>
                    {greetText || ' '}
                    {!greetDone && (
                      <span
                        className="inline-block w-0.5 h-3.5 ml-0.5 align-text-bottom animate-pulse"
                        style={{ background: '#00c8ff', boxShadow: '0 0 6px rgba(0,200,255,0.8)' }}
                      />
                    )}
                  </p>
                </div>
              </div>

              {/* ── Live stat chips ────────────────────────────────────────── */}
              {todayStats !== null && greetDone && (
                <div className="flex gap-2 flex-wrap justify-center mb-5 animate-fade-in">
                  <div
                    className="flex items-center gap-2 px-3 py-1.5"
                    style={{ background: colors.accentBg, border: `1px solid ${colors.border}` }}
                  >
                    <div
                      className="w-1.5 h-1.5 dot-pulse"
                      style={{ background: switchColor, boxShadow: `0 0 5px ${switchColor}` }}
                    />
                    <span
                      className="data-value text-[11px] font-black"
                      style={{ color: switchColor }}
                    >
                      {todayStats.switchRate > 0 ? `${todayStats.switchRate}/h` : '—'}
                    </span>
                    <span
                      className="text-[8px] uppercase tracking-widest"
                      style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}
                    >
                      switches
                    </span>
                  </div>
                  {todayStats.focusedTime > 0 && (
                    <div
                      className="flex items-center gap-2 px-3 py-1.5"
                      style={{ background: colors.accentBg, border: `1px solid ${colors.border}` }}
                    >
                      <div className="w-1.5 h-1.5" style={{ background: '#00e676', boxShadow: '0 0 5px #00e676' }} />
                      <span className="data-value text-[11px] font-black" style={{ color: '#00e676' }}>
                        {fmtMs(todayStats.focusedTime)}
                      </span>
                      <span
                        className="text-[8px] uppercase tracking-widest"
                        style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}
                      >
                        focused
                      </span>
                    </div>
                  )}
                  {todayStats.topDistractor && (
                    <div
                      className="flex items-center gap-2 px-3 py-1.5"
                      style={{ background: 'rgba(255,68,68,0.04)', border: '1px solid rgba(255,68,68,0.15)' }}
                    >
                      <div className="w-1.5 h-1.5" style={{ background: '#ff4444', boxShadow: '0 0 5px rgba(255,68,68,0.6)' }} />
                      <span
                        className="text-[8px] uppercase tracking-widest truncate max-w-[80px]"
                        style={{ color: 'rgba(255,68,68,0.8)', fontFamily: '"Share Tech Mono", monospace' }}
                      >
                        {todayStats.topDistractor}
                      </span>
                      <span
                        className="text-[8px] uppercase tracking-widest"
                        style={{ color: 'rgba(255,68,68,0.65)', fontFamily: '"Share Tech Mono", monospace' }}
                      >
                        top drain
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Quick command grid ─────────────────────────────────────── */}
              <div className="flex flex-col gap-2 w-full z-10" style={{ maxWidth: 420 }}>
                <div className="grid grid-cols-2 gap-2">
                  {quickCommands.map((cmd, i) => (
                    <QuickCmd
                      key={cmd.label}
                      label={cmd.label}
                      icon={cmd.icon}
                      accent={cmd.accent}
                      delay={greetDone ? i * 60 : 1200 + i * 80}
                      onClick={() => sendMessage(cmd.text)}
                    />
                  ))}
                </div>
                {!activeSession && (
                  <QuickCmd
                    label="Enter Deep Focus Mode"
                    icon={<Lock size={11} />}
                    accent="#00e5c8"
                    delay={greetDone ? 240 : 1520}
                    onClick={() => onNavigate('deep-focus')}
                    wide
                  />
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

          {/* Thinking indicator */}
          {phase === 'thinking' && (
            <div className="flex items-start gap-2.5 animate-fade-in">
              <OrbAvatar />
              <div
                className="px-4 py-3 text-[12px]"
                style={{
                  background: colors.aiBubbleBg,
                  border: `1px solid ${colors.aiBubbleBorder}`,
                  borderTopLeftRadius: 2, borderTopRightRadius: 12,
                  borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
                  boxShadow: `0 0 16px ${colors.accentBg}`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 animate-bounce"
                        style={{ background: '#00c8ff', boxShadow: '0 0 6px rgba(0,200,255,0.6)', animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                  <span className="text-[9px] uppercase tracking-widest" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
                    {activeToolName ? `Using tool: ${activeToolName.replace(/_/g, ' ')}…` : (THINKING_PHASES[thinkingStep] ?? THINKING_PHASES[0])}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Streaming */}
          {phase === 'streaming' && streamedText && (
            <div className="flex items-start gap-2.5 animate-fade-in">
              <OrbAvatar />
              <div
                className="max-w-[84%] px-4 py-3 text-[13px] leading-relaxed"
                style={{
                  background: colors.aiBubbleBg,
                  border: `1px solid ${colors.aiBubbleBorder}`,
                  color: colors.aiBubbleText,
                  borderTopLeftRadius: 2, borderTopRightRadius: 12,
                  borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
                  boxShadow: `0 0 16px ${colors.accentBg}`,
                }}
              >
                {renderMarkdown(streamedText, colors.textPrimary, colors.textSecondary)}
                <span
                  className="inline-block w-0.5 h-3.5 ml-0.5 align-text-bottom animate-pulse"
                  style={{ background: colors.accent }}
                />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ───────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2 relative">
        {/* Active session indicator strip */}
        {activeSession && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: '#00e676', boxShadow: '0 0 4px #00e676' }} />
            <span className="text-[8px] uppercase tracking-widest" style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}>
              Focus session active
            </span>
          </div>
        )}
        <div
          className="flex items-center gap-3 px-4 py-3 relative transition-all duration-200"
          style={{
            background: colors.inputBg,
            border: `1px solid ${inputFocused ? colors.borderHi : colors.border}`,
            boxShadow: inputFocused
              ? '0 0 0 2px rgba(0,200,255,0.06), 0 0 24px rgba(0,200,255,0.1)'
              : '0 2px 12px rgba(0,0,0,0.3)',
          }}
        >
          {/* TL corner accent when focused */}
          {inputFocused && (
            <>
              <div className="absolute top-0 left-0 w-3 h-3 pointer-events-none" style={{ borderTop: '1px solid rgba(0,200,255,0.6)', borderLeft: '1px solid rgba(0,200,255,0.6)' }} />
              <div className="absolute bottom-0 right-0 w-3 h-3 pointer-events-none" style={{ borderBottom: '1px solid rgba(0,200,255,0.35)', borderRight: '1px solid rgba(0,200,255,0.35)' }} />
            </>
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder="Tell me what to block, start a session, or ask about your focus patterns…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(input) }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            disabled={isProcessing}
            className="flex-1 bg-transparent text-[13px] outline-none disabled:opacity-40"
            style={{ color: colors.textPrimary, caretColor: colors.accent }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isProcessing}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center transition-all duration-200 disabled:opacity-20 hover:scale-110 active:scale-95"
            style={{
              background: input.trim() && !isProcessing ? 'rgba(0,200,255,0.15)' : 'rgba(0,200,255,0.04)',
              border: `1px solid ${input.trim() && !isProcessing ? 'rgba(0,200,255,0.5)' : 'rgba(0,200,255,0.12)'}`,
              boxShadow: input.trim() && !isProcessing ? '0 0 12px rgba(0,200,255,0.2)' : 'none',
              color: input.trim() && !isProcessing ? '#00c8ff' : 'rgba(0,200,255,0.3)',
            }}
          >
            {isProcessing
              ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              : <Send size={12} style={{ marginLeft: 1 }} />}
          </button>
        </div>
        <style>{`input::placeholder { color: var(--text-muted); font-family: inherit; font-size: 12px; }`}</style>
      </div>
    </div>
  )
}

// ── Quick command chip ────────────────────────────────────────────────────────
function QuickCmd({ label, icon, accent, delay, onClick, wide }: {
  label: string; icon: React.ReactNode; accent: string
  delay: number; onClick: () => void; wide?: boolean
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-2.5 px-3.5 py-2.5 text-left animate-entry transition-all duration-200 ${wide ? 'justify-center' : ''}`}
      style={{
        background: `${accent}08`,
        border: `1px solid ${accent}22`,
        animationDelay: `${delay}ms`,
        animationFillMode: 'both',
        opacity: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${accent}14`
        e.currentTarget.style.borderColor = `${accent}55`
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = `0 4px 16px ${accent}15`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = `${accent}08`
        e.currentTarget.style.borderColor = `${accent}22`
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <span className="flex-shrink-0" style={{ color: `${accent}cc` }}>{icon}</span>
      <span
        className="text-[10px] font-medium leading-tight"
        style={{ color: `${accent}dd`, fontFamily: '"Share Tech Mono", monospace', letterSpacing: '0.04em' }}
      >
        {label}
      </span>
      {/* Accent right border flash on hover (via group) */}
      <div
        className="ml-auto flex-shrink-0 w-1 h-1 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: accent, boxShadow: `0 0 4px ${accent}` }}
      />
    </button>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const { colors } = useTheme()
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
        <div
          className="px-4 py-3 text-[13px] leading-relaxed relative"
          style={isUser ? {
            background: colors.userBubbleBg,
            border: `1px solid ${colors.userBubbleBorder}`,
            color: colors.userBubbleText,
            borderTopLeftRadius: 12, borderTopRightRadius: 12,
            borderBottomLeftRadius: 12, borderBottomRightRadius: 2,
            boxShadow: `0 0 12px ${colors.accentBg}`,
          } : {
            background: colors.aiBubbleBg,
            border: `1px solid ${colors.aiBubbleBorder}`,
            color: colors.aiBubbleText,
            borderTopLeftRadius: 2, borderTopRightRadius: 12,
            borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
            boxShadow: `0 0 12px ${colors.accentBg}`,
          }}
        >
          {renderMarkdown(msg.content, colors.textPrimary, colors.textSecondary)}
          <button
            onClick={copy}
            className="absolute -top-2.5 opacity-0 group-hover:opacity-100 transition-all duration-150 flex items-center gap-1 px-1.5 py-0.5"
            style={{
              right: isUser ? 4 : 'auto', left: isUser ? 'auto' : 4,
              background: colors.panelBg,
              border: `1px solid ${colors.border}`,
              color: copied ? '#00e676' : colors.textMuted,
            }}
            title="Copy"
          >
            {copied ? <Check size={9} /> : <Copy size={9} />}
            <span className="text-[8px]" style={{ fontFamily: '"Share Tech Mono", monospace' }}>
              {copied ? 'Copied' : 'Copy'}
            </span>
          </button>
        </div>
        <span
          className={`text-[9px] px-1 data-value ${isUser ? 'text-right' : 'text-left'}`}
          style={{ color: colors.textMuted }}
        >
          {fmtTime(msg.timestamp)}
        </span>
      </div>
    </div>
  )
}

// ── Thread history drawer ─────────────────────────────────────────────────────
interface ThreadsDrawerProps {
  threads: Thread[]
  activeDate: string | null
  onSelect: (thread: Thread) => void
  onNewChat: () => void
  onClose: () => void
}

function ThreadsDrawer({ threads, activeDate, onSelect, onNewChat, onClose }: ThreadsDrawerProps): React.ReactElement {
  const { colors } = useTheme()
  const today = new Date().toISOString().split('T')[0]!

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-20"
        style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="absolute left-0 top-0 bottom-0 z-30 flex flex-col animate-slide-in-left"
        style={{
          width: 252,
          background: colors.panelBg,
          borderRight: `1px solid ${colors.border}`,
          boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${colors.border}` }}
        >
          <div className="flex items-center gap-2">
            <History size={11} style={{ color: colors.accent }} />
            <span
              className="text-[9px] uppercase tracking-widest font-bold"
              style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}
            >
              Conversations
            </span>
          </div>
          <button onClick={onClose} style={{ color: colors.textMuted }} className="opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>

        {/* New chat button */}
        <button
          onClick={onNewChat}
          className="flex items-center gap-2.5 px-3 py-2.5 text-left transition-all duration-150 flex-shrink-0"
          style={{ borderBottom: `1px solid ${colors.border}` }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = colors.accentBg }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
        >
          <div
            className="w-5 h-5 flex items-center justify-center flex-shrink-0"
            style={{ border: `1px solid ${colors.borderMid}`, color: colors.accent }}
          >
            <Plus size={10} />
          </div>
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>New conversation</span>
        </button>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <MessageSquare size={18} style={{ color: colors.textMuted, opacity: 0.3 }} />
              <p className="text-[10px]" style={{ color: colors.textMuted }}>No past conversations</p>
            </div>
          )}

          {threads.map((thread, idx) => {
            const isActive = thread.date === activeDate
            const isToday  = thread.date === today
            // Show a date group header when the label changes from previous item
            const prevLabel = idx > 0 ? threads[idx - 1]!.label : null
            const showHeader = !prevLabel || (
              !isToday && prevLabel !== thread.label &&
              idx === threads.findIndex((t) => t.label === thread.label)
            )

            return (
              <React.Fragment key={thread.date}>
                {showHeader && !isToday && idx > 0 && (
                  <div
                    className="px-3 pt-3 pb-1 text-[8px] uppercase tracking-widest"
                    style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace', opacity: 0.6 }}
                  >
                    {thread.label.match(/^\w+day$/) ? 'Earlier this week' : thread.label.includes(',') || thread.label.match(/\w+ \d+/) ? 'Older' : ''}
                  </div>
                )}
                <button
                  onClick={() => onSelect(thread)}
                  className="w-full text-left px-3 py-2.5 transition-all duration-150 flex flex-col gap-1 relative"
                  style={{
                    background: isActive ? colors.accentBg : 'transparent',
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = `${colors.accentBg}80` }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                >
                  {isActive && (
                    <div
                      className="absolute left-0 top-1 bottom-1 w-0.5"
                      style={{ background: colors.accent }}
                    />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-[10px] font-semibold truncate"
                      style={{ color: isActive ? colors.accent : colors.textPrimary }}
                    >
                      {thread.label}
                    </span>
                    <span
                      className="text-[8px] flex-shrink-0"
                      style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}
                    >
                      {thread.messages.filter((m) => m.role === 'user').length}msg
                    </span>
                  </div>
                  <p
                    className="text-[10px] leading-snug line-clamp-2 text-left"
                    style={{ color: colors.textSecondary, opacity: 0.8 }}
                  >
                    {thread.preview}{thread.preview.length >= 72 ? '…' : ''}
                  </p>
                  <span
                    className="text-[8px]"
                    style={{ color: colors.textMuted, fontFamily: '"Share Tech Mono", monospace' }}
                  >
                    {new Date(thread.lastTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              </React.Fragment>
            )
          })}
        </div>

        {/* Footer hint */}
        <div
          className="px-3 py-2 flex-shrink-0 text-center"
          style={{ borderTop: `1px solid ${colors.border}` }}
        >
          <p className="text-[8px] uppercase tracking-widest" style={{ color: colors.textMuted, opacity: 0.4, fontFamily: '"Share Tech Mono", monospace' }}>
            Esc to close
          </p>
        </div>
      </div>
    </>
  )
}

// ── API Key Modal ─────────────────────────────────────────────────────────────
function ApiKeyModal({ onSave, onClose }: { onSave: (key: string) => Promise<void>; onClose: () => void }): React.ReactElement {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { colors } = useTheme()

  const handleSave = async (): Promise<void> => {
    const trimmed = key.trim()
    if (!trimmed.startsWith('sk-ant-') && !trimmed.startsWith('sk-or-')) {
      setError('Key must start with sk-ant- (Anthropic) or sk-or- (OpenRouter)')
      return
    }
    setSaving(true)
    try {
      await onSave(key.trim())
    } catch {
      setError('Failed to save key')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md mx-4 p-6 relative"
        style={{ background: colors.cardBg, border: `1px solid ${colors.borderMid}`, boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
      >
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-4 h-4" style={{ borderTop: `1px solid ${colors.accent}`, borderLeft: `1px solid ${colors.accent}` }} />
        <div className="absolute bottom-0 right-0 w-4 h-4" style={{ borderBottom: `1px solid ${colors.accent}`, borderRight: `1px solid ${colors.accent}` }} />

        <button onClick={onClose} className="absolute top-4 right-4 opacity-50 hover:opacity-100" style={{ color: colors.textMuted }}>
          <X size={14} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-8 h-8 flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(0,200,255,0.1)', border: `1px solid ${colors.border}` }}
          >
            <Key size={14} style={{ color: colors.accent }} />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest" style={{ color: colors.accent, fontFamily: '"Share Tech Mono", monospace' }}>
              API Key
            </p>
            <p className="text-[11px]" style={{ color: colors.textMuted }}>
              Anthropic or OpenRouter
            </p>
          </div>
        </div>

        <p className="text-[11px] mb-4 leading-relaxed" style={{ color: colors.textSecondary }}>
          Your key is encrypted on this device using OS-level security and never leaves your machine.
          Get an Anthropic key at <span style={{ color: colors.accent }}>console.anthropic.com</span>, or an OpenRouter key at <span style={{ color: colors.accent }}>openrouter.ai/keys</span>.
        </p>

        <div
          className="flex items-center gap-2 px-3 py-2.5 mb-1"
          style={{ background: colors.inputBg, border: `1px solid ${colors.border}` }}
        >
          <input
            type={show ? 'text' : 'password'}
            placeholder="sk-ant-api03-... or sk-or-v1-..."
            value={key}
            onChange={(e) => { setKey(e.target.value); setError('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            className="flex-1 bg-transparent text-[12px] outline-none"
            style={{ color: colors.textPrimary, caretColor: colors.accent, fontFamily: 'monospace' }}
            autoFocus
          />
          <button
            onClick={() => setShow((v) => !v)}
            className="opacity-50 hover:opacity-100 flex-shrink-0"
            style={{ color: colors.textMuted }}
          >
            {show ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        {error && <p className="text-[10px] mb-3" style={{ color: '#ff4444' }}>{error}</p>}

        <button
          onClick={handleSave}
          disabled={!key.trim() || saving}
          className="w-full py-2.5 text-[11px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 mt-4"
          style={{
            background: 'rgba(0,200,255,0.12)',
            border: `1px solid ${colors.borderMid}`,
            color: colors.accent,
            fontFamily: '"Share Tech Mono", monospace',
          }}
        >
          {saving ? 'Saving…' : 'Save & Activate'}
        </button>
      </div>
    </div>
  )
}

// ── Orb avatar ────────────────────────────────────────────────────────────────
function OrbAvatar(): React.ReactElement {
  return (
    <div
      className="flex-shrink-0 self-start mt-1"
      style={{
        width: 22, height: 22,
        background: 'radial-gradient(circle at 38% 30%, rgba(0,200,255,0.9), rgba(0,144,190,0.95) 60%, rgba(0,80,130,1))',
        boxShadow: '0 0 10px rgba(0,200,255,0.4), 0 0 4px rgba(0,200,255,0.6)',
        clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
      }}
    />
  )
}
