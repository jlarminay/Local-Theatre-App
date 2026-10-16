// Builds the app icon and header logo from the theatre's footer logo
// (assets/source/footer-logo.png, from victoriafilmfestival.com): just the
// two-faces emblem, words dropped, in plain white on #121212.
// Writes assets/ (for `capacitor-assets generate`), public/logo.png and the
// Android notification icon.
// Usage: npm run icons

import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const SOURCE = 'assets/source/footer-logo.png';
const BACKGROUND = '#121212';
// The emblem occupies the left of the logo; the wordmark starts after this column.
const EMBLEM_MAX_X = 92;
const MASTER = 1024;

// The source is only ~90px tall, so the emblem's alpha is upscaled smoothly and
// then thresholded, giving crisp solid edges instead of a blurry enlargement.
// Returns the emblem as white-on-transparent, MASTER px on its longer side.
async function whiteEmblem() {
  const { data, info } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = Infinity,
    right = -1,
    top = Infinity,
    bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < EMBLEM_MAX_X; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 40) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const scale = MASTER / Math.max(right - left + 1, bottom - top + 1);
  const width = Math.round((right - left + 1) * scale);
  const height = Math.round((bottom - top + 1) * scale);
  const mask = await sharp(SOURCE)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .extractChannel('alpha')
    .resize(width, height, { kernel: 'lanczos3' })
    .blur(2)
    .threshold(128)
    .toColourspace('b-w')
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .joinChannel(mask)
    .png()
    .toBuffer();
}

const emblem = await whiteEmblem();
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** White emblem fitted into `fraction` of a `size` square, on `background` (or transparent). */
async function render(file, size, fraction, background) {
  const inner = Math.round(size * fraction);
  const fitted = await sharp(emblem)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: background ?? TRANSPARENT },
  })
    .composite([{ input: fitted, gravity: 'centre' }])
    .png()
    .toFile(file);
}

await Promise.all([
  render('assets/icon-only.png', 1024, 0.8, BACKGROUND),
  // Adaptive icons: launchers crop to roughly the middle 61%, so keep it inside that.
  render('assets/icon-foreground.png', 1024, 0.56, null),
  sharp({ create: { width: 1024, height: 1024, channels: 4, background: BACKGROUND } })
    .png()
    .toFile('assets/icon-background.png'),
  render('assets/splash.png', 2732, 0.22, BACKGROUND),
  render('assets/splash-dark.png', 2732, 0.22, BACKGROUND),
  render('public/logo.png', 256, 1, null),
  // Notification (status bar) icon: Android wants a white shape on transparent,
  // 24dp at each density. The runner refers to it as "ic_stat_vic".
  ...Object.entries({ mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 }).map(
    async ([density, size]) => {
      const dir = `android/app/src/main/res/drawable-${density}`;
      await mkdir(dir, { recursive: true });
      await render(`${dir}/ic_stat_vic.png`, size, 0.92, null);
    },
  ),
]);
console.log('Wrote icon sources to assets/ and public/logo.png');
