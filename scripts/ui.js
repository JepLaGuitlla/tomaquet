// ui.js — Renderizado de Rankings
// Sin lógica de negocio. Sin cálculos.
// Depende de: engine.js, allPlayers (global), playerPhoto()

'use strict';

// ─── HELPERS VISUALES ────────────────────────────────────────────────────────

function jFormDots(jForm) {
  return (jForm || []).slice(0, 5).map(v => {
    if (v === null || v === undefined) return `<span class="jf-dot" style="color:var(--text3)">—</span>`;
    const c = v >= 10 ? 'var(--c-top)' : v >= 6 ? 'var(--c-good)' : v >= 3 ? 'var(--c-mid)' : 'var(--c-low)';
    return `<span class="jf-dot" style="color:${c}">${v}</span>`;
  }).join('<span style="color:var(--border2);margin:0 1px">·</span>');
}

function buildRankRow(name, pos, club, valLabel, colorCls, pct) {
  if (pos && !PC[pos]) {
    const found = allPlayers.find(p => p.name === name);
    if (found) pos = (found.position || '').split('/')[0];
  }
  const posColor = PC[pos] || '#888';
  const barColor = colorCls === 'green' ? 'var(--green)' : colorCls === 'red' ? 'var(--red)' : colorCls === 'amber' ? 'var(--accent)' : 'var(--blue)';
  const player = allPlayers.find(p => p.name === name);
  const foto = player
    ? playerPhoto(player, 32)
    : `<div style="width:32px;height:32px;border-radius:50%;background:${posColor};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:800;color:#fff">${(pos || '?').split('/')[0]}</div>`;
  return `<div class="rank-row" style="cursor:pointer" onclick="openJugPanel(allPlayers.find(p=>p.name==='${name.replace(/'/g, "\\'")}'))">${foto}<div class="rank-player-info"><div class="rank-player-name">${name}</div><div class="rank-player-club">${club || '—'}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px"><div class="rank-val ${colorCls}">${valLabel}</div><div class="rank-bar-bg"><div class="rank-bar-fill" style="width:${pct}%;background:${barColor}"></div></div></div></div>`;
}

function initRankings() { if (allPlayers.length) renderRankings(allPlayers); }

// ─── RANKING CARDS ───────────────────────────────────────────────────────────

const _rkData = {};

function buildRankCard(cardId, icon, title, players, valFn, valClass, subFn, col2Fn, col2Label, col3Fn, col3Label) {
  const el = document.getElementById(cardId);
  if (!el || !players.length) return;
  _rkData[cardId] = { players, valFn, valClass, col2Fn, col2Label, col3Fn, col3Label };

  const slotsHTML = players.slice(0, 5).map((p, i) => {
    const pid    = p.id;
    const val    = valFn(p);
    const sub    = subFn ? subFn(p) : `${(p.price / 1e6).toFixed(2)}M€`;
    const img    = pid ? `./img/players/${pid}.avif` : null;
    const estado = calcEstadoMercado(p);
    const lecturaCard = estado
      ? `<div style="font-size:0.65rem;color:var(--text3);letter-spacing:0.5px;margin-top:1px" title="${estado.desc}">${estado.icono} <span style="font-size:0.55rem;text-transform:uppercase;letter-spacing:0.8px">Lectura</span></div>`
      : '';
    return `<div class="rk-player-slot" onclick="openJugPanel(allPlayers.find(x=>x.id===${pid}))">
      ${img ? `<img class="rk-slot-img" src="${img}" onerror="this.style.display='none'">` : ''}
      <div class="rk-slot-overlay"></div>
      <div class="rk-slot-num">${i + 1}</div>
      <div class="rk-slot-val ${valClass}">${val}</div>
      <div class="rk-slot-info">
        <div class="rk-slot-name">${p.name}</div>
        <div class="rk-slot-sub">${sub}</div>
        ${lecturaCard}
      </div>
    </div>`;
  }).join('');

  const listRows = players.map((p, i) => {
    const pid  = p.id;
    const pval = valFn(p);
    const psub = subFn ? subFn(p) : `${(p.price / 1e6).toFixed(2)}M€`;
    return `<div class="rk-list-row" onclick="openJugPanel(allPlayers.find(x=>x.id===${pid}))">
      <div class="rk-list-num">${i + 1}</div>
      <div>${playerPhoto(p, 28)}</div>
      <div><div class="rk-list-name">${p.name || '—'}</div><div class="rk-list-sub">${psub}</div></div>
      <div class="rk-list-val ${valClass}">${pval}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="rk-header">
      <span class="rk-icon">${icon}</span>
      <span class="rk-title">${title}</span>
      <button class="rk-expand-btn" onclick="toggleRkList('${cardId}')">Ver ranking</button>
    </div>
    <div class="rk-body">${slotsHTML}</div>
    <div class="rk-list" id="${cardId}-list" style="display:none">
      <div class="rk-list-inner">${listRows}</div>
    </div>`;
}

function toggleRkList(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const icon  = card.querySelector('.rk-icon')?.textContent  || '';
  const title = card.querySelector('.rk-title')?.textContent || '';
  const d = _rkData[cardId];
  if (!d) return;
  openRkPanel(icon, title, d.players, d.valFn, d.valClass, d.col2Fn, d.col2Label, d.col3Fn, d.col3Label);
}

// ─── PANEL RANKING ───────────────────────────────────────────────────────────

function openRkPanel(icon, title, players, valFn, valClass, col2Fn, col2Label, col3Fn, col3Label) {
  let overlay = document.getElementById('rkPanelOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'rkPanelOverlay';
    overlay.className = 'rk-panel-overlay';
    overlay.innerHTML = `<div class="rk-panel">
      <div class="rk-panel-header">
        <span class="rk-panel-icon"></span>
        <span class="rk-panel-title"></span>
        <span class="rk-panel-count"></span>
        <button class="rk-panel-close" onclick="closeRkPanel()">✕</button>
      </div>
      <div class="rk-panel-list"></div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeRkPanel(); });
    document.body.appendChild(overlay);
  }

  overlay.querySelector('.rk-panel-icon').textContent  = icon;
  overlay.querySelector('.rk-panel-title').textContent = title;
  overlay.querySelector('.rk-panel-count').textContent = `${players.length} jugadores`;

  const medias      = getMediasEsperadas();
  const titleClean  = title.toLowerCase().trim();
  const showPrecioJusto = titleClean.includes('infra') || titleClean.includes('sobrev');

  const rows = players.map((p, i) => {
    const pid     = p.id;
    const mainVal = valFn(p);
    const col2    = col2Fn ? col2Fn(p) : '';

    // Columna precio con trend
    let col3;
    if (showPrecioJusto) {
      const trendVal  = p.trend || 0;
      const precioStr = `${(p.price / 1e6).toFixed(2)}M€`;
      if (trendVal !== 0) {
        const tColor = trendVal > 0 ? 'var(--green)' : 'var(--red)';
        const tSign  = trendVal > 0 ? '+' : '';
        const tAbs   = Math.abs(trendVal);
        const tK     = tAbs >= 1000000
          ? `${tSign}${(trendVal / 1e6).toFixed(2)}M€`
          : `${tSign}${Math.round(trendVal / 1000)}K€`;
        col3 = `<div style="text-align:right">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:0.78rem;font-weight:700;color:var(--text)">${precioStr}</div>
          <div style="font-size:0.6rem;color:${tColor};font-weight:600">${tK}</div>
        </div>`;
      } else {
        col3 = `<div style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:0.78rem;font-weight:700;color:var(--text)">${precioStr}</div>`;
      }
    } else {
      col3 = col3Fn ? col3Fn(p) : `${(p.price / 1e6).toFixed(2)}M€`;
    }

    // Precio justo
    let precioJustoHtml = '';
    if (showPrecioJusto) {
      const pj = calcPrecioJusto(p);
      if (pj) {
        const color = pj.difEuros > 0 ? 'var(--green)' : 'var(--red)';
        const arrow = pj.difEuros > 0 ? '↑' : '↓';
        precioJustoHtml = `<div style="text-align:right">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:0.78rem;font-weight:700;color:var(--text)">${(pj.precioJusto / 1e6).toFixed(2)}M€</div>
          <div style="font-size:0.6rem;color:${color};font-weight:600">${arrow} ${pj.difEuros > 0 ? '+' : ''}${(pj.difEuros / 1e6).toFixed(2)}M€</div>
        </div>`;
      } else {
        precioJustoHtml = '<div style="text-align:right;color:var(--text3);font-size:0.7rem">—</div>';
      }
    }

    // Mercado 7d
    let mercadoHtml = '';
    if (showPrecioJusto) {
      const ph = (window._pricesData || {})[String(pid)] || [];
      let mom7 = 0, diasConsec = 0, dirConsec = 0;
      if (ph.length >= 2) {
        const last  = ph[ph.length - 1]?.p || p.price;
        const prev7 = ph[Math.max(0, ph.length - 8)]?.p || last;
        mom7 = prev7 > 0 ? ((last - prev7) / prev7) * 100 : 0;
        for (let k = ph.length - 1; k > 0; k--) {
          const diff = (ph[k]?.p || 0) - (ph[k - 1]?.p || 0);
          if (k === ph.length - 1) dirConsec = diff >= 0 ? 1 : -1;
          if ((diff >= 0 && dirConsec > 0) || (diff < 0 && dirConsec < 0)) diasConsec++;
          else break;
        }
      } else if (p.trend) {
        mom7      = (p.trend / p.price) * 100 * 5;
        diasConsec = p.trend > 0 ? 1 : -1;
        dirConsec  = p.trend > 0 ? 1 : -1;
      }
      const mColor = mom7 > 0 ? 'var(--green)' : mom7 < 0 ? 'var(--red)' : 'var(--text3)';
      const mArrow = dirConsec > 0 ? '↑' : dirConsec < 0 ? '↓' : '→';
      const mSign  = mom7 > 0 ? '+' : '';
      const mDias  = diasConsec > 0 ? `<span style="font-size:0.58rem;color:var(--text3)">${mArrow}${diasConsec}d</span>` : '';
      mercadoHtml = mom7 !== 0
        ? `<div style="text-align:right">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:0.75rem;font-weight:700;color:${mColor}">${mSign}${mom7.toFixed(1)}%</div>
            ${mDias}
           </div>`
        : `<div style="text-align:right;color:var(--text3);font-size:0.7rem">—</div>`;
    }

    // Lectura
    let lecturaHtml = '';
    if (showPrecioJusto) {
      const em = calcEstadoMercado(p);
      lecturaHtml = em
        ? `<div title="${em.desc}" style="text-align:center;cursor:help"><div style="font-size:1.1rem">${em.icono}</div></div>`
        : `<div style="text-align:center;color:var(--text3);font-size:0.7rem">—</div>`;
    }

    const cols = showPrecioJusto ? '32px 44px 1fr 80px 60px 80px 80px 70px 44px' : '32px 44px 1fr repeat(3,80px)';
    return `<div class="rk-modal-row" style="grid-template-columns:${cols}" onclick="closeRkPanel();openJugPanel(allPlayers.find(x=>x.id===${pid}))">
      <div class="rk-modal-num">${i + 1}</div>
      <div>${playerPhoto(p, 36)}</div>
      <div class="rk-modal-info">
        <div class="rk-modal-name">${p.name}</div>
        <div class="rk-modal-club">${p.club || p.teamName || '—'} · ${(p.position || '').split('/')[0]}</div>
      </div>
      <div class="rk-modal-val ${valClass}">${mainVal}</div>
      <div class="rk-modal-sec">${col2}</div>
      <div class="rk-modal-price">${col3}</div>
      ${showPrecioJusto ? precioJustoHtml : ''}
      ${showPrecioJusto ? mercadoHtml    : ''}
      ${showPrecioJusto ? lecturaHtml    : ''}
    </div>`;
  }).join('');

  // Leyenda
  const esInfra   = titleClean.includes('infra');
  const leyendaHtml = showPrecioJusto ? `
    <div style="padding:12px 16px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="border-left:3px solid ${esInfra ? 'var(--green)' : 'var(--red)'};padding:8px 12px;background:var(--bg);border-radius:0 4px 4px 0">
          <div style="font-family:'Figtree',sans-serif;font-size:0.62rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${esInfra ? 'var(--green)' : 'var(--red)'};margin-bottom:4px">${esInfra ? '📈' : '📉'} ${title}</div>
          <div style="font-family:'Figtree',sans-serif;font-size:0.7rem;color:var(--text2);line-height:1.5">
            Compara la media real con la media esperada de jugadores de <strong>su misma posición y precio similar</strong>.
            <span style="display:block;color:var(--text3);font-size:0.62rem;margin-top:2px">${esInfra ? '+60% = rinde un 60% más de lo esperado para su precio.' : '-40% = rinde un 40% menos de lo esperado para su precio.'}</span>
          </div>
        </div>
        <div style="border-left:3px solid #818cf8;padding:8px 12px;background:var(--bg);border-radius:0 4px 4px 0">
          <div style="font-family:'Figtree',sans-serif;font-size:0.62rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#818cf8;margin-bottom:4px">💰 Precio Justo</div>
          <div style="font-family:'Figtree',sans-serif;font-size:0.7rem;color:var(--text2);line-height:1.5">
            Lo que debería costar según su rendimiento vs jugadores similares de su posición y precio (curva continua, sin grupos rígidos).
            <span style="display:block;color:var(--text3);font-size:0.62rem;margin-top:2px">Excluye jugadores &lt;1M€ y con menos de 3 jornadas para evitar ruido.</span>
          </div>
        </div>
      </div>
      <div style="border-left:3px solid var(--text3);padding:6px 12px;background:var(--bg);border-radius:0 4px 4px 0">
        <div style="font-family:'Figtree',sans-serif;font-size:0.62rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--text3);margin-bottom:4px">🏷️ Señal de Mercado</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <span style="font-size:0.68rem;color:var(--text2)"><span style="font-size:0.85rem">💎</span> <strong style="color:#818cf8">INERCIA OCULTA</strong> — Rinde bien, nadie lo ha visto aún.</span>
          <span style="font-size:0.68rem;color:var(--text2)"><span style="font-size:0.85rem">💥</span> <strong style="color:#fb923c">EXPLOSIÓN</strong> — Subida fuerte respaldada por rendimiento real.</span>
          <span style="font-size:0.68rem;color:var(--text2)"><span style="font-size:0.85rem">📈</span> <strong style="color:var(--green)">REBOTE</strong> — Rendimiento mejorando, mercado corrigiendo.</span>
          <span style="font-size:0.68rem;color:var(--text2)"><span style="font-size:0.85rem">🎭</span> <strong style="color:var(--red)">HYPE</strong> — Precio por encima de lo que justifica el rendimiento.</span>
        </div>
      </div>
    </div>` : '';

  const thCols = showPrecioJusto ? '32px 44px 1fr 80px 60px 80px 80px 70px 44px' : '32px 44px 1fr repeat(3,80px)';
  const th = `<div class="rk-modal-th" style="grid-template-columns:${thCols}">
    <div></div><div></div><div>Jugador</div>
    <div style="text-align:right">${title}</div>
    <div style="text-align:right">${col2Label || ''}</div>
    <div style="text-align:right">${col3Label || 'Precio'}</div>
    ${showPrecioJusto ? '<div style="text-align:right">P. Justo</div>' : ''}
    ${showPrecioJusto ? '<div style="text-align:right">Mercado 7d</div>' : ''}
    ${showPrecioJusto ? '<div style="text-align:center">Lectura</div>' : ''}
  </div>`;

  overlay.querySelector('.rk-panel-list').innerHTML = leyendaHtml + th + rows;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeRkPanel() {
  const overlay = document.getElementById('rkPanelOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── RENDER RANKING CARDS ────────────────────────────────────────────────────

function renderRankingCards(players) {
  const medias = getMediasEsperadas();

  // 1. En racha
  const rachaList = [...players].map(p => {
    const jf       = (p.jForm || []).filter(v => v !== null && v !== undefined);
    const rachaSum = jf.slice(0, 5).reduce((s, v) => s + v, 0);
    const pts5     = jf.slice(0, 5);
    const media5   = pts5.length > 0 ? (rachaSum / pts5.length).toFixed(1) : '—';
    return { ...p, rachaSum, media5 };
  }).filter(p => p.rachaSum > 0).sort((a, b) => b.rachaSum - a.rachaSum);

  buildRankCard('rkCard-racha', '🔥', 'En racha', rachaList.filter(p => p.position !== 'PT'),
    p => `${p.rachaSum}`, 'rk-val-amber',
    p => `<span style="color:var(--text3);font-size:0.55rem">⌀${p.media5}</span>`,
    p => jFormDots(p.jForm), 'Últimas 5J',
    p => `⌀${p.media5}`, 'Media'
  );

  // 2. Infravalorados
  const infra = players.map(p => ({ ...p, efic: calcEficiencia(p, medias) }))
    .filter(p => p.efic !== null && p.efic > 0).sort((a, b) => b.efic - a.efic);
  buildRankCard('rkCard-infra', '📈', 'Infravalorados', infra.filter(p => p.position !== 'PT'),
    p => `+${p.efic}%`, 'rk-val-green',
    p => `${(p.price / 1e6).toFixed(2)}M€`,
    p => { const pj = (p.playedHome || 0) + (p.playedAway || 0); return `⌀${pj > 0 ? (p.pts / pj).toFixed(1) : '—'}`; }, 'Media',
    p => `${(p.price / 1e6).toFixed(2)}M€`, 'Precio'
  );

  // 3. Más suben
  const suben = [...players].filter(p => p.trend > 0).sort((a, b) => b.trend - a.trend);
  buildRankCard('rkCard-suben', '↑', 'Más suben', suben.filter(p => p.position !== 'PT'),
    p => `+${(p.trend / 1000).toFixed(0)}K€`, 'rk-val-green',
    p => `${(p.price / 1e6).toFixed(2)}M€`,
    p => jFormDots(p.jForm), 'Últimas 5J',
    p => `${(p.price / 1e6).toFixed(2)}M€`, 'Precio'
  );

  // 4. Top puntuadores
  const top = [...players].filter(p => p.pts > 0).sort((a, b) => b.pts - a.pts);
  buildRankCard('rkCard-top', '★', 'Top puntuadores', top.filter(p => p.position !== 'PT'),
    p => `${p.pts}`, 'rk-val-blue',
    p => { const pj = (p.playedHome || 0) + (p.playedAway || 0); return `⌀${pj > 0 ? (p.pts / pj).toFixed(1) : '—'} · ${(p.price / 1e6).toFixed(2)}M€`; },
    p => { const pj = (p.playedHome || 0) + (p.playedAway || 0); return `⌀${pj > 0 ? (p.pts / pj).toFixed(1) : '—'}`; }, 'Media',
    p => `${(p.price / 1e6).toFixed(2)}M€`, 'Precio'
  );

  // 5. Más bajan
  const bajan = [...players].filter(p => p.trend < 0).sort((a, b) => a.trend - b.trend);
  buildRankCard('rkCard-bajan', '↓', 'Más bajan', bajan.filter(p => p.position !== 'PT'),
    p => `${(p.trend / 1000).toFixed(0)}K€`, 'rk-val-red',
    p => `${(p.price / 1e6).toFixed(2)}M€`,
    p => jFormDots(p.jForm), 'Últimas 5J',
    p => `${(p.price / 1e6).toFixed(2)}M€`, 'Precio'
  );

  // 6. Comodines
  const comodines = players
    .filter(p => p.price > 0 && p.price <= 1500000 && p.status === 'ok')
    .map(p => {
      const jf     = (p.jForm || []).slice(0, 5);
      const jugadas = jf.filter(v => v !== null && v !== undefined && v > 0).length;
      const media5  = jugadas > 0 ? jf.filter(v => v > 0).reduce((s, v) => s + v, 0) / jugadas : 0;
      return { ...p, jugadas, media5 };
    })
    .filter(p => p.jugadas >= 3 && p.media5 >= 2)
    .sort((a, b) => (b.jugadas * 10 + b.media5) - (a.jugadas * 10 + a.media5));
  buildRankCard('rkCard-chollos', '🃏', 'Comodines', comodines.filter(p => p.position !== 'PT'),
    p => `⌀${p.media5.toFixed(1)}`, 'rk-val-amber',
    p => `${(p.price / 1e6).toFixed(2)}M€`,
    p => jFormDots(p.jForm), 'Últimas 5J',
    p => `${(p.price / 1e6).toFixed(2)}M€`, 'Precio'
  );

  // 7. Eficientes
  const eficientes = calcularEficientes(players).filter(p => {
    const jf = (p.jForm || []).slice(0, 5);
    return jf.filter(v => v !== null && v !== undefined && v > 0).length >= 2;
  });
  buildRankCard('rkCard-eficientes', '⚡', 'Eficientes', eficientes.filter(p => p.position !== 'PT'),
    p => `${p.score.toFixed(1)}`, 'rk-val-blue',
    p => `${(p.price / 1e6).toFixed(2)}M€ · ⌀${p.media.toFixed(1)}`,
    p => `⌀${p.media.toFixed(1)}`, 'Media',
    p => `${(p.price / 1e6).toFixed(2)}M€`, 'Precio'
  );

  // 8. Sobrevalorados
  const sobre = players.map(p => ({ ...p, efic: calcEficiencia(p, medias) }))
    .filter(p => p.efic !== null && p.efic < 0).sort((a, b) => a.efic - b.efic);
  buildRankCard('rkCard-sobrevalorados', '📉', 'Sobrevalorados', sobre.filter(p => p.position !== 'PT'),
    p => `${p.efic}%`, 'rk-val-red',
    p => `${(p.price / 1e6).toFixed(2)}M€`,
    p => { const pj = (p.playedHome || 0) + (p.playedAway || 0); return `⌀${pj > 0 ? (p.pts / pj).toFixed(1) : '—'}`; }, 'Media',
    p => `${(p.price / 1e6).toFixed(2)}M€`, 'Precio'
  );
}

// ─── RENDER RANKINGS (sidebar legacy) ───────────────────────────────────────

function renderRankings(players) {
  const pos = p => p.position || p.pos || '';

  // En racha
  const rachaList = [...players].map(p => {
    const form   = (p.jForm || []).filter(v => v !== null && v !== undefined);
    const sum    = form.reduce((s, v) => s + (v > 0 ? v : 0), 0);
    const pts5   = form.filter(v => v > 0);
    const media5 = pts5.length ? (sum / pts5.length).toFixed(1) : null;
    return { ...p, rachaSum: sum, media5 };
  }).filter(p => p.rachaSum > 0).sort((a, b) => b.rachaSum - a.rachaSum).slice(0, 5);

  if (rachaList.length) {
    const rachaMax = rachaList[0].rachaSum;
    const _rr = document.getElementById('rankRacha');
    if (_rr) _rr.innerHTML = rachaList.map(p => {
      const formDots = (p.jForm || []).slice(0, 5).map(v => {
        if (v === null || v === undefined) return '<span style="color:var(--text3)">—</span>';
        const c = v >= 10 ? 'var(--green)' : v >= 5 ? 'var(--pt)' : v > 0 ? 'var(--text2)' : 'var(--red)';
        return `<span style="color:${c};font-weight:600">${v}</span>`;
      }).join('<span style="color:var(--border2);margin:0 2px">·</span>');
      const sub = `<span style="font-size:0.6rem;color:var(--text3)">${formDots}${p.media5 ? ` &nbsp;⌀${p.media5}` : ''}</span>`;
      return buildRankRow(p.name, pos(p), sub, `${p.rachaSum}p`, 'amber', Math.round(p.rachaSum / rachaMax * 100));
    }).join('');
  }

  // Más suben
  const suben = [...players].filter(p => p.trend > 0).sort((a, b) => b.trend - a.trend).slice(0, 5);
  if (suben.length) {
    const subenMax = suben[0].trend;
    const _rs = document.getElementById('rankSuben');
    if (_rs) _rs.innerHTML = suben.map(p => buildRankRow(p.name, pos(p), fmt(p.price / 1000000) + 'M€', `+${fmt(p.trend / 1000)}K`, 'green', Math.round(p.trend / subenMax * 100))).join('');
  }

  // Más bajan
  const bajan = [...players].filter(p => p.trend < 0).sort((a, b) => a.trend - b.trend).slice(0, 5);
  if (bajan.length) {
    const bajanMax = Math.abs(bajan[0].trend);
    const _rb = document.getElementById('rankBajan');
    if (_rb) _rb.innerHTML = bajan.map(p => buildRankRow(p.name, pos(p), fmt(p.price / 1000000) + 'M€', `${fmt(p.trend / 1000)}K`, 'red', Math.round(Math.abs(p.trend) / bajanMax * 100))).join('');
  }

  // Top puntuadores
  const topPts = [...players].filter(p => p.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 5);
  if (topPts.length) {
    const ptsMax = topPts[0].pts;
    const _rg = document.getElementById('rankGoleadores');
    if (_rg) _rg.innerHTML = topPts.map(p => {
      const pj    = (p.playedHome || 0) + (p.playedAway || 0);
      const media = pj > 0 ? (p.pts / pj).toFixed(1) : '—';
      return buildRankRow(p.name, pos(p), `${fmt(p.price / 1000000)}M€ · ⌀${media}`, `${p.pts}p`, 'blue', Math.round(p.pts / ptsMax * 100));
    }).join('');
  }

  // Eficientes
  const eficientes = calcularEficientes(players);
  if (eficientes.length) {
    const efMax = eficientes[0].score;
    const _ru = document.getElementById('rankUndervalued');
    if (_ru) _ru.innerHTML = eficientes.slice(0, 5).map(p => buildRankRow(p.name, pos(p), `${(p.price / 1000000).toFixed(2)}M€ · ⌀${p.media.toFixed(1)}`, `${p.score.toFixed(1)}`, 'blue', Math.round(p.score / efMax * 100))).join('');
  }

  // Infravalorados
  const medias         = getMediasEsperadas();
  const infravalorados = players
    .map(p => ({ ...p, efic: calcEficiencia(p, medias) }))
    .filter(p => p.efic !== null && p.efic > 0)
    .sort((a, b) => b.efic - a.efic)
    .slice(0, 5);
  const elInfra = document.getElementById('rankInfravalorados');
  if (elInfra && infravalorados.length) {
    elInfra.innerHTML = infravalorados.map(p => {
      const col = p.efic >= 50 ? 'green' : p.efic >= 20 ? 'amber' : 'blue';
      return buildRankRow(p.name, pos(p), `${(p.price / 1000000).toFixed(2)}M€`, `+${p.efic}%`, col, Math.min(100, p.efic));
    }).join('');
  }

  // Chollos
  const chollos = calcularChollos(players);
  if (chollos.length) {
    const chollosMax = chollos[0].score;
    const _rc = document.getElementById('rankChollos');
    if (_rc) _rc.innerHTML = chollos.slice(0, 5).map(p => buildRankRow(p.name, pos(p), `${(p.price / 1000000).toFixed(2)}M€ · ⌀${p.media.toFixed(1)}`, `${p.score.toFixed(1)}`, 'amber', Math.round(p.score / chollosMax * 100))).join('');
  }

  // Actualizar Mercado v3
  mv3InitFromPlayers(players);
}
