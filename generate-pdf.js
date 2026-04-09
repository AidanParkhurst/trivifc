/**
 * generate-pdf.js
 *
 * Renders the TriviLife landing page in headless Chromium and exports it as
 * single continuous PDFs — one at desktop width, one at mobile width.
 *
 * Usage:
 *   npm install
 *   node generate-pdf.js
 *
 * Output: trivilife.pdf and trivilife-mobile.pdf in this directory.
 */

const puppeteer = require('puppeteer');
const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');

const PORT         = 8080;
const URL          = `http://localhost:${PORT}`;
const OUT_DESKTOP  = path.join(__dirname, 'trivilife.pdf');
const OUT_MOBILE   = path.join(__dirname, 'trivilife-mobile.pdf');
// Viewport width in CSS pixels — matches desktop layout
const WIDTH        = 1400;
// Typical mobile viewport (iPhone 14 / ~390 logical pixels)
const MOBILE_WIDTH = 390;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn('python', ['-u', 'serve.py'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    server.stderr.on('data', (d) => process.stderr.write(d));

    // Give the server a moment to bind, then resolve
    const timer = setTimeout(() => resolve(server), 800);

    server.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start server: ${err.message}`));
    });

    server.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer(server) {
  server.kill();
}

// ---------------------------------------------------------------------------
// Shared PDF rendering helper
// ---------------------------------------------------------------------------

async function renderPdf(browser, { viewportWidth, isMobile, outPath, label }) {
  const page = await browser.newPage();

  // Emulate reduced-motion so scroll-animated elements (opacity:1) are visible
  // without waiting for IntersectionObserver callbacks that never fire headlessly.
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);

  // Intercept the hero Unsplash image and swap to a smaller variant.
  // The original w=1920&q=80 gets rasterised into the PDF at full resolution,
  // which is the single biggest driver of file size and Chrome scroll lag.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('images.unsplash.com')) {
      const smaller = url
        .replace(/w=\d+/, 'w=900')
        .replace(/q=\d+/, 'q=65');
      req.continue({ url: smaller });
    } else {
      req.continue();
    }
  });

  await page.setViewport({
    width: viewportWidth,
    height: 900,
    deviceScaleFactor: 1,
    isMobile,
    hasTouch: isMobile,
  });

  console.log(`📄  [${label}] Loading ${URL}…`);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60_000 });

  await page.evaluate(() => document.fonts.ready);

  // Expand lazy-loaded images so they appear in the PDF
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('img[loading="lazy"]'));
    imgs.forEach((img) => { img.loading = 'eager'; });
    await new Promise((r) => setTimeout(r, 500));
  });

  // Fix vh-based heights, overlay colour, and freeze animations before
  // measuring or printing.
  // • Puppeteer's page.pdf() resizes the internal viewport to the PDF paper
  //   height, so `100vh` would otherwise expand to fill the whole page.
  // • The orange gradient stop in .hero__overlay blends pinkish in PDF
  //   colour compositing — replace it with a clean navy fade.
  await page.addStyleTag({
    content: `
      .hero {
        min-height: 0 !important;
        height: auto !important;
      }
      .hero__overlay {
        background: linear-gradient(
          155deg,
          rgba(10, 40, 24, 0.94) 0%,
          rgba(10, 40, 24, 0.72) 100%
        ) !important;
      }
      .marathons__track { animation-play-state: paused !important; }

      /* Remove backdrop-filter — forces full-page rasterisation in PDF,
         dramatically inflating file size and causing Chrome scroll lag.
         Replace with an opaque background that looks identical. */
      .hero__stats {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background: rgba(15, 23, 42, 0.88) !important;
      }

      /* Chromium's PDF renderer renders box-shadow blur as solid grey
         rectangles. Strip shadows from cards and use a border instead. */
      .example__card,
      .testimonials__card,
      .example__aside-icon {
        box-shadow: none !important;
        border: 1px solid var(--grey-200) !important;
      }
    `,
  });

  // Allow one animation frame for the layout to settle after the style change
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));

  const fullHeight = await page.evaluate(
    () => document.documentElement.scrollHeight
  );
  console.log(`📐  [${label}] Page height (after layout fix): ${fullHeight}px`);

  console.log(`🖨️   [${label}] Generating PDF…`);
  await page.pdf({
    path: outPath,
    width:  `${viewportWidth}px`,
    height: `${fullHeight}px`,
    printBackground: true,
    scale: 1,
    // No margins — the page already has its own padding
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  const size = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✅  [${label}] Saved: ${outPath}  (${size} KB)`);

  await page.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log('🚀  Starting local server…');
  const server = await startServer();

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await renderPdf(browser, {
      viewportWidth: WIDTH,
      isMobile: false,
      outPath: OUT_DESKTOP,
      label: 'desktop',
    });

    await renderPdf(browser, {
      viewportWidth: MOBILE_WIDTH,
      isMobile: true,
      outPath: OUT_MOBILE,
      label: 'mobile',
    });
  } finally {
    await browser.close();
    stopServer(server);
    console.log('🏁  Done.');
  }
})();
