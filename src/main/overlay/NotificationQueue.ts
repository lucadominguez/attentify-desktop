import Anthropic from '@anthropic-ai/sdk'
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getActiveGoals } from '../data/repository'
import { canUseAi, recordUsage } from '../billing'
import { buildAiClient } from '../aiClient'
import { resolveModel } from '../agent/modelRouter'
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

const OPENROUTER_BASE  = 'https://openrouter.ai/api'
const W = 400
const H = 190

class NotificationQueue {
  private win: BrowserWindow | null = null
  private queue: OverlayNotification[] = []
  private current: OverlayNotification | null = null
  private client: Anthropic | null = null
  private model = resolveModel('micro', false)
  private rendererUrl: string | null = null
  private overlayFile = ''
  // windowReady is set ONLY by markReady(), which fires from the 'overlay:ready' IPC —
  // i.e. only once the React overlay has actually mounted and subscribed. We never mark
  // ready off 'did-finish-load', so we never show the window when React isn't alive to
  // paint into it (that was the blank-window bug).
  private windowReady = false
  private pendingShow: OverlayNotification | null = null
  // The window is revealed only after the renderer confirms it painted the notification
  // ('overlay:shown' ack), or via a short fallback once we know React is alive. This
  // guarantees the small corner window is never shown blank.
  private showTimer: ReturnType<typeof setTimeout> | null = null
  // Belt-and-suspenders against a stuck overlay: force-hide after this long even if the
  // renderer never dismisses it.
  private safetyTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly SAFETY_HIDE_MS = 16_000

  init(rendererUrl: string | null, outDir: string): void {
    this.rendererUrl = rendererUrl
    this.overlayFile = join(outDir, 'renderer', 'overlay.html')
    this.refreshClient()
    this.createWindow()
  }

  refreshClient(): void {
    const { client, isOpenRouter } = buildAiClient()
    this.client = client
    this.model = resolveModel('micro', isOpenRouter)
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

    this.win.on('closed', () => {
      this.win = null
      this.windowReady = false
      if (this.safetyTimer) { clearTimeout(this.safetyTimer); this.safetyTimer = null }
      if (this.showTimer) { clearTimeout(this.showTimer); this.showTimer = null }
    })
  }

  // Called from the 'overlay:ready' IPC once the React overlay has mounted and
  // subscribed. Only now is it safe to flush a queued notification, and only now do we
  // know the renderer is alive to actually paint one.
  markReady(): void {
    if (this.windowReady) return
    this.windowReady = true
    if (this.pendingShow) {
      const n = this.pendingShow
      this.pendingShow = null
      this.showNotification(n)
    }
  }

  // Send the content, then reveal only after the renderer paints it. We do NOT show the
  // window here — reveal() is called by the 'overlay:shown' ack, or by a short fallback
  // (safe because windowReady means React is mounted and painting).
  private showNotification(n: OverlayNotification): void {
    this.sendToWindow('overlay:show', n)
    if (this.showTimer) clearTimeout(this.showTimer)
    this.showTimer = setTimeout(() => this.reveal(n.id), 800)
    if (this.safetyTimer) clearTimeout(this.safetyTimer)
    this.safetyTimer = setTimeout(() => {
      if (this.current?.id === n.id) this.onDismiss(n.id)
      else { this.win?.hide(); this.safetyTimer = null }
    }, NotificationQueue.SAFETY_HIDE_MS)
  }

  // Actually make the window visible — content is guaranteed painted by now.
  private reveal(id: string): void {
    if (this.showTimer) { clearTimeout(this.showTimer); this.showTimer = null }
    if (this.current?.id !== id) return
    if (!this.win || this.win.isDestroyed()) return
    if (!this.win.isVisible()) this.win.show()
  }

  // Renderer ack: it has rendered the notification, so it's safe to reveal immediately.
  handleShown(id: string): void {
    this.reveal(id)
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

    if (!this.win || this.win.isDestroyed()) { this.windowReady = false; this.createWindow() }

    if (this.windowReady) {
      this.showNotification(next)
    } else {
      // Wait for the renderer's ready signal (or the did-finish-load fallback).
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
      if (this.safetyTimer) { clearTimeout(this.safetyTimer); this.safetyTimer = null }
      if (this.showTimer) { clearTimeout(this.showTimer); this.showTimer = null }
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
    if (!this.client || !canUseAi()) return notif.rawMessage

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
      recordUsage(this.model, resp.usage?.input_tokens ?? 0, resp.usage?.output_tokens ?? 0)
      const text = (resp.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined)?.text?.trim() ?? ''
      return text || notif.rawMessage
    } catch {
      return notif.rawMessage
    }
  }
}

export const notificationQueue = new NotificationQueue()
