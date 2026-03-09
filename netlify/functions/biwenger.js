const LEAGUE_ID = "44700";

async function getComuniatePlayers() {
  const params = new URLSearchParams({
    operacion: '1', nombre: '', id_equipo: '0',
    posicion: '0', 'precio-min': '0', 'precio-max': '29000000',
    modo: 'biwenger', limite: '0', ordenar: '0'
  });
  const res = await fetch('https://www.comuniate.com/ajax/jugadores/comunio_jugadores.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://www.comuniate.com/jugadores/comunio' },
    body: params.toString()
  });
  return res.text();
}

function parsePlayers(html) {
  const players = [];
  const regex = /ficha_jugador[^"]*"[^>]*>[\s\S]*?<span[^>]*>(.*?)<\/span>[\s\S]*?(\d+[\.,]\d+)[\s\S]*?<\/div>/g;
  const nameRegex = /alt="([^"]+)"/g;
  const priceRegex = /(\d+[\.,]\d+)\.?\d*\s*€/g;
  const posRegex = /badge-(DL|MC|DF|PT|MC\/DL)/g;
  const pointsRegex = /\b(\d{2,3})\b/g;
  const blocks = html.split('ficha_jugador');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const nameMatch = block.match(/alt="([^"]+)"/);
    const priceMatch = block.match(/([\d]+\.[\d]+|[\d]+,[\d]+)\s*€/);
    const posMatch = block.match(/badge-(DL|MC|DF|PT|MC\/DL)/);
    const pointsMatch = block.match(/>(\d{2,3})<\/div>/);
    if (nameMatch) {
      players.push({
        name: nameMatch[1],
        price: priceMatch ? priceMatch[1].replace('.', '').replace(',', '.') : '0',
        position: posMatch ? posMatch[1] : '?',
        points: pointsMatch ? parseInt(pointsMatch[1]) : 0
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
