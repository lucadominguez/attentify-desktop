import React, { useState, useRef, useEffect } from 'react'
import { X, Send, Shield, MessageSquare } from 'lucide-react'
import type { AppStore, ChatMessage } from '@shared/types'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface ChatPanelProps {
  store: AppStore
  onClose: () => void
  onRefresh: () => void
  initialMessage?: string
}

const QUICK_COMMANDS = [
  'Block Twitter for 2 hours',
  "I'm writing until 5pm, be strict",
  "What's distracting me most?",
  'Block social media for today',
]

export default function ChatPanel({ store, onClose, onRefresh, initialMessage = '' }: ChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const initial: ChatMessage = {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hey. I'm your Daemon Assistant. Tell me what you need to focus on and I'll block everything that gets in the way.\n\nTry: *\"Block Instagram for 2 hours\"* or *\"Start a deep focus session\"*",
      timestamp: Date.now(),
    }
    return store.chatHistory.length > 0 ? store.chatHistory : [initial]
  })
  const [input, setInput] = useState(initialMessage)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const sendMessage = async (text: string): Promise<void> => {
    if (!text.trim() || sending) return
    setSending(true)

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')

    try {
      const response = await api.sendMessage(text.trim())
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.reply,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, assistantMsg])
      onRefresh()
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: 'Something went wrong. Try again.', timestamp: Date.now() },
      ])
    } finally {
      setSending(false)
    }
  }

  const renderContent = (content: string): React.ReactNode => {
    const parts = content.split(/(\*[^*]+\*)/g)
    return parts.map((part, i) => {
      if (part.startsWith('*') && part.endsWith('*')) {
        return <strong key={i} className="text-white font-semibold">{part.slice(1, -1)}</strong>
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div
      className="flex flex-col w-[360px] h-full flex-shrink-0 animate-slide-in-right"
      style={{ background: '#080f1e', borderLeft: '1px solid rgba(30,58,95,0.5)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(30,58,95,0.5)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center">
            <MessageSquare size={14} className="text-accent-blue" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Daemon Assistant</p>
            <p className="text-navy-500 text-[10px]">Runs locally · No data leaves your device</p>
          </div>
        </div>
        <button onClick={onClose} className="text-navy-500 hover:text-white transition-colors p-1">
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
              className="max-w-[85%] px-3 py-2.5 rounded-xl text-xs leading-relaxed"
              style={{
                background: msg.role === 'user' ? 'rgba(33,150,243,0.2)' : 'rgba(17,34,64,0.8)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(33,150,243,0.3)' : 'rgba(30,58,95,0.5)'}`,
                color: msg.role === 'user' ? '#e2e8f0' : '#94a3b8',
                borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '4px 12px 12px 12px',
              }}
            >
              {renderContent(msg.content)}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center mr-2 mt-0.5">
              <Shield size={12} className="text-accent-blue" />
            </div>
            <div className="px-3 py-3 rounded-xl" style={{ background: 'rgba(17,34,64,0.8)', border: '1px solid rgba(30,58,95,0.5)', borderRadius: '4px 12px 12px 12px' }}>
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-navy-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick commands */}
      {messages.length <= 2 && (
        <div className="px-4 pb-2 flex-shrink-0">
          <p className="text-navy-600 text-[10px] mb-2">Quick commands:</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                onClick={() => sendMessage(cmd)}
                className="px-2.5 py-1.5 rounded-full text-[10px] text-navy-400 hover:text-white transition-colors"
                style={{ background: '#112240', border: '1px solid rgba(30,58,95,0.8)' }}
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-4" style={{ borderTop: '1px solid rgba(30,58,95,0.5)', paddingTop: 12 }}>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Block Twitter for 2 hours…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
            disabled={sending}
            className="flex-1 bg-navy-800 border border-navy-600 text-white text-xs px-3 py-2.5 rounded-xl outline-none focus:border-accent-blue placeholder-navy-600 transition-colors disabled:opacity-60"
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
