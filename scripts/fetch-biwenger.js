// scripts/fetch-biwenger.js
const https = require('https');
const fs    = require('fs');

const EMAIL     = process.env.BIWENGER_EMAIL;
const PASSWORD  = process.env.BIWENGER_PASSWORD;
const LEAGUE_ID = '44700';
const USER_ID   = '6541195';
const VERSION   = '630';
const FD_TOKEN  = '00308a91cfc84b248611ecc22550c9de'; // football-data.org

// Feeds RSS de noticias fantasy
const RSS_SOURCES = [
  { id:'jp', label:'Jornada Perfecta', url:'https://www.jornadaperfecta.com/feed/' },
  { id:'as', label:'AS Fantasy',       url:'https://fantasy.as.com/feed/' },
  { id:'cm', label:'Comuniate',        url:'https://www.comuniate.com/feed/' },
  { id:'rv', label:'Relevo Fantasy',   url:'https://www.relevo.com/rss/noticias/' },
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

  if (res.status !== 200) {
    console.error('❌ Error al obtener jugadores. Status:', res.status);
    process.exit(1);
  }

  const match = res.raw.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) {
    console.error('❌ No se pudo parsear la respuesta JSONP');
    process.exit(1);
  }

  const parsed = JSON.parse(match[1]);
  const rawPlayers = parsed?.data?.players;

  if (!rawPlayers) {
    console.error('❌ Sin jugadores en la respuesta');
    process.exit(1);
  }

  const arr = Array.isArray(rawPlayers) ? rawPlayers : Object.values(rawPlayers);
  console.log(`✅ ${arr.length} jugadores descargados`);

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
    jForm:      (p.fitness || []).slice(0, 5).map(f => typeof f === 'number' ? f : (f?.points ?? null)),
    clausula:   p.clause         || null,
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

// ─── 4. TODOS LOS EQUIPOS DE LA LIGA (quién tiene cada jugador) ──────────────
async function fetchAllTeams(token) {
  console.log('👥 Descargando equipos de todos los participantes...');

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path: `/api/v2/leagues/${LEAGUE_ID}/teams?fields=*,players`,
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      'Authorization': `Bearer ${token}`,
    }
  });

  if (res.status !== 200) {
    console.warn('⚠️ No se pudieron obtener equipos. Status:', res.status);
    return null;
  }

  const teams = res.body?.data || [];
  console.log(`✅ ${teams.length} equipos descargados`);

  // Devuelve array de equipos con sus jugadores (solo IDs para no duplicar datos)
  return teams.map(t => ({
    id:      t.id,
    name:    t.name,
    manager: t.manager?.name || t.name,
    points:  t.points || 0,
    value:   t.teamValue || 0,
    players: (t.players || []).map(p => ({
      id:       p.id,
      name:     p.name,
      position: p.position,
      price:    p.price || 0,
      points:   p.points || 0,
    })),
  }));
}

// ─── 5. MI EQUIPO (Guitlla) ──────────────────────────────────────────────────
async function fetchMyTeam(token) {
  console.log('🦊 Descargando mi equipo (Guitlla)...');

  // Primero obtenemos el ID del equipo del usuario en la liga
  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path: `/api/v2/leagues/${LEAGUE_ID}/user?fields=*,team,players`,
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      'Authorization': `Bearer ${token}`,
    }
  });

  if (res.status !== 200) {
    console.warn('⚠️ No se pudo obtener mi equipo. Status:', res.status);
    return null;
  }

  const data = res.body?.data;
  if (!data) {
    console.warn('⚠️ Sin datos de mi equipo');
    return null;
  }

  const players = data.team?.players || data.players || [];
  console.log(`✅ Mi equipo: ${players.length} jugadores`);

  return {
    teamId:  data.team?.id || null,
    name:    data.team?.name || 'Guitlla',
    points:  data.team?.points || 0,
    value:   data.team?.teamValue || 0,
    players: players.map(p => ({
      id:       p.id,
      name:     p.name,
      position: p.position,
      price:    p.price || 0,
      points:   p.points || 0,
      trend:    p.priceIncrement || 0,
      status:   p.fitness?.[0]?.status || 'ok',
      jForm:    (p.fitness || []).slice(0, 5).map(f => typeof f === 'number' ? f : (f?.points ?? null)),
      clausula: p.clause || null,
    })),
  };
}

// ─── 6. LA LIGA (football-data.org) ─────────────────────────────────────────
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

    if (!standings.ok) {
      console.warn('⚠️ No se pudo obtener clasificación.');
      return null;
    }

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
          id: m.id,
          matchday: m.matchday,
          date: m.utcDate,
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

// ─── 7. NOTICIAS RSS (sin CORS, desde Node) ──────────────────────────────────
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

      if (res.status !== 200) {
        console.warn(`⚠️ RSS ${src.id} status ${res.status}`);
        continue;
      }

      // Parse XML manual (sin dependencias externas)
      const xml = res.raw;
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

        if (title && link) {
          allNews.push({
            title,
            link,
            date,
            img,
            srcId:    src.id,
            srcLabel: src.label,
          });
        }
      });

    } catch(e) {
      console.warn(`⚠️ Error RSS ${src.id}:`, e.message);
    }
  }

  // Ordenar por fecha descendente
  allNews.sort((a, b) => {
    try { return new Date(b.date) - new Date(a.date); } catch(e) { return 0; }
  });

  console.log(`✅ ${allNews.length} noticias descargadas en total`);
  return allNews;
}

// ─── 8. SOFASCORE — ESTADÍSTICAS REALES DE JUGADORES ─────────────────────────
async function fetchSofascoreStats() {
  console.log('📊 Descargando estadísticas de Sofascore...');

  const SS_BASE = 'www.sofascore.com';
  const TOURNAMENT_ID = 8; // LaLiga
  const DELAY = 1200; // ms entre llamadas para no triggear Cloudflare

  const ssHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Referer': 'https://www.sofascore.com/football/spain/laliga/statistics',
    'Origin': 'https://www.sofascore.com',
    'Cache-Control': 'no-cache',
  };

  function ssGet(path) {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: SS_BASE,
        path: `/api/v1${path}`,
        method: 'GET',
        headers: ssHeaders,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ ok: res.statusCode === 200, body: JSON.parse(data), status: res.statusCode }); }
          catch(e) { resolve({ ok: false, body: {}, status: res.statusCode }); }
        });
      });
      req.on('error', () => resolve({ ok: false, body: {}, status: 0 }));
      req.end();
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  try {
    // 1. Obtener season ID actual de LaLiga
    const seasonsRes = await ssGet(`/unique-tournament/${TOURNAMENT_ID}/seasons`);
    if (!seasonsRes.ok) {
      console.warn('⚠️ Sofascore: no se pudo obtener seasons. Status:', seasonsRes.status);
      return null;
    }

    const seasons = seasonsRes.body?.seasons || [];
    // El primero suele ser el más reciente
    const currentSeason = seasons[0];
    if (!currentSeason) {
      console.warn('⚠️ Sofascore: no hay seasons disponibles');
      return null;
    }

    const seasonId = currentSeason.id;
    console.log(`  Season: ${currentSeason.name} (ID: ${seasonId})`);
    await sleep(DELAY);

    // 2. Descargar stats por páginas (100 jugadores por página)
    const STATS_FIELDS = 'goals,assists,yellowCards,redCards,minutesPlayed,appearances,accuratePasses,rating,saves,cleanSheets,goalsPrevented,successfulDribbles,tackles,interceptions,shotsOnTarget,totalShots,matchesStarted,substituteIn';
    const allStats = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const path = `/unique-tournament/${TOURNAMENT_ID}/season/${seasonId}/statistics/player?limit=${limit}&offset=${offset}&order=-rating&fields=${STATS_FIELDS}&filters=position.in.G~D~M~F`;
      const res = await ssGet(path);

      if (!res.ok) {
        console.warn(`⚠️ Sofascore stats offset ${offset}: status ${res.status}`);
        break;
      }

      const results = res.body?.results || [];
      if (!results.length) { hasMore = false; break; }

      results.forEach(r => {
        const p = r.player || {};
        const t = r.team || {};
        allStats.push({
          sfId:         p.id,
          name:         p.name || '',
          shortName:    p.shortName || p.name || '',
          position:     p.position || '',
          teamName:     t.name || '',
          // Stats principales
          rating:       r.rating        || null,
          appearances:  r.appearances   || 0,
          started:      r.matchesStarted || 0,
          minutes:      r.minutesPlayed  || 0,
          goals:        r.goals          || 0,
          assists:      r.assists        || 0,
          yellowCards:  r.yellowCards    || 0,
          redCards:     r.redCards       || 0,
          // Porteros
          saves:        r.saves          || 0,
          cleanSheets:  r.cleanSheets    || 0,
          goalsPrevented: r.goalsPrevented || null,
          // Extras
          shotsOnTarget:  r.shotsOnTarget  || 0,
          totalShots:     r.totalShots     || 0,
          dribbles:       r.successfulDribbles || 0,
          tackles:        r.tackles        || 0,
          // Calculados
          minutesPerGoal: (r.goals && r.minutesPlayed) ? Math.round(r.minutesPlayed / r.goals) : null,
          subsIn:         (r.appearances || 0) - (r.matchesStarted || 0),
        });
      });

      console.log(`  Sofascore: ${allStats.length} jugadores cargados (offset ${offset})`);
      offset += limit;

      // Si devuelve menos de limit, ya no hay más
      if (results.length < limit) hasMore = false;
      else await sleep(DELAY);
    }

    console.log(`✅ Sofascore: ${allStats.length} jugadores con estadísticas`);
    return { seasonId, seasonName: currentSeason.name, players: allStats };

  } catch(e) {
    console.warn('⚠️ Error en Sofascore:', e.message);
    return null;
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  try {
    const token    = await login();
    const players  = await fetchPlayers();
    const league   = await fetchLeague(token);
    const allTeams = await fetchAllTeams(token);
    const myTeam   = await fetchMyTeam(token);
    const laliga   = await fetchLaLiga();
    const news     = await fetchNews();
    const sofascore = await fetchSofascoreStats();

    const output = {
      updatedAt: new Date().toISOString(),
      players,
      league,
      allTeams,
      myTeam,
      laliga,
      news,
      sofascore,
    };

    fs.writeFileSync('data.json', JSON.stringify(output, null, 2), 'utf8');
    console.log('💾 data.json guardado correctamente');
    console.log(`📊 ${players.length} jugadores | equipos: ${allTeams?.length || 0} | mi equipo: ${myTeam?.players?.length || 0} | noticias: ${news.length} | sofascore: ${sofascore?.players?.length || 0} stats`);

  } catch (err) {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  }
}

main();
