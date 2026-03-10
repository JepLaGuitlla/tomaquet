// scripts/fetch-biwenger.js
const https = require('https');
const fs    = require('fs');

const EMAIL     = process.env.BIWENGER_EMAIL;
const PASSWORD  = process.env.BIWENGER_PASSWORD;
const LEAGUE_ID = process.env.BIWENGER_LEAGUE_ID || '44700';

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

// ─── 1. LOGIN ────────────────────────────────────────────────────────────────
async function login() {
  console.log('🔐 Haciendo login en Biwenger...');
  const payload = JSON.stringify({ email: EMAIL, password: PASSWORD });

  const res = await request({
    hostname: 'biwenger.as.com',
    path: '/api/v2/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': 'https://biwenger.as.com',
      'Referer': 'https://biwenger.as.com/',
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

  // Extraer también el userId de la respuesta
  const userId = res.body?.data?.user?.id || res.body?.data?.id || '';
  console.log('✅ Login correcto, userId:', userId);
  return { token, userId };
}

// ─── 2. JUGADORES ────────────────────────────────────────────────────────────
async function fetchPlayers(token, userId) {
  console.log('📥 Descargando jugadores...');

  const headers = {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://biwenger.as.com',
    'Referer': 'https://biwenger.as.com/',
    'x-league': LEAGUE_ID,
  };
  if (userId) headers['x-user'] = String(userId);

  const res = await request({
    hostname: 'biwenger.as.com',
    path: `/api/v2/leagues/${LEAGUE_ID}/players?fields=*,fitness,team&score=2`,
    method: 'GET',
    headers,
  });

  console.log('Status jugadores:', res.status);
  console.log('Respuesta (500 chars):', JSON.stringify(res.body).substring(0, 500));

  if (res.status !== 200) {
    console.error('❌ Error al obtener jugadores');
    process.exit(1);
  }

  const raw = res.body?.data;
  if (!raw) {
    console.error('❌ Sin datos en la respuesta');
    process.exit(1);
  }

  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  console.log(`✅ ${arr.length} jugadores descargados`);
  return arr.map(p => ({
    id:         p.id,
    name:       p.name,
    position:   p.position,
    price:      p.price      || 0,
    points:     p.points     || 0,
    trend:      p.priceIncrement || 0,
    playedHome: p.playedHome || 0,
    playedAway: p.playedAway || 0,
    teamName:   p.teamName   || p.team?.name || '',
    status:     p.fitness?.[0]?.status || 'ok',
    jForm:      (p.fitness || []).slice(0, 5).map(f => f.points ?? null),
  }));
}

// ─── 3. DATOS DE LIGA ────────────────────────────────────────────────────────
async function fetchLeague(token, userId) {
  console.log('🏆 Descargando datos de la liga...');

  const headers = {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://biwenger.as.com',
    'Referer': 'https://biwenger.as.com/',
    'x-league': LEAGUE_ID,
  };
  if (userId) headers['x-user'] = String(userId);

  const res = await request({
    hostname: 'biwenger.as.com',
    path: `/api/v2/leagues/${LEAGUE_ID}?fields=*,standings,teams`,
    method: 'GET',
    headers,
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
    const { token, userId } = await login();
    const players = await fetchPlayers(token, userId);
    const league  = await fetchLeague(token, userId);

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
