// fetch-board-history.js
// Barrido incremental del tablón de la liga TOMAQUET (compras/ventas/pujas)
// hacia atrás en el tiempo, vía /api/v2/league/{id}/board?offset=&limit=.
// Diseñado para ejecutarse varias veces (manual, workflow_dispatch): cada
// vez continúa desde donde lo dejó la anterior (board-history-progress.json)
// hasta que Biwenger deja de devolver eventos nuevos.
//
// Después, fetch-biwenger.js mantiene transacciones-liga.json al día con lo
// más reciente en cada ejecución de cada 6h — este script es solo para
// recuperar lo de atrás, una vez.

const https = require('https');
const fs    = require('fs');

const EMAIL     = process.env.BIWENGER_EMAIL;
const PASSWORD  = process.env.BIWENGER_PASSWORD;
const LEAGUE_ID     = '44700';
const LEAGUE_USER_ID = '6541195';

const OUT_FILE      = 'transacciones-liga.json';
const PROGRESS_FILE = 'board-history-progress.json';

// Calibración inicial, no un ritmo probado: no hay ninguna certeza de que
// Biwenger tolere esto, así que la primera tanda es deliberadamente
// pequeña (5 páginas, pausas largas) para observar el resultado antes de
// subir el ritmo en una ejecución posterior. No tocar estos números al
// alza sin comprobar antes que la tanda anterior salió limpia (sin 429).
const LIMIT       = 20;
const PAUSE_MS    = 9000;
const MAX_PAGES   = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function doRequest(opts) {
  return new Promise((resolve) => {
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', () => resolve({ status: 0, raw: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, raw: '' }); });
    req.end();
  });
}

async function login() {
  const body = JSON.stringify({ email: EMAIL, password: PASSWORD });
  const res = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'biwenger.as.com',
      path:     '/api/v2/auth/login',
      method:   'POST',
      timeout:  10000,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':         '*/*',
        'Origin':         'https://biwenger.as.com',
        'Referer':        'https://biwenger.as.com/',
        'x-lang':         'es',
        'x-version':      '631',
      }
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve({ status: r.statusCode, raw }));
    });
    req.on('error', () => resolve({ status: 0, raw: '' }));
    req.write(body);
    req.end();
  });

  if (res.status !== 200) { console.error('❌ Login fallido. Status:', res.status); process.exit(1); }
  const data  = JSON.parse(res.raw);
  const token = data?.data?.token || data?.token;
  if (!token) { console.error('❌ Token no encontrado'); process.exit(1); }
  console.log('✅ Login correcto');
  return token;
}

async function fetchBoardPage(token, offset) {
  const res = await doRequest({
    hostname: 'biwenger.as.com',
    path:     `/api/v2/league/${LEAGUE_ID}/board?offset=${offset}&limit=${LIMIT}`,
    method:   'GET',
    timeout:  12000,
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':          '*/*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Origin':          'https://biwenger.as.com',
      'Referer':         'https://biwenger.as.com/',
      'Authorization':   `Bearer ${token}`,
      'x-league':        LEAGUE_ID,
      'x-user':          LEAGUE_USER_ID,
      'x-lang':          'es',
      'x-version':       '631',
    }
  });

  if (res.status === 429) return { rateLimited: true };
  if (res.status !== 200) return { rateLimited: false, events: null, status: res.status };

  try {
    const data = JSON.parse(res.raw);
    return { rateLimited: false, events: Array.isArray(data.data) ? data.data : [] };
  } catch (e) {
    return { rateLimited: false, events: null };
  }
}

function transaccionId(t) {
  return [t.date, t.player, t.from?.id, t.to?.id, t.amount].join('-');
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('❌ Faltan BIWENGER_EMAIL o BIWENGER_PASSWORD');
    process.exit(1);
  }

  let transacciones = [];
  if (fs.existsSync(OUT_FILE)) {
    transacciones = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  }
  const vistos = new Set(transacciones.map(transaccionId));

  let progress = { nextOffset: 0, done: false };
  if (fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  if (progress.done) {
    console.log('✅ El barrido ya se completó en una ejecución anterior (no quedan páginas más antiguas).');
    return;
  }

  const token = await login();
  console.log(`📂 ${transacciones.length} transacciones ya guardadas — continuando desde offset ${progress.nextOffset}`);

  let paginasHechas = 0;
  let nuevas = 0;
  let offset = progress.nextOffset;

  while (paginasHechas < MAX_PAGES) {
    const { rateLimited, events, status } = await fetchBoardPage(token, offset);

    if (rateLimited) {
      console.warn('🛑 Rate limit. Guardando progreso y parando aquí por hoy.');
      break;
    }
    if (events === null) {
      console.warn(`⚠️ Fallo leyendo offset ${offset} (status ${status}). Parando aquí.`);
      break;
    }
    if (events.length === 0) {
      console.log(`🏁 Página vacía en offset ${offset} — no quedan más eventos antiguos. Barrido completo.`);
      progress.done = true;
      break;
    }

    events
      .filter(ev => ev.type === 'transfer' && Array.isArray(ev.content))
      .forEach(ev => {
        ev.content.forEach(t => {
          const registro = {
            date:   ev.date,
            player: t.player,
            from:   t.from ? { id: t.from.id, name: t.from.name } : null,
            to:     t.to   ? { id: t.to.id,   name: t.to.name   } : null,
            amount: t.amount,
          };
          const id = transaccionId(registro);
          if (vistos.has(id)) return;
          vistos.add(id);
          transacciones.push(registro);
          nuevas++;
        });
      });

    offset += LIMIT;
    paginasHechas++;
    progress.nextOffset = offset;

    fs.writeFileSync(OUT_FILE, JSON.stringify(transacciones.sort((a, b) => (b.date || 0) - (a.date || 0)), null, 2), 'utf8');
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');

    console.log(`  [página ${paginasHechas}/${MAX_PAGES}] offset ${offset - LIMIT} — ${events.length} eventos vistos, ${nuevas} nuevos acumulados`);

    if (events.length < LIMIT) {
      console.log('🏁 Página incompleta — probablemente el final del histórico. Barrido completo.');
      progress.done = true;
      break;
    }

    await sleep(PAUSE_MS);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(transacciones.sort((a, b) => (b.date || 0) - (a.date || 0)), null, 2), 'utf8');
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');

  console.log(`\n✅ Ejecución terminada — ${paginasHechas} páginas, ${nuevas} transacciones nuevas`);
  console.log(`📦 ${OUT_FILE} — ${transacciones.length} transacciones en total`);
  console.log(progress.done
    ? '🏁 Barrido histórico completo, no hace falta relanzar.'
    : `⏭ Quedan más páginas — vuelve a lanzar este mismo workflow para continuar desde offset ${progress.nextOffset}.`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
