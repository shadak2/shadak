async function fetchOnePage(code, page) {
  const url = `https://finance.naver.com/item/frgn.naver?code=${code}&page=${page}`;
  const tryInfo = {
    url, page, status: 0, htmlLen: 0, totalTrs: 0, rowsFound: 0, error: null,
  };
  const data = [];

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': `https://finance.naver.com/item/main.naver?code=${code}`,
        'Cache-Control': 'no-cache',
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

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      tryInfo.totalTrs++;
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

      if (cells.length < 6) continue;
      const dateStr = cells[0];
      if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) continue;

      const date = dateStr.replace(/\./g, '-');
      const close = parseInt(cells[1].replace(/,/g, ''), 10) || 0;

      const has9Cols = cells.length >= 9;
      const chgIdx = has9Cols ? 3 : 2;
      const volIdx = has9Cols ? 4 : 3;
      const instIdx = has9Cols ? 5 : 4;
      const frgnIdx = has9Cols ? 6 : 5;
      const frgnHoldIdx = has9Cols ? 7 : 6;
      const frgnRateIdx = has9Cols ? 8 : 7;

      let chgRate = 0;
      if (cells[chgIdx]) {
        const chgClean = cells[chgIdx].replace(/[%+,\s]/g, '');
        chgRate = parseFloat(chgClean) || 0;
        if (cells[chgIdx].includes('-')) chgRate = -Math.abs(chgRate);
      }

      const vol = parseInt((cells[volIdx] || '0').replace(/,/g, ''), 10) || 0;
      const inst = parseInt((cells[instIdx] || '0').replace(/,/g, ''), 10) || 0;
      const frgn = parseInt((cells[frgnIdx] || '0').replace(/,/g, ''), 10) || 0;
      const frgnHold =
        parseInt((cells[frgnHoldIdx] || '0').replace(/,/g, ''), 10) || 0;
      const frgnRate =
        parseFloat((cells[frgnRateIdx] || '0').replace(/[%]/g, '')) || 0;

      data.push({ date, close, chgRate, vol, inst, frgn, frgnHold, frgnRate });
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
  const pages = Math.max(1, Math.min(5, parseInt(req.query.pages, 10) || 3));

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
    // 페이지간 100ms 딜레이 (네이버 부담 감소)
    if (page < pages && data.length > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // 최신순 정렬
  allData.sort((a, b) => b.date.localeCompare(a.date));

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
