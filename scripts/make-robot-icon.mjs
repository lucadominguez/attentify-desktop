// Build the Attentify logo assets from the source art. The source is an app-icon style
// image (dark background, white rounded tile, green robot). We crop a square safely
// INSIDE the white tile (avoiding the dark rounded corners) so the in-app mark renders
// as a clean white badge, then emit:
//   • src/renderer/src/assets/logo.png  — in-app mark + chat avatar (white bg, robot)
//   • resources/logo-mark.png           — same, kept as source of truth
//   • resources/icon.png / icon.ico     — OS/taskbar/installer icon (rounded)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = 'C:/Users/Lenovo/Desktop/AI/daemon'
// Source: pass a path as argv[2], else fall back to resources/logo-source.png.
const source = process.argv[2] || join(root, 'resources', 'logo-source.png')

// Trim the dark background down to the white tile, square it, then mask the corners
// transparent (rounded) so the tile's dark rounded-corner bleed is removed cleanly and
// the whole robot is preserved.
const S = 512
const cornerMask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect x="0" y="0" width="${S}" height="${S}" rx="118" ry="118"/></svg>`)
const tile = await sharp(readFileSync(source))
  .trim({ threshold: 40 })
  .resize(S, S, { fit: 'fill' })
  .ensureAlpha()
  .composite([{ input: cornerMask, blend: 'dest-in' }])
  .png()
  .toBuffer()

// Sanity: corners should be transparent (alpha ~0), not dark.
const { data, info } = await sharp(tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const ch = info.channels
const alpha = (x, y) => data[(y * S + x) * ch + 3]
console.log('corner alpha (want ~0):', alpha(2, 2), alpha(509, 2), alpha(2, 509), alpha(509, 509))

writeFileSync(join(root, 'src', 'renderer', 'src', 'assets', 'logo.png'), tile)
writeFileSync(join(root, 'resources', 'logo-mark.png'), tile)
console.log('wrote assets/logo.png + resources/logo-mark.png')

// Icon: the tile is already rounded with transparent corners.
writeFileSync(join(root, 'resources', 'icon.png'), tile)
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(sizes.map((s) => sharp(tile).resize(s, s).png().toBuffer()))
writeFileSync(join(root, 'resources', 'icon.ico'), await pngToIco(pngs))
console.log('wrote resources/icon.png + icon.ico')
