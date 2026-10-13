# Tự động cộng ngân lượng

Luồng: khách bấm Nạp → game tạo mã VietQR có sẵn số tiền + nội dung `NL XXXXXX` → khách chuyển khoản →
dịch vụ đọc giao dịch (SePay hoặc Casso) báo cho máy chủ `worker.js` → máy chủ cộng ngân lượng vào Firebase →
game của khách hiện "+X ngân lượng" ngay.

## 1. Dịch vụ đọc giao dịch ngân hàng
- Đăng ký SePay (sepay.vn) hoặc Casso (casso.vn), liên kết tài khoản ngân hàng nhận tiền.
- Tài liệu SePay và Casso hiện không ghi Vietcombank trong danh sách hỗ trợ webhook.
  Nếu dashboard không cho thêm Vietcombank, mở một tài khoản MB Bank / ACB / TPBank... rồi sửa
  `BANK` trong `src.html` (bin, tên, số tài khoản, chủ tài khoản).

## 2. Khoá bí mật Firebase
Firebase Console → ⚙ Project settings → Service accounts → Database secrets → Show → copy.

## 3. Tạo máy chủ trên Cloudflare (miễn phí)
1. dash.cloudflare.com → Workers & Pages → Create → Create Worker → đặt tên `tiendo-pay` → Deploy.
2. Edit code → xoá hết → dán toàn bộ `worker.js` → Deploy.
3. Settings → Variables and Secrets → thêm:
   - `FB_URL` = `https://dau-hu-thui-default-rtdb.asia-southeast1.firebasedatabase.app`
   - `FB_SECRET` = khoá ở bước 2 (chọn loại Secret)
   - `HOOK_KEY` = một chuỗi bí mật tự đặt, ví dụ `tiendo-8f3k2...` (loại Secret)
   - `BANK_ACC` = số tài khoản nhận tiền
4. Copy địa chỉ worker, dạng `https://tiendo-pay.<ten>.workers.dev`.

## 4. Gắn webhook
- SePay: Webhooks → Thêm → URL = địa chỉ worker, Kiểu chứng thực = API Key, API Key = `HOOK_KEY`,
  chỉ nhận tiền vào.
- Casso: Thiết lập Webhook → URL = địa chỉ worker, Secure token = `HOOK_KEY`.

## 5. Bật trong game
Trong `src.html` đổi `const AUTO_TOPUP = false` thành `true` để màn nạp ghi "tự cộng sau 1 phút".

## 6. Luật Firebase thêm
```json
"tt_txn": { ".read": false, ".write": false },
```
(Máy chủ dùng khoá bí mật nên vẫn ghi được.)
