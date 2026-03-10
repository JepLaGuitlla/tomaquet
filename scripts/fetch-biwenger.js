// scripts/fetch-biwenger.js
const https = require('https');
const fs    = require('fs');

const EMAIL     = process.env.BIWENGER_EMAIL;
const PASSWORD  = process.env.BIWENGER_PASSWORD;
const LEAGUE_ID = '44700';
const USER_ID   = '6541195';
const VERSION   = '630';

if (!EMAIL || !PASSWORD) {
  console.error('❌ Faltan Secrets en GitHub');
  process.exit(1);
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, raw: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestJSON(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Origin': 'https://biwenger.as.com',
  'Referer': 'https://biwenger.as.com/',
  'x-league': LEAGUE_ID,
  'x-user': USER_ID,
  'x-version': VERSION,
};

// ─── 1. LOGIN ────────────────────────────────────────────────────────────────
async function login() {
  console.log('🔐 Haciendo login en Biwenger...');
  const payload = JSON.stringify({ email: EMAIL, password: PASSWORD });

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path: '/api/v2/auth/login',
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    }
  }, payload);

  if (res.status !== 200) {
    console.error('❌ Login fallido. Status:', res.status);
    process.exit(1);
  }

  const token = res.body?.data?.token || res.body?.token;
  if (!token) {
    console.error('❌ No se encontró token');
    process.exit(1);
  }

  console.log('✅ Login correcto');
  return token;
}

// ─── 2. TODOS LOS JUGADORES via JSONP ────────────────────────────────────────
async function fetchPlayers() {
  console.log('📥 Descargando todos los jugadores de LaLiga...');

  const cbName = 'jsonp_cb';
  const res = await request({
    hostname: 'cf.biwenger.com',
    path: `/api/v2/competitions/la-liga/data?lang=es&score=5&callback=${cbName}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': 'https://biwenger.as.com/',
    }
  });

  console.log('Status jugadores:', res.status);
  console.log('Primeros 200 chars:', res.raw.substring(0, 200));

  if (res.status !== 200) {
    console.error('❌ Error al obtener jugadores. Status:', res.status);
    process.exit(1);
  }

  // La respuesta es JSONP: jsonp_cb({...}) — hay que extraer el JSON
  const match = res.raw.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) {
    console.error('❌ No se pudo parsear la respuesta JSONP');
    console.log('Respuesta completa (500 chars):', res.raw.substring(0, 500));
    process.exit(1);
  }

  const parsed = JSON.parse(match[1]);
  const rawPlayers = parsed?.data?.players;

  if (!rawPlayers) {
    console.error('❌ Sin jugadores en la respuesta');
    console.log('Keys disponibles:', Object.keys(parsed?.data || {}));
    process.exit(1);
  }

  const arr = Array.isArray(rawPlayers) ? rawPlayers : Object.values(rawPlayers);
  console.log(`✅ ${arr.length} jugadores descargados`);
  console.log('Ejemplo primer jugador:', JSON.stringify(arr[0]).substring(0, 300));

  return arr.map(p => ({
    id:         p.id,
    name:       p.name,
    position:   p.position,
    price:      p.price          || 0,
    points:     p.points         || 0,
    trend:      p.priceIncrement || 0,
    playedHome: p.playedHome     || 0,
    playedAway: p.playedAway     || 0,
    teamName:   p.teamName       || p.team?.name || '',
    status:     p.fitness?.[0]?.status || 'ok',
    jForm:      (p.fitness || []).slice(0, 5).map(f => f.points ?? null),
  }));
}

// ─── 3. DATOS DE LIGA ────────────────────────────────────────────────────────
async function fetchLeague(token) {
  console.log('🏆 Descargando datos de la liga...');

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path: `/api/v2/leagues/${LEAGUE_ID}?fields=*,standings,teams`,
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      'Authorization': `Bearer ${token}`,
    }
  });

  if (res.status !== 200) {
    console.warn('⚠️ No se pudieron obtener datos de liga. Status:', res.status);
    return null;
  }

  console.log('✅ Datos de liga descargados');
  return res.body?.data || null;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  try {
    const token   = await login();
    const players = await fetchPlayers();   // No necesita token, es pública
    const league  = await fetchLeague(token);

    const output = {
      updatedAt: new Date().toISOString(),
      players,
      league,
    };

    fs.writeFileSync('data.json', JSON.stringify(output, null, 2), 'utf8');
    console.log('💾 data.json guardado correctamente');
    console.log(`📊 ${players.length} jugadores, liga: ${league ? 'OK' : 'no disponible'}`);

  } catch (err) {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  }
}

main();
