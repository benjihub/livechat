// Smoke test: start server, hit endpoints, report, and exit
const { spawn } = require('child_process');
const http = require('http');

const PORT = process.env.PORT || '3002';
const BASE = `http://localhost:${PORT}`;

function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

function get(path){
  return new Promise((resolve) => {
    const req = http.get(`${BASE}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(3000, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

async function run(){
  console.log(`[smoke] starting server on ${BASE}...`);
  const env = { ...process.env, PORT, USE_OPENAI: process.env.USE_OPENAI || 'false' };
  const server = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: ['ignore','pipe','pipe'] });
  let ready = false;
  server.stdout.on('data', (buf) => {
    const s = buf.toString();
    process.stdout.write(s.replace(/\r?\n/g, '\n'));
    if (!ready && s.includes('Server is ready')) ready = true;
  });
  server.stderr.on('data', (buf) => process.stderr.write(buf));

  // Wait up to 10s for ready
  for (let i=0; i<20 && !ready; i++) await wait(500);

  // Probe endpoints
  const results = {};
  results.health = await get('/api/bot/health');
  results.promos = await get('/api/promotions');
  results.rtp = await get('/api/rtp');
  results.stats = await get('/api/dashboard/stats');

  // Print compact results
  function ok(r){ return r && !r.error && r.status>=200 && r.status<500; }
  console.log('\n[smoke] results:');
  for (const [k,v] of Object.entries(results)){
    console.log(` - ${k}: ${ok(v) ? 'OK' : 'FAIL'} ${v.error ? '('+v.error+')' : ''} ${v.status ? v.status : ''}`);
  }

  // Shutdown server
  server.kill('SIGINT');
  await wait(500);
  if (!server.killed) server.kill('SIGTERM');
}

run().catch((e)=>{ console.error('[smoke] error', e); process.exit(1); });
