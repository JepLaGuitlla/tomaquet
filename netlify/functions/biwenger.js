async function fetchPage(pagina) {
  const params = new URLSearchParams({
    operacion: '1', nombre: '', id_equipo: '0',
    posicion: '0', 'precio-min': '0', 'precio-max': '29000000',
    modo: 'biwenger', limite: '0', ordenar: '0', pagina: String(pagina)
  });
  const res = await fetch('https://www.comuniate.com/ajax/jugadores/comunio_jugadores.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://www.comuniate.com/jugadores/comunio',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Origin': 'https://www.comuniate.com',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: params.toString()
  });
  const buffer = await res.arrayBuffer();
  return new TextDecoder('latin1').decode(buffer);
}

function parsePlayers(html) {
  const players = [];
  const blocks = html.split('ficha_jugador');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const nameMatch = b.match(/class="titulo_ficha_jugador">([^<]+)<\/span>/);
    if (!nameMatch) continue;
    const priceMatch = b.match(/<small>([\d.]+)€<\/small>/);
    const posMatch = b.match(/label-danger">\s*([A-Z\/]+)\s*/);
    const pointsMatch = b.match(/label-primary">(\d+)<\/span>/);
    const clubMatch = b.match(/alt="([^"]+)"[^>]*>\s*<\/div>/);
    const injuredMatch = b.match(/estados\/lesionado/);
    const sanctionMatch = b.match(/estados\/sancionado/);
    const homeMatch = b.match(/fa-home[^>]*><\/i>\s*(\d+)/);
    const awayMatch = b.match(/fa-plane[^>]*><\/i>\s*(\d+)/);
    const trendMatch = b.match(/([+\-][\d.]+)€<\/div>/);

    const price = priceMatch ? parseInt(priceMatch[1].replace(/\./g, '')) : 0;
    const pts = pointsMatch ? parseInt(pointsMatch[1]) : 0;
    const roi = price > 0 ? parseFloat((pts / (price / 1000000)).toFixed(2)) : 0;
    const trend = trendMatch ? parseInt(trendMatch[1].replace(/\./g, '')) : 0;

    players.push({
      name: nameMatch[1].trim(),
      price, pts, roi,
      position: posMatch ? posMatch[1].trim() : '?',
      club: clubMatch ? clubMatch[1].trim() : '—',
      injured: !!injuredMatch,
      sanctioned: !!sanctionMatch,
      playedHome: homeMatch ? parseInt(homeMatch[1]) : 0,
      playedAway: awayMatch ? parseInt(awayMatch[1]) : 0,
      trend
    });
  }
  return players;
}

exports.handler = async function() {
  try {
    const allPlayers = [];
    
    // Fetch page 1 first to detect total pages
    const firstHtml = await fetchPage(1);
    const firstBatch = parsePlayers(firstHtml);
    allPlayers.push(...firstBatch);
    
    // Detect total pages from pagination
    const pageNums = [];
    const pageRegex = /ir a p[aá]gina (\d+)/g;
    let m;
    while ((m = pageRegex.exec(firstHtml)) !== null) {
      pageNums.push(parseInt(m[1]));
    }
    const totalPages = pageNums.length > 0 ? Math.max(...pageNums) : 1;
    
    // Fetch remaining pages in batches of 5 to avoid timeout
    for (let p = 2; p <= Math.min(totalPages, 22); p += 5) {
      const batch = [];
      for (let pp = p; pp < Math.min(p + 5, totalPages + 1); pp++) {
        batch.push(fetchPage(pp).then(parsePlayers));
      }
      const results = await Promise.all(batch);
      results.forEach(r => allPlayers.push(...r));
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1800'
      },
      body: JSON.stringify({
        players: allPlayers,
        total: allPlayers.length,
        pages: totalPages,
        source: 'comuniate',
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
