# Đậu Hủ Thúi Nhà Họ La · Game bán hàng

Mini game bán đậu hủ thúi trên điện thoại, chạy bằng 1 file `index.html` (HTML/CSS/JS thuần, không cần cài gì).

- Chơi: mở `index.html` hoặc link GitHub Pages của repo.
- Quản lý menu: thêm `?admin` vào cuối link.
- Đăng nhập Google + bảng xếp hạng: dán config Firebase vào `FIREBASE_CONFIG` trong `index.html`.

## 🤖 Bật AI cho đánh giá & trả lời khách

Game gọi AI qua một máy chủ trung gian nhỏ (Cloudflare Worker, miễn phí) để không lộ mã khoá API.

1. Lấy mã khoá API miễn phí ở **Google AI Studio** (aistudio.google.com → Get API key). Hoặc dùng mã khoá Anthropic (Claude).
2. Vào **dash.cloudflare.com** → đăng ký/đăng nhập → **Workers & Pages** → **Create** → **Create Worker** → đặt tên `dau-hu-ai` → **Deploy**.
3. Bấm **Edit code**, xoá hết code mẫu, dán toàn bộ nội dung file `ai-worker/worker.js` → **Deploy**.
4. Vào **Settings → Variables and Secrets → Add**: kiểu **Secret**, tên `GEMINI_API_KEY` (hoặc `ANTHROPIC_API_KEY`), giá trị là mã khoá → **Deploy**.
5. Copy link Worker (dạng `https://dau-hu-ai.<tên>.workers.dev`), dán vào dòng `const AI_URL = '';` trong `index.html`.

Giới hạn sẵn: tối đa 20 lượt/phút mỗi IP và 40 lượt AI mỗi ngày chơi cho mỗi người. AI lỗi thì game tự dùng câu có sẵn.
