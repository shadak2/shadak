module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const code = req.query.code;
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      error: 'invalid code',
      hint: '6자리 한국 주식 코드 필요 (예: 010120, 062040)',
    });
  }

  try {
    const url = `https://finance.naver.com/item/frgn.naver?code=${code}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': 'https://finance.naver.com/',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'naver_failed',
        status: response.status,
      });
    }

    // 네이버는 EUC-KR로 응답하므로 디코딩 필요
    const buffer = await response.arrayBuffer();
    let html;
    try {
      html = new TextDecoder('euc-kr').decode(buffer);
    } catch (e) {
      html = new TextDecoder('utf-8').decode(buffer);
    }

    // 테이블 행 파싱: <tr onmouseover="..."> ... </tr>
    const data = [];
    const rowRegex = /<tr[^>]*onmouseover[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const cells = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(rowMatch[1])) !== null) {
        const text = tdMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/[\r\n\t]+/g, ' ')
          .trim();
        cells.push(text);
      }

      if (cells.length < 7) continue;

      const dateStr = cells[0];
      if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) continue;

      const date = dateStr.replace(/\./g, '-');
      const close = parseInt(cells[1].replace(/,/g, ''), 10) || 0;

      // 등락률
      let chgRate = 0;
      if (cells[3]) {
        const chgClean = cells[3].replace(/[%+,\s]/g, '');
        chgRate = parseFloat(chgClean) || 0;
        if (cells[3].includes('-')) chgRate = -Math.abs(chgRate);
      }

      const vol = parseInt(cells[4].replace(/,/g, ''), 10) || 0;

      // 기관 순매매 (cells[5])
      const instRaw = cells[5].replace(/,/g, '').trim();
      let inst = parseInt(instRaw, 10) || 0;

      // 외국인 순매매 (cells[6])
      const frgnRaw = cells[6].replace(/,/g, '').trim();
      let frgn = parseInt(frgnRaw, 10) || 0;

      // 외국인 보유주수 (cells[7])
      const frgnHold = cells[7] ? parseInt(cells[7].replace(/,/g, ''), 10) || 0 : 0;

      // 외국인 비율 (cells[8])
      const frgnRate = cells[8] ? parseFloat(cells[8].replace(/[%]/g, '')) || 0 : 0;

      data.push({ date, close, chgRate, vol, inst, frgn, frgnHold, frgnRate });
    }

    if (data.length === 0) {
      return res.status(200).json({
        code,
        count: 0,
        data: [],
        warning: 'no rows parsed - 네이버 페이지 구조 변경 가능성',
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.json({ code, count: data.length, data });
  } catch (e) {
    res.status(502).json({ error: 'fetch_failed', message: e.message });
  }
};
