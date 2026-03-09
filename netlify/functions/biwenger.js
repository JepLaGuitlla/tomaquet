async function getPage(pagina) {
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
      'User-Agent': 'Mozilla/5.0'
    },
    body: params.toString()
  });
  const buffer = await res.arrayBuffer();
  return new TextDecoder('latin1').decode(buffer);
}

function parsePage(html) {
  const players = [];
  const lines = html.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    // Posicion
    const posMatch = line.match(/^(DL|DF|PT|MD|MC)\s*$/);
    if (posMatch) {
      const pos = posMatch[1];
      // Puntos en next non-empty line
      let pts = 0;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const ptsMatch = lines[j] && lines[j].trim().match(/^(\d+)$/);
      if (ptsMatch) pts = parseInt(ptsMatch[1]);
      // Name from markdown link
      let name = '', price = 0, club = '—', injured = false, sanctioned = false;
      let home = 0, away = 0;
      for (let k = i; k < Math.min(i + 30, lines.length); k++) {
        const l = lines[k].trim();
        const nameMatch = l.match(/^\[([^\]]+)\]\(https:\/\/www\.comuniate\.com\/jugadores\//);
        if (nameMatch && !name) name = nameMatch[1];
        const priceMatch = l.match(/^([\d.]+)€$/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/\./g, ''));
        const clubMatch = l.match(/!\[([^\]]+)\]\(https:\/\/www\.comuniate\.com\/intranet\/equipos/);
        if (clubMatch) club = clubMatch[1];
        if (l.includes('lesionado')) injured = true;
        if (l.includes('sancionado')) sanctioned = true;
        const homeMatch = l.match(/\\s*(\\d+)\\s*\\\\s*(\\d+)/);
      }
      if (name) {
        players.push({ name, position: pos, points: pts, price, club, injured, sanctioned });
      }
    }
    i++;
  }
  return players;
}

exports.handler = async function() {
  try {
    const allPlayers = [];
    for (let p = 1; p <= 22; p++) {
      const html = await getPage(p);
      const players = parsePage(html);
      allPlayers.push(...players);
      if (players.length === 0) break;
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ players: allPlayers, total: allPlayers.length, source: 'comuniate', timestamp: new Date().toISOString() })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
