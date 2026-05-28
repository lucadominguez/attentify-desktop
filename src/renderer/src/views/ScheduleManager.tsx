import React, { useState } from 'react'
import { Calendar, Plus, Trash2, ToggleLeft, ToggleRight, Clock } from 'lucide-react'
import type { AppStore, ScheduleRule } from '@shared/types'
import { useTheme } from '../context/ThemeContext'

const api = (window as unknown as { electronAPI: Window['electronAPI'] }).electronAPI

interface ScheduleManagerProps {
  store: AppStore
  onRefresh: () => void
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function ScheduleManager({ store, onRefresh }: ScheduleManagerProps): React.ReactElement {
  const { colors } = useTheme()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('No Social Media')
  const [newStart, setNewStart] = useState('09:00')
  const [newEnd, setNewEnd] = useState('17:00')
  const [newDays, setNewDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [newDomains, setNewDomains] = useState('twitter.com, instagram.com, reddit.com')

  const handleCreate = async (): Promise<void> => {
    const rule: ScheduleRule = {
      id: crypto.randomUUID(),
      name: newName,
      days: newDays,
      startTime: newStart,
      endTime: newEnd,
      domains: newDomains.split(',').map((d) => d.trim()).filter(Boolean),
      processes: [],
      active: true,
    }
    const updated = [...store.schedules, rule]
    await api.setStore({ schedules: updated })
    onRefresh()
    setCreating(false)
  }

  const handleToggle = async (id: string): Promise<void> => {
    const updated = store.schedules.map((r) => r.id === id ? { ...r, active: !r.active } : r)
    await api.setStore({ schedules: updated })
    onRefresh()
  }

  const handleDelete = async (id: string): Promise<void> => {
    const updated = store.schedules.filter((r) => r.id !== id)
    await api.setStore({ schedules: updated })
    onRefresh()
  }

  const toggleDay = (d: number): void => {
    setNewDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])
  }

  return (
    <div className="p-6 animate-fade-in space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-xl flex items-center gap-2" style={{ color: colors.textPrimary }}>
            <Calendar size={20} className="text-accent-amber" /> Schedule Manager
          </h1>
          <p className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>Set recurring focus blocks that activate automatically</p>
        </div>
        <button
          onClick={() => setCreating(!creating)}
          className="flex items-center gap-2 bg-accent-blue hover:bg-accent-blue-light text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors"
        >
          <Plus size={14} /> New schedule
        </button>
      </div>

      {creating && (
        <div className="card space-y-4">
          <p className="font-semibold text-sm" style={{ color: colors.textPrimary }}>New schedule</p>
          <div>
            <label className="text-xs mb-1 block" style={{ color: colors.textSecondary }}>Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-colors"
              style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: colors.textSecondary }}>Start</label>
              <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-colors"
                style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: colors.textSecondary }}>End</label>
              <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-colors"
                style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }} />
            </div>
          </div>
          <div>
            <label className="text-xs mb-2 block" style={{ color: colors.textSecondary }}>Days</label>
            <div className="flex gap-2">
              {DAYS.map((day, idx) => (
                <button key={day} onClick={() => toggleDay(idx)}
                  className="w-9 h-9 rounded-full text-xs font-semibold transition-all"
                  style={{
                    background: newDays.includes(idx) ? 'rgba(33,150,243,0.2)' : colors.cardBg,
                    border: `1px solid ${newDays.includes(idx) ? 'rgba(33,150,243,0.5)' : colors.border}`,
                    color: newDays.includes(idx) ? colors.textPrimary : colors.textSecondary,
                  }}
                >{day}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: colors.textSecondary }}>Domains to block (comma-separated)</label>
            <input type="text" value={newDomains} onChange={(e) => setNewDomains(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-colors"
              style={{ background: colors.inputBg, border: `1px solid ${colors.border}`, color: colors.textPrimary }} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="btn-primary flex-1">Create schedule</button>
            <button
              onClick={() => setCreating(false)}
              className="px-4 py-2 rounded-full text-sm transition-colors"
              style={{ color: colors.textSecondary, border: `1px solid ${colors.border}` }}
            >Cancel</button>
          </div>
        </div>
      )}

      {store.schedules.length === 0 && !creating ? (
        <div className="card flex flex-col items-center py-10 text-center">
          <Clock size={40} className="mb-3" style={{ color: colors.textSecondary }} />
          <p className="font-semibold mb-1" style={{ color: colors.textPrimary }}>No schedules yet</p>
          <p className="text-sm" style={{ color: colors.textSecondary }}>Create recurring focus blocks — e.g. block social media weekdays 9am–5pm</p>
        </div>
      ) : (
        <div className="space-y-3">
          {store.schedules.map((rule) => (
            <div key={rule.id} className="card flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-sm" style={{ color: colors.textPrimary }}>{rule.name}</p>
                  {!rule.active && <span className="text-xs" style={{ color: colors.textSecondary }}>(paused)</span>}
                </div>
                <p className="text-xs" style={{ color: colors.textSecondary }}>
                  {rule.startTime} – {rule.endTime} · {rule.days.map((d) => DAYS[d]).join(', ')}
                </p>
                <p className="text-xs mt-0.5 truncate" style={{ color: colors.textSecondary }}>{rule.domains.slice(0, 3).join(', ')}{rule.domains.length > 3 ? ` +${rule.domains.length - 3}` : ''}</p>
              </div>
              <button onClick={() => handleToggle(rule.id)} className="hover:text-white transition-colors flex-shrink-0" style={{ color: colors.textSecondary }}>
                {rule.active ? <ToggleRight size={22} className="text-accent-green" /> : <ToggleLeft size={22} />}
              </button>
              <button onClick={() => handleDelete(rule.id)} className="hover:text-accent-orange transition-colors flex-shrink-0" style={{ color: colors.textSecondary }}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
