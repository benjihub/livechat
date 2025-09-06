// Cross-platform parallel runner: launches server, bot, and opener
const { spawn } = require('child_process');

const procs = [];

function run(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  procs.push({ name, p });
  p.on('exit', (code, signal) => {
    if (code !== 0) {
      console.error(`[${name}] exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
    } else {
      console.log(`[${name}] exited`);
    }
  });
  return p;
}

// Forward Ctrl+C to children and exit cleanly
function shutdown() {
  console.log('\nShutting down...');
  for (const { p } of procs) {
    try { if (p && !p.killed) p.kill(); } catch (_) {}
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', 'node', ['server.js']);
run('bot', 'node', ['newtest3.js']);
run('open', 'node', ['open-browser.js']);
