module.exports = async function handler(req, res) {
  const targetUrl = req.query.url;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  if (!targetUrl) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).json({ error: 'missing url parameter' });
  }

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
    return res.status(403).json({ error: 'host not allowed', host: parsed.host });
  }

  const isYahoo = parsed.host.includes('yahoo');
  const isStooq = parsed.host.includes('stooq');

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        // 야후가 더 잘 받아주는 데스크톱 UA로 변경
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, text/csv, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': isYahoo ? 'https://finance.yahoo.com/' : (isStooq ? 'https://stooq.com/' : ''),
      },
    });

    const body = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'text/plain';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Proxy-Source', parsed.host);

    // 캐시 전략: 성공시 5분, 실패시 짧게
    if (upstream.status === 200) {
      // Stooq는 일봉이라 길게 캐시, Yahoo는 짧게
      const maxAge = isStooq ? 600 : 300; // Stooq 10분, Yahoo 5분
      res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge*2}`);
    } else if (upstream.status === 429) {
      // Rate limit - 클라이언트가 알 수 있도록 명시
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '120');
      res.setHeader('X-Rate-Limited', 'true');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

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
