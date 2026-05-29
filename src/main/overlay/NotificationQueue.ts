import Anthropic from '@anthropic-ai/sdk'
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { loadApiKey } from '../keystore'
import { getActiveGoals } from '../data/repository'
import { debugLog } from '../debug/logger'

export interface OverlayAction {
  label: string
  type: 'block' | 'break' | 'dismiss' | 'chat' | 'view-actions'
  domain?: string
  durationMs?: number
  chatMsg?: string
}

export interface OverlayNotification {
  id: string
  type: 'auto-block' | 'suggest' | 'heuristic' | 'guard' | 'proactive'
  title: string
  rawMessage: string
  aiMessage?: string
  actions: OverlayAction[]
  domain?: string
  confidence?: number
}

const ANTHROPIC_MODEL  = 'claude-haiku-4-5-20251001'
const OPENROUTER_MODEL = 'anthropic/claude-haiku-4-5'
const OPENROUTER_BASE  = 'https://openrouter.ai/api'
const W = 400
const H = 190

class NotificationQueue {
  private win: BrowserWindow | null = null
  private queue: OverlayNotification[] = []
  private current: OverlayNotification | null = null
  private client: Anthropic | null = null
  private model = ANTHROPIC_MODEL
  private rendererUrl: string | null = null
  private overlayFile = ''
  private windowReady = false
  private pendingShow: OverlayNotification | null = null

  init(rendererUrl: string | null, outDir: string): void {
    this.rendererUrl = rendererUrl
    this.overlayFile = join(outDir, 'renderer', 'overlay.html')
    this.refreshClient()
    this.createWindow()
  }

  refreshClient(): void {
    const key = loadApiKey()
    if (!key) { this.client = null; return }
    const isOR = key.startsWith('sk-or-')
    this.model = isOR ? OPENROUTER_MODEL : ANTHROPIC_MODEL
    this.client = new Anthropic({
      apiKey: key,
      ...(isOR ? { baseURL: OPENROUTER_BASE, defaultHeaders: { 'HTTP-Referer': 'https://productivitydaemon.app', 'X-Title': 'Productivity Daemon' } } : {}),
    })
  }

  createWindow(): void {
    if (this.win && !this.win.isDestroyed()) return

    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    this.win = new BrowserWindow({
      width: W,
      height: H,
      x: width - W - 16,
      y: height - H - 16,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    this.win.setAlwaysOnTop(true, 'floating')

    if (this.rendererUrl) {
      const base = this.rendererUrl.replace(/\/+$/, '')
      void this.win.loadURL(`${base}/overlay.html`)
    } else {
      void this.win.loadFile(this.overlayFile)
    }

    this.win.webContents.once('did-finish-load', () => {
      this.windowReady = true
      if (this.pendingShow) {
        this.sendToWindow('overlay:show', this.pendingShow)
        this.win?.show()
        this.pendingShow = null
      }
    })

    this.win.on('closed', () => {
      this.win = null
      this.windowReady = false
    })
  }

  push(notification: OverlayNotification): void {
    if (this.queue.length >= 3) {
      debugLog('overlay:dropped', { id: notification.id, type: notification.type })
      return
    }
    this.queue.push(notification)
    this.tryShow()
  }

  private tryShow(): void {
    if (this.current) return
    const next = this.queue.shift()
    if (!next) return
    this.current = next

    if (!this.win || this.win.isDestroyed()) this.createWindow()

    if (this.windowReady) {
      this.sendToWindow('overlay:show', next)
      this.win?.show()
    } else {
      this.pendingShow = next
    }

    void this.generateAiMessage(next).then((aiMessage) => {
      if (this.current?.id !== next.id) return
      next.aiMessage = aiMessage
      this.sendToWindow('overlay:update', { id: next.id, aiMessage })
      debugLog('overlay:ai-message', { id: next.id, aiMessage: aiMessage.slice(0, 80) })
    })
  }

  onDismiss(id: string): void {
    if (this.current?.id === id) {
      this.current = null
      this.win?.hide()
      setTimeout(() => this.tryShow(), 350)
    }
  }

  getWindow(): BrowserWindow | null { return this.win }

  private sendToWindow(channel: string, data: unknown): void {
    if (!this.win || this.win.isDestroyed()) return
    try { this.win.webContents.send(channel, data) } catch { /* ignore */ }
  }

  private async generateAiMessage(notif: OverlayNotification): Promise<string> {
    if (!this.client) return notif.rawMessage

    const goals = getActiveGoals().slice(0, 3).map((g) => g.text).join('; ') || 'none set'
    const hour = new Date().getHours()
    const timeCtx = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'late night'

    const eventDesc: Record<string, string> = {
      'auto-block': `Automatically blocked ${notif.domain ?? 'a site'} — matched a known distraction category.`,
      'suggest':    `AI flagged ${notif.domain ?? 'a site'} as likely distraction (${Math.round((notif.confidence ?? 0) * 100)}% confident).`,
      'heuristic':  `Behavioral pattern detected: ${notif.rawMessage}`,
      'guard':      `URL guard caught ${notif.domain ?? 'a site'} as a distraction.`,
      'proactive':  notif.rawMessage,
    }

    const prompt = `You are monitoring a user's attention. Write ONE short sentence (max 22 words) for this notification.

Event: ${eventDesc[notif.type] ?? notif.rawMessage}
Goals: ${goals}
Time: ${timeCtx}
Existing reasoning: ${notif.rawMessage}

Rules: Be direct and specific. Name the actual site/behavior. Address user as "you". No corporate language. Make them feel seen, not lectured. Do NOT explain what the app is doing — explain what it means for them right now.`

    try {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 60,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = (resp.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined)?.text?.trim() ?? ''
      return text || notif.rawMessage
    } catch {
      return notif.rawMessage
    }
  }
}

export const notificationQueue = new NotificationQueue()
