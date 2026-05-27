import React, { useRef, useEffect } from 'react'

export type SphereMode = 'idle' | 'active' | 'processing'

interface PulsingSphereProps {
  mode?: SphereMode
  size?: number
}

// ── 3-vector helpers ─────────────────────────────────────────────────────────
type V3 = readonly [number, number, number]

function ry(v: V3, a: number): V3 {
  const [x, y, z] = v
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)]
}
function rx(v: V3, a: number): V3 {
  const [x, y, z] = v
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]
}
function sph(latDeg: number, lonDeg: number): V3 {
  const la = (latDeg * Math.PI) / 180
  const lo = (lonDeg * Math.PI) / 180
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)]
}

// ── Config ───────────────────────────────────────────────────────────────────
const VIEW_TILT = 0.36          // ~21° fixed camera tilt (globe north tilts toward viewer)
const GRID_LATS = [-60, -40, -20, 0, 20, 40, 60]
const GRID_LONS = Array.from({ length: 12 }, (_, i) => i * 30)
const SEG       = 60            // arc segments per line
const RING_R    = 1.60          // outer ring radius (multiples of sphere R)
const RING_INC  = 0.50          // ring inclination ~29°
const SAT_ANGLES = [0.55, 1.85, 3.10, 4.50, 5.75]

// Surface ping locations (lat, lon)
const PING_SITES: [number, number][] = [
  [48, 10], [-23, -46], [35, 139], [40, -74], [51, 0],
  [55, 37], [19, 72], [-34, 151], [31, 121], [-1, 37],
  [25, 55], [60, -5], [-15, -75], [45, 90], [0, 110],
]

interface Projected { px: number; py: number; z: number }
interface Ping { lat: number; lon: number; age: number; maxAge: number }

function project(pt: V3, spinY: number, R: number, cx: number, cy: number): Projected {
  let v = ry(pt, spinY)
  v = rx(v, VIEW_TILT)
  return { px: cx + v[0] * R, py: cy + v[1] * R, z: v[2] }
}

function projectRing(a: number, satOffset: number, R: number, cx: number, cy: number): Projected {
  let v: V3 = [Math.cos(a + satOffset) * RING_R, 0, Math.sin(a + satOffset) * RING_R]
  v = rx(v, RING_INC)
  v = rx(v, VIEW_TILT)
  return { px: cx + v[0] * R, py: cy + v[1] * R, z: v[2] / RING_R }
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PulsingSphere({ mode = 'idle', size = 224 }: PulsingSphereProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width  = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const R  = size * 0.275    // sphere radius in canvas px

    // ── Palette ──────────────────────────────────────────────────────────────
    type RGB = readonly [number, number, number]
    const PAL: Record<SphereMode, { grid: RGB; eq: RGB; scan: RGB; ring: RGB; core: RGB }> = {
      idle:       { grid: [56, 189, 248],  eq: [14, 165, 233],  scan: [125, 211, 252], ring: [103, 232, 249], core: [56, 189, 248] },
      active:     { grid: [74, 222, 128],  eq: [34, 197, 94],   scan: [134, 239, 172], ring: [74, 222, 128],  core: [74, 222, 128] },
      processing: { grid: [167, 139, 250], eq: [139, 92, 246],  scan: [196, 181, 253], ring: [216, 180, 254], core: [167, 139, 250] },
    }
    const P = PAL[mode]
    const g = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`

    // ── Per-mode animation speeds ─────────────────────────────────────────────
    const spinSpeed = mode === 'processing' ? 0.85 : mode === 'active' ? 0.52 : 0.28
    const satSpeed  = spinSpeed * 0.6
    const scanDeg   = mode === 'processing' ? 0.75 : 0.38   // degrees / frame

    // ── State ────────────────────────────────────────────────────────────────
    const pings: Ping[] = []
    let nextPingIn = 40 + Math.floor(Math.random() * 60)
    let scanLat    = -82
    let t          = 0
    let raf        = 0

    // ── Draw helpers ─────────────────────────────────────────────────────────

    function drawAtmosphere(): void {
      const [cr, cg, cb] = P.core
      const a1 = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 2.0)
      a1.addColorStop(0,   `rgba(${cr},${cg},${cb},0.10)`)
      a1.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.04)`)
      a1.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`)
      ctx.fillStyle = a1
      ctx.beginPath(); ctx.arc(cx, cy, R * 2.0, 0, Math.PI * 2); ctx.fill()
    }

    function drawOrbitalRing(satOffset: number): void {
      const SEGS = 72
      for (let i = 0; i < SEGS; i++) {
        const a1 = (i / SEGS) * Math.PI * 2
        const a2 = ((i + 1) / SEGS) * Math.PI * 2
        const p1 = projectRing(a1, 0, R, cx, cy)
        const p2 = projectRing(a2, 0, R, cx, cy)
        const midZ  = (p1.z + p2.z) / 2
        const depth = (midZ + 1) / 2
        const op    = 0.07 + depth * 0.40
        ctx.beginPath(); ctx.moveTo(p1.px, p1.py); ctx.lineTo(p2.px, p2.py)
        ctx.strokeStyle = g(P.ring, op)
        ctx.lineWidth   = 0.5 + depth * 0.6
        ctx.stroke()
      }
      // Satellite dots
      for (const baseA of SAT_ANGLES) {
        const p    = projectRing(baseA, satOffset, R, cx, cy)
        const depth = (p.z + 1) / 2
        if (depth < 0.28) continue
        const op   = 0.35 + depth * 0.65
        const sz   = 2.8 + depth * 1.2
        const sg = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, sz * 2.2)
        sg.addColorStop(0, g(P.ring, op))
        sg.addColorStop(1, g(P.ring, 0))
        ctx.fillStyle = sg
        ctx.beginPath(); ctx.arc(p.px, p.py, sz * 2.2, 0, Math.PI * 2); ctx.fill()
        // Hard dot center
        ctx.fillStyle = g(P.ring, op * 0.9)
        ctx.beginPath(); ctx.arc(p.px, p.py, sz * 0.55, 0, Math.PI * 2); ctx.fill()
      }
    }

    function drawGrid(spinY: number): void {
      // Latitude lines
      for (const lat of GRID_LATS) {
        const isEq = lat === 0
        const pts: Projected[] = []
        for (let i = 0; i <= SEG; i++) pts.push(project(sph(lat, (i / SEG) * 360), spinY, R, cx, cy))

        if (isEq) {
          ctx.save()
          ctx.shadowBlur = 5
          ctx.shadowColor = g(P.eq, 0.6)
        }
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!, b = pts[i + 1]!
          const midZ  = (a.z + b.z) / 2
          const depth = (midZ + 1) / 2
          const op    = isEq ? (0.15 + depth * 0.72) : (0.03 + depth * 0.44)
          if (op < 0.025) continue
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py)
          ctx.strokeStyle = g(isEq ? P.eq : P.grid, op)
          ctx.lineWidth   = isEq ? (0.75 + depth * 0.95) : (0.38 + depth * 0.52)
          ctx.stroke()
        }
        if (isEq) ctx.restore()
      }

      // Longitude lines
      for (const lon of GRID_LONS) {
        const pts: Projected[] = []
        for (let i = 0; i <= SEG / 2; i++) {
          pts.push(project(sph(-90 + (i / (SEG / 2)) * 180, lon), spinY, R, cx, cy))
        }
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!, b = pts[i + 1]!
          const midZ  = (a.z + b.z) / 2
          const depth = (midZ + 1) / 2
          const op    = 0.025 + depth * 0.30
          if (op < 0.02) continue
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py)
          ctx.strokeStyle = g(P.grid, op)
          ctx.lineWidth   = 0.32 + depth * 0.42
          ctx.stroke()
        }
      }
    }

    function drawScan(spinY: number): void {
      scanLat += scanDeg
      if (scanLat > 82) scanLat = -82

      const brightness = Math.sin(((scanLat + 82) / 164) * Math.PI)
      if (brightness < 0.05) return

      const pts: Projected[] = []
      for (let i = 0; i <= SEG; i++) pts.push(project(sph(scanLat, (i / SEG) * 360), spinY, R, cx, cy))

      ctx.save()
      ctx.shadowBlur  = 8
      ctx.shadowColor = g(P.scan, brightness * 0.75)
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!, b = pts[i + 1]!
        if (a.z < -0.05 && b.z < -0.05) continue
        const depth = ((a.z + b.z) / 2 + 1) / 2
        const op    = brightness * (0.28 + depth * 0.65)
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py)
        ctx.strokeStyle = g(P.scan, op)
        ctx.lineWidth   = 0.85 + brightness * 1.6
        ctx.stroke()
      }
      ctx.restore()
    }

    function drawPings(spinY: number): void {
      // Spawn
      nextPingIn--
      if (nextPingIn <= 0) {
        const [lat, lon] = PING_SITES[Math.floor(Math.random() * PING_SITES.length)]!
        pings.push({ lat, lon, age: 0, maxAge: 52 + Math.floor(Math.random() * 20) })
        nextPingIn = 65 + Math.floor(Math.random() * 85)
      }

      for (let i = pings.length - 1; i >= 0; i--) {
        const p = pings[i]!
        p.age++
        if (p.age >= p.maxAge) { pings.splice(i, 1); continue }

        const { px, py, z } = project(sph(p.lat, p.lon), spinY, R, cx, cy)
        if (z < 0) continue

        const life  = p.age / p.maxAge
        const depth = (z + 1) / 2
        const op    = (1 - life) * (0.45 + depth * 0.55)
        const pr    = life * R * 0.28

        // Expanding ring
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2)
        ctx.strokeStyle = g(P.scan, op * 0.85)
        ctx.lineWidth = 0.85
        ctx.stroke()

        // Center dot (fades in then out)
        const dotOp = Math.sin(life * Math.PI) * depth * 0.9
        const dg = ctx.createRadialGradient(px, py, 0, px, py, 2.5)
        dg.addColorStop(0, g(P.scan, dotOp))
        dg.addColorStop(1, g(P.scan, 0))
        ctx.fillStyle = dg
        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill()
      }
    }

    function drawFrontGlow(): void {
      // Subtle hemisphere brightening — makes the globe feel solid, not just a cage
      const fg = ctx.createRadialGradient(cx - R * 0.22, cy - R * 0.18, 0, cx, cy, R * 0.9)
      fg.addColorStop(0, g(P.core, 0.07))
      fg.addColorStop(0.5, g(P.core, 0.03))
      fg.addColorStop(1, g(P.core, 0))
      ctx.fillStyle = fg
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2); ctx.fill()
    }

    // ── Main loop ─────────────────────────────────────────────────────────────
    function draw(): void {
      ctx.clearRect(0, 0, size, size)

      const spinY    = t * spinSpeed
      const satOffset = t * satSpeed

      drawAtmosphere()
      drawOrbitalRing(satOffset)
      drawGrid(spinY)
      drawScan(spinY)
      drawPings(spinY)
      drawFrontGlow()

      t  += 0.016
      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [mode, size])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: 'block' }}
    />
  )
}
