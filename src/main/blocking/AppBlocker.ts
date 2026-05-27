import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { platform } from 'process'

/**
 * Window-interception based app blocker.
 * Polls the foreground window at 750ms intervals. When a blocked app
 * is detected in the foreground, its window is immediately minimized
 * via ShowWindow(SW_MINIMIZE). The process is never terminated — all
 * state, files, and connections remain intact.
 */
export class AppBlocker extends EventEmitter {
  private blockerProcess: ChildProcess | null = null
  private blockedNames: string[] = []
  private running = false

  setApps(names: string[]): void {
    this.blockedNames = names.map((n) => n.toLowerCase().replace(/\.exe$/i, '')).filter(Boolean)
    if (this.running) {
      this.restart()
    } else if (this.blockedNames.length > 0) {
      this.start()
    }
  }

  start(): void {
    if (this.running || this.blockedNames.length === 0) return
    this.running = true
    this.spawnBlocker()
  }

  stop(): void {
    this.running = false
    this.blockerProcess?.kill()
    this.blockerProcess = null
  }

  private spawnBlocker(): void {
    if (platform === 'win32') {
      this.spawnWindows()
    }
    // macOS/Linux: not implemented — process killing remains the fallback
  }

  private spawnWindows(): void {
    const blockedList = this.blockedNames.map((n) => `'${n}'`).join(',')

    // Inline C# compiled once per session. Polls the foreground window and
    // calls ShowWindow(SW_MINIMIZE=6) when a blocked process is detected.
    const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class WinBlock {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string[] GetForeground() {
    var h = GetForegroundWindow();
    if (h == IntPtr.Zero) return new string[]{"", "", "0"};
    uint pid = 0;
    GetWindowThreadProcessId(h, out pid);
    try {
      var p = Process.GetProcessById((int)pid);
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      return new string[]{ p.ProcessName.ToLower(), sb.ToString(), h.ToInt64().ToString() };
    } catch { return new string[]{"","","0"}; }
  }
  public static void Minimize(string hStr) {
    long v;
    if (long.TryParse(hStr, out v) && v != 0)
      ShowWindow(new IntPtr(v), 6);
  }
}
"@ -ErrorAction SilentlyContinue
$blocked = @(${blockedList})
while ($true) {
  try {
    $fg = [WinBlock]::GetForeground()
    $proc = $fg[0]; $hwnd = $fg[2]
    if ($proc -ne '') {
      foreach ($b in $blocked) {
        if ($proc -eq $b -or $proc -like "*${b}*") {
          if ($hwnd -ne '0') { [WinBlock]::Minimize($hwnd) }
          Write-Output "BLOCKED:$proc"
          break
        }
      }
    }
  } catch {}
  Start-Sleep -Milliseconds 750
}`.trim()

    this.blockerProcess = spawn(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )

    this.blockerProcess.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        const t = line.trim()
        if (t.startsWith('BLOCKED:')) {
          this.emit('blocked', { type: 'process', item: t.slice(8).trim() })
        }
      }
    })

    this.blockerProcess.on('exit', () => {
      if (this.running && this.blockedNames.length > 0) {
        setTimeout(() => this.spawnWindows(), 1500)
      }
    })
  }

  private restart(): void {
    this.blockerProcess?.kill()
    this.blockerProcess = null
    if (this.blockedNames.length > 0) {
      this.spawnBlocker()
    } else {
      this.running = false
    }
  }
}
