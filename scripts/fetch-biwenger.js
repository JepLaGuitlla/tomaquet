// scripts/fetch-biwenger.js
// Se ejecuta cada día via GitHub Actions.
// Lee credenciales desde variables de entorno (GitHub Secrets).
// Guarda el resultado en data.json en la raíz del repositorio.

const https = require('https');
const fs    = require('fs');

const EMAIL     = process.env.BIWENGER_EMAIL;
const PASSWORD  = process.env.BIWENGER_PASSWORD;
const LEAGUE_ID = process.env.BIWENGER_LEAGUE_ID || '44700';

if (!EMAIL || !PASSWORD) {
  console.error('❌ Faltan Secrets en GitHub');
  process.exit(1);
}

// ─── Utilidad: fetch con https nativo (sin dependencias externas) ────────────
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
      'User-Agent': 'Mozilla/5.0',
    }
  }, payload);

  if (res.status !== 200) {
    console.error('❌ Login fallido. Status:', res.status);
    console.error('Respuesta:', JSON.stringify(res.body));
    process.exit(1);
  }

  const token = res.body?.data?.token || res.body?.token;
  if (!token) {
    console.error('❌ No se encontró token en la respuesta:', JSON.stringify(res.body));
    process.exit(1);
  }

  console.log('✅ Login correcto, token obtenido');
  return token;
}

// ─── 2. DATOS DE JUGADORES (no requiere auth, es pública) ───────────────────
async function fetchPlayers(token) {
  console.log('📥 Descargando jugadores de LaLiga...');

  const res = await request({
    hostname: 'cf.biwenger.com',
    path: '/api/v2/competitions/la-liga/data?lang=es&score=2',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0',
    }
  });

  if (res.status !== 200) {
    console.error('❌ Error al obtener jugadores. Status:', res.status);
    process.exit(1);
  }

  const players = res.body?.data?.players;
  if (!players) {
    console.error('❌ No se encontraron jugadores en la respuesta');
    process.exit(1);
  }

  // Convertir de objeto {id: datos} a array
  const arr = Object.values(players).map(p => ({
    id:          p.id,
    name:        p.name,
    position:    p.position,
    price:       p.price       || 0,
    points:      p.points      || 0,
    trend:       p.priceIncrement || 0,
    playedHome:  p.playedHome  || 0,
    playedAway:  p.playedAway  || 0,
    teamName:    p.teamName    || p.team?.name || '',
    status:      p.fitness?.[0]?.status || 'ok',
    // Últimas 5 jornadas si están disponibles
    jForm:       (p.fitness || []).slice(0, 5).map(f => f.points ?? null),
  }));

  console.log(`✅ ${arr.length} jugadores descargados`);
  return arr;
}

// ─── 3. DATOS DE LA LIGA (clasificación, etc.) ──────────────────────────────
async function fetchLeague(token) {
  console.log('🏆 Descargando datos de la liga...');

  const res = await request({
    hostname: 'biwenger.as.com',
    path: `/api/v2/leagues/${LEAGUE_ID}?fields=*,standings,teams`,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0',
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
    const token  = await login();
    const players = await fetchPlayers(token);
    const league  = await fetchLeague(token);

    const output = {
      updatedAt: new Date().toISOString(),
      players,
      league,
    };

    fs.writeFileSync('data.json', JSON.stringify(output, null, 2), 'utf8');
    console.log('💾 data.json guardado correctamente');
    console.log(`📊 Resumen: ${players.length} jugadores, liga: ${league ? 'OK' : 'no disponible'}`);

  } catch (err) {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  }
}

main();
