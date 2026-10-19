// Builds the app icon, splash, favicon and notification icon: a placeholder
// "LT" in solid block letters, white on #121212. Drawn from rectangles, so
// it doesn't depend on installed fonts. Final branding comes later.
// Writes assets/ (for `capacitor-assets generate`), public/favicon.svg and the
// Android notification icon.
// Usage: npm run icons

import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const BACKGROUND = '#121212';
await mkdir('public', { recursive: true });

// "LT" in a 100×100 box, centred: L spans 12–46, T spans 52–88; strokes 16 wide.
const LETTERS = [
  [12, 18, 16, 64],
  [12, 66, 34, 16],
  [52, 18, 36, 16],
  [62, 18, 16, 64],
];

/** The letters as SVG, filling `fraction` of a `size` square, on `background` (or transparent). */
function svg(size, fraction, background, radius = 0) {
  const scale = (size * fraction) / 100;
  const offset = (size - size * fraction) / 2;
  const n = (value) => Math.round(value * 100) / 100;
  const rects = LETTERS.map(
    ([x, y, w, h]) =>
      `<rect x="${n(offset + x * scale)}" y="${n(offset + y * scale)}" width="${n(w * scale)}" height="${n(h * scale)}"/>`,
  ).join('');
  const bg = background
    ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}<g fill="#ffffff">${rects}</g></svg>`;
}

const render = (file, size, fraction, background) =>
  sharp(Buffer.from(svg(size, fraction, background)))
    .png()
    .toFile(file);

await Promise.all([
  render('assets/icon-only.png', 1024, 0.8, BACKGROUND),
  // Adaptive icons: launchers crop to roughly the middle 61%, so keep it inside that.
  render('assets/icon-foreground.png', 1024, 0.56, null),
  sharp({ create: { width: 1024, height: 1024, channels: 4, background: BACKGROUND } })
    .png()
    .toFile('assets/icon-background.png'),
  render('assets/splash.png', 2732, 0.22, BACKGROUND),
  render('assets/splash-dark.png', 2732, 0.22, BACKGROUND),
  writeFile('public/favicon.svg', svg(64, 0.8, BACKGROUND, 12) + '\n'),
  // Notification (status bar) icon: Android wants a white shape on transparent,
  // 24dp at each density. The runner refers to it as "ic_stat_notify".
  ...Object.entries({ mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 }).map(
    async ([density, size]) => {
      const dir = `android/app/src/main/res/drawable-${density}`;
      await mkdir(dir, { recursive: true });
      await render(`${dir}/ic_stat_notify.png`, size, 0.92, null);
    },
  ),
]);
console.log('Wrote icon sources to assets/, public/favicon.svg and the notification icon');
