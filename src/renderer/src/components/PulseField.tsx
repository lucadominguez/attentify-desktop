import React, { useRef, useEffect } from 'react'
import { usePresence } from '../context/PresenceContext'
import { useTheme } from '../context/ThemeContext'

// The neural field. An experiment, behind the Settings toggle: opt-in, off by default.
//
// A faint web of interconnected wires with electrical charges travelling along them,
// slowly. The charges are the signal: they run a wire, arrive at a node, and hop to
// another wire leaving that node, so what you see is activity propagating through a
// network rather than a decoration looping.
//
// This is a canvas, not CSS. The first attempt was a CSS dot grid, and a grid is the one
// thing a neural web must not look like: the whole read comes from irregular spacing and
// from edges that actually connect specific nodes. That is geometry, and geometry wants a
// canvas.
//
// It covers the WHOLE app. An earlier version masked the middle 45% empty on the theory
// that presence belongs at the periphery; that made it look like a vignette rather than a
// web, so the mask is gone. It stays readable because it sits at z-index 0, behind every
// panel: it shows through the gaps between surfaces, not through the text.
//
// Costs, since this app runs 24/7 and this is real per-frame drawing:
//   • The static web is rasterised ONCE to an offscreen canvas and blitted each frame.
//     Only the charges are drawn live, and there are ~10 of them.
//   • Capped at ~24fps rather than free-running rAF. Nothing here benefits from 120Hz.
//   • Stops dead when the window is hidden, and never starts under reduced-motion (it
//     paints one still frame of the web instead).
//
// It sits out under glass, for the same reason AmbientWash does: animated colour over a
// see-through window painted on the user's live desktop is exactly the psychedelia the
// glass experiment was archived for.

interface Node { x: number; y: number }
interface Edge { a: number; b: number; len: number }
interface Charge { edge: number; t: number; dir: 1 | -1; speed: number }

// Parse the presence colour once per repaint. Canvas needs numbers, not a CSS string.
function rgbOf(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{6})$/i)
  if (hex) { const n = parseInt(hex[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (m) return [+m[1], +m[2], +m[3]]
  return [99, 102, 241]
}

// Deterministic layout. A web that reshuffles on every resize or re-render reads as a
// glitch; this one is the same web at the same size every time.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Poisson-ish scatter: a jittered grid. Pure random clumps and leaves bald patches; a
// plain grid is a grid. Jittering a coarse grid gives the irregular-but-even spacing a
// neuron web actually has.
function buildWeb(w: number, h: number): { nodes: Node[]; edges: Edge[]; adj: number[][] } {
  const rnd = mulberry32(1337)
  const cell = 108
  const cols = Math.max(2, Math.ceil(w / cell) + 1)
  const rows = Math.max(2, Math.ceil(h / cell) + 1)
  const nodes: Node[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({ x: (c + 0.5 + (rnd() - 0.5) * 0.85) * cell, y: (r + 0.5 + (rnd() - 0.5) * 0.85) * cell })
    }
  }
  // Connect near neighbours only. A distance cap is what keeps it a web instead of a
  // cat's cradle: long edges crossing everything destroy the sense of local structure.
  const maxLen = cell * 1.55
  const edges: Edge[] = []
  const adj: number[][] = nodes.map(() => [])
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
      const len = Math.hypot(dx, dy)
      if (len > maxLen) continue
      // Thin the graph: every candidate edge would make a dense quilt.
      if (rnd() > 0.62) continue
      const idx = edges.length
      edges.push({ a: i, b: j, len })
      adj[i].push(idx); adj[j].push(idx)
    }
  }
  return { nodes, edges, adj }
}

export default function PulseField(): React.ReactElement | null {
  const { color, state } = usePresence()
  const { pulse, glass } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // The presence drives intensity, but it changes far less often than a frame, so it is
  // read through a ref instead of restarting the animation on every state change.
  const look = useRef({ color, state })
  look.current = { color, state }

  const active = pulse && !glass

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let stopped = false
    let web: ReturnType<typeof buildWeb> | null = null
    let charges: Charge[] = []
    let webLayer: HTMLCanvasElement | null = null
    let dpr = 1, w = 0, h = 0

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Rasterise the wires and nodes once. Redrawing ~400 line segments every frame would
    // be the whole cost of this component; blitting one bitmap is nearly free.
    const renderWebLayer = (): void => {
      if (!web) return
      const [r, g, b] = rgbOf(look.current.color)
      const layer = document.createElement('canvas')
      layer.width = Math.max(1, Math.floor(w * dpr))
      layer.height = Math.max(1, Math.floor(h * dpr))
      const lc = layer.getContext('2d')
      if (!lc) return
      lc.scale(dpr, dpr)
      lc.lineCap = 'round'
      for (const e of web.edges) {
        const A = web.nodes[e.a], B = web.nodes[e.b]
        // Longer wires fade: it reads as depth, and it stops the far connections from
        // being as loud as the tight local clusters.
        const a = 0.16 * (1 - (e.len / (108 * 1.55)) * 0.55)
        lc.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`
        lc.lineWidth = 1
        lc.beginPath(); lc.moveTo(A.x, A.y); lc.lineTo(B.x, B.y); lc.stroke()
      }
      for (const n of web.nodes) {
        lc.fillStyle = `rgba(${r}, ${g}, ${b}, 0.30)`
        lc.beginPath(); lc.arc(n.x, n.y, 1.5, 0, Math.PI * 2); lc.fill()
      }
      webLayer = layer
    }

    const layout = (): void => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width; h = rect.height
      if (w < 2 || h < 2) return
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      web = buildWeb(w, h)
      renderWebLayer()
      // A charge per ~14 edges, so density scales with the window instead of a big
      // monitor looking emptier than a small one.
      const count = Math.max(4, Math.min(14, Math.round(web.edges.length / 14)))
      const rnd = mulberry32(99)
      charges = Array.from({ length: count }, () => ({
        edge: Math.floor(rnd() * web!.edges.length),
        t: rnd(),
        dir: rnd() > 0.5 ? 1 : -1,
        speed: 26 + rnd() * 26,   // px/sec. Slow: this is a signal, not a loading bar.
      }))
    }

    const draw = (now: number, dt: number): void => {
      if (!web || !webLayer) return
      const { state: st } = look.current
      const [r, g, b] = rgbOf(look.current.color)
      // Intensity follows the presence, and the whole field breathes on a 7s cycle.
      const base = st === 'intervening' ? 1.0 : st === 'drifting' ? 0.8 : st === 'focused' ? 0.62 : 0.5
      const breath = reduced ? 1 : 0.82 + 0.18 * Math.sin((now / 7000) * Math.PI * 2)
      const gain = base * breath

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.globalAlpha = gain
      ctx.drawImage(webLayer, 0, 0)
      ctx.globalAlpha = 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (reduced) return   // A still web. No travelling charges.

      for (const c of charges) {
        const e = web.edges[c.edge]
        const A = web.nodes[e.a], B = web.nodes[e.b]
        c.t += (c.speed * dt) / 1000 / e.len * c.dir
        // Arrived at a node: hop onto another wire leaving it. This is what makes it read
        // as propagation through a network rather than dots looping on fixed tracks.
        if (c.t > 1 || c.t < 0) {
          const atNode = c.t > 1 ? e.b : e.a
          const options = web.adj[atNode].filter((i) => i !== c.edge)
          const next = options.length ? options[Math.floor(Math.random() * options.length)] : c.edge
          const ne = web.edges[next]
          c.edge = next
          // Enter the new wire from whichever end we are standing on.
          c.dir = ne.a === atNode ? 1 : -1
          c.t = ne.a === atNode ? 0 : 1
          continue
        }
        const x = A.x + (B.x - A.x) * c.t
        const y = A.y + (B.y - A.y) * c.t
        // A short comet tail along the wire, so the charge has direction.
        const tail = 0.22
        const tx = A.x + (B.x - A.x) * Math.max(0, Math.min(1, c.t - tail * c.dir))
        const ty = A.y + (B.y - A.y) * Math.max(0, Math.min(1, c.t - tail * c.dir))
        const grad = ctx.createLinearGradient(tx, ty, x, y)
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`)
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${(0.5 * gain).toFixed(3)})`)
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.4
        ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke()
        // The charge head, with a soft halo.
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 5)
        halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(0.75 * gain).toFixed(3)})`)
        halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
        ctx.fillStyle = halo
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill()
      }
    }

    // ~24fps. Nothing here reads better at 60, and this runs all day.
    const FRAME = 1000 / 24
    let last = performance.now()
    let acc = 0
    const loop = (now: number): void => {
      if (stopped) return
      raf = requestAnimationFrame(loop)
      const dt = Math.min(now - last, 100)   // clamp: a backgrounded tab must not teleport charges
      last = now
      acc += dt
      if (acc < FRAME) return
      acc = 0
      draw(now, dt)
    }

    layout()
    if (reduced) {
      draw(performance.now(), 0)
    } else {
      raf = requestAnimationFrame(loop)
    }

    const onResize = (): void => { layout() }
    // Do not burn frames on a window nobody is looking at.
    const onVisibility = (): void => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0 }
      else if (!raf && !reduced && !stopped) { last = performance.now(); raf = requestAnimationFrame(loop) }
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active])

  // Repaint the wires when the presence colour changes, without rebuilding the web.
  useEffect(() => { /* colour is read per-frame via look.current; the web layer is
    re-rasterised on the next layout. Presence colour shifts are slow and rare, and the
    charges pick the new colour up immediately, which is enough to read as a mood change. */
  }, [color])

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pulse-field"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
