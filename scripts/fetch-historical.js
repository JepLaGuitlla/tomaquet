const https = require('https');
const fs   = require('fs');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BIWENGER_EMAIL    = process.env.BIWENGER_EMAIL;
const BIWENGER_PASSWORD = process.env.BIWENGER_PASSWORD;
const OUTPUT_FILE       = 'jornadas.json';
const BATCH_SIZE        = 5;   // jugadores en paralelo
const DELAY_MS          = 300; // pausa entre lotes

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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

// ─── LOGIN ───────────────────────────────────────────────────────────────────
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
      'x-version':      '5',
    }
  }, body);
  const token = res.body?.data?.token || res.body?.token;
  if (!token) { console.error('❌ Login fallido. Status:', res.status, JSON.stringify(res.body).slice(0,100)); process.exit(1); }
  console.log('✅ Login correcto');
  return token;
}

// ─── SLUG ────────────────────────────────────────────────────────────────────
function nameToSlug(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ─── FETCH JUGADOR ───────────────────────────────────────────────────────────
async function fetchPlayerHistory(player, token) {
  const slug = nameToSlug(player.name);
  const cb   = `jsonp_${Math.floor(Math.random()*1e9)}`;
  const path = `/api/v2/players/la-liga/${slug}?lang=es&fields=*,reports(points,home,match(*,round))&callback=${cb}`;

  const res = await requestRaw({
    hostname: 'cf.biwenger.com',
    path,
    method:   'GET',
    timeout:  10000,
    headers:  {
      'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer':       'https://biwenger.as.com/',
      'Authorization': `Bearer ${token}`,
    }
  });

  if (res.status !== 200) {
    if (player.name === 'Yamal' || player.name?.includes('Yamal')) {
      console.log(`  DEBUG Yamal: status=${res.status} raw=${res.raw.slice(0,150)}`);
    }
    return null;
  }

  // Strip JSONP wrapper
  const match = res.raw.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) {
    if (player.name === 'Yamal' || player.name?.includes('Yamal')) {
      console.log(`  DEBUG Yamal: no JSONP match. raw=${res.raw.slice(0,150)}`);
    }
    return null;
  }

  try {
    const data = JSON.parse(match[1]);
    const reports = data?.data?.reports || [];
    // Log diagnóstico para el primer jugador
    if (player.name === 'Yamal' || player.name?.includes('Yamal')) {
      console.log(`  DEBUG Yamal: status=${res.status} reports=${reports.length} raw_start=${res.raw.slice(0,100)}`);
    }
    const history = {};
    reports.forEach(r => {
      const roundId = r.match?.round?.id;
      if (roundId && r.points !== undefined && r.points !== null) {
        history[roundId] = { pts: r.points, home: r.home };
      }
    });
    return history;
  } catch(e) {
    return null;
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Recuperación histórica de jornadas\n');

  // Leer jugadores del data.json existente
  if (!fs.existsSync('data.json')) { console.error('❌ data.json no encontrado'); process.exit(1); }
  const data    = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const players = data.players || [];
  console.log(`📊 ${players.length} jugadores a procesar`);

  // Cargar historial existente si hay
  let jornadas = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    jornadas = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    console.log(`📂 ${Object.keys(jornadas).length} entradas existentes en jornadas.json`);
  }

  const token = await login();

  let ok = 0, failed = 0, skipped = 0;

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async p => {
      // Si ya tenemos datos de este jugador, saltar
      if (jornadas[p.id] && Object.keys(jornadas[p.id]).length > 0) {
        skipped++;
        return;
      }

      const history = await fetchPlayerHistory(p, token);
      if (history && Object.keys(history).length > 0) {
        jornadas[p.id] = history;
        ok++;
      } else {
        failed++;
      }
    }));

    if ((i + BATCH_SIZE) % 50 === 0) {
      console.log(`  Progreso: ${Math.min(i+BATCH_SIZE, players.length)}/${players.length} — ok:${ok} skip:${skipped} fail:${failed}`);
    }

    if (i + BATCH_SIZE < players.length) await sleep(DELAY_MS);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jornadas), 'utf8');
  console.log(`\n✅ jornadas.json guardado — ${ok} jugadores · ${skipped} ya existían · ${failed} fallidos`);
  console.log(`📦 Entradas totales: ${Object.keys(jornadas).length} jugadores con historial`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
