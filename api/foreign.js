// =============================================================
// 외국인/기관 매매 동향 API v2 (Vercel 서버리스 함수)
// 위치: /api/foreign.js
// 호출: /api/foreign?code=010120
// 디버그: /api/foreign?code=010120&debug=1  ← HTML 미리보기 포함
// =============================================================

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const code = req.query.code;
  const debug = req.query.debug === '1';

  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      error: 'invalid code',
      hint: '6자리 한국 주식 코드 필요',
    });
  }

  // 두 URL 시도: frgn_table이 실제 데이터 페이지일 가능성 높음
  const urls = [
    `https://finance.naver.com/item/frgn.naver?code=${code}&page=1`,
    `https://finance.naver.com/item/frgn_table.naver?code=${code}&page=1`,
  ];

  const debugInfo = { tries: [] };

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const tryInfo = {
      url,
      status: 0,
      htmlLen: 0,
      totalTrs: 0,
      rowsFound: 0,
      error: null,
    };

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'Referer': `https://finance.naver.com/item/main.naver?code=${code}`,
          'Cache-Control': 'no-cache',
        },
      });

      tryInfo.status = response.status;
      if (!response.ok) {
        tryInfo.error = `HTTP ${response.status}`;
        debugInfo.tries.push(tryInfo);
        continue;
      }

      const buffer = await response.arrayBuffer();
      tryInfo.htmlLen = buffer.byteLength;

      // EUC-KR 디코딩 시도
      let html;
      try {
        html = new TextDecoder('euc-kr').decode(buffer);
      } catch (e) {
        html = new TextDecoder('utf-8').decode(buffer);
      }

      // 모든 tr 행 처리 (관대한 정규식)
      const data = [];
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let rowMatch;
      let totalTrs = 0;

      while ((rowMatch = rowRegex.exec(html)) !== null) {
        totalTrs++;
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

        // 컬럼 수에 따라 인덱스 자동 조정 (전일비/등락률 차이 처리)
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
        const inst =
          parseInt((cells[instIdx] || '0').replace(/[,]/g, ''), 10) || 0;
        const frgn =
          parseInt((cells[frgnIdx] || '0').replace(/[,]/g, ''), 10) || 0;
        const frgnHold =
          parseInt((cells[frgnHoldIdx] || '0').replace(/,/g, ''), 10) || 0;
        const frgnRate =
          parseFloat((cells[frgnRateIdx] || '0').replace(/[%]/g, '')) || 0;

        data.push({
          date,
          close,
          chgRate,
          vol,
          inst,
          frgn,
          frgnHold,
          frgnRate,
        });
      }

      tryInfo.totalTrs = totalTrs;
      tryInfo.rowsFound = data.length;

      // 디버그 모드면 HTML 일부 보존
      if (debug && data.length === 0) {
        tryInfo.htmlPreview = html.substring(0, 2000);
        // 첫 번째 tr 내용 미리보기
        const firstTr = html.match(/<tr[^>]*>([\s\S]{0,500}?)<\/tr>/);
        if (firstTr) tryInfo.firstTrPreview = firstTr[0].substring(0, 500);
      }

      debugInfo.tries.push(tryInfo);

      if (data.length > 0) {
        res.setHeader(
          'Cache-Control',
          'public, s-maxage=300, stale-while-revalidate=600'
        );
        const result = { code, count: data.length, data, urlUsed: i };
        if (debug) result.debug = debugInfo;
        return res.json(result);
      }
    } catch (e) {
      tryInfo.error = e.message;
      debugInfo.tries.push(tryInfo);
    }
  }

  // 모든 URL 실패
  return res.status(200).json({
    code,
    count: 0,
    data: [],
    warning: 'no rows parsed - 네이버 페이지 구조 변경 또는 차단',
    debug: debugInfo,
  });
};
