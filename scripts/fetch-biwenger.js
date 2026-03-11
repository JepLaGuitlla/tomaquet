// scripts/fetch-biwenger.js
const https = require('https');
const fs    = require('fs');

const EMAIL          = process.env.BIWENGER_EMAIL;
const PASSWORD       = process.env.BIWENGER_PASSWORD;
const LEAGUE_ID      = '44700';
const USER_ID        = '6541195';
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
  'x-league':        LEAGUE_ID,
  'x-user':          USER_ID,
  'x-version':       VERSION,
};

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
  if (!rawPlayers) { console.error('❌ Sin jugadores en la respuesta'); process.exit(1); }

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

// ─── 3. DATOS DE LIGA (Biwenger) ─────────────────────────────────────────────

async function fetchLeague(token) {
  console.log('🏆 Descargando datos de liga (Biwenger)...');

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     `/api/v2/leagues/${LEAGUE_ID}?fields=*,standings,teams`,
    method:   'GET',
    headers:  { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` }
  });

  if (res.status !== 200) { console.warn('⚠️ No se pudieron obtener datos de liga. Status:', res.status); return null; }

  console.log('✅ Datos de liga descargados');
  return res.body?.data || null;
}

// ─── 4. TODOS LOS EQUIPOS DE LA LIGA ────────────────────────────────────────

async function fetchAllTeams(token) {
  console.log('👥 Descargando equipos de todos los participantes...');

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     `/api/v2/leagues/${LEAGUE_ID}/teams?fields=*,players`,
    method:   'GET',
    headers:  { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` }
  });

  if (res.status !== 200) { console.warn('⚠️ No se pudieron obtener equipos. Status:', res.status); return null; }

  const teams = res.body?.data || [];
  console.log(`✅ ${teams.length} equipos descargados`);

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
      price:    p.price   || 0,
      points:   p.points  || 0,
    })),
  }));
}

// ─── 5. MI EQUIPO (Guitlla) ───────────────────────────────────────────────────

async function fetchMyTeam(token) {
  console.log('🦊 Descargando mi equipo (Guitlla)...');

  const res = await requestJSON({
    hostname: 'biwenger.as.com',
    path:     `/api/v2/leagues/${LEAGUE_ID}/user?fields=*,team,players`,
    method:   'GET',
    headers:  { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` }
  });

  if (res.status !== 200) { console.warn('⚠️ No se pudo obtener mi equipo. Status:', res.status); return null; }

  const data = res.body?.data;
  if (!data) { console.warn('⚠️ Sin datos de mi equipo'); return null; }

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
      price:    p.price            || 0,
      points:   p.points           || 0,
      trend:    p.priceIncrement   || 0,
      status:   p.fitness?.[0]?.status || 'ok',
      jForm:    (p.fitness || []).slice(0, 5).map(f => typeof f === 'number' ? f : (f?.points ?? null)),
      clausula: p.clause           || null,
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
    const scheduled = await fdGet('/competitions/PD/matches?status=SCHEDULED&limit=30');
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

    const allScheduled = scheduled.body?.matches || [];
    const nextMD       = allScheduled.length
      ? Math.min(...allScheduled.map(m => m.matchday).filter(Boolean))
      : null;
    const nextMatches  = nextMD
      ? allScheduled.filter(m => m.matchday === nextMD).map(m => ({
          id:       m.id,
          matchday: m.matchday,
          date:     m.utcDate,
          home:     { id: m.homeTeam.id, name: m.homeTeam.name, short: m.homeTeam.shortName, crest: m.homeTeam.crest },
          away:     { id: m.awayTeam.id, name: m.awayTeam.name, short: m.awayTeam.shortName, crest: m.awayTeam.crest },
        }))
      : [];

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
  const allNews = [];

  for (const src of RSS_SOURCES) {
    try {
      const url = new URL(src.url);
      const res = await request({
        hostname: url.hostname,
        path:     url.pathname + (url.search || ''),
        method:   'GET',
        headers:  {
          'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
          'Accept':     'application/rss+xml, application/xml, text/xml, */*',
        }
      });

      if (res.status !== 200) { console.warn(`⚠️ RSS ${src.id} status ${res.status}`); continue; }

      const xml   = res.raw;
      const items = xml.match(/<item[\s\S]*?<\/item>/g) || [];
      console.log(`  ${src.id}: ${items.length} noticias`);

      items.slice(0, 10).forEach(item => {
        const getTag  = (tag) => {
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

  allNews.sort((a, b) => { try { return new Date(b.date) - new Date(a.date); } catch { return 0; } });
  console.log(`✅ ${allNews.length} noticias descargadas`);
  return allNews;
}

// ─── 8. STATS DE JUGADORES — FBREF ───────────────────────────────────────────
//
//  Una sola request a fbref.com/en/comps/12/stats/La-Liga-Stats
//  Tabla HTML con ~500 jugadores de LaLiga. Sin API key, sin límites.
//  Datos de Opta/StatsBomb: PJ, min, goles, asistencias, xG, xA, tarjetas...

async function fetchFbrefStats() {
  console.log('📊 Descargando estadísticas de jugadores (FBref)...');

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'fbref.com',
      path:     '/en/comps/12/stats/La-Liga-Stats',
      method:   'GET',
      headers:  {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Referer':         'https://fbref.com/',
      }
    }, (res) => {
      // FBref puede redirigir
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        console.log('  → Redirigiendo a:', loc);
        resolve(fetchFbrefRedirect(loc));
        return;
      }

      let html = '';
      res.on('data', c => html += c);
      res.on('end', () => resolve(parseFbrefHtml(html)));
    });
    req.on('error', (e) => { console.warn('⚠️ Error FBref:', e.message); resolve(null); });
    req.end();
  });
}

function fetchFbrefRedirect(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url.startsWith('http') ? url : 'https://fbref.com' + url);
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      }
    }, (res) => {
      let html = '';
      res.on('data', c => html += c);
      res.on('end', () => resolve(parseFbrefHtml(html)));
    });
    req.on('error', (e) => { console.warn('⚠️ Error FBref redirect:', e.message); resolve(null); });
    req.end();
  });
}

function parseFbrefHtml(html) {
  if (!html || html.length < 1000) {
    console.warn('⚠️ FBref: respuesta vacía o demasiado corta');
    return null;
  }

  // La tabla principal es stats_standard — buscar todas las filas <tr>
  // Las filas de datos tienen data-row-index o simplemente <td> con data-stat
  const players = [];

  // Extraer filas de la tabla stats_standard (LaLiga)
  // FBref usa: <td data-stat="player"><a href="...">Nombre</a></td>
  // FBref: la tabla de LaLiga es stats_standard_12 (comp_id=12)
  // Buscar primero el ID específico, luego el genérico como fallback
  let tableIdx = html.indexOf('id="stats_standard_12"');
  if (tableIdx === -1) tableIdx = html.indexOf('id="stats_standard');
  if (tableIdx === -1) {
    // Diagnóstico: mostrar qué IDs hay disponibles
    const allIds = [...html.matchAll(/id="([^"]{0,40})"/g)].map(m => m[1]).filter(id => id.includes('stat') || id.includes('player'));
    console.warn('⚠️ FBref: no se encontró la tabla. IDs disponibles:', allIds.slice(0, 15).join(', '));
    return null;
  }
  const tableEnd = html.indexOf('</table>', tableIdx);
  const table    = html.slice(tableIdx, tableEnd + 8);

  // Extraer filas <tr> manualmente
  const rows = [];
  let pos2 = 0;
  while (true) {
    const trStart = table.indexOf('<tr', pos2);
    if (trStart === -1) break;
    const trEnd = table.indexOf('</tr>', trStart);
    if (trEnd === -1) break;
    rows.push(table.slice(trStart, trEnd + 5));
    pos2 = trEnd + 5;
  }

  rows.forEach(row => {
    // Saltar cabeceras y separadores
    if (row.includes('class="thead"') || row.includes('class="spacer"')) return;

    function getStat(stat) {
      const m = row.match(new RegExp('data-stat="' + stat + '"[^>]*>(?:<[^>]+>)?([^<]*)', 'i'));
      return m ? m[1].trim() : '';
    }

    const name   = getStat('player');
    const team   = getStat('team');
    const pos    = getStat('position');
    const nation = getStat('nationality');
    const age    = getStat('age');

    if (!name || name === 'Player') return; // saltar cabeceras

    const mp      = parseInt(getStat('games'))            || 0;
    const starts  = parseInt(getStat('games_starts'))     || 0;
    const minutes = parseInt(getStat('minutes').replace(',','')) || 0;
    const goals   = parseInt(getStat('goals'))            || 0;
    const assists = parseInt(getStat('assists'))          || 0;
    const xg      = parseFloat(getStat('xg'))             || 0;
    const xag     = parseFloat(getStat('xg_assist'))      || 0;
    const yellow  = parseInt(getStat('cards_yellow'))     || 0;
    const red     = parseInt(getStat('cards_red'))        || 0;
    const shots   = parseInt(getStat('shots_on_target'))  || 0;
    const prgC    = parseInt(getStat('progressive_carries')) || 0;
    const prgP    = parseInt(getStat('progressive_passes'))  || 0;

    players.push({
      name, team, pos, nation,
      age:     age ? parseInt(age) : null,
      mp, starts, minutes,
      goals, assists,
      xg, xag,
      yellowCards: yellow,
      redCards:    red,
      shotsOnTarget: shots,
      progressiveCarries: prgC,
      progressivePasses:  prgP,
      minutesPerGoal: (goals && minutes) ? Math.round(minutes / goals) : null,
    });
  });

  if (!players.length) {
    console.warn('⚠️ FBref: no se parseó ningún jugador');
    return null;
  }

  console.log('✅ FBref: ' + players.length + ' jugadores descargados');
  return {
    source:    'fbref',
    league:    'LaLiga',
    updatedAt: new Date().toISOString(),
    players,
  };
}


// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    console.log('🚀 Iniciando fetch — La Pausa Fantasy\n');

    const token      = await login();
    const players    = await fetchPlayers();
    const league     = await fetchLeague(token);
    const allTeams   = await fetchAllTeams(token);
    const myTeam     = await fetchMyTeam(token);
    const laliga     = await fetchLaLiga();
    const news       = await fetchNews();

    const playerStats = await fetchFbrefStats();

    const output = {
      updatedAt:   new Date().toISOString(),
      players,
      league,
      allTeams,
      myTeam,
      laliga,
      news,
      playerStats,
    };

    fs.writeFileSync('data.json', JSON.stringify(output, null, 2), 'utf8');

    console.log('\n💾 data.json guardado correctamente');
    console.log(`📊 Jugadores Biwenger: ${players.length}`);
    console.log(`👥 Equipos fantasy:    ${allTeams?.length || 0}`);
    console.log(`🦊 Mi equipo:          ${myTeam?.players?.length || 0} jugadores`);
    console.log(`📰 Noticias:           ${news.length}`);
    console.log(`⚽ Stats jugadores:    ${playerStats?.players?.length || 0} (FBref)`);

  } catch(err) {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  }
}

main();
