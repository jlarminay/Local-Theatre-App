// Shows a TMDB key (or any text) as a QR code in the terminal, to scan with
// the phone app (Settings → TMDB key → camera button). Offline: the key is
// read without echoing, and handed to qrencode on stdin, never as an argument
// (which other processes could see) or to a website.
// Usage: npm run key-qr     (needs qrencode: sudo apt install qrencode)

import { spawn } from 'node:child_process';
import readline from 'node:readline';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (text) => {
      if (text === question || text.endsWith('\n')) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const key = await askHidden('Paste the key (it will not be shown): ');
if (!key) {
  console.error('No key entered.');
  process.exit(1);
}

const qr = spawn('qrencode', ['-t', 'ansiutf8', '-m', '2'], {
  stdio: ['pipe', 'inherit', 'inherit'],
});
qr.on('error', () => {
  console.error('qrencode not found. Install it with: sudo apt install qrencode');
  process.exit(1);
});
qr.on('close', (code) => {
  if (code === 0) console.log('Scan this with the app, then clear the terminal (Ctrl+L).');
  process.exit(code ?? 0);
});
qr.stdin.end(key);
