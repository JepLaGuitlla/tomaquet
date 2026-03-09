async function getComuniatePlayers() {
  const params = new URLSearchParams({
    operacion: '1', nombre: '', id_equipo: '0',
    posicion: '0', 'precio-min': '0', 'precio-max': '29000000',
    modo: 'biwenger', limite: '500', ordenar: '0'
  });
  const res = await fetch('https://www.comuniate.com/ajax/jugadores/comunio_jugadores.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://www.comuniate.com/jugadores/comunio',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
    const block = blocks[i];
    const nameMatch = block.match(/class="titulo_ficha_jugador">([^<]+)<\/span>/);
    const priceMatch = block.match(/<small>([\d.]+)€<\/small>/);
    const posMatch = block.match(/label-danger">\s*([A-Z\/]+)\s*/);
    const pointsMatch = block.match(/label-primary">(\d+)<\/span>/);
    const clubMatch = block.match(/alt="([^"]+)">\s*<\/div>/);
    const injuredMatch = block.match(/estados\/lesionado/);
    const sanctionMatch = block.match(/estados\/sancionado/);
    const homeMatch = block.match(/fa-home[^>]*><\/i>\s*(\d+)/);
    const awayMatch = block.match(/fa-plane[^>]*><\/i>\s*(\d+)/);
    const trendMatch = block.match(/([+-][\d.]+)€<\/div>/);

    if (nameMatch) {
      const priceRaw = priceMatch ? priceMatch[1].replace(/\./g, '') : '0';
      const trendRaw = trendMatch ? trendMatch[1].replace(/\./g, '') : '0';
      players.push({
        name: nameMatch[1].trim(),
        price: parseInt(priceRaw) || 0,
        position: posMatch ? posMatch[1].trim() : '?',
        points: pointsMatch ? parseInt(pointsMatch[1]) : 0,
        club: clubMatch ? clubMatch[1].trim() : '—',
        injured: !!injuredMatch,
        sanctioned: !!sanctionMatch,
        playedHome: homeMatch ? parseInt(homeMatch[1]) : 0,
        playedAway: awayMatch ? parseInt(awayMatch[1]) : 0,
        trend: parseInt(trendRaw) || 0
      });
    }
  }
  return players;
}

exports.handler = async function() {
  try {
    const html = await getComuniatePlayers();
    const players = parsePlayers(html);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ players, total: players.length, source: 'comuniate', timestamp: new Date().toISOString() })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
