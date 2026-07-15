import { execFile } from 'child_process'
import { release } from 'os'
import { join } from 'path'
import { writeFileSync, unlinkSync } from 'fs'
import { app } from 'electron'
import { checkElevation, verifyHostsWritable } from './blocking/hostsFileEditor'
import type { CompatCheck, CompatReport, CompatStatus } from '../shared/types'

// Windows 10 1809 (October 2018 Update). Electron 28 / Chromium 120 will not launch
// below this, so the installer refuses to install (see build/installer.nsh) and this
// check only ever fires for an in-place OS downgrade or a side-loaded copy.
const MIN_WIN_BUILD = 17763
const WIN11_BUILD = 22000

/** Build number out of os.release() ("10.0.26200" → 26200). 0 if unparseable. */
function windowsBuild(): number {
  const parts = release().split('.')
  return parts.length >= 3 ? Number(parts[2]) || 0 : 0
}

function checkOs(): CompatCheck {
  if (process.platform !== 'win32') {
    return {
      id: 'os',
      label: 'Operating system',
      status: 'warn',
      detail: `${process.platform}. Enforcement is Windows-only`,
      fix: 'Blocking, firewall and browser policies do nothing here. Tracking still works.'
    }
  }
  const build = windowsBuild()
  const name = build >= WIN11_BUILD ? 'Windows 11' : 'Windows 10'
  if (build === 0) {
    return { id: 'os', label: 'Operating system', status: 'warn', detail: `Unrecognized version (${release()})` }
  }
  if (build < MIN_WIN_BUILD) {
    return {
      id: 'os',
      label: 'Operating system',
      status: 'fail',
      detail: `${name} build ${build}, below the supported minimum (${MIN_WIN_BUILD})`,
      fix: 'Update to Windows 10 version 1809 or newer.'
    }
  }
  return { id: 'os', label: 'Operating system', status: 'ok', detail: `${name} (build ${build})` }
}

function checkArch(): CompatCheck {
  // An x64 build running on an ARM64 machine sees process.arch === 'x64' because it is
  // emulated. The real machine architecture leaks through PROCESSOR_ARCHITEW6432, which
  // Windows only sets for a process running under emulation/WOW.
  const emulated = (process.env['PROCESSOR_ARCHITEW6432'] || '').toUpperCase()
  if (emulated === 'ARM64') {
    return {
      id: 'arch',
      label: 'Architecture',
      status: 'warn',
      detail: 'ARM64 device running the x64 build under emulation',
      fix: 'Everything works, but tracking and blocking are slower than a native build.'
    }
  }
  return { id: 'arch', label: 'Architecture', status: 'ok', detail: `${process.arch} (native)` }
}

function checkElevationStatus(): CompatCheck {
  if (checkElevation()) {
    return { id: 'elevation', label: 'Administrator rights', status: 'ok', detail: 'Elevated, blocks are enforced' }
  }
  return {
    id: 'elevation',
    label: 'Administrator rights',
    status: 'warn',
    detail: 'Not elevated, running in soft mode',
    fix: 'Blocks are recorded but not enforced. Restart as administrator to enforce them.'
  }
}

function checkHosts(): CompatCheck {
  if (process.platform !== 'win32') {
    return { id: 'hosts', label: 'Hosts file', status: 'warn', detail: 'Not enforced on this platform' }
  }
  if (!checkElevation()) {
    return {
      id: 'hosts',
      label: 'Hosts file',
      status: 'warn',
      detail: 'Cannot verify without administrator rights',
      fix: 'Restart as administrator.'
    }
  }
  if (verifyHostsWritable()) {
    return { id: 'hosts', label: 'Hosts file', status: 'ok', detail: 'Writable, domain blocking works' }
  }
  return {
    id: 'hosts',
    label: 'Hosts file',
    status: 'fail',
    detail: 'Elevated, but the hosts file is locked',
    fix: 'Antivirus "tamper protection" commonly locks it. Allow Attentify in your AV, or domain blocking will not work.'
  }
}

function checkDataDir(): CompatCheck {
  const dir = app.getPath('userData')
  const probe = join(dir, '.write-probe')
  try {
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return { id: 'dataDir', label: 'Data folder', status: 'ok', detail: dir }
  } catch (e) {
    return {
      id: 'dataDir',
      label: 'Data folder',
      status: 'fail',
      detail: `${dir} is not writable (${(e as Error).message})`,
      fix: 'Settings, history and analytics cannot be saved. Check folder permissions or your antivirus.'
    }
  }
}

/**
 * Tracking on Windows runs a persistent PowerShell process that Add-Type-compiles a
 * small C# class to read the foreground window. Two things break that on locked-down
 * machines: PowerShell missing entirely, and Constrained Language Mode (set by AppLocker
 * / WDAC / some corporate policies), which forbids Add-Type. The tracker swallows that
 * failure and emits "idle" forever, so without this check the app would look healthy
 * while recording nothing. Probe it explicitly instead.
 */
function checkTracking(): Promise<CompatCheck> {
  const label = 'Activity tracking'
  if (process.platform !== 'win32') {
    return Promise.resolve({ id: 'tracking', label, status: 'warn', detail: 'Only probed on Windows' })
  }
  // Mirrors how ActivityTracker actually spawns PowerShell: the script goes through
  // -Command, not a .ps1 file. That matters — ExecutionPolicy only governs script files,
  // so passing the probe inline needs no -ExecutionPolicy override and leaves the
  // machine's script-execution policy alone. It also keeps this probe a faithful test of
  // the real tracker: if this succeeds, the tracker's Add-Type will too.
  const script =
    '$m = $ExecutionContext.SessionState.LanguageMode; ' +
    "try { Add-Type -TypeDefinition 'public class AttentifyProbe { public static int Ping() { return 1; } }' -ErrorAction Stop; $o = [AttentifyProbe]::Ping() } " +
    'catch { $o = 0 }; ' +
    'Write-Output "$m|$o"'

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-Command', script],
      { timeout: 15_000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve({
            id: 'tracking',
            label,
            status: 'fail',
            detail: 'PowerShell could not be run',
            fix: 'Attentify needs Windows PowerShell 5.1 to see which window is in focus. Nothing will be tracked without it.'
          })
          return
        }
        const [mode = '', ok = '0'] = String(stdout).trim().split('|')
        if (ok.trim() === '1') {
          resolve({ id: 'tracking', label, status: 'ok', detail: `PowerShell ${mode.trim()}. Foreground window readable` })
          return
        }
        resolve({
          id: 'tracking',
          label,
          status: 'fail',
          detail: `PowerShell is in ${mode.trim() || 'a restricted'} mode, so it cannot read the foreground window`,
          fix: 'A security policy (AppLocker/WDAC) is blocking Add-Type. Activity would be recorded as permanently idle. Ask your administrator to allow Attentify.'
        })
      }
    )
  })
}

function worst(checks: CompatCheck[]): CompatStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'ok'
}

/**
 * Full compatibility sweep. Cheap enough to run on demand (the only subprocess is the
 * PowerShell probe); nothing is cached, so the report always reflects the machine now —
 * elevation and the hosts file can both change between launches.
 */
export async function runPreflight(): Promise<CompatReport> {
  const checks: CompatCheck[] = [
    checkOs(),
    checkArch(),
    checkElevationStatus(),
    checkHosts(),
    await checkTracking(),
    checkDataDir()
  ]
  return { overall: worst(checks), checks, checkedAt: Date.now() }
}
