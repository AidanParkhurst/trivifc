/**
 * generate-one-pager-pdf.js
 *
 * Renders one-pager.html in headless Chromium and exports it as a
 * single A4-width PDF at a fixed height that contains all content.
 *
 * Usage:
 *   node generate-one-pager-pdf.js
 *
 * Output: trivifc-one-pager.pdf in this directory.
 */

const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');

const PORT     = 8080;
const URL      = `http://localhost:${PORT}/one-pager.html`;
const OUT_PATH = path.join(__dirname, 'trivifc-one-pager.pdf');
const WIDTH    = 794; // A4 @ 96 dpi

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn('python', ['-u', 'serve.py'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    server.stderr.on('data', (d) => process.stderr.write(d));
    const timer = setTimeout(() => resolve(server), 800);
    server.on('error', (err) => { clearTimeout(timer); reject(new Error(`Server error: ${err.message}`)); });
    server.on('exit', (code) => { if (code !== null && code !== 0) { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); } });
  });
}

(async () => {
  console.log('🚀  Starting local server on port', PORT, '…');
  const server = await startServer();

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);

    await page.setViewport({ width: WIDTH, height: 1123, deviceScaleFactor: 1 });

    console.log(`📄  Loading ${URL}…`);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    const fullHeight = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    console.log(`📐  Page height: ${fullHeight}px`);

    console.log('🖨️   Generating PDF…');
    await page.pdf({
      path: OUT_PATH,
      width:  `${WIDTH}px`,
      height: `${fullHeight}px`,
      printBackground: true,
      scale: 1,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const size = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
    console.log(`✅  Saved: ${OUT_PATH}  (${size} KB)`);

    await page.close();
  } finally {
    await browser.close();
    server.kill();
    console.log('🏁  Done.');
  }
})();
