#!/usr/bin/env node
// Generate app icons from the Attentify brand logo.
//
//   node scripts/make-icon.mjs
//
// Source: resources/logo-full.png (the full brand lockup — shield mark + "Attentify"
// wordmark). We crop out just the shield mark (the wordmark is illegible at icon
// sizes) and emit:
//   • resources/icon.ico  — multi-size Windows icon (taskbar / installer / exe)
//   • resources/icon.png  — 512px PNG (Linux AppImage + macOS + in-app use)
//
// Requires sharp + png-to-ico (already in the workspace; else: npm i --no-save sharp png-to-ico).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = join(root, 'resources', 'logo-full.png');
if (!existsSync(srcPath)) {
  console.error('✗ resources/logo-full.png not found — put the brand logo there first.');
  process.exit(1);
}

// Crop box for the shield mark within the 1254×1254 brand lockup. Excludes the
// wordmark below and the stray accent dot from the "i". If the source art changes,
// re-tune these four numbers.
const CROP = { left: 312, top: 205, width: 630, height: 610 };

// A square master of just the shield on a white field (matches the brand art).
const master = await sharp(readFileSync(srcPath))
  .extract(CROP)
  .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .png()
  .toBuffer();

// .ico embeds multiple square sizes so Windows picks the right one per context.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  sizes.map((s) => sharp(master).resize(s, s).png().toBuffer())
);
const ico = await pngToIco(pngBuffers);
writeFileSync(join(root, 'resources', 'icon.ico'), ico);
console.log(`wrote resources/icon.ico (${ico.length} bytes, sizes ${sizes.join('/')})`);

writeFileSync(join(root, 'resources', 'icon.png'), master);
console.log(`wrote resources/icon.png (${master.length} bytes, 512×512)`);
