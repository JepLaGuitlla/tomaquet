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
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
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
  'Accept': 'application/json, text/plain, */*',
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

  const res = await request({
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
    console.error('❌ Login fallido. Status:', res.status, JSON.stringify(res.body));
    process.exit(1);
  }

  const token = res.body?.data?.token || res.body?.token;
  if (!token) {
    console.error('❌ No se encontró token:', JSON.stringify(res.body));
    process.exit(1);
  }

  console.log('✅ Login correcto');
  return token;
}

// ─── 2. JUGADORES de la liga ──────────────────────────────────────────────────
async function fetchPlayers(token) {
  console.log('📥 Descargando jugadores de la liga...');

  const res = await request({
    hostname: 'biwenger.as.com',
    path: `/api/v2/leagues/${LEAGUE_ID}/players?fields=*,fitness,team&score=2`,
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      'Authorization': `Bearer ${token}`,
    }
  });

  console.log('Status jugadores:', res.status);
  console.log('Respuesta (500 chars):', JSON.stringify(res.body).substring(0, 500));

  if (res.status !== 200) {
    console.error('❌ Error al obtener jugadores. Status:', res.status);
    process.exit(1);
  }

  const raw = res.body?.data;
  if (!raw) {
    console.error('❌ Sin datos en la respuesta');
    process.exit(1);
  }

  // Puede venir como objeto {id: player} o como array
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
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

  const res = await request({
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
    const players = await fetchPlayers(token);
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
