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
  const blocks = html.split('class="ficha_jugador');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const nameMatch = block.match(/alt="([^"]+)"/);
    const priceMatch = block.match(/(\d+\.?\d*)\s*€/);
    const posMatch = block.match(/pos-(?:badge-)?(DL|MC|DF|PT|MC\/DL|MCDL)/i) || 
                     block.match(/"(DL|MC|DF|PT)"/i) ||
                     block.match(/>(DL|MC|DF|PT|MC\/DL)<\/span>/i);
    const pointsMatch = block.match(/puntos[^>]*>(\d+)</i) ||
                        block.match(/>(\d{2,3})<\/div>/);
    const clubMatch = block.match(/equipo[^"]*"[^>]*>([^<]+)</i) ||
                      block.match(/alt="[^"]*"\s+title="([^"]+)"/);

    if (nameMatch && nameMatch[1] !== 'escudo') {
      const priceRaw = priceMatch ? priceMatch[1].replace(/\./g, '') : '0';
      players.push({
        name: nameMatch[1],
        price: parseInt(priceRaw) || 0,
        position: posMatch ? posMatch[1].toUpperCase() : '?',
        points: pointsMatch ? parseInt(pointsMatch[1]) : 0,
        club: clubMatch ? clubMatch[1].trim() : '—',
        playedHome: 0,
        playedAway: 0
      });
    }
  }
  return players;
}

exports.handler = async function() {
  try {
    const html = await getComuniatePlayers();
    const players = parsePlayers(html);
    
    // Also return raw sample for debugging
    const sample = html.substring(0, 500);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ players, source: 'comuniate', timestamp: new Date().toISOString(), debug_sample: sample })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
