import React, { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Shield, MessageSquare, Zap } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface ChatPanelProps {
  onClose: () => void
  onRefresh: () => void
  initialMessage?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  streaming?: boolean
  toolName?: string
}

const QUICK_COMMANDS = [
  'Block Twitter for 2 hours',
  "I'm writing until 5pm, be strict",
  "What's distracting me most?",
  'Block social media for today',
]

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

// ── ChatPanel ─────────────────────────────────────────────────────────────────

export default function ChatPanel({ onClose, onRefresh, initialMessage = '' }: ChatPanelProps): React.ReactElement {
  const { colors } = useTheme()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState(initialMessage)
  const [sending, setSending] = useState(false)
  const [activeToolName, setActiveToolName] = useState<string | null>(null)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const streamingIdRef = useRef<string | null>(null)

  // Load history from SQLite on mount
  useEffect(() => {
    api.getAgentHistory(40).then((history: unknown) => {
      const rows = history as { id: string; role: string; content: string; ts: number }[]
      if (!rows || rows.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: "Hey. I'm your Daemon Assistant. Tell me what you need to focus on and I'll block everything that gets in the way.\n\nTry: **Block Instagram for 2 hours** or **Start a deep focus session**",
          timestamp: Date.now(),
        }])
        return
      }
      // history comes DESC; reverse to ASC, filter out tool messages
      const visible = [...rows]
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .reverse()
        .map((r) => ({
          id: r.id,
          role: r.role as 'user' | 'assistant',
          content: r.content.startsWith('[proactive] ') ? r.content.slice(12) : r.content,
          timestamp: r.ts,
        }))
      setMessages(visible.length > 0 ? visible : [{
        id: 'welcome',
        role: 'assistant',
        content: "Hey. I'm your Daemon Assistant. Tell me what you need to focus on and I'll block everything that gets in the way.\n\nTry: **Block Instagram for 2 hours** or **Start a deep focus session**",
        timestamp: Date.now(),
      }])
    }).catch(() => {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: "Hey. I'm your Daemon Assistant. Tell me what you need to focus on and I'll block everything that gets in the way.",
        timestamp: Date.now(),
      }])
    })
  }, [])

  // Register streaming event listeners
  useEffect(() => {
    const offChunk = api.onChatChunk((chunk: string) => {
      setMessages((prev) => {
        const id = streamingIdRef.current
        if (!id) return prev
        return prev.map((m) =>
          m.id === id ? { ...m, content: m.content + chunk } : m
        )
      })
    })

    const offTool = api.onChatTool((toolName: string) => {
      setActiveToolName(toolName)
      setTimeout(() => setActiveToolName(null), 3000)
    })

    const offDone = api.onChatDone((evt) => {
      setSending(false)
      setStreamingId(null)
      streamingIdRef.current = null
      setActiveToolName(null)
      // Finalize the streaming message with authoritative content from DB
      setMessages((prev) =>
        prev.map((m) =>
          m.streaming
            ? { ...m, id: evt.id, content: evt.content, streaming: false }
            : m
        )
      )
      onRefresh()
    })

    const offError = api.onChatError((err: string) => {
      setSending(false)
      setStreamingId(null)
      streamingIdRef.current = null
      setActiveToolName(null)
      setMessages((prev) => [
        ...prev.filter((m) => !m.streaming),
        { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${err}`, timestamp: Date.now() },
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    if (!text.trim() || sending) return
    setSending(true)

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
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

    api.chatStart(text.trim())
  }, [sending])

  const showQuickCommands = messages.length <= 1 ||
    (messages.length === 1 && messages[0]?.id === 'welcome')

  return (
    <div
      className="flex flex-col w-[380px] h-full flex-shrink-0 animate-slide-in-right"
      style={{ background: colors.panelBg, borderLeft: `1px solid ${colors.border}` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center">
            <MessageSquare size={14} className="text-accent-blue" />
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: colors.textPrimary }}>Daemon Assistant</p>
            <p className="text-[10px]" style={{ color: colors.textMuted }}>Runs locally · No data leaves your device</p>
          </div>
        </div>
        <button onClick={onClose} className="transition-colors p-1" style={{ color: colors.textMuted }}>
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
                <Shield size={12} className="text-accent-blue" />
              </div>
            )}
            <div
              className="max-w-[85%] px-3 py-2.5 text-xs leading-relaxed"
              style={{
                background: msg.role === 'user' ? colors.userBubbleBg : colors.aiBubbleBg,
                border: `1px solid ${msg.role === 'user' ? colors.userBubbleBorder : colors.aiBubbleBorder}`,
                color: msg.role === 'user' ? colors.userBubbleText : colors.aiBubbleText,
                borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '4px 12px 12px 12px',
              }}
            >
              {msg.streaming && msg.content === '' ? (
                <div className="flex gap-1 py-0.5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: colors.textMuted, animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              ) : (
                renderMarkdown(msg.content)
              )}
              {msg.streaming && msg.content !== '' && (
                <span className="inline-block w-1.5 h-3 ml-0.5 rounded-sm animate-pulse" style={{ background: colors.textMuted, verticalAlign: 'text-bottom' }} />
              )}
            </div>
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

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-4" style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Block Twitter for 2 hours…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
            disabled={sending}
            className="flex-1 text-xs px-3 py-2.5 rounded-xl outline-none transition-colors disabled:opacity-60"
            style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || sending}
            className="w-9 h-9 flex items-center justify-center bg-accent-blue hover:bg-accent-blue-light disabled:opacity-40 rounded-xl transition-colors flex-shrink-0"
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}
