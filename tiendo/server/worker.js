// Immortal Ascent · máy chủ tự cộng ngân lượng (Cloudflare Worker)
// Nhận thông báo "có tiền vào" từ SePay hoặc Casso, đọc nội dung "NL XXXXXX",
// tìm người chơi theo mã XXXXXX rồi cộng ngân lượng vào Firebase.
//
// Biến môi trường cần đặt trong Cloudflare (Settings → Variables and Secrets):
//   FB_URL         https://dau-hu-thui-default-rtdb.asia-southeast1.firebasedatabase.app
//   FB_SECRET      Database secret của Firebase (bí mật)
//   HOOK_KEY       Chuỗi bí mật tự đặt, dán y hệt vào SePay (API Key) hoặc Casso (secure token)
//   BANK_ACC       1053619661   (chỉ nhận tiền vào đúng tài khoản này)

const PACKS = { 20000: 200, 50000: 520, 100000: 1100, 200000: 2300, 500000: 6000 };
const nlFor = vnd => PACKS[vnd] || Math.floor(vnd / 100);

export default {
  async fetch(req, env) {
    if (req.method === 'GET') return new Response('Immortal Ascent payment hook OK');
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // 1) Kiểm tra khoá bí mật (SePay: "Authorization: Apikey KEY", Casso: "secure-token: KEY")
    const auth = req.headers.get('authorization') || '';
    const tok = req.headers.get('secure-token') || auth.replace(/^Apikey\s+/i, '').replace(/^Bearer\s+/i, '');
    if (!env.HOOK_KEY || tok !== env.HOOK_KEY) return json({ success: false, error: 'unauthorized' }, 401);

    let body;
    try { body = await req.json(); } catch (e) { return json({ success: false, error: 'bad json' }, 400); }

    // 2) Gom giao dịch về một dạng chung
    const list = [];
    if (body && body.transferAmount !== undefined) {               // SePay
      if (body.transferType === 'in') list.push({ id: 'sepay_' + body.id, amount: +body.transferAmount, text: String(body.content || '') + ' ' + String(body.description || ''), acc: String(body.accountNumber || '') });
    } else if (body && body.data) {                                  // Casso (v1: mảng, v2: object)
      for (const t of Array.isArray(body.data) ? body.data : [body.data]) {
        const amt = +t.amount;
        if (amt > 0) list.push({ id: 'casso_' + (t.id || t.tid || t.reference), amount: amt, text: String(t.description || ''), acc: String(t.accountNumber || t.subAccId || t.bankSubAccId || '') });
      }
    }

    const out = [];
    for (const t of list) out.push(await handle(t, env).catch(e => ({ id: t.id, error: String(e.message || e) })));
    // SePay cần nhận {"success":true} để không gửi lại
    return json({ success: true, results: out });
  }
};

async function handle(t, env) {
  if (env.BANK_ACC && t.acc && !t.acc.includes(env.BANK_ACC)) return { id: t.id, skip: 'other account' };
  const m = t.text.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').match(/NL\s*([A-Z0-9]{6})/);
  if (!m) return { id: t.id, skip: 'no code' };
  const code = m[1];

  // 3) Chống cộng trùng: mỗi mã giao dịch chỉ xử lý 1 lần
  const txKey = 'tt_txn/' + t.id.replace(/[.#$\[\]\/]/g, '_');
  const tx = await fb(env, txKey, 'GET', null, true);
  if (tx.val !== null) return { id: t.id, skip: 'duplicate' };
  const claim = await fb(env, txKey, 'PUT', { code, amount: t.amount, t: Date.now(), st: 'processing' }, false, tx.etag);
  if (!claim.ok) return { id: t.id, skip: 'duplicate (race)' };

  // 4) Tìm người chơi theo mã
  const uid = (await fb(env, 'tt_code/' + code, 'GET')).val;
  if (!uid) { await fb(env, txKey + '/st', 'PUT', 'no-player'); return { id: t.id, skip: 'unknown code ' + code }; }

  // 5) Cộng ngân lượng (ghi có điều kiện để không mất lượt khi 2 giao dịch tới cùng lúc)
  const n = nlFor(t.amount);
  let total = null;
  for (let i = 0; i < 6 && total === null; i++) {
    const cur = await fb(env, 'tt_wallet/' + uid + '/nl', 'GET', null, true);
    const next = (cur.val || 0) + n;
    const w = await fb(env, 'tt_wallet/' + uid + '/nl', 'PUT', next, false, cur.etag);
    if (w.ok) total = next;
  }
  if (total === null) throw new Error('wallet busy');
  await fb(env, txKey + '/st', 'PUT', 'done');
  await fb(env, 'tt_topup', 'POST', { code, uid, n, vnd: t.amount, src: t.id, by: 'auto', t: Date.now() });
  return { id: t.id, code, credited: n, total };
}

async function fb(env, path, method, body, wantEtag, ifMatch) {
  const url = env.FB_URL.replace(/\/$/, '') + '/' + path + '.json?auth=' + encodeURIComponent(env.FB_SECRET);
  const headers = { 'content-type': 'application/json' };
  if (wantEtag) headers['X-Firebase-ETag'] = 'true';
  if (ifMatch) headers['if-match'] = ifMatch;
  const r = await fetch(url, { method, headers, body: body === null || body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let val = null; try { val = JSON.parse(text); } catch (e) {}
  return { ok: r.ok, status: r.status, val, etag: r.headers.get('ETag') };
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
