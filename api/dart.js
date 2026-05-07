export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const { corp_code, bsns_year, reprt_code } = req.query;
  const API_KEY = process.env.DART_API_KEY;
  
  if (!corp_code || !API_KEY) {
    return res.status(400).json({ error: 'missing params' });
  }
  
  const url = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${API_KEY}&corp_code=${corp_code}&bsns_year=${bsns_year || new Date().getFullYear() - 1}&reprt_code=${reprt_code || '11011'}&fs_div=CFS`;
  
  try {
    const r = await fetch(url);
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
