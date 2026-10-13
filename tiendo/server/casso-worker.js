// Cloudflare Worker: nhận webhook Casso khi có tiền vào tài khoản, tự cộng ngân lượng cho người chơi.
// Biến môi trường cần đặt trong Cloudflare (Settings → Variables and Secrets):
//   FB_URL    = https://dau-hu-thui-default-rtdb.asia-southeast1.firebasedatabase.app
//   FB_SECRET = Database secret của Firebase (Project settings → Service accounts → Database secrets)
//   KEY       = một chuỗi bí mật tự đặt, ví dụ tt-8f3k2p9x (dùng trong link webhook ?key=...)
// Link webhook điền vào Casso:  https://<ten-worker>.<ten-ban>.workers.dev/casso?key=<KEY>

const PACKS = { 20000: 200, 50000: 520, 100000: 1100, 200000: 2300, 500000: 6000 };
const toNL = amount => PACKS[amount] || Math.floor(amount / 100);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'GET') return new Response('Tien Do payment hook OK');
    if (url.pathname !== '/casso' || req.method !== 'POST') return new Response('Not found', { status: 404 });
    const key = url.searchParams.get('key') || req.headers.get('secure-token') || '';
    if (!env.KEY || key !== env.KEY) return new Response('Forbidden', { status: 403 });

    let body; try { body = await req.json(); } catch (e) { return json({ success: false, msg: 'bad json' }, 400); }
    const list = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
    const db = (path, opt = {}) => fetch(`${env.FB_URL}/${path}.json?auth=${env.FB_SECRET}`, opt);
    const results = [];

    for (const tx of list) {
      const id = String(tx.id || tx.tid || ''), amount = Math.round(+tx.amount || 0), desc = String(tx.description || '');
      if (!id || amount <= 0) continue;
      // chống cộng trùng: mỗi giao dịch chỉ xử lý 1 lần
      const seen = await (await db(`tt_paid/${id}`)).json();
      if (seen) { results.push({ id, skip: 'dup' }); continue; }
      const cands = [...desc.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').matchAll(/NL\s*([A-Z0-9]{6})/g)].map(x => x[1]);
      let code = '', uid = null;
      for (const c of cands) { const u = await (await db(`tt_code/${c}`)).json(); if (u) { code = c; uid = u; break; } }
      const m = cands.length ? [0, cands[0]] : null;
      if (!m) { await db(`tt_unmatched/${id}`, { method: 'PUT', body: JSON.stringify({ amount, desc, t: Date.now() }) }); await db(`tt_paid/${id}`, { method: 'PUT', body: JSON.stringify({ amount, code: '', t: Date.now() }) }); results.push({ id, skip: 'nocode' }); continue; }
      if (!uid) { await db(`tt_unmatched/${id}`, { method: 'PUT', body: JSON.stringify({ amount, desc, code: m[1], t: Date.now() }) }); await db(`tt_paid/${id}`, { method: 'PUT', body: JSON.stringify({ amount, code: m[1], t: Date.now() }) }); results.push({ id, skip: 'nouser' }); continue; }
      const nl = toNL(amount);
      // cộng ngân lượng an toàn với ETag (không ghi đè khi có thay đổi cùng lúc)
      for (let i = 0; i < 5; i++) {
        const r = await fetch(`${env.FB_URL}/tt_wallet/${uid}/nl.json?auth=${env.FB_SECRET}`, { headers: { 'X-Firebase-ETag': 'true' } });
        const etag = r.headers.get('ETag'), cur = (await r.json()) || 0;
        const w = await fetch(`${env.FB_URL}/tt_wallet/${uid}/nl.json?auth=${env.FB_SECRET}`, { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify(cur + nl) });
        if (w.ok) break;
      }
      const now = Date.now();
      await db(`tt_paid/${id}`, { method: 'PUT', body: JSON.stringify({ amount, code, uid, nl, t: now }) });
      await db(`tt_topup`, { method: 'POST', body: JSON.stringify({ code, uid, n: nl, amount, tx: id, by: 'auto', t: now }) });
      await db(`tt_notify/${uid}/${id}`, { method: 'PUT', body: JSON.stringify({ n: nl, amount, t: now }) });
      results.push({ id, code, nl });
    }
    return json({ success: true, results });
  }
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
