import { execSync } from 'child_process'
import { platform } from 'process'

export interface RunningProcess {
  pid: number
  name: string
}

export function listRunningProcesses(): RunningProcess[] {
  try {
    if (platform === 'win32') {
      const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      return out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parts = line.replace(/"/g, '').split(',')
          return { name: parts[0]?.toLowerCase() ?? '', pid: parseInt(parts[1] ?? '0', 10) }
        })
        .filter((p) => p.name && p.pid > 0)
    } else {
      const out = execSync('ps -eo pid,comm', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      return out
        .split('\n')
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/)
          return { pid: parseInt(parts[0] ?? '0', 10), name: parts[1]?.toLowerCase() ?? '' }
        })
        .filter((p) => p.name && p.pid > 0)
    }
  } catch {
    return []
  }
}

export function killProcessByName(name: string): boolean {
  try {
    const target = name.toLowerCase().replace(/\.exe$/, '')
    if (platform === 'win32') {
      execSync(`taskkill /F /IM "${target}.exe"`, { stdio: 'ignore' })
    } else {
      execSync(`pkill -f "${target}"`, { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

export function killProcessByPid(pid: number): boolean {
  try {
    if (platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' })
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

export function isProcessRunning(name: string): boolean {
  const target = name.toLowerCase().replace(/\.exe$/, '')
  const procs = listRunningProcesses()
  return procs.some((p) => p.name.replace(/\.exe$/, '') === target || p.name.includes(target))
}
