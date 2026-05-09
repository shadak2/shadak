async function fetchOnePage(code, page) {
  const url = `https://finance.naver.com/item/sise_day.naver?code=${code}&page=${page}`;
  const tryInfo = { url, page, status: 0, htmlLen: 0, rowsFound: 0, error: null };
  const data = [];

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': `https://finance.naver.com/item/main.naver?code=${code}`,
      },
    });

    tryInfo.status = response.status;
    if (!response.ok) {
      tryInfo.error = `HTTP ${response.status}`;
      return { data, tryInfo };
    }

    const buffer = await response.arrayBuffer();
    tryInfo.htmlLen = buffer.byteLength;

    let html;
    try {
      html = new TextDecoder('euc-kr').decode(buffer);
    } catch (e) {
      html = new TextDecoder('utf-8').decode(buffer);
    }

    // tr 단위 파싱 (외인/기관과 같은 패턴)
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const cells = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(rowMatch[1])) !== null) {
        const text = tdMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/[\r\n\t]+/g, ' ')
          .trim();
        cells.push(text);
      }

      // 일별 시세는 7개 셀: [날짜, 종가, 전일비, 시가, 고가, 저가, 거래량]
      if (cells.length < 7) continue;
      const dateStr = cells[0];
      if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) continue;

      const date = dateStr.replace(/\./g, '-');
      const close = parseInt(cells[1].replace(/,/g, ''), 10) || 0;
      const open = parseInt(cells[3].replace(/,/g, ''), 10) || 0;
      const high = parseInt(cells[4].replace(/,/g, ''), 10) || 0;
      const low = parseInt(cells[5].replace(/,/g, ''), 10) || 0;
      const volume = parseInt(cells[6].replace(/,/g, ''), 10) || 0;

      if (close === 0 || open === 0) continue;

      data.push({ date, open, high, low, close, volume });
    }

    tryInfo.rowsFound = data.length;
  } catch (e) {
    tryInfo.error = e.message;
  }

  return { data, tryInfo };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const code = req.query.code;
  const debug = req.query.debug === '1';
  const pages = Math.max(1, Math.min(30, parseInt(req.query.pages, 10) || 10));

  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      error: 'invalid code',
      hint: '6자리 한국 주식 코드 필요',
    });
  }

  const allData = [];
  const tries = [];
  const seen = new Set();

  for (let page = 1; page <= pages; page++) {
    const { data, tryInfo } = await fetchOnePage(code, page);
    tries.push(tryInfo);
    for (const row of data) {
      if (!seen.has(row.date)) {
        seen.add(row.date);
        allData.push(row);
      }
    }
    if (page < pages && data.length > 0) {
      await new Promise((r) => setTimeout(r, 80));
    }
    // 빈 페이지 만나면 종료
    if (data.length === 0 && page > 1) break;
  }

  // 오래된 → 최신 순으로 정렬 (차트용)
  allData.sort((a, b) => a.date.localeCompare(b.date));

  if (allData.length === 0) {
    return res.status(200).json({
      code,
      count: 0,
      data: [],
      warning: 'no rows parsed',
      debug: debug ? { tries } : undefined,
    });
  }

  res.setHeader(
    'Cache-Control',
    'public, s-maxage=300, stale-while-revalidate=600'
  );

  const result = {
    code,
    count: allData.length,
    pagesFetched: pages,
    data: allData,
  };
  if (debug) result.debug = { tries };
  return res.json(result);
};
