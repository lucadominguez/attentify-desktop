// Build the Attentify logo assets from the source art.
//
// The art is an app-icon: a green robot centred on a near-black navy field, with no
// white tile and no alpha. That is a DIFFERENT shape from the previous source (a white
// rounded tile on dark), which this script used to assume: it trimmed the dark away to
// find the tile. With this art there is no tile, so trimming lands on the robot itself.
//
// So: trim to the robot, re-pad it evenly, and keep the navy as the mark's own
// background. Re-padding matters because the source leaves roughly a quarter of the
// frame empty, which is fine at 256px and useless at the 26px the sidebar renders.
//
// Emits:
//   • src/renderer/src/assets/logo.png  — in-app mark + chat avatar
//   • resources/logo-mark.png           — same, kept as source of truth
//   • resources/icon.png / icon.ico     — OS/taskbar/installer icon
//
// Usage: node scripts/make-robot-icon.mjs "<path-to-source.png>"
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = 'C:/Users/Lenovo/Desktop/AI/daemon'
const source = process.argv[2] || join(root, 'resources', 'logo-source.png')

const S = 512
const RADIUS = 118        // the rounded-tile look of a Windows app icon
const PAD_RATIO = 0.09    // margin around the robot, as a fraction of its longest side

const meta = await sharp(readFileSync(source)).metadata()

// Sample the field from a corner rather than hard-coding it, so a re-export with a
// slightly different background still works.
//
// Read the raw pixel: `.extract(...).stats()` reports stats for the WHOLE image, not the
// extracted region, so it returns an average of the navy AND the green robot. Padding
// with that average leaves a visibly lighter rectangle around the art.
const cornerRaw = await sharp(readFileSync(source))
  .extract({ left: 0, top: 0, width: 4, height: 4 })
  .removeAlpha()
  .raw()
  .toBuffer()
const bg = { r: cornerRaw[0], g: cornerRaw[1], b: cornerRaw[2] }

// Trim the flat field to find the robot. The threshold is generous: the art is a
// gradient and a tight value clips the antialiased edges of the arms.
const trimmed = await sharp(readFileSync(source)).trim({ threshold: 18 }).toBuffer({ resolveWithObject: true })
const tw = trimmed.info.width
const th = trimmed.info.height

// Square around the robot with an even margin, filled with the art's own navy so the
// seam is invisible.
const side = Math.max(tw, th)
const pad = Math.round(side * PAD_RATIO)
const canvas = side + pad * 2
const top = Math.round((canvas - th) / 2)
const left = Math.round((canvas - tw) / 2)

// Pad and resize in SEPARATE passes. sharp applies operations in its own fixed order
// (resize before extend) rather than the order they are chained, so doing both on one
// instance resizes to 512 and THEN pads, yielding 812x666 instead of a 512 square.
const padded = await sharp(trimmed.data)
  .extend({ top, bottom: canvas - th - top, left, right: canvas - tw - left, background: bg })
  .png()
  .toBuffer()
const squared = await sharp(padded).resize(S, S, { fit: 'fill' }).png().toBuffer()

// Round the corners by masking alpha, so the mark sits on any surface without a square
// navy block around it.
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">`
  + `<rect x="0" y="0" width="${S}" height="${S}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`,
)
// top/left pinned explicitly: composite defaults to centre gravity, which silently masks
// the wrong region if the base is ever not exactly S x S.
const rounded = await sharp(squared)
  .ensureAlpha()
  .composite([{ input: mask, blend: 'dest-in', top: 0, left: 0 }])
  .png()
  .toBuffer()

// Verify rather than trust: the corners must actually be transparent.
const probe = await sharp(rounded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const alphaAt = (x, y) => probe.data[(y * S + x) * probe.info.channels + 3]
const corners = [alphaAt(2, 2), alphaAt(S - 3, 2), alphaAt(2, S - 3), alphaAt(S - 3, S - 3)]
if (corners.some((a) => a > 8)) throw new Error(`corners not transparent (${corners}) — the mask did not apply`)

writeFileSync(join(root, 'src', 'renderer', 'src', 'assets', 'logo.png'), rounded)
writeFileSync(join(root, 'resources', 'logo-mark.png'), rounded)
writeFileSync(join(root, 'resources', 'icon.png'), rounded)

// .ico needs real multi-size entries; Windows picks per context (taskbar, alt-tab, tray).
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(sizes.map((s) => sharp(rounded).resize(s, s, { fit: 'fill' }).png().toBuffer()))
writeFileSync(join(root, 'resources', 'icon.ico'), await pngToIco(pngs))

console.log(`source ${meta.width}x${meta.height} · field rgb(${bg.r},${bg.g},${bg.b}) · robot ${tw}x${th}`)
console.log(`corner alpha ${corners.join(',')} (want ~0)`)
console.log('wrote: assets/logo.png, resources/logo-mark.png, resources/icon.png, resources/icon.ico')
