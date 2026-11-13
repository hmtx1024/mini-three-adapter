#!/usr/bin/env node
/**
 * H5 native event verification (ADR-0010).
 *
 * Loads the built adapter in a real Chromium, patches a real <canvas> with
 * `createBrowserRuntime()`, and checks that the browser's own event system
 * survived: native methods not overwritten, real event forwarding does not
 * throw, `webglcontextlost` reaches the runtime, and the pointer bridge emits
 * real `PointerEvent`s.
 *
 * Usage:
 *   npm run build
 *   npm run verify:h5
 *
 * Playwright is an optional dependency of this script only. If it is missing:
 *   npm i -D playwright && npx playwright install chromium
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDir = join(root, 'dist');

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const PAGE = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>verifying</title>
    <style>html,body{margin:0;background:#101820}#gl{width:320px;height:200px;display:block}</style>
  </head>
  <body>
    <canvas id="gl"></canvas>
    <pre id="out">running</pre>
    <script type="module">
      const out = document.getElementById('out');
      const canvas = document.getElementById('gl');
      const results = {};
      try {
        const beforeAdd = canvas.addEventListener;
        const beforeDispatch = canvas.dispatchEvent;
        const beforeStyle = canvas.style;
        const beforeRect = canvas.getBoundingClientRect;

        const { createBrowserRuntime } = await import('/dist/index.js');
        const runtime = await createBrowserRuntime({ canvas, logLevel: 'silent' });

        results.identityKept = runtime.canvas === canvas;
        results.addEventListenerNative = canvas.addEventListener === beforeAdd;
        results.dispatchEventNative = canvas.dispatchEvent === beforeDispatch;
        results.styleNative = canvas.style === beforeStyle;
        results.rectNative = canvas.getBoundingClientRect === beforeRect;

        let hits = 0;
        canvas.addEventListener('pointerdown', () => { hits++; });
        let threw = null;
        try {
          canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 6, bubbles: true }));
        } catch (error) {
          threw = String(error && error.message);
        }
        results.forwardThrew = threw;
        results.forwardHits = hits;

        let lost = 0;
        runtime.on('contextlost', () => { lost++; });
        canvas.dispatchEvent(new Event('webglcontextlost'));
        results.contextlost = lost;

        let moveEvent = null;
        canvas.addEventListener('pointermove', (event) => { moveEvent = event; });
        runtime.handleTouch({
          type: 'touchmove',
          changedTouches: [{ identifier: 2, clientX: 12, clientY: 34 }],
          touches: [{ identifier: 2, clientX: 12, clientY: 34 }],
        });
        results.bridgeIsRealEvent = moveEvent instanceof Event;
        results.bridgeIsPointerEvent = moveEvent instanceof PointerEvent;
        results.bridgeClientX = moveEvent ? moveEvent.clientX : null;
        results.bridgePointerId = moveEvent ? moveEvent.pointerId : null;

        canvas.style.width = '123px';
        results.styleWidthApplied = getComputedStyle(canvas).width;

        runtime.dispose();
      } catch (error) {
        results.fatal = String(error && error.stack ? error.stack : error);
      }
      out.textContent = JSON.stringify(results, null, 2);
      document.title = 'done';
    </script>
  </body>
</html>`;

const CHECKS = [
  ['canvas identity kept', (r) => r.identityKept === true],
  ['addEventListener is native', (r) => r.addEventListenerNative === true],
  ['dispatchEvent is native', (r) => r.dispatchEventNative === true],
  ['style is native', (r) => r.styleNative === true],
  ['getBoundingClientRect is native', (r) => r.rectNative === true],
  ['forwarding a real PointerEvent does not throw', (r) => r.forwardThrew === null || r.forwardThrew === undefined],
  ['forwarded event reaches the listener', (r) => r.forwardHits === 1],
  ['webglcontextlost reaches runtime.on', (r) => r.contextlost === 1],
  ['bridge dispatches a real Event', (r) => r.bridgeIsRealEvent === true],
  ['bridge dispatches a real PointerEvent', (r) => r.bridgeIsPointerEvent === true],
  ['bridge keeps clientX', (r) => r.bridgeClientX === 12],
  ['bridge keeps pointerId', (r) => r.bridgePointerId === 2],
  ['canvas.style.width applies to the real element', (r) => r.styleWidthApplied === '123px'],
];

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

function startServer() {
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    if (url === '/' || url.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    if (url.startsWith('/dist/')) {
      const target = normalize(join(distDir, decodeURIComponent(url.slice('/dist/'.length))));
      if (!target.startsWith(distDir + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      try {
        const body = await readFile(target);
        res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
      return;
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolvePort({ server, port: typeof address === 'object' && address ? address.port : 0 });
    });
  });
}

async function main() {
  // Debug switch: serve the harness page without launching a browser, so the
  // routing can be inspected by hand (and by CI smoke tests).
  if (process.argv.includes('--serve-only')) {
    const { server, port } = await startServer();
    console.log(`[verify:h5] harness at http://127.0.0.1:${port}/ (Ctrl+C to stop)`);
    await new Promise(() => server);
    return;
  }

  try {
    await readFile(join(distDir, 'index.js'), 'utf8');
  } catch {
    console.error('[verify:h5] dist/index.js is missing. Run `npm run build` first.');
    process.exitCode = 1;
    return;
  }

  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error(
      '[verify:h5] playwright is not installed.\n' +
        '  npm i -D playwright && npx playwright install chromium',
    );
    process.exitCode = 1;
    return;
  }

  const { server, port } = await startServer();
  const browser = await playwright.chromium.launch();
  const failures = [];
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.title === 'done', undefined, { timeout: 20000 });

    const raw = await page.textContent('#out');
    const results = JSON.parse(raw ?? '{}');
    if (results.fatal) {
      failures.push(['runtime booted', false, String(results.fatal).split('\n')[0]]);
    }
    for (const [label, check] of CHECKS) {
      const ok = check(results);
      if (!ok) failures.push([label, false, JSON.stringify(results)]);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    }
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }

  if (pageErrors.length > 0) {
    console.error(`[verify:h5] page errors:\n${pageErrors.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  if (failures.length > 0) {
    console.error(`[verify:h5] ${failures.length} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log('[verify:h5] all checks passed');
}

main().catch((error) => {
  console.error('[verify:h5] crashed:', error);
  process.exitCode = 1;
});
