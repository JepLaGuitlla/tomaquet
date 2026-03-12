// diag-biwenger.js — diagnóstico rápido Biwenger
// ⚠️ Pon tu email y contraseña aquí abajo y ejecuta: node diag-biwenger.js

const EMAIL     = 'pepepresta@hotmail';
const PASSWORD  = 'Marmoles12';
const LEAGUE_ID = '44700';

// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');

function req(options, body = null) {
  return new Promise((resolve) => {
    const r = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d.slice(0, 300) }); }
      });
    });
    r.on('error', e => resolve({ status: 0, body: e.message }));
    if (body) r.write(body);
    r.end();
  });
}

async function main() {
  console.log('🔐 Login...');
  const payload = JSON.stringify({ email: EMAIL, password: PASSWORD });
  const login = await req({
    hostname: 'biwenger.as.com',
    path:     '/api/v2/auth/login',
    method:   'POST',
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent':     'Mozilla/5.0',
    }
  }, payload);

  const token = login.body?.data?.token;
  console.log('Login status:', login.status, token ? '✅ token OK' : '❌ sin token');
  if (!token) { console.log('Body:', JSON.stringify(login.body)); return; }

  const auth = {
    'Authorization': `Bearer ${token}`,
    'User-Agent':    'Mozilla/5.0',
    'Accept':        'application/json',
  };

  console.log('\n🔍 Probando rutas...\n');

  const tests = [
    { label: 'GET /user/leagues?id=LEAGUE',           path: `/api/v2/user/leagues?id=${LEAGUE_ID}`,    method: 'GET',  headers: auth },
    { label: 'GET /user/leagues (x-league header)',   path: `/api/v2/user/leagues`,                    method: 'GET',  headers: { ...auth, 'x-league': LEAGUE_ID } },
    { label: 'POST /user/leagues {id}',               path: `/api/v2/user/leagues`,                    method: 'POST', body: JSON.stringify({ id: parseInt(LEAGUE_ID) }) },
    { label: 'POST /user/leagues {leagueId}',         path: `/api/v2/user/leagues`,                    method: 'POST', body: JSON.stringify({ leagueId: parseInt(LEAGUE_ID) }) },
    { label: 'GET /account (control — debe dar 200)', path: `/api/v2/account`,                         method: 'GET',  headers: auth },
  ];

  for (const t of tests) {
    let headers = t.headers || auth;
    let body = null;
    if (t.method === 'POST' && t.body) {
      body = t.body;
      headers = { ...auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    }
    const res = await req({ hostname: 'biwenger.as.com', path: t.path, method: t.method, headers }, body);
    console.log(`[${res.status}] ${t.label}`);
    console.log(`       → ${JSON.stringify(res.body).slice(0, 200)}\n`);
  }
}

main();
