// fetch-historical.js
// Descarga el historial de jornadas de todos los jugadores de Biwenger.
// Usa el mismo token de autenticación que fetch-biwenger.js.
// Diseñado para ejecutarse UNA sola vez. Después, fetch-biwenger.js 
// mantiene jornadas.json actualizado incrementalmente.

const https = require('https');
const fs    = require('fs');

const EMAIL    = process.env.BIWENGER_EMAIL;
const PASSWORD = process.env.BIWENGER_PASSWORD;
const OUT_FILE = 'jornadas.json';

// Conservador: 2 jugadores por lote, 3s de pausa
// 542 jugadores / 2 * 3s = ~13 minutos. Seguro.
const BATCH   = 2;
const PAUSE   = 3000;
const SAVE_N  = 20; // guardar progreso cada N jugadores

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function doRequest(opts, body = null) {
  return new Promise((resolve) => {
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', () => resolve({ status: 0, raw: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, raw: '' }); });
    if (body) req.write(body);
    req.end();
  });
}

async function login() {
  const body = JSON.stringify({ email: EMAIL, password: PASSWORD });
  const res = await doRequest({
    hostname: 'biwenger.as.com',
    path:     '/api/v2/auth/login',
    method:   'POST',
    timeout:  10000,
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':         '*/*',
      'Origin':         'https://biwenger.as.com',
      'Referer':        'https://biwenger.as.com/',
      'x-lang':         'es',
      'x-version':      '630',
    }
  }, body);

  if (res.status !== 200) {
    console.error('❌ Login fallido. Status:', res.status);
    process.exit(1);
  }
  const data  = JSON.parse(res.raw);
  const token = data?.data?.token || data?.token;
  if (!token) { console.error('❌ Token no encontrado'); process.exit(1); }
  console.log('✅ Login correcto');
  return token;
}

async function fetchHistory(player, token) {
  const path = `/api/v2/players/${player.id}?fields=*,reports(points,home,match(*,round))`;
  const res  = await doRequest({
    hostname: 'biwenger.as.com',
    path,
    method:   'GET',
    timeout:  12000,
    headers:  {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':          '*/*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Origin':          'https://biwenger.as.com',
      'Referer':         'https://biwenger.as.com/',
      'Authorization':   `Bearer ${token}`,
      'x-lang':          'es',
      'x-version':       '630',
    }
  });

  if (res.status === 429) return { rateLimited: true };
  if (res.status !== 200) return { rateLimited: false, history: null };

  try {
    const data    = JSON.parse(res.raw);
    const reports = data?.data?.reports || [];
    const history = {};
    reports.forEach(r => {
      const roundId = r.match?.round?.id;
      if (!roundId) return;
      // scoreID 5 = AS+Sofascore (el de Biwenger por defecto)
      const pts = typeof r.points === 'object'
        ? (r.points['5'] ?? r.points['1'] ?? null)
        : (r.points ?? null);
      if (pts !== null) history[roundId] = { pts, home: r.home ?? null };
    });
    return { rateLimited: false, history: Object.keys(history).length > 0 ? history : null };
  } catch(e) {
    return { rateLimited: false, history: null };
  }
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('❌ Faltan BIWENGER_EMAIL o BIWENGER_PASSWORD');
    process.exit(1);
  }
  if (!fs.existsSync('data.json')) {
    console.error('❌ data.json no encontrado — ejecuta el workflow principal primero');
    process.exit(1);
  }

  const players = JSON.parse(fs.readFileSync('data.json', 'utf8')).players || [];
  console.log(`📊 ${players.length} jugadores`);

  let jornadas = {};
  if (fs.existsSync(OUT_FILE)) {
    jornadas = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    console.log(`📂 ${Object.keys(jornadas).length} ya procesados — se saltarán`);
  }

  const token = await login();
  let ok = 0, skip = 0, fail = 0;
  const t0 = Date.now();

  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH);

    for (const p of batch) {
      if (jornadas[p.id] && Object.keys(jornadas[p.id]).length > 0) {
        skip++; continue;
      }

      const { rateLimited, history } = await fetchHistory(p, token);

      if (rateLimited) {
        console.warn(`\n🛑 Rate limit. Guardando progreso y esperando 2 minutos...`);
        fs.writeFileSync(OUT_FILE, JSON.stringify(jornadas), 'utf8');
        await sleep(120000);
        // Reintentar este jugador
        const retry = await fetchHistory(p, token);
        if (retry.history) { jornadas[p.id] = retry.history; ok++; }
        else fail++;
        continue;
      }

      if (history) { jornadas[p.id] = history; ok++; }
      else fail++;

      // Pequeña pausa entre jugadores del mismo lote
      await sleep(500);
    }

    // Guardar progreso
    const done = i + BATCH;
    if (done % SAVE_N === 0 || done >= players.length) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(jornadas), 'utf8');
      const pct  = Math.min(100, Math.round(done / players.length * 100));
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  [${pct}%] ${Math.min(done, players.length)}/${players.length} — ✅${ok} ⏭${skip} ❌${fail} — ${secs}s`);
    }

    if (i + BATCH < players.length) await sleep(PAUSE);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(jornadas), 'utf8');
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n✅ Completado en ${mins} minutos`);
  console.log(`📦 jornadas.json — ${ok} nuevos · ${skip} ya existían · ${fail} fallidos`);
  console.log(`📊 Total jugadores con historial: ${Object.keys(jornadas).length}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
