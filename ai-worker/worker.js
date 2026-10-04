// Máy chủ AI trung gian cho game "Đậu Hủ Thúi Nhà Họ La" — chạy trên Cloudflare Workers (gói miễn phí).
// Giữ mã khoá API bí mật, game chỉ gọi tới đây.
// Biến môi trường (Settings → Variables and Secrets):
//   GEMINI_API_KEY      (khuyên dùng, có gói miễn phí)   hoặc   ANTHROPIC_API_KEY
//   MODEL               (tuỳ chọn) ví dụ gemini-2.5-flash  hoặc  claude-haiku-4-5
//   ALLOW_ORIGIN        (tuỳ chọn) mặc định https://tien2201.github.io

const DEF_ORIGIN = 'https://tien2201.github.io';
const hits = new Map(); // giới hạn lượt gọi theo IP (ước lượng, theo từng máy chủ Cloudflare)

function cors(env, req){
  const allow = (env.ALLOW_ORIGIN || DEF_ORIGIN).split(',').map(s => s.trim());
  const o = req.headers.get('Origin') || '';
  const ok = allow.includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o);
  return { 'Access-Control-Allow-Origin': ok ? o : allow[0], 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
function limited(ip){
  const now = Date.now(), w = hits.get(ip) || [];
  const recent = w.filter(t => now - t < 60000);
  recent.push(now); hits.set(ip, recent);
  return recent.length > 20; // tối đa 20 lượt/phút mỗi IP
}
const clip = (s, n) => String(s || '').slice(0, n);

const SYS = `Bạn đóng vai khách hàng thật của quán đậu hủ thúi "Nhà Họ La" ở Sài Gòn trong một trò chơi vui.
Viết tiếng Việt tự nhiên như người thật bình luận trên Google Maps / Facebook: ngắn gọn, có cảm xúc, có thể dùng teencode nhẹ hoặc emoji.
Không bao giờ nhắc tới việc mình là AI. Không chửi tục nặng, không phân biệt đối xử, không nội dung người lớn.`;

function buildPrompt(path, b){
  if(path === '/review'){
    const facts = [
      `Số sao: ${b.stars}/5`, `Món đã ăn: ${clip(b.dish, 40)}`, b.mins ? `Chờ khoảng ${b.mins} phút` : '',
      b.mist ? 'Quán làm sai món / sai lời dặn' : '', b.dirty ? 'Quán hơi dơ' : '', b.pricey ? 'Thấy giá hơi mắc' : '', b.cheap ? 'Thấy giá rẻ' : '',
      b.online ? `Đặt qua app giao hàng` : 'Ăn tại quán', b.weather ? `Thời tiết: ${clip(b.weather, 30)}` : '',
      b.staff ? `Nhân viên: ${clip(b.staff, 120)}` : '', b.persona ? `Người viết: ${clip(b.persona, 60)}` : '',
      b.lang && b.lang !== 'vi' ? `Viết bằng ngôn ngữ của khách (${clip(b.lang, 20)}), sau đó xuống dòng ghi "— Dịch: " kèm bản tiếng Việt` : '',
    ].filter(Boolean).join('\n');
    return `Viết MỘT đánh giá (1-3 câu, dưới 280 ký tự) dựa trên các sự thật sau, đúng với số sao:\n${facts}\nChỉ trả về nội dung đánh giá.`;
  }
  if(path === '/reply'){
    const th = (b.thread || []).slice(-6).map(m => `${m.w === 'o' ? 'Chủ quán' : m.w === 'c' ? 'Khách' : 'Người khác'}: ${clip(m.t, 200)}`).join('\n');
    return `Bạn là khách tên ${clip(b.name, 40)} đã viết đánh giá ${b.stars}★: "${clip(b.review, 300)}".
Cuộc trò chuyện:\n${th}\nChủ quán vừa trả lời (giọng điệu: ${clip(b.tone, 10)}): "${clip(b.owner, 300)}".
Hãy trả lời lại chủ quán MỘT câu (dưới 200 ký tự), đúng tính cách khách: nếu chủ quán lịch sự thì dịu lại, nếu chủ quán hỗn thì phản pháo gay gắt (không tục). Chỉ trả về câu trả lời.`;
  }
  if(path === '/owner'){
    return `Bạn là nhân viên quản lý page của quán đậu hủ thúi "${clip(b.shop, 40)}", tính cách: ${clip(b.trait, 60)}.
Khách ${clip(b.name, 40)} đánh giá ${b.stars}★: "${clip(b.review, 300)}".
Viết MỘT câu trả lời thay mặt quán (dưới 200 ký tự), đúng tính cách nhân viên. Chỉ trả về câu trả lời.`;
  }
  return null;
}

async function callGemini(env, sys, prompt){
  const model = env.MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ systemInstruction:{ parts:[{ text:sys }] }, contents:[{ role:'user', parts:[{ text:prompt }] }], generationConfig:{ maxOutputTokens:220, temperature:1 } }),
  });
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}
async function callClaude(env, sys, prompt){
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model: env.MODEL || 'claude-haiku-4-5', max_tokens:220, system:sys, messages:[{ role:'user', content:prompt }] }),
  });
  const j = await r.json();
  return j?.content?.map(c => c.text || '').join('') || '';
}

export default {
  async fetch(req, env){
    const h = cors(env, req);
    if(req.method === 'OPTIONS') return new Response(null, { headers:h });
    const url = new URL(req.url);
    if(req.method !== 'POST') return new Response('Đậu Hủ Thúi AI đang chạy ✅', { headers:h });
    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    if(limited(ip)) return Response.json({ error:'rate' }, { status:429, headers:h });
    let b; try{ b = await req.json(); }catch(e){ return Response.json({ error:'json' }, { status:400, headers:h }); }
    const prompt = buildPrompt(url.pathname, b || {});
    if(!prompt) return Response.json({ error:'path' }, { status:404, headers:h });
    try{
      const text = env.GEMINI_API_KEY ? await callGemini(env, SYS, prompt) : env.ANTHROPIC_API_KEY ? await callClaude(env, SYS, prompt) : '';
      const t = String(text).trim().replace(/^["“]|["”]$/g, '').slice(0, 600);
      if(!t) return Response.json({ error:'empty' }, { status:502, headers:h });
      return Response.json({ text:t }, { headers:h });
    }catch(e){ return Response.json({ error:'upstream' }, { status:502, headers:h }); }
  },
};
