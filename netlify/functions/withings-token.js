exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const CLIENT_ID     = process.env.WITHINGS_CLIENT_ID;
  const CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET;
  const REDIRECT_URI  = 'https://miopianoallenamento.netlify.app/callback';

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { code, grant_type, refresh_token } = body;

  const params = new URLSearchParams({
    action: 'requesttoken',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  });

  if (grant_type === 'refresh_token') {
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refresh_token);
  } else {
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
  }

  try {
    const res = await fetch('https://wbsapi.withings.net/v2/oauth2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await res.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
