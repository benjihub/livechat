// Cross-platform browser opener that waits for the server to be ready
// The 'open' package is ESM-only; use dynamic import from CommonJS.

const http = require('http');

const PORT = parseInt(process.env.PORT || '3001', 10);
const URL = `http://localhost:${PORT}/`;

const start = Date.now();
const timeoutMs = 30_000; // give server up to 30s to start
const retryMs = 1000;

async function openUrl(url) {
  try {
    const mod = await import('open');
    const open = mod && (mod.default || mod);
    if (typeof open === 'function') {
      await open(url);
    }
  } catch {
    // Swallow errors; opening the browser is a convenience only
  }
}

function tryOpen() {
  const req = http.get(URL, (res) => {
    // If we can reach the server, open the browser
    if (res.statusCode >= 200 && res.statusCode < 600) {
      // Consume and close response quickly
      res.resume();
      openUrl(URL).finally(() => process.exit(0));
    } else {
      res.resume();
    }
  });
  req.on('error', () => {
    if (Date.now() - start > timeoutMs) {
      // Give up after timeout, but do not fail the whole script
      process.exit(0);
    }
    setTimeout(tryOpen, retryMs);
  });
  req.setTimeout(2000, () => {
    req.destroy();
  });
}

setTimeout(tryOpen, retryMs);
