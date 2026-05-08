module.exports = async function handler(req, res) {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({
      error: 'missing url parameter',
      usage: '/api/proxy?url=<encoded URL>'
    });
  }

  // 보안: 허용 도메인만 프록시 (외부에서 악용 방지)
  const ALLOWED_HOSTS = [
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
    'stooq.com',
    'finance.yahoo.com',
  ];

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ error: 'invalid url', url: targetUrl });
  }

  if (!ALLOWED_HOSTS.includes(parsed.host)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(403).json({
      error: 'host not allowed',
      host: parsed.host,
      allowed: ALLOWED_HOSTS
    });
  }

  try {
    // User-Agent 없으면 야후가 종종 거부함
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
      },
    });

    const body = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'text/plain';

    // CORS + 캐시 (vercel edge에서 30초 캐시 → 부하 감소)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Proxy-Source', parsed.host);

    res.status(upstream.status).send(body);
  } catch (error) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(502).json({
      error: 'upstream_failed',
      message: error.message,
      target: targetUrl,
    });
  }
};
