import React, { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Shield, MessageSquare, Zap, Trash2, Paperclip, Plus, ChevronDown, RotateCcw, Check } from 'lucide-react'
import type { Conversation } from '@shared/types'
import { useTheme } from '../context/ThemeContext'
import BrandMark from '../components/BrandMark'

const WELCOME_TEXT = "Hey. I'm Attentify, your focus assistant. Tell me what you need to focus on and I'll block everything that gets in the way.\n\nTry: **Block Instagram for 2 hours** or **Start a deep focus session**"
const DEFAULT_TITLES = new Set(['New chat', 'Chat'])

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface ChatPanelProps {
  onClose?: () => void
  onRefresh: () => void
  initialMessage?: string
  // 'panel' = the 380px slide-in used on other views. 'full' = the home screen: a
  // centered, full-height conversation (Attentify's chat-first landing surface).
  variant?: 'panel' | 'full'
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  streaming?: boolean
  toolName?: string
  images?: string[]   // data URLs, shown as thumbnails on user messages
}

interface Attachment {
  id: string
  dataUrl: string     // full data: URL (for preview)
  mediaType: string   // e.g. image/png
  data: string        // base64 payload (no prefix) for the API
}

// Strip tool-call / raw-JSON artifacts from what we SHOW the user. Handles both the
// mid-stream case (an artifact opener arrives before it's closed) and stray JSON the
// model occasionally leaks as text. Kept conservative so real prose is never cut.
function cleanForDisplay(text: string): string {
  let t = text
  t = t.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
  t = t.replace(/<function_results>[\s\S]*?<\/function_results>/gi, '')
  t = t.replace(/<invoke\b[\s\S]*?<\/invoke>/gi, '')
  t = t.replace(/<\/?(?:antml:[a-z_]+|tool_call|tool_use|parameter)\b[^>]*>/gi, '')
  t = t.replace(/```(?:json|tool_code|xml|tool_use)?\s*[[{][\s\S]*?[\]}]\s*```/gi, '')
  // Mid-stream: cut everything from the first unclosed artifact opener onward.
  const openers = [
    t.indexOf('<function_calls>'),
    t.search(/<invoke\b/),
    t.search(/```(?:json|tool_code|tool_use)/),
  ].filter((i) => i >= 0)
  if (openers.length) t = t.slice(0, Math.min(...openers))
  // A reply that is nothing but a tool-ish JSON blob → hide entirely.
  const trimmed = t.trim()
  if (/^[[{][\s\S]*[\]}]$/.test(trimmed) && /"(name|parameters|tool_name|recipient_name|input|domain|action)"\s*:/.test(trimmed)) {
    return ''
  }
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}

const QUICK_COMMANDS = [
  "I'm writing until 5pm, keep me off social",
  'Hide YouTube Shorts but keep my subscriptions',
  'No music videos or rage bait in my feed',
  "What's been eating my focus this week?",
]

// The chat is strictly conversational. URL-scoring / classification calls the
// daemon makes internally sometimes look like `{"distraction":true,...}` — those
// must never surface here. This guards the display so any raw-JSON / classification
// payload that ever lands in the history is hidden rather than shown to the user.
function looksLikeDebug(content: string): boolean {
  const t = content.trim()
  if (!t) return true
  if (/^[[{]/.test(t) && /"(distraction|distractionProbability|intent|confidence|category|reasoning|predicted_domain)"\s*:/.test(t)) return true
  // Internal browser-extension classifier prompts that used to be proxied through the
  // chat agent — never show these, even if some linger in history.
  if (/analyze browsing context|distractionProbability|goalAligned|"behavior"\s*:\s*\{|"dwellMs"/.test(t)) return true
  return false
}

// ── Minimal markdown renderer ─────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  lines.forEach((line, lineIdx) => {
    // Headers
    if (line.startsWith('### ')) {
      elements.push(<p key={lineIdx} className="font-semibold text-[11px] mt-2 mb-0.5">{renderInline(line.slice(4))}</p>)
      return
    }
    if (line.startsWith('## ')) {
      elements.push(<p key={lineIdx} className="font-bold text-xs mt-2 mb-0.5">{renderInline(line.slice(3))}</p>)
      return
    }
    if (line.startsWith('# ')) {
      elements.push(<p key={lineIdx} className="font-bold text-xs mt-2 mb-1">{renderInline(line.slice(2))}</p>)
      return
    }

    // Bullet points
    if (/^[-*•]\s/.test(line)) {
      elements.push(
        <div key={lineIdx} className="flex gap-1.5 my-0.5">
          <span className="mt-0.5 opacity-60 flex-shrink-0">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      )
      return
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)/)
      if (match) {
        elements.push(
          <div key={lineIdx} className="flex gap-1.5 my-0.5">
            <span className="flex-shrink-0 opacity-60">{match[1]}.</span>
            <span>{renderInline(match[2])}</span>
          </div>
        )
        return
      }
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={lineIdx} className="my-2 opacity-20" />)
      return
    }

    // Empty line → spacer
    if (line.trim() === '') {
      if (lineIdx > 0 && lineIdx < lines.length - 1) {
        elements.push(<div key={lineIdx} className="h-1.5" />)
      }
      return
    }

    // Normal line
    elements.push(<div key={lineIdx}>{renderInline(line)}</div>)
  })

  return <>{elements}</>
}

function renderInline(text: string): React.ReactNode {
  // Split on bold (**text**), italic (*text*), inline code (`code`)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <em key={i} className="italic opacity-80">{part.slice(1, -1)}</em>
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code key={i} className="px-1 py-0.5 rounded text-[10px] font-mono" style={{ background: 'rgba(255,255,255,0.1)' }}>
              {part.slice(1, -1)}
            </code>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// Memoized message body: renderMarkdown is a pure function of `content`, so wrapping it
// in React.memo means only the message whose content changed (i.e. the one currently
// streaming) re-parses its markdown. Without this, every streaming update re-parsed
// EVERY message in the conversation, a major cause of the "freeze while thinking".
const MessageBody = React.memo(function MessageBody({ content, clean }: { content: string; clean: boolean }): React.ReactElement {
  return <>{renderMarkdown(clean ? cleanForDisplay(content) : content)}</>
})

// ── ChatPanel ─────────────────────────────────────────────────────────────────

export default function ChatPanel({ onClose, onRefresh, initialMessage = '', variant = 'panel' }: ChatPanelProps): React.ReactElement {
  const isFull = variant === 'full'
  const { colors } = useTheme()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(initialMessage)
  const [sending, setSending] = useState(false)
  const [activeToolName, setActiveToolName] = useState<string | null>(null)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [paywalled, setPaywalled] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamingIdRef = useRef<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentsRef = useRef<Attachment[]>([])
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])

  // ── Conversations ─────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConvId, setCurrentConvId] = useState<string | null>(null)
  const [showConvMenu, setShowConvMenu] = useState(false)
  const currentConvIdRef = useRef<string | null>(null)
  const conversationsRef = useRef<Conversation[]>([])
  useEffect(() => { currentConvIdRef.current = currentConvId }, [currentConvId])
  useEffect(() => { conversationsRef.current = conversations }, [conversations])

  const welcomeMsg = (): Message[] => [{ id: 'welcome', role: 'assistant', content: WELCOME_TEXT, timestamp: Date.now() }]

  const [checkpointByMsg, setCheckpointByMsg] = useState<Record<string, { id: string; label?: string }>>({})
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreNote, setRestoreNote] = useState<string | null>(null)

  const loadCheckpoints = useCallback(async (convId: string): Promise<void> => {
    try {
      const cps = await api.getCheckpoints(convId)
      const map: Record<string, { id: string; label?: string }> = {}
      for (const c of cps) if (c.message_id) map[c.message_id] = { id: c.id, label: c.label }
      setCheckpointByMsg(map)
    } catch { setCheckpointByMsg({}) }
  }, [])

  const doRestore = useCallback(async (cpId: string, label?: string): Promise<void> => {
    setRestoringId(cpId)
    let res: { ok: boolean; error?: string } = { ok: false }
    try { res = await api.restoreCheckpoint(cpId) } catch { res = { ok: false, error: 'Restore failed' } }
    setRestoringId(null); setConfirmRestore(null)
    setRestoreNote(res.ok ? `Reverted to “${label || 'this point'}”` : (res.error || 'Could not revert'))
    if (res.ok) onRefresh()
    setTimeout(() => setRestoreNote(null), 4000)
  }, [onRefresh])

  const loadConversation = useCallback(async (id: string): Promise<void> => {
    void loadCheckpoints(id)
    try {
      const rows = await api.getConversationMessages(id, 200)
      const visible = (rows ?? [])
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .filter((r) => !looksLikeDebug(r.content.startsWith('[proactive] ') ? r.content.slice(12) : r.content))
        .map((r) => ({
          id: r.id,
          role: r.role as 'user' | 'assistant',
          content: r.content.startsWith('[proactive] ') ? r.content.slice(12) : r.content,
          timestamp: r.ts,
        }))
      setMessages(visible.length > 0 ? visible : welcomeMsg())
    } catch { setMessages(welcomeMsg()) }
  }, [])

  // Bootstrap: load conversation list, open the most recent (or create one).
  useEffect(() => {
    void (async () => {
      let convs: Conversation[] = []
      try { convs = await api.getConversations() } catch { convs = [] }
      if (!convs || convs.length === 0) {
        try { convs = [await api.createConversation('Chat')] } catch { convs = [] }
      }
      setConversations(convs)
      const cur = convs[0]?.id ?? null
      setCurrentConvId(cur)
      if (cur) void loadConversation(cur)
      else setMessages(welcomeMsg())
    })()
  }, [loadConversation])

  const refreshConversations = useCallback(() => {
    api.getConversations().then(setConversations).catch(() => {})
  }, [])

  const newConversation = useCallback(async (): Promise<void> => {
    try {
      const c = await api.createConversation('New chat')
      setConversations((prev) => [c, ...prev])
      setCurrentConvId(c.id)
      setMessages(welcomeMsg())
      setShowConvMenu(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    } catch { /* ignore */ }
  }, [])

  const switchConversation = useCallback((id: string): void => {
    setShowConvMenu(false)
    if (id === currentConvIdRef.current) return
    setCurrentConvId(id)
    void loadConversation(id)
  }, [loadConversation])

  const deleteConv = useCallback(async (id: string): Promise<void> => {
    await api.deleteConversation(id).catch(() => {})
    const remaining = conversationsRef.current.filter((c) => c.id !== id)
    setConversations(remaining)
    if (currentConvIdRef.current === id) {
      if (remaining[0]) { setCurrentConvId(remaining[0].id); void loadConversation(remaining[0].id) }
      else {
        try { const c = await api.createConversation('Chat'); setConversations([c]); setCurrentConvId(c.id); setMessages(welcomeMsg()) } catch { /* ignore */ }
      }
    }
  }, [loadConversation])

  // Register streaming event listeners
  useEffect(() => {
    const offChunk = api.onChatChunk((chunk: string) => {
      // `chunk` is the FULL sanitized reply-so-far (main scrubs tool-call JSON on every
      // update), so we REPLACE the content rather than append — junk can never persist.
      setMessages((prev) => {
        const id = streamingIdRef.current
        if (!id) return prev
        return prev.map((m) =>
          m.id === id ? { ...m, content: chunk } : m
        )
      })
    })

    const offTool = api.onChatTool((toolName: string) => {
      setActiveToolName(toolName)
      setTimeout(() => setActiveToolName(null), 3000)
    })

    const offDone = api.onChatDone((evt) => {
      const sid = streamingIdRef.current
      setSending(false)
      setStreamingId(null)
      streamingIdRef.current = null
      setActiveToolName(null)
      // Finalize the streaming message with authoritative content from DB
      setMessages((prev) =>
        prev.map((m) =>
          m.id === sid || m.streaming
            ? { ...m, id: evt.id, content: evt.content, streaming: false }
            : m
        )
      )
      refreshConversations()
      if (currentConvIdRef.current) void loadCheckpoints(currentConvIdRef.current)
      onRefresh()
    })

    const offError = api.onChatError((err: string) => {
      setSending(false)
      setStreamingId(null)
      streamingIdRef.current = null
      setActiveToolName(null)
      const isPaywall = err === 'PAYWALL'
      if (isPaywall) setPaywalled(true)
      // The main process rejects chat:start when signed out; say so in the thread rather
      // than surfacing a raw error string.
      const isAuth = err === 'AUTH_REQUIRED'
      setMessages((prev) => [
        ...prev.filter((m) => !m.streaming),
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: isPaywall
            ? "You've used up your **$1 of free AI**. Subscribe to **Attentify Cloud** for **$5/month** to keep using the assistant, or add your own OpenRouter key in Settings (never metered)."
            : isAuth
              ? 'Sign in to use the assistant. Open the account button at the bottom of the sidebar.'
              : `Error: ${err}`,
          timestamp: Date.now(),
        },
      ])
    })

    return () => {
      offChunk()
      offTool()
      offDone()
      offError()
    }
  }, [onRefresh])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    const nearBottom = scrollHeight - scrollTop - clientHeight < 120
    // Always scroll on new user message or end of stream; only scroll mid-stream if already near bottom
    if (nearBottom || !sending) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [messages, sending])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const atts = attachmentsRef.current
    if ((!text.trim() && atts.length === 0) || sending) return
    setSending(true)

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
      images: atts.length ? atts.map((a) => a.dataUrl) : undefined,
    }

    const assistantId = crypto.randomUUID()
    streamingIdRef.current = assistantId
    setStreamingId(assistantId)

    const streamingMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    }

    setMessages((prev) => [...prev, userMsg, streamingMsg])
    setInput('')
    setAttachments([])

    const convId = currentConvIdRef.current ?? undefined
    // Auto-title a still-default conversation from its first message.
    if (convId && text.trim()) {
      const conv = conversationsRef.current.find((c) => c.id === convId)
      if (conv && DEFAULT_TITLES.has(conv.title)) {
        const title = text.trim().replace(/\s+/g, ' ').slice(0, 40)
        api.renameConversation(convId, title).catch(() => {})
        setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)))
      }
    }

    api.chatStart(text.trim() || 'What do you see in this image?', atts.map((a) => ({ media_type: a.mediaType, data: a.data })), convId)
  }, [sending])

  // Read a File into an Attachment (data URL + base64 payload for the API).
  const addFiles = useCallback((files: FileList | File[]): void => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 4)
    for (const file of imgs) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        const comma = dataUrl.indexOf(',')
        setAttachments((prev) => prev.length >= 4 ? prev : [...prev, {
          id: crypto.randomUUID(),
          dataUrl,
          mediaType: file.type,
          data: dataUrl.slice(comma + 1),
        }])
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const clearHistory = useCallback(async (): Promise<void> => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); return }
    await api.clearChatHistory(currentConvIdRef.current ?? undefined)
    setConfirmClear(false)
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: "History cleared. I'm Attentify, your focus assistant, tell me what you need to focus on.",
      timestamp: Date.now(),
    }])
  }, [confirmClear])

  const handleSubscribe = useCallback(async (): Promise<void> => {
    setCheckingOut(true)
    try {
      const res = await api.cloudCheckout()
      if (res.url) await api.openExternal(res.url)
    } catch { /* ignore */ }
    setCheckingOut(false)
  }, [])

  const showQuickCommands = messages.length <= 1 ||
    (messages.length === 1 && messages[0]?.id === 'welcome')

  const currentConv = conversations.find((c) => c.id === currentConvId)
  const convTitle = currentConv?.title || 'Chat'

  return (
    <div
      className={isFull
        ? 'flex flex-col h-full w-full max-w-3xl mx-auto'
        : 'flex flex-col w-[380px] h-full flex-shrink-0 animate-slide-in-right'}
      style={isFull
        ? { background: 'transparent' }
        : { background: colors.panelBg, borderLeft: `1px solid ${colors.border}` }}
    >
      {/* Header — logo + conversation switcher + actions */}
      <div className="relative flex items-center justify-between px-4 py-2.5 flex-shrink-0" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandMark size={isFull ? 30 : 26} />
          <button onClick={() => setShowConvMenu((v) => !v)} className="flex flex-col items-start min-w-0 titlebar-nodrag" title="Switch conversation">
            <span className="flex items-center gap-1 font-semibold text-[13px] max-w-[180px] truncate" style={{ color: colors.textPrimary }}>
              <span className="truncate">{convTitle}</span>
              <ChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
            </span>
            <span className="text-[10px]" style={{ color: colors.textMuted }}>Runs locally · private</span>
          </button>
        </div>
        <div className="flex items-center gap-1 titlebar-nodrag">
          <button onClick={() => void newConversation()} title="New chat" className="transition-colors p-1.5 rounded" style={{ color: colors.textMuted }}>
            <Plus size={15} />
          </button>
          <button
            onClick={() => void clearHistory()}
            title={confirmClear ? 'Click again to confirm' : 'Clear this conversation'}
            className="transition-colors p-1.5 rounded"
            style={{ color: confirmClear ? '#f87171' : colors.textMuted, background: confirmClear ? 'rgba(248,113,113,0.1)' : 'transparent' }}
          >
            <Trash2 size={13} />
          </button>
          {onClose && (
            <button onClick={onClose} className="transition-colors p-1" style={{ color: colors.textMuted }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Conversation dropdown */}
        {showConvMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowConvMenu(false)} />
            <div className="absolute z-50 left-4 top-full mt-1 w-64 rounded-xl overflow-hidden shadow-xl" style={{ background: colors.panelBg, border: `1px solid ${colors.borderMid}` }}>
              <div className="max-h-72 overflow-y-auto py-1">
                {conversations.length === 0 && (
                  <p className="px-3 py-2 text-[11px]" style={{ color: colors.textMuted }}>No conversations yet</p>
                )}
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => switchConversation(c.id)}
                    className="group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
                    style={{ background: c.id === currentConvId ? colors.accentBg : 'transparent' }}
                  >
                    <MessageSquare size={12} style={{ color: c.id === currentConvId ? colors.accent : colors.textMuted, flexShrink: 0 }} />
                    <span className="flex-1 text-[12px] truncate" style={{ color: c.id === currentConvId ? colors.textPrimary : colors.textSecondary }}>{c.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteConv(c.id) }}
                      title="Delete conversation"
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                      style={{ color: colors.textMuted }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => void newConversation()}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium transition-colors"
                style={{ borderTop: `1px solid ${colors.border}`, color: colors.accent }}
              >
                <Plus size={13} /> New chat
              </button>
            </div>
          </>
        )}
      </div>

      {/* Restore confirmation banner */}
      {restoreNote && (
        <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0" style={{ background: colors.accentBg, borderBottom: `1px solid ${colors.border}` }}>
          <Check size={12} style={{ color: colors.accent }} />
          <span className="text-[11px]" style={{ color: colors.textSecondary }}>{restoreNote}</span>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className="flex flex-col group">
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="mr-2 mt-0.5 flex-shrink-0">
                <BrandMark size={24} />
              </div>
            )}
            <div
              className="select-text max-w-[85%] px-3 py-2.5 text-xs leading-relaxed"
              style={{
                background: msg.role === 'user' ? colors.userBubbleBg : colors.aiBubbleBg,
                border: `1px solid ${msg.role === 'user' ? colors.userBubbleBorder : colors.aiBubbleBorder}`,
                color: msg.role === 'user' ? colors.userBubbleText : colors.aiBubbleText,
                borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '4px 12px 12px 12px',
              }}
            >
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {msg.images.map((src, i) => (
                    <img key={i} src={src} alt="attachment" className="rounded-lg" style={{ maxWidth: 140, maxHeight: 140, objectFit: 'cover', border: `1px solid ${colors.border}` }} />
                  ))}
                </div>
              )}
              {msg.streaming && msg.content === '' ? (
                <div className="flex gap-1 py-0.5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: colors.textMuted, animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              ) : (
                // The streaming message already arrives sanitized from main, so skip the
                // per-chunk regex pass while it types. Memoized so only the changed
                // message re-renders.
                <MessageBody content={msg.content} clean={msg.role === 'assistant' && !msg.streaming} />
              )}
              {msg.streaming && msg.content !== '' && (
                <span className="inline-block w-1.5 h-3 ml-0.5 rounded-sm animate-pulse" style={{ background: colors.textMuted, verticalAlign: 'text-bottom' }} />
              )}
            </div>
            </div>
            {msg.role === 'user' && checkpointByMsg[msg.id] && (
              <div className="flex justify-end mt-1 pr-0.5">
                <button
                  onClick={() => (confirmRestore === checkpointByMsg[msg.id]!.id ? void doRestore(checkpointByMsg[msg.id]!.id, checkpointByMsg[msg.id]!.label) : setConfirmRestore(checkpointByMsg[msg.id]!.id))}
                  disabled={restoringId === checkpointByMsg[msg.id]!.id}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md transition-all opacity-0 group-hover:opacity-100 disabled:opacity-100"
                  style={{ color: confirmRestore === checkpointByMsg[msg.id]!.id ? colors.warning : colors.textMuted, border: `1px solid ${colors.border}` }}
                  title="Revert blocks, schedules and cards to how they were before this message"
                >
                  <RotateCcw size={10} />
                  {restoringId === checkpointByMsg[msg.id]!.id ? 'Reverting…' : confirmRestore === checkpointByMsg[msg.id]!.id ? 'Click to confirm' : 'Restore checkpoint'}
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Tool use indicator */}
        {activeToolName && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
              <Zap size={12} className="text-accent-blue" />
            </div>
            <div
              className="px-3 py-2 text-[10px] italic flex items-center gap-1.5"
              style={{ color: colors.textMuted }}
            >
              <div className="w-1 h-1 rounded-full bg-accent-blue animate-pulse" />
              Using tool: {activeToolName}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick commands */}
      {showQuickCommands && (
        <div className="px-4 pb-2 flex-shrink-0">
          <p className="text-[10px] mb-2" style={{ color: colors.textMuted }}>Quick commands:</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                onClick={() => sendMessage(cmd)}
                className="px-2.5 py-1.5 rounded-full text-[10px] transition-colors"
                style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, color: colors.textSecondary }}
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Paywall — free AI exhausted */}
      {paywalled && (
        <div className="px-4 pb-2 flex-shrink-0">
          <button
            onClick={() => void handleSubscribe()}
            disabled={checkingOut}
            className="w-full py-2.5 text-[11px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 rounded-xl"
            style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399' }}
          >
            {checkingOut ? 'Opening checkout…' : 'Subscribe for $5/month'}
          </button>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-4" style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
        {/* Attachment thumbnails */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((a) => (
              <div key={a.id} className="relative" style={{ width: 52, height: 52 }}>
                <img src={a.dataUrl} alt="attachment" className="rounded-lg w-full h-full" style={{ objectFit: 'cover', border: `1px solid ${colors.border}` }} />
                <button
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: colors.negative, color: '#fff' }}
                  title="Remove"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || attachments.length >= 4}
            title="Attach image"
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors flex-shrink-0 disabled:opacity-40"
            style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textMuted }}
          >
            <Paperclip size={14} />
          </button>
          {/* A textarea, not an input: a chat box you cannot write a paragraph in is the
              single most obvious thing missing. Enter sends, Shift+Enter is a newline,
              and it grows with the text up to a cap. It is also NOT disabled while the
              assistant is answering, so you can compose your next message while it talks. */}
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Block Twitter for 2 hours…    (Shift+Enter for a new line)"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!sending) sendMessage(input)
              }
            }}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
              if (imgs.length) { e.preventDefault(); addFiles(imgs) }
            }}
            className="flex-1 text-xs px-3 py-2.5 rounded-xl outline-none transition-colors resize-none"
            style={{
              background: colors.inputBg, border: `1px solid ${colors.border}`,
              color: colors.textPrimary, maxHeight: 160, lineHeight: 1.5,
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={(!input.trim() && attachments.length === 0) || sending}
            className="w-9 h-9 flex items-center justify-center disabled:opacity-40 rounded-xl transition-all hover:brightness-110 flex-shrink-0"
            style={{ background: colors.accent }}
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}
