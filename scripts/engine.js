// engine.js — Motor analítico de La Pausa Fantasy
// Funciones de cálculo puro. Sin DOM. Sin render.
// Depende de: allPlayers, ligaData (globales), window._pricesData, window._jornadasData

'use strict';

// ─── HELPERS DE PRECIO ───────────────────────────────────────────────────────

function getPriceRange(price) {
  const m = price / 1000000;
  if (m < 0.15) return null;
  if (m < 1)    return '0.15-1M';
  if (m < 3)    return '1-3M';
  if (m < 6)    return '3-6M';
  if (m < 12)   return '6-12M';
  return '+12M';
}

// ─── EFICIENCIA ──────────────────────────────────────────────────────────────

function calcMediaEsperada(players) {
  const grupos = {};
  players.forEach(p => {
    const pos   = (p.position || p.pos || '').split('/')[0];
    const rango = getPriceRange(p.price);
    if (!pos || !rango) return;
    const jForm = (p.jForm || []).filter(v => v !== null && v !== undefined && v >= 0);
    if (jForm.length < 5) return;
    const media = jForm.reduce((s,v) => s+v, 0) / jForm.length;
    const key = `${pos}_${rango}`;
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(media);
  });
  const medias = {};
  Object.entries(grupos).forEach(([key, vals]) => {
    medias[key] = vals.reduce((s,v) => s+v, 0) / vals.length;
  });
  return medias;
}

function calcEficiencia(player, mediasEsperadas) {
  const pos   = (player.position || player.pos || '').split('/')[0];
  const rango = getPriceRange(player.price);
  if (!pos || !rango) return null;
  const jForm = (player.jForm || []).filter(v => v !== null && v !== undefined && v >= 0);
  if (jForm.length < 5) return null;
  const mediaReal = jForm.reduce((s,v) => s+v, 0) / jForm.length;
  const key = `${pos}_${rango}`;
  const mediaEsperada = mediasEsperadas[key];
  if (!mediaEsperada || mediaEsperada === 0) return null;
  return Math.round(((mediaReal - mediaEsperada) / mediaEsperada) * 100);
}

// Cache — se calcula una vez al cargar jugadores
let _mediasEsperadas = null;
function getMediasEsperadas() {
  if (!_mediasEsperadas) _mediasEsperadas = calcMediaEsperada(allPlayers);
  return _mediasEsperadas;
}

// ─── PRECIO JUSTO ────────────────────────────────────────────────────────────
// Curva gaussiana continua σ=2M€. Compara contra todos de misma posición
// ponderando por proximidad de precio.
// precio_justo = media_real × (precio_medio_ponderado / media_media_ponderada)

const SIGMA_M = 2.0;

let _precioJustoCache = null;

// Pesos degradados para jForm — la jornada más reciente pesa más
const JFORM_PESOS = [1.0, 0.8, 0.6, 0.4, 0.2];

// Calcula la media real combinando:
// 60% media de temporada (pts/pj) — estable
// 40% jForm con degradado — captura forma reciente sin cliff effect
function calcMediaReal(player) {
  const pj = (player.playedHome || 0) + (player.playedAway || 0);
  const mediaTemporada = pj > 0 ? (player.pts || 0) / pj : null;

  const jForm = (player.jForm || []).slice(0, 5);
  const validos = jForm.map((v, i) => ({ v, peso: JFORM_PESOS[i] }))
    .filter(x => x.v !== null && x.v !== undefined && x.v >= 0);

  if (validos.length < 3) return mediaTemporada; // fallback a media temporada

  const sumPesos = validos.reduce((s, x) => s + x.peso, 0);
  const mediaJForm = validos.reduce((s, x) => s + x.v * x.peso, 0) / sumPesos;

  if (mediaTemporada === null) return mediaJForm;

  // 60% temporada + 40% jForm ponderado
  return mediaTemporada * 0.6 + mediaJForm * 0.4;
}

function calcPrecioJusto(player) {
  const pos = (player.position || player.pos || '').split('/')[0];
  if (!pos || pos === 'MD' || pos === '?') return null;
  if (!player.price || player.price < 500000) return null;

  const mediaReal = calcMediaReal(player);
  if (!mediaReal || mediaReal <= 0) return null;

  const precioM = player.price / 1e6;

  const candidatos = allPlayers.filter(p => {
    if (p.id === player.id) return false;
    const pPos = (p.position || p.pos || '').split('/')[0];
    if (pPos !== pos) return false;
    if (!p.price || p.price < 1e6) return false;
    const med = calcMediaReal(p);
    return med !== null && med > 0;
  });

  if (candidatos.length < 3) return null;

  let sumPesosPrecio = 0, sumPesosMedia = 0, sumPesos = 0;
  candidatos.forEach(p => {
    const pM  = p.price / 1e6;
    const med = calcMediaReal(p);
    if (!med || med <= 0) return;
    const dist = Math.abs(pM - precioM);
    const peso = Math.exp(-(dist * dist) / (2 * SIGMA_M * SIGMA_M));
    sumPesosPrecio += pM  * peso;
    sumPesosMedia  += med * peso;
    sumPesos       += peso;
  });

  if (sumPesos < 0.1 || sumPesosMedia < 0.01) return null;

  const precioMedioPond  = sumPesosPrecio / sumPesos;
  const mediaMediaPond   = sumPesosMedia  / sumPesos;
  const ratioPrecioMedia = precioMedioPond / mediaMediaPond;
  const precioJusto      = Math.round(mediaReal * ratioPrecioMedia * 1e6);
  const difEuros         = precioJusto - player.price;
  const difPct           = Math.round((difEuros / player.price) * 100);

  return {
    precioJusto,
    difEuros,
    difPct,
    mediaReal: Math.round(mediaReal * 10) / 10,
    ratioPrecioMedia: Math.round(ratioPrecioMedia * 100) / 100,
    n: candidatos.length,
  };
}

function getGruposParaPrecioJusto()  { return {}; }
function calcGruposParaPrecioJusto() { return {}; }

// ─── ESTADO DE MERCADO ───────────────────────────────────────────────────────
// Cruza infravaloración con reacción del mercado (prices.json)
// Devuelve: { estado, icono, label, desc, colorFondo, colorTexto } | null

function calcEstadoMercado(player) {
  if (!player.price || player.price < 150000) return null;

  const jForm = (player.jForm || []).slice(0, 5);

  // Distinción clave:
  // null = no jugó por sanción/lesión/duda (justificado)
  // 0    = no jugó por decisión técnica (señal negativa)
  const ultimaJ     = jForm[0];
  const penultimaJ  = jForm[1];
  const ultimas2SinJugar = (ultimaJ === null || ultimaJ === undefined || ultimaJ === 0) &&
                           (penultimaJ === null || penultimaJ === undefined || penultimaJ === 0);
  const ultimaDecisionTecnica = ultimaJ === 0; // 0 exacto = banquillo por decisión técnica

  // 🚨 VENTA OBLIGATORIA — sin jugar 2J + precio bajando
  if (ultimas2SinJugar && player.trend < 0) {
    return {
      estado: 'venta', icono: '🚨', label: 'VENTA OBLIGATORIA',
      desc: `Sin jugar las últimas 2 jornadas y el precio sigue bajando (▼${Math.abs(Math.round(player.trend/1000))}K€ hoy). Vende antes de que siga cayendo.`,
      colorFondo: 'rgba(239,68,68,0.15)', colorTexto: '#ef4444',
    };
  }

  // 👁️ DESPERTAR — sin jugar 2J (null = lesión/sanción) pero mercado sube
  // No aplica si la última fue decisión técnica (0)
  if (ultimas2SinJugar && !ultimaDecisionTecnica && player.trend > 10000) {
    return {
      estado: 'despertar', icono: '👁️', label: 'DESPERTAR',
      desc: `Sin jugar las últimas 2 jornadas pero el mercado empieza a moverse (▲${Math.round(player.trend/1000)}K€ hoy). El mercado anticipa su vuelta antes que las puntuaciones.`,
      colorFondo: 'rgba(168,85,247,0.1)', colorTexto: '#a855f7',
    };
  }

  // Filtros para señales positivas
  // 1. Si la última jornada fue decisión técnica (0) → no hay señal positiva posible
  if (ultimaDecisionTecnica) return null;

  const jornadasConPuntos = jForm.filter(v => v !== null && v !== undefined && v > 0).length;
  if (jornadasConPuntos < 3) return null;

  // 2. Media mínima absoluta de 3 pts/J — null cuenta como 0, no se ignora
  const mediaJForm = jForm.length > 0
    ? jForm.map(v => (v === null || v === undefined) ? 0 : v).reduce((s,v) => s+v, 0) / jForm.length
    : 0;
  if (mediaJForm < 3) return null;

  const statusOk = !player.status || player.status === 'ok' || player.status === 1 || player.status === '' || player.status === 'doubt';
  if (!statusOk) return null;

  const efic = calcEficiencia(player, getMediasEsperadas()); // puede ser null

  const pj      = calcPrecioJusto(player);
  const precioM = player.price / 1e6;

  // Momentum de mercado
  const priceHistory = (window._pricesData || {})[String(player.id)] || [];
  let mom7 = 0, diasSubiendo = 0;

  if (priceHistory.length >= 2) {
    const last  = priceHistory[priceHistory.length - 1]?.p || player.price;
    const prev7 = priceHistory[Math.max(0, priceHistory.length - 8)]?.p || last;
    mom7 = prev7 > 0 ? ((last - prev7) / prev7) * 100 : 0;
    for (let i = priceHistory.length - 1; i > 0; i--) {
      if ((priceHistory[i]?.p || 0) > (priceHistory[i-1]?.p || 0)) diasSubiendo++;
      else if ((priceHistory[i]?.p || 0) < (priceHistory[i-1]?.p || 0)) { break; }
      else break;
    }
  } else {
    mom7 = player.trend > 0 ? (player.trend / player.price) * 100 * 5 : 0;
    diasSubiendo = player.trend > 0 ? 1 : 0;
  }

  // Umbrales adaptativos por precio
  let umbralDormido, umbralReaccionando;
  if      (precioM < 0.5)  { umbralDormido = 25;  umbralReaccionando = 80; }
  else if (precioM < 1.0)  { umbralDormido = 15;  umbralReaccionando = 60; }
  else if (precioM < 1.5)  { umbralDormido = 10;  umbralReaccionando = 50; }
  else if (precioM < 2.0)  { umbralDormido = 8;   umbralReaccionando = 40; }
  else if (precioM < 5.0)  { umbralDormido = 3;   umbralReaccionando = 25; }
  else if (precioM < 15.0) { umbralDormido = 1.5; umbralReaccionando = 15; }
  else                     { umbralDormido = 0.8;  umbralReaccionando = 8;  }

  const mercadoDormido      = mom7 < umbralDormido;
  const mercadoReaccionando = mom7 >= umbralReaccionando;

  const margenPJ           = pj ? ((pj.precioJusto - player.price) / player.price) * 100 : null;
  const hayMargen          = margenPJ !== null && margenPJ > 30;
  const estaCaroRespectoPJ = margenPJ !== null && margenPJ < -20;

  const recientes  = jForm.slice(0, 2).filter(v => v !== null && v !== undefined);
  const anteriores = jForm.slice(2, 5).filter(v => v !== null && v !== undefined);
  const mediaRec   = recientes.length  ? recientes.reduce((s,v)=>s+v,0)  / recientes.length  : 0;
  const mediaAnt   = anteriores.length ? anteriores.reduce((s,v)=>s+v,0) / anteriores.length : 0;
  const mejorando  = mediaRec > mediaAnt * 1.2;

  // 🎭 HYPE — precio caro respecto al justo + mercado reaccionando
  // O subida extrema (>2x umbral) con eficiencia baja o nula
  if (mercadoReaccionando && (
    estaCaroRespectoPJ ||
    (efic !== null && efic < 5) ||
    (efic === null && mom7 > umbralReaccionando * 2)
  )) {
    return {
      estado: 'hype', icono: '🎭', label: 'HYPE',
      desc: `Subida fuerte (+${mom7.toFixed(1)}% en 7 días) sin rendimiento real que la justifique. Riesgo de corrección.`,
      colorFondo: 'rgba(239,68,68,0.1)', colorTexto: 'var(--red)',
    };
  }

  // 💥 EXPLOSIÓN — mercado reaccionando + rendimiento que lo justifica
  if (mercadoReaccionando && (efic === null || efic > 5) && (hayMargen || efic > 10)) {
    return {
      estado: 'explosion', icono: '💥', label: 'EXPLOSIÓN',
      desc: `Subida fuerte (+${mom7.toFixed(1)}% en 7 días) respaldada por rendimiento real${efic !== null ? ` (+${efic}% sobre lo esperado)` : ''}. ${hayMargen ? `Aún hay margen de +${margenPJ?.toFixed(0)}% hasta precio justo.` : ''}`,
      colorFondo: 'rgba(251,146,60,0.12)', colorTexto: '#fb923c',
    };
  }

  // 📈 REBOTE — mejorando + mercado reconociéndolo
  if (mejorando && mercadoReaccionando && (efic === null || efic > 0)) {
    return {
      estado: 'rebote', icono: '📈', label: 'REBOTE',
      desc: `Rendimiento mejorando en las últimas jornadas (ø${mediaRec.toFixed(1)} vs ø${mediaAnt.toFixed(1)} anterior). El mercado lo está reconociendo (+${mom7.toFixed(1)}% en 7 días).`,
      colorFondo: 'rgba(34,197,94,0.1)', colorTexto: 'var(--green)',
    };
  }

  // 💎 INERCIA OCULTA — rinde bien, mercado dormido o medio (nunca si baja)
  if (hayMargen && mom7 >= 0 && (efic === null || efic > 10)) {
    if (mercadoDormido) {
      return {
        estado: 'joya', icono: '💎', label: 'INERCIA OCULTA',
        desc: `Rinde${efic !== null ? ` +${efic}%` : ''} por encima de lo esperado para su precio. El mercado aún no reacciona (+${mom7.toFixed(1)}% en 7 días). Precio justo estimado: ${pj ? (pj.precioJusto/1e6).toFixed(2)+'M€' : '—'}. Margen: +${margenPJ?.toFixed(0)}%.`,
        colorFondo: 'rgba(99,102,241,0.15)', colorTexto: '#818cf8',
      };
    }
    if (!mercadoReaccionando) {
      return {
        estado: 'joya', icono: '💎', label: 'INERCIA OCULTA',
        desc: `Rinde${efic !== null ? ` +${efic}%` : ''} por encima de lo esperado para su precio. El mercado empieza a moverse (+${mom7.toFixed(1)}% en 7 días) pero aún hay margen. Precio justo: ${pj ? (pj.precioJusto/1e6).toFixed(2)+'M€' : '—'}.`,
        colorFondo: 'rgba(99,102,241,0.15)', colorTexto: '#818cf8',
      };
    }
  }

  // 📉 DESPLOME — mercado castigando + rendimiento bajo o sin jugar
  const mercadoBajando = mom7 < -umbralDormido || (priceHistory.length < 2 && player.trend < -10000);
  if (mercadoBajando && (efic === null || efic < 0)) {
    return {
      estado: 'desplome', icono: '📉', label: 'DESPLOME',
      desc: `El mercado lo está castigando (${mom7 < 0 ? mom7.toFixed(1)+'% en 7 días' : '▼'+Math.abs(Math.round(player.trend/1000))+'K€ hoy'})${efic !== null ? ` y rinde ${efic}% por debajo de lo esperado` : ''}. Riesgo de seguir bajando.`,
      colorFondo: 'rgba(239,68,68,0.08)', colorTexto: '#f87171',
    };
  }

  return null;
}

// ─── RANKINGS ────────────────────────────────────────────────────────────────

function calcularEficientes(players) {
  const MIN_PJ = 8, MIN_PTS = 60;
  const candidatos = players.filter(p => p.price > 0 && p.pts >= MIN_PTS && p.pj >= MIN_PJ);
  const maxPorPos = {};
  candidatos.forEach(p => {
    const pos = (p.position || p.pos || '').split('/')[0];
    if (!maxPorPos[pos] || p.pts > maxPorPos[pos]) maxPorPos[pos] = p.pts;
  });
  return candidatos.map(p => {
    const precioM  = p.price / 1000000;
    const media    = p.media || (p.pts / p.pj);
    const pos      = (p.position || p.pos || '').split('/')[0];
    const maxPos   = maxPorPos[pos] || p.pts;
    const score    = (media * 0.5) + ((p.pts / precioM) * 0.3) + ((p.pts / maxPos) * 100 * 0.2);
    return { ...p, media, score };
  }).sort((a, b) => b.score - a.score).slice(0, 10);
}

function calcularChollos(players) {
  const candidatos = players.filter(p => p.price > 0 && (p.price / 1000000) <= 5 && p.pts >= 40 && p.pj >= 6);
  if (!candidatos.length) return [];
  const precios = candidatos.map(p => p.price / 1000000);
  const minP = Math.min(...precios), maxP = Math.max(...precios, 1), rangoP = maxP - minP || 1;
  return candidatos.map(p => {
    const precioM = p.price / 1000000;
    const media   = p.media || (p.pts / p.pj);
    const barato  = ((maxP - precioM) / rangoP) * 100;
    const score   = (p.pts * 0.5) + (media * 0.3) + (barato * 0.2);
    return { ...p, media, score };
  }).sort((a, b) => b.score - a.score).slice(0, 10);
}

// ─── FACTOR EQUIPO ───────────────────────────────────────────────────────────

const BW_TO_FD_TEAM = {
  'athletic':'Athletic Club',
  'atletico':'Club Atlético de Madrid','atlético':'Club Atlético de Madrid',
  'osasuna':'CA Osasuna',
  'espanyol':'RCD Espanyol de Barcelona',
  'barcelona':'FC Barcelona',
  'getafe':'Getafe CF',
  'madrid':'Real Madrid CF','real madrid':'Real Madrid CF',
  'rayo':'Rayo Vallecano de Madrid',
  'levante':'Levante UD',
  'mallorca':'RCD Mallorca',
  'betis':'Real Betis Balompié',
  'sociedad':'Real Sociedad de Fútbol','real sociedad':'Real Sociedad de Fútbol',
  'villarreal':'Villarreal CF',
  'valencia':'Valencia CF',
  'alaves':'Deportivo Alavés','alavés':'Deportivo Alavés',
  'elche':'Elche CF',
  'girona':'Girona FC',
  'celta':'RC Celta de Vigo',
  'sevilla':'Sevilla FC',
  'oviedo':'Real Oviedo','real oviedo':'Real Oviedo',
};

function formScore(results) {
  return results.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
}

function getStandingByClub(clubName) {
  if (!ligaData?.standings || !clubName || clubName === '—') return null;
  const cn = clubName.toLowerCase().trim();
  let s = ligaData.standings.find(t => {
    const tn = (t.team.name || '').toLowerCase();
    const ts = (t.team.shortName || '').toLowerCase();
    if (tn === cn || ts === cn) return true;
    if (ts.length > 3 && cn.includes(ts)) return true;
    const stop = new Set(['real','club','fc','rcd','ud','ca','rc','de','del','la','cf','sd','barcelona','madrid','sevilla','valencia','bilbao']);
    const cw = cn.split(' ').filter(w => w.length > 3 && !stop.has(w));
    const tw = tn.split(' ').filter(w => w.length > 3 && !stop.has(w));
    if (!cw.length || !tw.length) return false;
    return cw.some(w => tw.some(t => t === w || t.startsWith(w) || w.startsWith(t)));
  });
  if (!s) {
    const fdName = BW_TO_FD_TEAM[cn];
    if (fdName) s = ligaData.standings.find(t => (t.team.name || '').toLowerCase() === fdName.toLowerCase());
  }
  return s || null;
}

function getEstadoEquipo(clubName) {
  if (!allPlayers.length || !clubName || clubName === '—') return null;
  const cn = clubName.toLowerCase().trim();
  const jugadores = allPlayers.filter(p => {
    const pClub = (p.club || p.teamName || '').toLowerCase().trim();
    return pClub === cn || pClub.includes(cn.split(' ')[0]) || cn.includes(pClub.split(' ')[0]);
  });
  if (!jugadores.length) return null;

  const DISPONIBILIDAD = {
    'ok': 1.0, 'doubt': 0.65, 'sanctioned': 0.0,
    'injured': 0.0, 'not_in_league': 0.0, 'unknown': 0.5,
  };

  let valorTotal = 0, valorDisponible = 0;
  const jugadoresOk = [], jugadoresDuda = [], jugadoresFuera = [];

  jugadores.forEach(p => {
    const precio = p.price || 0;
    if (!precio) return;
    const disp = DISPONIBILIDAD[p.status] ?? 1.0;
    valorTotal      += precio;
    valorDisponible += precio * disp;
    if (disp === 1.0)  jugadoresOk.push(p);
    else if (disp > 0) jugadoresDuda.push(p);
    else               jugadoresFuera.push(p);
  });

  const pctDisponible = valorTotal > 0 ? (valorDisponible / valorTotal) * 100 : 100;
  const valorFuera = jugadoresFuera
    .concat(jugadoresDuda.map(p => ({ ...p, price: p.price * 0.35 })))
    .reduce((s, p) => s + (p.price || 0), 0);
  const impacto = valorFuera > valorTotal * 0.25 ? 'alto' :
                  valorFuera > valorTotal * 0.10 ? 'medio' : 'bajo';

  return { pctDisponible, valorTotal, valorDisponible, jugadoresOk, jugadoresDuda, jugadoresFuera, impacto, total: jugadores.length };
}

const FE_MEDIA_MAX_POS = { PT: 7.3, DF: 6.7, MC: 7.9, DL: 10.3 };

const FE_PESOS = {
  PT: { w: 0.80, e: 0.50, l: -0.20, o25base: -0.30 },
  DF: { w: 0.70, e: 0.40, l: -0.10, o25base:  0.00 },
  MC: { w: 0.60, e: 0.30, l:  0.00, o25base:  0.20 },
  DL: { w: 0.50, e: 0.10, l:  0.00, o25base:  0.40 },
};

function feO25Factor(pos, goles, pj) {
  if (pos === 'PT') return -0.30;
  if (pos === 'DF') return  0.00;
  const ratio = pj > 0 ? goles / pj : 0;
  if (pos === 'DL') return ratio > 0.25 ? 0.50 : ratio > 0.15 ? 0.35 : 0.20;
  return ratio > 0.20 ? 0.35 : ratio > 0.10 ? 0.25 : 0.10;
}

function calcFactorEquipo(clubName, jugador) {
  if (!ligaData || !ligaData.standings || !ligaData.forms) return null;
  if (!clubName || clubName === '—' || clubName === '') return null;

  const standing = getStandingByClub(clubName);
  if (!standing) return null;

  const teamId   = standing.team.id;
  const teamOdds = (ligaData.odds || {})[teamId];
  if (!teamOdds) return null;

  const pW     = teamOdds.win    || 0;
  const pD     = teamOdds.draw   || 0;
  const pL     = teamOdds.loss   || 0;
  const over25 = teamOdds.over25 || 0;
  const isHome = teamOdds.isHome;

  const posMap = { 1:'PT', 2:'DF', 3:'MC', 4:'DL' };
  const pos    = jugador ? (posMap[jugador.position] || posMap[jugador.pos] || 'MC') : 'MC';
  const pw     = FE_PESOS[pos];

  const goles = jugador ? (jugador.sf_goals || jugador.goals || 0) : 0;
  const pj    = jugador ? ((jugador.playedHome || 0) + (jugador.playedAway || 0)) : 1;

  // C1: Contexto (50%)
  const o25f    = feO25Factor(pos, goles, pj);
  const ctxBase = pW * pw.w + pD * pw.e + pL * pw.l;
  const amp     = 1 + (over25 - 0.50) * o25f;
  const ctx     = ctxBase * amp;
  const c1      = Math.min(10, ctx / 0.65 * 10);

  // C2: Forma en condición (30%)
  let mediaBase = 5.0;
  if (jugador) {
    const mt = pj > 0 ? (jugador.points || jugador.pts || 0) / pj : 0;
    const jdPlayer = (window._jornadasData || {})[String(jugador.id)];
    if (jdPlayer) {
      const cond = Object.values(jdPlayer).filter(v => v.home === isHome && v.pts !== null);
      const all  = Object.values(jdPlayer).filter(v => v.pts !== null);
      if      (cond.length >= 3) mediaBase = cond.reduce((s,v) => s + v.pts, 0) / cond.length;
      else if (all.length  >= 3) mediaBase = all.reduce((s,v)  => s + v.pts, 0) / all.length;
      else                       mediaBase = mt;
    } else {
      mediaBase = mt;
    }
    const jv = (jugador.jForm || []).filter(v => v !== null && v !== undefined);
    if (jv.length >= 3 && mediaBase > 0) {
      const jm = jv.reduce((s,v) => s+v, 0) / jv.length;
      const aj = Math.min(1.5, Math.max(0.5, jm / mediaBase));
      mediaBase = mediaBase * aj;
    }
  }
  const c2 = Math.min(10, mediaBase / 10.0 * 10);

  // C3: Nivel absoluto (20%)
  let c3 = 5.0;
  if (jugador) {
    const mt  = pj > 0 ? (jugador.points || jugador.pts || 0) / pj : 0;
    const max = FE_MEDIA_MAX_POS[pos] || 10;
    c3 = Math.min(10, mt / max * 10);
  }

  const fe = c1 * 0.50 + c2 * 0.30 + c3 * 0.20;
  return Math.min(10, Math.max(0, Math.round(fe * 10) / 10));
}

// ─── SISTEMA DE RECOMENDACIONES ──────────────────────────────────────────────
// Puntúa cada jugador sobre 100 combinando señales independientes

function calcRecomendacion(p) {
  if (!p || !p.price || p.price < 300000) return null;
  if (p.status === 'injured') return null;

  let score = 0;
  const reasons  = [];
  const warnings = [];

  // 1. Racha últimas 3 jornadas (30%)
  const jForm = (p.jForm || []).filter(v => v !== null && v !== undefined);
  const last3 = jForm.slice(0, 3);
  const last5 = jForm.slice(0, 5);
  if (last3.length >= 2) {
    const avg3 = last3.reduce((s,v) => s+v, 0) / last3.length;
    const avg5 = last5.length ? last5.reduce((s,v) => s+v, 0) / last5.length : avg3;
    const rachaScore = Math.min(30, (avg3 / 10) * 30);
    score += rachaScore;
    if      (avg3 >= 8) reasons.push(`racha de ${avg3.toFixed(1)} de media en las últimas ${last3.length} jornadas`);
    else if (avg3 >= 6) reasons.push(`media de ${avg3.toFixed(1)} pts en sus últimas ${last3.length} jornadas`);
    if (last3.length >= 2 && avg3 < avg5 - 1.5) warnings.push('forma bajando respecto a su media');
    if (last3.length === 3 && last3.every(v => v >= 5)) { score += 5; reasons.push('muy consistente — nunca baja de 5'); }
  }

  // 2. Factor Equipo próxima jornada (25%)
  const club = p.club || p.teamName || '';
  const fe = calcFactorEquipo(club);
  if (fe !== null) {
    score += (fe / 10) * 25;
    if      (fe >= 7) reasons.push(`partido muy favorable (factor equipo ${fe.toFixed(1)}/10)`);
    else if (fe >= 5) reasons.push(`partido aceptable (factor ${fe.toFixed(1)}/10)`);
    else if (fe <  3) warnings.push(`partido difícil (factor ${fe.toFixed(1)}/10)`);

    const standing = getStandingByClub(club);
    if (standing) {
      const nextM = (ligaData.nextMatches || []).find(m => m.home.id === standing.team.id || m.away.id === standing.team.id);
      if (nextM) {
        const isLocal = nextM.home.id === standing.team.id;
        const rival   = isLocal ? nextM.away : nextM.home;
        if (isLocal) reasons.push(`juega en casa vs ${rival.short || rival.name}`);
        else         reasons.push(`visita ${rival.short || rival.name}`);
      }
    }
  }

  // 3. ROI últimas 5 jornadas (20%)
  const precioM      = p.price / 1000000;
  const ptsRecientes = last5.reduce((s,v) => s + (v > 0 ? v : 0), 0);
  const roiReciente  = last5.length ? (ptsRecientes / last5.length) / precioM : 0;
  if (roiReciente > 0) {
    score += Math.min(20, (roiReciente / 3) * 20);
    if      (roiReciente >= 2)   reasons.push(`ROI reciente excelente (${roiReciente.toFixed(1)} pts/M€ por jornada)`);
    else if (roiReciente >= 1.2) reasons.push(`buen rendimiento por precio (${roiReciente.toFixed(1)} pts/M€/J)`);
  }

  // 4. Momentum de precio (10%)
  const priceHistory = (window._pricesData || {})[String(p.id)] || [];
  if (priceHistory.length >= 3) {
    const last  = priceHistory[priceHistory.length - 1]?.p || p.price;
    const prev3 = priceHistory[Math.max(0, priceHistory.length - 4)]?.p || last;
    const prev7 = priceHistory[Math.max(0, priceHistory.length - 8)]?.p || last;
    const mom3  = prev3 > 0 ? ((last - prev3) / prev3) * 100 : 0;
    const mom7  = prev7 > 0 ? ((last - prev7) / prev7) * 100 : 0;
    let diasSubiendo = 0;
    for (let i = priceHistory.length - 1; i > 0; i--) {
      if ((priceHistory[i]?.p || 0) > (priceHistory[i-1]?.p || 0)) diasSubiendo++;
      else break;
    }
    if (mom7 > 3) {
      score += Math.min(10, (mom7 / 10) * 10);
      if      (diasSubiendo >= 4) reasons.push(`subiendo ${diasSubiendo} días consecutivos (+${mom7.toFixed(1)}% en 7 días)`);
      else if (mom7 >= 5)         reasons.push(`momentum fuerte: +${mom7.toFixed(1)}% en 7 días`);
      else                        reasons.push(`precio en tendencia alcista (+${mom3.toFixed(1)}% en 3 días)`);
    } else if (mom7 < -3) {
      score -= 5;
      warnings.push(`precio cayendo ${mom7.toFixed(1)}% en 7 días — el mercado vende`);
    }
  } else {
    const trend = p.trend || 0;
    if (trend > 0) {
      score += Math.min(10, (trend / 200000) * 10);
      if (trend >= 100000) reasons.push(`precio subiendo ▲${(trend / 1000).toFixed(0)}K€`);
    } else if (trend < -50000) {
      score -= 5;
      warnings.push(`precio bajando ▼${Math.abs(trend / 1000).toFixed(0)}K€`);
    }
  }

  // 5. Estado — penalizaciones (15%)
  if (p.status === 'doubt')      { score -= 15; warnings.push('en duda para el próximo partido'); }
  if (p.status === 'sanctioned') { score -= 20; warnings.push('sancionado — no jugará'); }

  // 6. Bonus: ya en tu equipo
  const enMiEquipo = (getEquipo() || []).some(x => x.id === p.id || x.name === p.name);

  if (score < 35) return null;

  return {
    player: p,
    score:  Math.round(Math.min(99, Math.max(0, score))),
    reasons,
    warnings,
    enMiEquipo,
    fe,
    roiReciente,
  };
}
