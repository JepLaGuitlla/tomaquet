const https = require('https');
const fs    = require('fs');

const OUTPUT_FILE  = 'jornadas.json';
const BATCH_SIZE   = 3;     // sin auth podemos ir un poco más rápido
const DELAY_MS     = 1500;  // 1.5s entre lotes
const SAVE_EVERY   = 30;    // guardar cada 30 jugadores

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Genera slug desde nombre si no viene en data.json
function nameToSlug(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function fetchPlayerHistory(player) {
  const slug = player.slug || nameToSlug(player.name);
  const cb   = 'jsonp_' + Math.floor(Math.random() * 1e9);
  const path = `/api/v2/players/${slug}?lang=es&fields=*,reports(points,home,match(*,round))&callback=${cb}`;

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'biwenger.as.com',
      path,
      method:   'GET',
      timeout:  12000,
      headers:  {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':          '*/*',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer':         'https://biwenger.as.com/',
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
          console.warn(`  🛑 Rate limit en ${player.name}`);
          resolve({ status: 429, history: null });
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ status: res.statusCode, history: null });
          return;
        }
        try {
          const match = raw.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
          if (!match) { resolve({ status: 0, history: null }); return; }
          const data    = JSON.parse(match[1]);
          const reports = data?.data?.reports || [];
          const history = {};
          reports.forEach(r => {
            const roundId = r.match?.round?.id;
            if (roundId && r.points !== undefined && r.points !== null) {
              // Guardar puntos del scoreID 5 (AS+Sofascore) que es el de Biwenger
              const pts = typeof r.points === 'object' ? (r.points['5'] ?? r.points['1']) : r.points;
              history[roundId] = { pts, home: r.home ?? null };
            }
          });
          resolve({ status: 200, history: Object.keys(history).length > 0 ? history : null });
        } catch(e) {
          resolve({ status: 0, history: null });
        }
      });
    });
    req.on('error', () => resolve({ status: 0, history: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, history: null }); });
    req.end();
  });
}

async function main() {
  console.log('🚀 Recuperación histórica de jornadas (endpoint público)');
  console.log(`   Lotes: ${BATCH_SIZE} · Pausa: ${DELAY_MS}ms · Sin autenticación\n`);

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

  let ok = 0, failed = 0, skipped = 0, rateLimited = false;
  const startTime = Date.now();

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async p => {
      if (jornadas[p.id] && Object.keys(jornadas[p.id]).length > 0) {
        skipped++;
        return;
      }
      const { status, history } = await fetchPlayerHistory(p);
      if (status === 429) { rateLimited = true; failed++; return; }
      if (history) { jornadas[p.id] = history; ok++; }
      else { failed++; }
    }));

    // Si hay rate limit, esperar más
    if (rateLimited) {
      console.warn('  ⏸ Rate limit detectado. Esperando 90s...');
      await sleep(90000);
      rateLimited = false;
    }

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
