// scripts/fetch-biwenger.js
const https = require('https');
const fs    = require('fs');

const EMAIL           = process.env.BIWENGER_EMAIL;
const PASSWORD        = process.env.BIWENGER_PASSWORD;
const LEAGUE_TOMAQUET = { id: '44700',   userId: '6541195'  };
const LEAGUE_ENBAS    = { id: '1248640', userId: '11504267' };
const VERSION         = '630';
const FD_TOKEN        = '00308a91cfc84b248611ecc22550c9de'; // football-data.org

// Feeds RSS de noticias fantasy — solo JP funciona (as/cm/rv dan error)
const RSS_SOURCES = [
  { id:'jp', label:'Jornada Perfecta', url:'https://www.jornadaperfecta.com/feed/' },
];

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

function headersForLeague(liga) {
  return {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Origin':          'https://biwenger.as.com',
    'Referer':         'https://biwenger.as.com/',
    'x-league':        liga.id,
    'x-user':          liga.userId,
    'x-version':       VERSION,
  };
}
const LOGIN_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Origin':          'https://biwenger.as.com',
  'Referer':         'https://biwenger.as.com/',
  'x-league':        LEAGUE_TOMAQUET.id,
  'x-user':          LEAGUE_TOMAQUET.userId,
  'x-version':       VERSION,
};

// ─── 1. LOGIN ────────────────────────────────────────────────────────────────
async function login() {
  console.log('🔐 Login en Biwenger...');
  const payload = JSON.stringify({ email: EMAIL, password: PASSWORD });

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path: '/api/v2/auth/login',
    method: 'POST',
    headers: {
      ...LOGIN_HEADERS,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    }
  }, payload);

  if (res.status !== 200) { console.error('❌ Login fallido. Status:', res.status); process.exit(1); }

  const token = res.body?.data?.token || res.body?.token;
  if (!token) { console.error('❌ No se encontró token'); process.exit(1); }

  console.log('✅ Login correcto');
  return token;
}

// ─── 2. TODOS LOS JUGADORES via JSONP ────────────────────────────────────────
async function fetchPlayers() {
  console.log('📥 Descargando jugadores de LaLiga (Biwenger)...');

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

  if (res.status !== 200) { console.error('❌ Error jugadores. Status:', res.status); process.exit(1); }

  const match = res.raw.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) { console.error('❌ No se pudo parsear JSONP'); process.exit(1); }

  const parsed = JSON.parse(match[1]);
  const rawPlayers = parsed?.data?.players;
  if (!rawPlayers) { console.error('❌ Sin jugadores'); process.exit(1); }

  const arr = Array.isArray(rawPlayers) ? rawPlayers : Object.values(rawPlayers);
  console.log(`✅ ${arr.length} jugadores descargados`);

  return arr.map(p => ({
    id:         Number(p.id),
    name:       p.name,
    position:   p.position,
    position2:  p.position2 || null,
    price:      p.price          || 0,
    points:     p.points         || 0,
    trend:      p.priceIncrement || 0,
    playedHome: p.playedHome     || 0,
    playedAway: p.playedAway     || 0,
    teamName:   p.teamName       || p.team?.name || '',
    status:     p.status         || 'ok',   // FIX: campo directo, no p.fitness[0].status
    jForm:      (p.fitness || []).slice(0, 5).map(f => {
      if (typeof f === 'number') return f;
      if (typeof f === 'string') return f;
      if (f && typeof f === 'object') return f.points ?? f.status ?? null;
      return null;
    }),
    clausula:   p.clause || null,
  }));
}

// ─── 3. DATOS DE LIGA ────────────────────────────────────────────────────────
async function fetchLeague(token, liga) {
  console.log(`🏆 Descargando datos de liga ${liga.id} (Biwenger)...`);

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path: `/api/v2/league?include=all,-lastAccess&fields=*,standings,tournaments,group,settings(description)`,
    method: 'GET',
    headers: { ...headersForLeague(liga), 'Authorization': `Bearer ${token}`, 'x-lang': 'es' }
  });

  if (res.status !== 200) {
    console.warn(`⚠️ Liga ${liga.id} falló. Status:`, res.status);
    return null;
  }

  console.log(`✅ Liga ${liga.id} descargada`);
  return res.body?.data || null;
}

// ─── 4. TODOS LOS EQUIPOS DE LA LIGA ─────────────────────────────────────────
async function fetchAllTeams(token, liga) {
  console.log(`👥 Descargando equipos liga ${liga.id}...`);

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path: `/api/v2/league?include=all&fields=*,standings,tournaments,group,settings(description)`,
    method: 'GET',
    headers: { ...headersForLeague(liga), 'Authorization': `Bearer ${token}`, 'x-lang': 'es' }
  });

  if (res.status !== 200) {
    console.warn(`⚠️ Equipos liga ${liga.id} fallaron. Status:`, res.status);
    return null;
  }

  const data  = res.body?.data;
  const teams = data?.standings || [];
  console.log(`✅ ${teams.length} equipos descargados (liga ${liga.id})`);

  return teams.map(t => ({
    id:      t.id,
    name:    t.name,
    manager: t.manager?.name || t.name,
    points:  t.points    || 0,
    value:   t.teamValue || 0,
    players: (t.players || []).map(p => ({
      id:       Number(p.id),
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
    path: `/api/v2/user?fields=*,lineup(type,playersID,reservesID,captain,striker,coach,date),players(id,owner),market,offers,-trophies`,
    method: 'GET',
    headers: {
      ...headersForLeague(liga),
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json; charset=utf-8',
      'x-lang':        'es',
    }
  });

  if (res.status !== 200) {
    console.warn(`⚠️ Mi equipo liga ${liga.id} falló. Status:`, res.status);
    return null;
  }

  const data = res.body?.data;
  if (!data) { console.warn('⚠️ Sin datos de mi equipo'); return null; }

  const playerRefs = data.players || [];
  console.log(`✅ Mi equipo: ${playerRefs.length} jugadores, presupuesto: ${data.balance || 0}`);

  return {
    teamId:  data.id     || null,
    name:    data.name   || 'Guitlla',
    points:  data.points || 0,
    balance: data.balance || 0,
    lineup:  data.lineup  || {},
    players: playerRefs.map(p => ({
      id:       Number(p.id),
      clause:   p.owner?.clause   || 0,
      invested: p.owner?.invested || 0,
      buyDate:  p.owner?.date     || 0,
    })),
    market: (data.market || []).map(m => ({
      playerID: m.playerID,
      price:    m.price,
      type:     m.type,
      until:    m.until,
    })),
  };
}

// ─── 6. TABLÓN DE LIGA ────────────────────────────────────────────────────────
async function fetchBoard(token, liga) {
  console.log(`📋 Descargando tablón liga ${liga.id}...`);
  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path: '/api/v2/home',
    method: 'GET',
    headers: { ...headersForLeague(liga), 'Authorization': `Bearer ${token}`, 'x-lang': 'es' }
  });
  if (res.status !== 200) {
    console.warn(`⚠️ Board liga ${liga.id}: status ${res.status}`);
    return [];
  }
  const board  = res.body?.data?.league?.board || [];
  const events = board
    .filter(e => e.type === 'transfer' || e.type === 'market')
    .map(e => ({ type: e.type, date: e.date, content: e.content }));
  console.log(`✅ Tablón liga ${liga.id}: ${events.length} eventos`);
  return events;
}

// ─── 7. LA LIGA (football-data.org) ──────────────────────────────────────────
async function fetchLaLiga() {
  console.log('⚽ Descargando datos de La Liga (football-data.org)...');

  async function fdGet(path) {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.football-data.org',
        path: `/v4${path}`,
        method: 'GET',
        headers: { 'X-Auth-Token': FD_TOKEN }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ ok: res.statusCode === 200, body: JSON.parse(data) }); }
          catch(e) { resolve({ ok: false, body: {} }); }
        });
      });
      req.on('error', () => resolve({ ok: false, body: {} }));
      req.end();
    });
  }

  try {
    const standings = await fdGet('/competitions/PD/standings');
    await new Promise(r => setTimeout(r, 700));
    const scheduled = await fdGet('/competitions/PD/matches?status=SCHEDULED&limit=30');
    await new Promise(r => setTimeout(r, 700));
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
        const f = forms[team.id];
        if (f.results.length < 5) {
          const scored  = idx === 0 ? hg : ag;
          const concede = idx === 0 ? ag : hg;
          f.results.push(scored > concede ? 'W' : scored < concede ? 'L' : 'D');
          f.gf += scored;
          f.ga += concede;
        }
      });
    });

    const allScheduled = scheduled.body?.matches || [];
    const nextMD = allScheduled.length
      ? Math.min(...allScheduled.map(m => m.matchday).filter(Boolean))
      : null;
    const nextMatches = nextMD
      ? allScheduled.filter(m => m.matchday === nextMD).map(m => ({
          id: m.id, matchday: m.matchday, date: m.utcDate,
          home: { id: m.homeTeam.id, name: m.homeTeam.name, short: m.homeTeam.shortName, crest: m.homeTeam.crest },
          away: { id: m.awayTeam.id, name: m.awayTeam.name, short: m.awayTeam.shortName, crest: m.awayTeam.crest },
        }))
      : [];

    const recentResults = sortedMatches.slice(0, 8).map(m => ({
      date: m.utcDate,
      home: { name: m.homeTeam.name, short: m.homeTeam.shortName, crest: m.homeTeam.crest },
      away: { name: m.awayTeam.name, short: m.awayTeam.shortName, crest: m.awayTeam.crest },
      score: { home: m.score?.fullTime?.home, away: m.score?.fullTime?.away }
    }));

    console.log(`✅ La Liga: ${table.length} equipos, jornada ${matchday}, ${nextMatches.length} próximos`);
    return { matchday, table, forms, nextMatches, recentResults };

  } catch(e) {
    console.warn('⚠️ Error en football-data:', e.message);
    return null;
  }
}

// ─── 8. NOTICIAS RSS ─────────────────────────────────────────────────────────
async function fetchNews() {
  console.log('📰 Descargando noticias RSS...');
  const allNews = [];

  for (const src of RSS_SOURCES) {
    try {
      const url = new URL(src.url);
      const res = await request({
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        }
      });

      if (res.status !== 200) { console.warn(`⚠️ RSS ${src.id} status ${res.status}`); continue; }

      const xml   = res.raw;
      const items = xml.match(/<item[\s\S]*?<\/item>/g) || [];
      console.log(`  ${src.id}: ${items.length} noticias`);

      items.slice(0, 10).forEach(item => {
        const getTag = (tag) => {
          const m = item.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
          return m ? m[1].trim() : '';
        };
        const getAttr = (tag, attr) => {
          const m = item.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i'));
          return m ? m[1] : '';
        };

        const title = getTag('title');
        const link  = getTag('link') || getAttr('link', 'href');
        const date  = getTag('pubDate') || getTag('dc:date') || '';
        const img   = getAttr('enclosure', 'url') ||
                      getAttr('media:content', 'url') ||
                      (item.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || '';

        if (title && link) allNews.push({ title, link, date, img, srcId: src.id, srcLabel: src.label });
      });

    } catch(e) {
      console.warn(`⚠️ Error RSS ${src.id}:`, e.message);
    }
  }

  allNews.sort((a, b) => { try { return new Date(b.date) - new Date(a.date); } catch(e) { return 0; } });
  console.log(`✅ ${allNews.length} noticias descargadas`);
  return allNews;
}

// ─── 9. ESTADÍSTICAS JUGADORES (football-data.org scorers) ───────────────────
async function fetchPlayerStats() {
  console.log('📊 Descargando estadísticas de jugadores (football-data.org)...');
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.football-data.org',
      path: '/v4/competitions/PD/scorers?limit=100',
      method: 'GET',
      headers: { 'X-Auth-Token': FD_TOKEN }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          const scorers = (body.scorers || []).map(s => ({
            name:     s.player?.name || '',
            teamName: s.team?.name   || '',
            goals:    s.goals        || 0,
            assists:  s.assists      || 0,
            penalties: s.penalties   || 0,
          }));
          console.log(`✅ football-data scorers: ${scorers.length} jugadores`);
          resolve(scorers);
        } catch(e) {
          console.warn('⚠️ Error parseando scorers');
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    console.log('🚀 Iniciando fetch — La Pausa Fantasy');
    const token = await login();

    console.log('📥 Descargando jugadores de LaLiga (Biwenger)...');
    const players = await fetchPlayers();

    console.log('\n--- TOMAQUET ---');
    const league        = await fetchLeague(token, LEAGUE_TOMAQUET);
    const allTeams      = await fetchAllTeams(token, LEAGUE_TOMAQUET);
    const myTeam        = await fetchMyTeam(token, LEAGUE_TOMAQUET);

    console.log('\n--- EN BAS ---');
    const leagueEnBas   = await fetchLeague(token, LEAGUE_ENBAS);
    const allTeamsEnBas = await fetchAllTeams(token, LEAGUE_ENBAS);
    const myTeamEnBas   = await fetchMyTeam(token, LEAGUE_ENBAS);

    console.log('\n--- TABLONES ---');
    const boardTomaquet = await fetchBoard(token, LEAGUE_TOMAQUET);
    const boardEnBas    = await fetchBoard(token, LEAGUE_ENBAS);

    const laliga      = await fetchLaLiga();
    const news        = await fetchNews();
    const playerStats = await fetchPlayerStats();

    const output = {
      updatedAt: new Date().toISOString(),
      players,
      league,
      allTeams,
      myTeam,
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
    console.log('💾 data.json guardado correctamente');
    console.log(`📊 Jugadores Biwenger: ${players.length}`);
    console.log(`👥 Equipos Tomaquet:   ${allTeams?.length || 0}`);
    console.log(`👥 Equipos EN BAS:     ${allTeamsEnBas?.length || 0}`);
    console.log(`🦊 Mi equipo Tomaquet: ${myTeam?.players?.length || 0} jugadores`);
    console.log(`🦊 Mi equipo EN BAS:   ${myTeamEnBas?.players?.length || 0} jugadores`);
    console.log(`📋 Tablón Tomaquet:    ${boardTomaquet?.length || 0} eventos`);
    console.log(`📋 Tablón EN BAS:      ${boardEnBas?.length || 0} eventos`);
    console.log(`📰 Noticias:           ${news.length}`);
    console.log(`⚽ Stats jugadores:    ${playerStats.length} (football-data)`);

    // ── Acumular history.json ─────────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    let history = { tomaquet: [], enbas: [] };
    try { history = JSON.parse(fs.readFileSync('history.json', 'utf8')); } catch(e) {}

    function calcTeamStats(myTeamData, allPlayersList) {
      if (!myTeamData?.players) return { teamValue: 0, trend: 0, pts: 0 };
      let teamValue = 0, trend = 0, pts = 0;
      myTeamData.players.forEach(ref => {
        const p = allPlayersList.find(x => Number(x.id) === Number(ref.id));
        if (p) { teamValue += p.price || 0; trend += p.trend || 0; pts += p.points || 0; }
      });
      return { teamValue, trend, pts };
    }

    function getPos(standings) {
      const sorted = [...(standings||[])].sort((a,b) => (b.points||0) - (a.points||0));
      const idx = sorted.findIndex(t => t.name?.includes('Guitlla') || t.name?.includes('🦊'));
      return idx >= 0 ? idx + 1 : null;
    }

    const statsT  = calcTeamStats(myTeam,      players);
    const statsEB = calcTeamStats(myTeamEnBas, players);
    const posT    = getPos(allTeams);
    const posEB   = getPos(allTeamsEnBas);

    if (!history.tomaquet.find(e => e.date === today)) {
      history.tomaquet.push({ date: today, teamValue: statsT.teamValue, trend: statsT.trend, pts: statsT.pts, pos: posT });
    }
    if (!history.enbas.find(e => e.date === today)) {
      history.enbas.push({ date: today, teamValue: statsEB.teamValue, trend: statsEB.trend, pts: statsEB.pts, pos: posEB });
    }

    if (history.tomaquet.length > 120) history.tomaquet = history.tomaquet.slice(-120);
    if (history.enbas.length    > 120) history.enbas    = history.enbas.slice(-120);

    fs.writeFileSync('history.json', JSON.stringify(history, null, 2), 'utf8');
    console.log('💾 history.json actualizado');

  } catch (err) {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  }
}

main();
