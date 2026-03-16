// scripts/fetch-biwenger.js
const https = require('https');
const fs    = require('fs');

const EMAIL          = process.env.BIWENGER_EMAIL;
const PASSWORD       = process.env.BIWENGER_PASSWORD;
const LEAGUE_TOMAQUET = { id: '44700',   userId: '6541195'  };
const LEAGUE_ENBAS    = { id: '1248640', userId: '11504267' };
const VERSION        = '630';
const FD_TOKEN       = '00308a91cfc84b248611ecc22550c9de'; // football-data.org

// Feeds RSS de noticias fantasy
const RSS_SOURCES = [
  { id:'jp', label:'Jornada Perfecta', url:'https://www.jornadaperfecta.com/feed/' },
  { id:'as', label:'AS Fantasy',       url:'https://fantasy.as.com/feed/' },
  { id:'cm', label:'Comuniate',        url:'https://www.comuniate.com/feed/' },
  { id:'rv', label:'Relevo Fantasy',   url:'https://www.relevo.com/rss/noticias/' },
];

if (!EMAIL || !PASSWORD) {
  console.error('❌ Faltan Secrets en GitHub: BIWENGER_EMAIL / BIWENGER_PASSWORD');
  process.exit(1);
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, raw: data, headers: res.headers }));
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
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const COMMON_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':          '*/*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Origin':          'https://biwenger.as.com',
  'Referer':         'https://biwenger.as.com/',
  'x-version':       VERSION,
};

function headersForLeague(liga) {
  return { ...COMMON_HEADERS, 'x-league': liga.id, 'x-user': liga.userId };
}

// ─── 1. LOGIN ────────────────────────────────────────────────────────────────

async function login() {
  console.log('🔐 Login en Biwenger...');
  const payload = JSON.stringify({ email: EMAIL, password: PASSWORD });

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     '/api/v2/auth/login',
    method:   'POST',
    headers:  {
      ...COMMON_HEADERS,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload),
    }
  }, payload);

  if (res.status !== 200) { console.error('❌ Login fallido. Status:', res.status); process.exit(1); }

  const token = res.body?.data?.token || res.body?.token;
  if (!token) { console.error('❌ No se encontró token'); process.exit(1); }

  console.log('✅ Login correcto');
  return token;
}

// ─── 2. JUGADORES (Biwenger JSONP) ──────────────────────────────────────────

async function fetchPlayers() {
  console.log('📥 Descargando jugadores de LaLiga (Biwenger)...');

  const cbName = 'jsonp_cb';
  const res = await request({
    hostname: 'cf.biwenger.com',
    path:     `/api/v2/competitions/la-liga/data?lang=es&score=5&callback=${cbName}`,
    method:   'GET',
    headers:  {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':          '*/*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer':         'https://biwenger.as.com/',
    }
  });

  if (res.status !== 200) { console.error('❌ Error jugadores. Status:', res.status); process.exit(1); }

  const match = res.raw.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) { console.error('❌ No se pudo parsear JSONP'); process.exit(1); }

  const parsed     = JSON.parse(match[1]);
  const rawPlayers = parsed?.data?.players;
  const rawTeams   = parsed?.data?.teams || {};
  if (!rawPlayers) { console.error('❌ Sin jugadores en la respuesta'); process.exit(1); }

  const arr = Array.isArray(rawPlayers) ? rawPlayers : Object.values(rawPlayers);
  console.log(`✅ ${arr.length} jugadores descargados`);

  return arr.map(p => {
    // El campo correcto es p.teamID (D mayúscula) — confirmado con DEBUG
    const tid = p.teamID || null;
    const teamObj = rawTeams[tid] || rawTeams[String(tid)] || null;
    return {
      id:         p.id,
      name:       p.name,
      position:   p.position,
      price:      p.price          || 0,
      points:     p.points         || 0,
      trend:      p.priceIncrement || 0,
      playedHome: p.playedHome     || 0,
      playedAway: p.playedAway     || 0,
      teamName:   teamObj?.name    || p.teamName || '',
      teamId:     teamObj?.id      || null,
      status:     p.fitness?.[0]?.status || 'ok',
      jForm:      (p.fitness || []).slice(0, 5).map(f => typeof f === 'number' ? f : (f?.points ?? null)),
      clausula:   p.clause         || null,
    };
  });
}

// ─── 3. DATOS DE LIGA (Biwenger) ─────────────────────────────────────────────

async function fetchLeague(token, liga) {
  console.log(`🏆 Descargando datos de liga ${liga.id} (Biwenger)...`);

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     `/api/v2/league?include=all,-lastAccess&fields=*,standings,tournaments,group,settings(description)`,
    method:   'GET',
    headers:  { ...headersForLeague(liga), 'Authorization': `Bearer ${token}`, 'x-lang': 'es' }
  });

  if (res.status !== 200) { console.warn('⚠️ No se pudieron obtener datos de liga. Status:', res.status, JSON.stringify(res.body).slice(0,150)); return null; }

  console.log(`✅ Liga ${liga.id} descargada`);
  return res.body?.data || null;
}

// ─── 4. TODOS LOS EQUIPOS DE LA LIGA ────────────────────────────────────────

async function fetchAllTeams(token, liga) {
  console.log(`👥 Descargando equipos liga ${liga.id}...`);

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     `/api/v2/league?include=all&fields=*,standings,tournaments,group,settings(description)`,
    method:   'GET',
    headers:  { ...headersForLeague(liga), 'Authorization': `Bearer ${token}`, 'x-lang': 'es' }
  });

  if (res.status !== 200) { console.warn('⚠️ No se pudieron obtener equipos. Status:', res.status); return null; }

  const data  = res.body?.data;
  const teams = data?.standings || [];
  console.log(`✅ ${teams.length} equipos descargados (liga ${liga.id})`);
  return teams.map(t => ({
    id:      t.id,
    name:    t.name,
    manager: t.manager?.name || t.name,
    points:  t.points     || 0,
    value:   t.teamValue  || 0,
    trend:   t.teamValueInc || 0,
    players: (t.players || []).map(p => ({
      id:       p.id,
      name:     p.name,
      position: p.position,
      price:    p.price  || 0,
      points:   p.points || 0,
    })),
  }));
}

// ─── 5. MI EQUIPO (Guitlla) ───────────────────────────────────────────────────

async function fetchMyTeam(token, liga) {
  console.log(`🦊 Descargando mi equipo liga ${liga.id}...`);

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     `/api/v2/user?fields=*,lineup(type,playersID,reservesID,captain,striker,coach,date),players(id,owner),market,offers,-trophies`,
    method:   'GET',
    headers:  {
      ...headersForLeague(liga),
      'Authorization':  `Bearer ${token}`,
      'Content-Type':   'application/json; charset=utf-8',
      'x-lang':         'es',
    }
  });

  if (res.status !== 200) { console.warn('⚠️ No se pudo obtener mi equipo. Status:', res.status, JSON.stringify(res.body).slice(0,200)); return null; }

  const data = res.body?.data;
  if (!data) { console.warn('⚠️ Sin datos de mi equipo'); return null; }

  const playerRefs = data.players || [];
  const lineup     = data.lineup  || {};
  console.log(`✅ Mi equipo: ${playerRefs.length} jugadores, presupuesto: ${data.balance || 0}`);

  return {
    teamId:   data.id    || null,
    name:     data.name  || 'Guitlla',
    points:   data.points || 0,
    balance:  data.balance || 0,
    lineup,
    players:  playerRefs.map(p => ({
      id:          p.id,
      buyPrice:    p.owner?.price    || 0,
      clause:      p.owner?.clause   || 0,
      invested:    p.owner?.invested || 0,
      buyDate:     p.owner?.date     || 0,
    })),
    market: (data.market || []).map(m => ({
      playerID: m.playerID,
      price:    m.price,
      type:     m.type,
      until:    m.until,
    })),
  };
}

// ─── 6. LA LIGA (football-data.org) ──────────────────────────────────────────

async function fetchLaLiga() {
  console.log('⚽ Descargando datos de La Liga (football-data.org)...');

  function fdGet(path) {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.football-data.org',
        path:     `/v4${path}`,
        method:   'GET',
        headers:  { 'X-Auth-Token': FD_TOKEN }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try   { resolve({ ok: res.statusCode === 200, body: JSON.parse(data) }); }
          catch { resolve({ ok: false, body: {} }); }
        });
      });
      req.on('error', () => resolve({ ok: false, body: {} }));
      req.end();
    });
  }

  try {
    const standings = await fdGet('/competitions/PD/standings');
    await sleep(700);
    const scheduled = await fdGet('/competitions/PD/matches?status=SCHEDULED&limit=50');
    await sleep(700);
    const inPlay   = await fdGet('/competitions/PD/matches?status=IN_PLAY&limit=20');
    await sleep(700);
    const finished  = await fdGet('/competitions/PD/matches?status=FINISHED&limit=50');

    if (!standings.ok) { console.warn('⚠️ No se pudo obtener clasificación.'); return null; }

    const table    = standings.body?.standings?.[0]?.table || [];
    const matchday = standings.body?.season?.currentMatchday || null;

    const forms = {};
    const sortedMatches = (finished.body?.matches || [])
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

    sortedMatches.forEach(m => {
      const hg = m.score?.fullTime?.home;
      const ag = m.score?.fullTime?.away;
      if (hg === null || hg === undefined) return;
      [m.homeTeam, m.awayTeam].forEach((team, idx) => {
        if (!forms[team.id]) forms[team.id] = { results: [], gf: 0, ga: 0, crest: team.crest, name: team.name };
        const f       = forms[team.id];
        if (f.results.length < 5) {
          const scored  = idx === 0 ? hg : ag;
          const concede = idx === 0 ? ag : hg;
          f.results.push(scored > concede ? 'W' : scored < concede ? 'L' : 'D');
          f.gf += scored;
          f.ga += concede;
        }
      });
    });

    const allScheduled = [
      ...(scheduled.body?.matches || []),
      ...(inPlay.body?.matches    || []),
    ];
    const nextMD = allScheduled.length
      ? Math.min(...allScheduled.map(m => m.matchday).filter(Boolean))
      : null;

    const nextMDs = nextMD ? [nextMD, nextMD + 1] : [];
    const nextMatches = allScheduled
      .filter(m => nextMDs.includes(m.matchday))
      .map(m => ({
          id:       m.id,
          matchday: m.matchday,
          date:     m.utcDate,
          home:     { id: m.homeTeam.id, name: m.homeTeam.name, short: m.homeTeam.shortName, crest: m.homeTeam.crest },
          away:     { id: m.awayTeam.id, name: m.awayTeam.name, short: m.awayTeam.shortName, crest: m.awayTeam.crest },
        }));

    const recentResults = sortedMatches.slice(0, 8).map(m => ({
      date:  m.utcDate,
      home:  { name: m.homeTeam.name, short: m.homeTeam.shortName, crest: m.homeTeam.crest },
      away:  { name: m.awayTeam.name, short: m.awayTeam.shortName, crest: m.awayTeam.crest },
      score: { home: m.score?.fullTime?.home, away: m.score?.fullTime?.away }
    }));

    console.log(`✅ La Liga: ${table.length} equipos, jornada ${matchday}, ${nextMatches.length} próximos`);
    return { matchday, table, forms, nextMatches, recentResults };

  } catch(e) {
    console.warn('⚠️ Error en football-data:', e.message);
    return null;
  }
}

// ─── 7. NOTICIAS RSS ─────────────────────────────────────────────────────────

async function fetchNews() {
  console.log('📰 Descargando noticias RSS...');

  const LIVE_SOURCES = RSS_SOURCES.filter(s => s.id === 'jp');

  function fetchRSS(src) {
    return new Promise((resolve) => {
      const url = new URL(src.url);
      const req = https.request({
        hostname: url.hostname,
        path:     url.pathname + (url.search || ''),
        method:   'GET',
        timeout:  5000,
        headers:  {
          'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
          'Accept':     'application/rss+xml, application/xml, text/xml, */*',
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ src, status: res.statusCode, raw: data }));
      });
      req.on('timeout', () => { req.destroy(); console.warn(`⚠️ Timeout RSS ${src.id}`); resolve(null); });
      req.on('error',   (e) => { console.warn(`⚠️ Error RSS ${src.id}:`, e.message); resolve(null); });
      req.end();
    });
  }

  const results = await Promise.all(LIVE_SOURCES.map(fetchRSS));
  const allNews = [];

  for (const r of results) {
    if (!r || r.status !== 200) continue;
    const items = r.raw.match(/<item[\s\S]*?<\/item>/g) || [];
    console.log(`  ${r.src.id}: ${items.length} noticias`);
    items.slice(0, 10).forEach(item => {
      const getTag  = (tag) => { const m = item.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i')); return m ? m[1].trim() : ''; };
      const getAttr = (tag, attr) => { const m = item.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i')); return m ? m[1] : ''; };
      const title = getTag('title');
      const link  = getTag('link') || getAttr('link', 'href');
      const date  = getTag('pubDate') || getTag('dc:date') || '';
      const img   = getAttr('enclosure', 'url') || getAttr('media:content', 'url') || (item.match(/<img[^>]+src=["']([^"']+)["']/i)||[])[1] || '';
      if (title && link) allNews.push({ title, link, date, img, srcId: r.src.id, srcLabel: r.src.label });
    });
  }

  allNews.sort((a, b) => { try { return new Date(b.date) - new Date(a.date); } catch { return 0; } });
  console.log(`✅ ${allNews.length} noticias descargadas`);
  return allNews;
}

// ─── 8. STATS DE JUGADORES — FOOTBALL-DATA.ORG ───────────────────────────────

async function fetchPlayerStats() {
  console.log('\u{1F4CA} Descargando estadísticas de jugadores (football-data.org)...');

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.football-data.org',
      path:     '/v4/competitions/PD/scorers?limit=100',
      method:   'GET',
      timeout:  10000,
      headers:  { 'X-Auth-Token': FD_TOKEN }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.warn('\u26A0\uFE0F football-data scorers status:', res.statusCode);
          resolve(null);
          return;
        }
        try {
          const body    = JSON.parse(data);
          const scorers = body?.scorers || [];
          const players = scorers.map(s => ({
            id:          String(s.player?.id || ''),
            name:        s.player?.name || '',
            team:        s.team?.name   || s.team?.shortName || '',
            position:    s.player?.position || '',
            nationality: s.player?.nationality || '',
            appearances: parseInt(s.playedMatches) || 0,
            goals:       parseInt(s.goals)         || 0,
            assists:     parseInt(s.assists)        || 0,
            penalties:   parseInt(s.penalties)      || 0,
            minutesPerGoal: (s.goals && s.playedMatches)
              ? Math.round((s.playedMatches * 90) / s.goals) : null,
          }));
          console.log('\u2705 football-data scorers: ' + players.length + ' jugadores');
          resolve({
            source:    'football-data',
            league:    'LaLiga',
            season:    '2025/26',
            updatedAt: new Date().toISOString(),
            players,
          });
        } catch(e) {
          console.warn('\u26A0\uFE0F Error parseando scorers:', e.message);
          resolve(null);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); console.warn('\u26A0\uFE0F Timeout scorers'); resolve(null); });
    req.on('error',   (e) => { console.warn('\u26A0\uFE0F Error scorers:', e.message); resolve(null); });
    req.end();
  });
}

// ─── TABLÓN DE LIGA (Biwenger board) ─────────────────────────────────────────

async function fetchBoard(token, liga) {
  console.log(`📋 Descargando tablón liga ${liga.id}...`);

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     '/api/v2/home',
    method:   'GET',
    headers:  { ...headersForLeague(liga), 'Authorization': `Bearer ${token}`, 'x-lang': 'es' }
  });

  if (res.status !== 200) {
    console.warn(`⚠️ No se pudo obtener tablón liga ${liga.id}. Status:`, res.status);
    return [];
  }

  const board = res.body?.data?.league?.board || [];
  const events = board.filter(e => e.type === 'transfer' || e.type === 'market');
  console.log(`✅ Tablón liga ${liga.id}: ${events.length} eventos`);

  return events.map(ev => ({
    type:    ev.type,
    date:    ev.date || null,
    content: ev.content || null,
  }));
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────

function updateHistory(myTeamTomaquet, myTeamEnBas, allTeamsTomaquet, allTeamsEnBas, leagueTomaquet, leagueEnBas) {
  const HISTORY_FILE = 'history.json';
  const MAX_ENTRIES  = 180;

  let history = { tomaquet: [], enbas: [] };
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch(e) {
    console.warn('⚠️ No se pudo leer history.json, iniciando desde cero');
  }

  const today = new Date().toISOString().slice(0, 10);

  const isMe = t => t.name?.includes('Guitlla') || t.name?.includes('🦊');
  const meT = (allTeamsTomaquet || []).find(isMe);
  const meE = (allTeamsEnBas   || []).find(isMe);

  const entryT = {
    date:      today,
    teamValue: meT?.value  || null,
    trend:     meT?.trend  || null,
    pts:       meT?.points || myTeamTomaquet?.points || null,
    pos:       null,
  };
  const standingsT = (allTeamsTomaquet || []).slice().sort((a,b)=>(b.points||0)-(a.points||0));
  const posT = standingsT.findIndex(t => t.name?.includes('🦊') || t.name?.includes('Guitlla'));
  if (posT >= 0) entryT.pos = posT + 1;

  const idxT = history.tomaquet.findIndex(e => e.date === today);
  if (idxT >= 0) history.tomaquet[idxT] = entryT;
  else history.tomaquet.push(entryT);
  if (history.tomaquet.length > MAX_ENTRIES) history.tomaquet = history.tomaquet.slice(-MAX_ENTRIES);

  const entryE = {
    date:      today,
    teamValue: meE?.value  || null,
    trend:     meE?.trend  || null,
    pts:       meE?.points || myTeamEnBas?.points || null,
    pos:       null,
  };
  const standingsE = (allTeamsEnBas || []).slice().sort((a,b)=>(b.points||0)-(a.points||0));
  const posE = standingsE.findIndex(t => t.name?.includes('🦊') || t.name?.includes('Guitlla'));
  if (posE >= 0) entryE.pos = posE + 1;

  const idxE = history.enbas.findIndex(e => e.date === today);
  if (idxE >= 0) history.enbas[idxE] = entryE;
  else history.enbas.push(entryE);
  if (history.enbas.length > MAX_ENTRIES) history.enbas = history.enbas.slice(-MAX_ENTRIES);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  console.log(`📅 history.json — Tomaquet: ${history.tomaquet.length} días (hoy: teamValue=${entryT.teamValue} trend=${entryT.trend}) · EN BAS: ${history.enbas.length} días`);
}

// ─── PLAYER PRICES HISTORY ────────────────────────────────────────────────────

function updatePlayerPrices(players) {
  const FILE      = 'prices.json';
  const MAX_DAYS  = 90;
  const today     = new Date().toISOString().slice(0, 10);

  let prices = {};
  try {
    if (fs.existsSync(FILE)) {
      prices = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    }
  } catch(e) {
    console.warn('⚠️ No se pudo leer prices.json, iniciando desde cero');
  }

  let updated = 0;
  for (const p of players) {
    if (!p.id || !p.price) continue;
    const id = String(p.id);
    if (!prices[id]) prices[id] = [];
    const todayIdx = prices[id].findIndex(e => e.d === today);
    const entry = { d: today, p: p.price };
    if (todayIdx >= 0) {
      prices[id][todayIdx] = entry;
    } else {
      prices[id].push(entry);
      updated++;
    }
    if (prices[id].length > MAX_DAYS) {
      prices[id] = prices[id].slice(-MAX_DAYS);
    }
  }

  fs.writeFileSync(FILE, JSON.stringify(prices), 'utf8');
  console.log(`💰 prices.json — ${Object.keys(prices).length} jugadores · ${updated} nuevas entradas hoy`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

// ─── FOTOS DE JUGADORES ───────────────────────────────────────────────────────
// Descarga las fotos desde cf.biwenger.com (sin CORS en Node.js)
// y las guarda en img/players/ para servirlas desde GitHub Pages

async function downloadPlayerPhotos(players) {
  const DIR = 'img/players';
  if (!fs.existsSync('img'))  fs.mkdirSync('img');
  if (!fs.existsSync(DIR))    fs.mkdirSync(DIR);

  let downloaded = 0, skipped = 0, failed = 0;

  // Función que sigue redirecciones manualmente
  function fetchImage(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = https.request({
        hostname: urlObj.hostname,
        path:     urlObj.pathname + urlObj.search,
        method:   'GET',
        timeout:  8000,
        headers:  {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer':    'https://biwenger.as.com/',
          'Accept':     'image/png,image/jpeg,image/*',
        }
      }, (res) => {
        // Seguir redirecciones (301, 302, 303, 307, 308)
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : `https://${urlObj.hostname}${res.headers.location}`;
          res.resume(); // descartar body
          resolve(fetchImage(redirectUrl, maxRedirects - 1));
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
  }

  // Limpiar archivos corruptos (< 500 bytes) para forzar re-descarga
  if (fs.existsSync(DIR)) {
    const existing = fs.readdirSync(DIR);
    let cleaned = 0;
    existing.forEach(f => {
      const fp = `${DIR}/${f}`;
      if (fs.statSync(fp).size < 500) { fs.unlinkSync(fp); cleaned++; }
    });
    if (cleaned > 0) console.log(`🧹 ${cleaned} fotos corruptas eliminadas`);
  }

  const BATCH = 10;
  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH);
    await Promise.all(batch.map(async p => {
      const file = `${DIR}/${p.id}.png`;
      // Si ya existe y tiene tamaño real (>500 bytes = imagen real), saltar
      if (fs.existsSync(file) && fs.statSync(file).size > 500) {
        skipped++;
        return;
      }
      try {
        const res = await fetchImage(`https://cf.biwenger.com/static/img/players/la-liga/${p.id}.png`);
        if (res.status === 200 && res.data.length > 500) {
          fs.writeFileSync(file, res.data);
          downloaded++;
        } else {
          failed++;
        }
      } catch(e) {
        failed++;
      }
    }));
    if (i + BATCH < players.length) await sleep(100);
  }

  console.log(`🖼️  Fotos jugadores: ${downloaded} descargadas · ${skipped} ya existían · ${failed} fallidas`);
}


async function main() {
  try {
    console.log('🚀 Iniciando fetch — La Pausa Fantasy\n');

    const token   = await login();
    const players = await fetchPlayers();

    console.log('\n--- LIGAS (paralelo) ---');
    const [
      leagueTomaquet, allTeamsTomaquet, myTeamTomaquet,
      leagueEnBas,    allTeamsEnBas,    myTeamEnBas,
      boardTomaquet,  boardEnBas,
      laliga,         news,             playerStats,
    ] = await Promise.all([
      fetchLeague(token, LEAGUE_TOMAQUET),
      fetchAllTeams(token, LEAGUE_TOMAQUET),
      fetchMyTeam(token, LEAGUE_TOMAQUET),
      fetchLeague(token, LEAGUE_ENBAS),
      fetchAllTeams(token, LEAGUE_ENBAS),
      fetchMyTeam(token, LEAGUE_ENBAS),
      fetchBoard(token, LEAGUE_TOMAQUET),
      fetchBoard(token, LEAGUE_ENBAS),
      fetchLaLiga(),
      fetchNews(),
      fetchPlayerStats(),
    ]);

    const output = {
      updatedAt:   new Date().toISOString(),
      players,
      league:      leagueTomaquet,
      allTeams:    allTeamsTomaquet,
      myTeam:      myTeamTomaquet,
      boardTomaquet,
      leagueEnBas,
      allTeamsEnBas,
      myTeamEnBas,
      boardEnBas,
      laliga,
      news,
      playerStats,
    };

    fs.writeFileSync('data.json', JSON.stringify(output, null, 2), 'utf8');
    console.log('\n💾 data.json guardado correctamente');

    updateHistory(myTeamTomaquet, myTeamEnBas, allTeamsTomaquet, allTeamsEnBas, leagueTomaquet, leagueEnBas);
    updatePlayerPrices(players);
    await downloadPlayerPhotos(players);
    console.log(`📊 Jugadores Biwenger: ${players.length}`);
    console.log(`👥 Equipos Tomaquet:   ${allTeamsTomaquet?.length || 0}`);
    console.log(`👥 Equipos EN BAS:     ${allTeamsEnBas?.length || 0}`);
    console.log(`🦊 Mi equipo Tomaquet: ${myTeamTomaquet?.players?.length || 0} jugadores`);
    console.log(`🦊 Mi equipo EN BAS:   ${myTeamEnBas?.players?.length || 0} jugadores`);
    console.log(`📋 Tablón Tomaquet:    ${boardTomaquet?.length || 0} eventos`);
    console.log(`📋 Tablón EN BAS:      ${boardEnBas?.length || 0} eventos`);
    console.log(`📰 Noticias:           ${news.length}`);
    console.log(`⚽ Stats jugadores:    ${playerStats?.players?.length || 0} (football-data)`);

  } catch(err) {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  }
}

main();
