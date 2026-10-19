// Builds the app icon, splash, favicon and notification icon from one line
// drawing: a ticket stub with "LT", white strokes on #121212 (the same style
// as the other apps: Lucide-like line art, round caps and joins).
// Writes assets/ (for `capacitor-assets generate`), public/favicon.svg and the
// Android notification icon.
// Usage: npm run icons

import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const BACKGROUND = '#121212';
await mkdir('public', { recursive: true });

// 24×24 line art: a ticket with half-circle notches on each short side, a
// dashed tear line near its right end, and "LT" in the main part.
const ART = `
  <path d="M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.8a2.2 2.2 0 0 0 0 4.4V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1.8a2.2 2.2 0 0 0 0-4.4Z"/>
  <path d="M17 8v1.2M17 11.4v1.2M17 14.8V16"/>
  <path d="M7.2 9.5V14.5H9.45"/>
  <path d="M10.8 9.5H14.05M12.425 9.5V14.5"/>`;
// Thin enough that, drawn large (ICON), the lines look like the other apps' icons.
const STROKE = 1.1;

/**
 * The art as an SVG `size` px square: drawn across `fraction` of it, on
 * `background` (or transparent), in white unless `color` is given.
 */
function svg(size, fraction, { background, radius = 0, stroke = STROKE, color = '#ffffff' } = {}) {
  const scale = (size * fraction) / 24;
  const offset = (size - size * fraction) / 2;
  const bg = background
    ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}` +
    `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${color}" ` +
    `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ART}</g></svg>`
  );
}

const render = (file, size, fraction, options) =>
  sharp(Buffer.from(svg(size, fraction, options)))
    .png()
    .toFile(file);

// How much of the visible icon the art spans: about as large as it can be
// with the ticket's corners still inside Android's guaranteed safe circle
// (66dp of the 72dp shown). Adaptive icons show the middle two thirds of
// their canvas, so the foreground layer uses two thirds of this.
const ICON = 0.95;

await Promise.all([
  render('assets/icon-only.png', 1024, ICON, { background: BACKGROUND }),
  render('assets/icon-foreground.png', 1024, ICON * (72 / 108)),
  sharp({ create: { width: 1024, height: 1024, channels: 4, background: BACKGROUND } })
    .png()
    .toFile('assets/icon-background.png'),
  render('assets/splash.png', 2732, 0.2, { background: BACKGROUND }),
  render('assets/splash-dark.png', 2732, 0.2, { background: BACKGROUND }),
  writeFile('public/favicon.svg', svg(64, 0.8, { background: BACKGROUND, radius: 12 }) + '\n'),
  // Notification (status bar) icon: Android wants a white shape on transparent,
  // 24dp at each density; slightly heavier lines so it holds up that small.
  // The runner refers to it as "ic_stat_notify".
  ...Object.entries({ mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 }).map(
    async ([density, size]) => {
      const dir = `android/app/src/main/res/drawable-${density}`;
      await mkdir(dir, { recursive: true });
      await render(`${dir}/ic_stat_notify.png`, size, 0.92, { stroke: 1.6 });
    },
  ),
]);
console.log('Wrote icon sources to assets/, public/favicon.svg and the notification icon');
