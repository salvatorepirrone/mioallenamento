exports.handler = async function() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.WITHINGS_CLIENT_ID
    })
  };
};
