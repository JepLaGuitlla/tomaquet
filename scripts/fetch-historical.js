const https = require('https');
const fs   = require('fs');

const BIWENGER_EMAIL    = process.env.BIWENGER_EMAIL_HISTORICAL || process.env.BIWENGER_EMAIL;
const BIWENGER_PASSWORD = process.env.BIWENGER_PASSWORD_HISTORICAL || process.env.BIWENGER_PASSWORD;
const OUTPUT_FILE       = 'jornadas.json';
const BATCH_SIZE        = 2;
const DELAY_MS          = 2500;
const SAVE_EVERY        = 20;
const MAX_RETRIES       = 2;
const RETRY_WAIT_MS     = 90000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function requestRaw(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, raw, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function requestJSON(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function login() {
  const body = JSON.stringify({ email: BIWENGER_EMAIL, password: BIWENGER_PASSWORD });
  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     '/api/v2/auth/login',
    method:   'POST',
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'x-lang':         'es',
      'x-version':      '630',
    }
  }, body);
  const token = res.body?.data?.token || res.body?.token;
  if (!token) {
    console.error('❌ Login fallido. Status:', res.status, JSON.stringify(res.body).slice(0,100));
    process.exit(1);
  }
  console.log('✅ Login correcto');
  return token;
}

async function fetchPlayerHistory(player, token, attempt = 1) {
  const path = `/api/v2/players/${player.id}?fields=*,reports(points,home,match(*,round))`;
  const headers = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept':          '*/*',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Origin':          'https://biwenger.as.com',
    'Referer':         'https://biwenger.as.com/',
    'Authorization':   `Bearer ${token}`,
    'x-lang':          'es',
    'x-version':       '630',
  };

  let res;
  try {
    res = await requestRaw({ hostname: 'biwenger.as.com', path, method: 'GET', timeout: 12000, headers });
  } catch(e) {
    console.warn(`  ⚠️ Error red ${player.name}: ${e.message}`);
    return null;
  }

  if (res.status === 429) {
    console.error(`\n🛑 Rate limit (429) en ${player.name}. Esperando ${RETRY_WAIT_MS/1000}s...`);
    await sleep(RETRY_WAIT_MS);
    if (attempt < MAX_RETRIES) return fetchPlayerHistory(player, token, attempt + 1);
    console.error(`❌ Rate limit persistente. Saltando ${player.name}.`);
    return null;
  }

  if (res.status !== 200) return null;

  try {
    const data = JSON.parse(res.raw);
    const reports = data?.data?.reports || [];
    const history = {};
    reports.forEach(r => {
      const roundId = r.match?.round?.id;
      if (roundId && r.points !== undefined && r.points !== null) {
        history[roundId] = { pts: r.points, home: r.home };
      }
    });
    return Object.keys(history).length > 0 ? history : null;
  } catch(e) {
    return null;
  }
}

async function main() {
  console.log('🚀 Recuperación histórica de jornadas');
  console.log(`   Lotes: ${BATCH_SIZE} · Pausa: ${DELAY_MS}ms · Guardado cada: ${SAVE_EVERY}\n`);

  if (!BIWENGER_EMAIL || !BIWENGER_PASSWORD) {
    console.error('❌ Faltan BIWENGER_EMAIL / BIWENGER_PASSWORD');
    process.exit(1);
  }
  if (!fs.existsSync('data.json')) {
    console.error('❌ data.json no encontrado');
    process.exit(1);
  }

  const data    = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const players = data.players || [];
  console.log(`📊 ${players.length} jugadores a procesar`);

  let jornadas = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    jornadas = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`📂 ${Object.keys(jornadas).length} ya procesados — se saltarán`);
  }

  const token = await login();
  let ok = 0, failed = 0, skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async p => {
      if (jornadas[p.id] && Object.keys(jornadas[p.id]).length > 0) {
        skipped++;
        return;
      }
      const history = await fetchPlayerHistory(p, token);
      if (history) { jornadas[p.id] = history; ok++; }
      else { failed++; }
    }));

    const processed = i + BATCH_SIZE;
    if (processed % SAVE_EVERY === 0 || processed >= players.length) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jornadas), 'utf8');
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const pct = Math.min(100, Math.round((processed / players.length) * 100));
      console.log(`  [${pct}%] ${Math.min(processed, players.length)}/${players.length} — ✅${ok} ⏭${skipped} ❌${failed} — ${elapsed}s`);
    }

    if (i + BATCH_SIZE < players.length) await sleep(DELAY_MS);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jornadas), 'utf8');
  const mins = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n✅ Completado en ${mins} minutos`);
  console.log(`📦 jornadas.json — ${ok} nuevos · ${skipped} ya existían · ${failed} fallidos`);
  console.log(`📊 Total: ${Object.keys(jornadas).length} jugadores con historial`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
