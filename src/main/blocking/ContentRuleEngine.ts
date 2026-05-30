import { EventEmitter } from 'events'
import { getStore, patchStore } from '../store'
import type { ContentRule, BypassAttempt } from '../../../shared/types'
import { debugLog } from '../debug/logger'
import { randomUUID } from 'crypto'
import { PREDEFINED_RULES } from './predefined-rules'

export class ContentRuleEngine extends EventEmitter {
  private bypassAttempts: BypassAttempt[] = []
  private bypassScores = new Map<string, number>()
  private extensionConnected = false
  private lastSeenAt = 0

  // ── Rule CRUD ─────────────────────────────────────────────────────────────────

  getRules(): ContentRule[] {
    return getStore().contentRules ?? []
  }

  addRule(rule: Omit<ContentRule, 'createdAt' | 'updatedAt'> & { id?: string }): ContentRule {
    const now = Date.now()
    const full: ContentRule = {
      ...rule,
      id: rule.id ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    const existing = this.getRules().filter((r) => r.id !== full.id)
    patchStore({ contentRules: [...existing, full] })
    debugLog('content-rule:added', { id: full.id, domain: full.domain })
    this.emit('rules:changed', this.getRules())
    return full
  }

  toggleRule(id: string, enabled: boolean): boolean {
    const rules = this.getRules()
    const idx = rules.findIndex((r) => r.id === id)
    if (idx === -1) return false
    rules[idx] = { ...rules[idx]!, enabled, updatedAt: Date.now() }
    patchStore({ contentRules: rules })
    debugLog('content-rule:toggled', { id, enabled })
    this.emit('rules:changed', rules)
    return true
  }

  deleteRule(id: string): boolean {
    const rules = this.getRules()
    const filtered = rules.filter((r) => r.id !== id)
    if (filtered.length === rules.length) return false
    patchStore({ contentRules: filtered })
    this.emit('rules:changed', filtered)
    return true
  }

  installPredefined(): ContentRule[] {
    const existing = this.getRules()
    const existingIds = new Set(existing.map((r) => r.id))
    const now = Date.now()
    const toAdd = PREDEFINED_RULES
      .filter((r) => !existingIds.has(r.id))
      .map((r) => ({ ...r, createdAt: now, updatedAt: now }))
    if (toAdd.length > 0) {
      patchStore({ contentRules: [...existing, ...toAdd] })
      this.emit('rules:changed', this.getRules())
    }
    return this.getRules()
  }

  // ── Bypass handling ───────────────────────────────────────────────────────────

  handleBypass(attempt: BypassAttempt): { score: number; escalation: 'none' | 'warn' | 'block_5m' | 'block_1h' } {
    this.bypassAttempts.unshift(attempt)
    if (this.bypassAttempts.length > 300) this.bypassAttempts.pop()

    const score = (this.bypassScores.get(attempt.ruleId) ?? 0) + 1
    this.bypassScores.set(attempt.ruleId, score)

    debugLog('content-rule:bypass', {
      ruleId: attempt.ruleId,
      method: attempt.method,
      score,
    })

    let escalation: 'none' | 'warn' | 'block_5m' | 'block_1h' = 'none'
    if (score >= 10)      escalation = 'block_1h'
    else if (score >= 6)  escalation = 'block_5m'
    else if (score >= 3)  escalation = 'warn'

    this.emit('bypass', attempt, score, escalation)
    return { score, escalation }
  }

  getBypassAttempts(ruleId?: string, limit = 50): BypassAttempt[] {
    const list = ruleId
      ? this.bypassAttempts.filter((a) => a.ruleId === ruleId)
      : this.bypassAttempts
    return list.slice(0, limit)
  }

  getBypassScore(ruleId: string): number {
    return this.bypassScores.get(ruleId) ?? 0
  }

  getAllBypassScores(): Record<string, number> {
    return Object.fromEntries(this.bypassScores)
  }

  // ── Extension presence ────────────────────────────────────────────────────────

  heartbeat(): void {
    this.extensionConnected = true
    this.lastSeenAt = Date.now()
  }

  isExtensionConnected(): boolean {
    // Consider connected if last heartbeat was within 90 seconds
    return this.extensionConnected && Date.now() - this.lastSeenAt < 90_000
  }
}
