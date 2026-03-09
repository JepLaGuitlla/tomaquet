async function getComuniatePlayers() {
  const params = new URLSearchParams({
    operacion: '1', nombre: '', id_equipo: '0',
    posicion: '0', 'precio-min': '0', 'precio-max': '29000000',
    modo: 'biwenger', limite: '0', ordenar: '0'
  });
  const res = await fetch('https://www.comuniate.com/ajax/jugadores/comunio_jugadores.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://www.comuniate.com/jugadores/comunio',
      'User-Agent': 'Mozilla/5.0'
    },
    body: params.toString()
  });
  return res.text();
}

function parsePlayers(html) {
  const players = [];
  const blocks = html.split('ficha_jugador');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const nameMatch = block.match(/alt="([^"]+)"/);
    const posMatch = block.match(/label-danger[^>]*>\s*([A-Z\/]+)\s*</);
    const pointsMatch = block.match(/label-primary">(\d+)<\/span>/);
    const priceMatch = block.match(/(\d[\d.]+)\s*€/) || block.match(/precio[^>]*>([\d.]+)/i);
    const clubMatch = block.match(/title="([^"]+)"\s+class="escudo/);

    if (nameMatch && nameMatch[1] !== 'escudo') {
      const priceRaw = priceMatch ? priceMatch[1].replace(/\./g, '') : '0';
      players.push({
        name: nameMatch[1],
        price: parseInt(priceRaw) || 0,
        position: posMatch ? posMatch[1] : '?',
        points: pointsMatch ? parseInt(pointsMatch[1]) : 0,
        club: clubMatch ? clubMatch[1] : '—'
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
      body: JSON.stringify({ players, source: 'comuniate', timestamp: new Date().toISOString() })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
