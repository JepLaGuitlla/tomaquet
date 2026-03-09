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

exports.handler = async function() {
  const html = await getComuniatePlayers();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
    body: html.substring(0, 3000)
  };
};
