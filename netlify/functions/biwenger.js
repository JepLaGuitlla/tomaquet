const BIWENGER_EMAIL = "pepepresta@hotmail.com";
const BIWENGER_PASSWORD = "Marmoles12";
const LEAGUE_ID = "44700";
const BASE_URL = "https://biwenger.as.com/api/v2";

async function login() {
  const res = await fetch(`${BASE_URL}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: BIWENGER_EMAIL, password: BIWENGER_PASSWORD, remember: true })
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data.token || data.data?.token || null;
  } catch(e) {
    console.log("Login response:", text.substring(0, 200));
    return null;
  }
}

async function get(url, token) {
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-League": LEAGUE_ID
    }
  });
  return res.json();
}

exports.handler = async function() {
  try {
    const token = await login();
    if (!token) throw new Error("Login fallido");

    const [league, account, players] = await Promise.all([
      get(`${BASE_URL}/league/${LEAGUE_ID}?include=all&fields=*,standings,tournaments,group,settings(description)`, token),
      get(`${BASE_URL}/account?fields=*,players(id,name,position,price,points,playedHome,playedAway,teamID,teamName,fitness)`, token),
      get(`${BASE_URL}/league/${LEAGUE_ID}/players?fields=id,name,position,price,points,playedHome,playedAway,teamID,teamName&order=points`, token),
    ]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ league, account, players, timestamp: new Date().toISOString() })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
