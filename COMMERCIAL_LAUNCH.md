# Hoàn Lại — cổng mở thương mại

Website đang chạy ở chế độ `closed_beta`. Không chuyển `SERVICE_MODE` sang `production` chỉ vì trang web tải được.

## Các chốt bắt buộc

1. Điền `BUSINESS_LEGAL_NAME`, `BUSINESS_ADDRESS`, `SUPPORT_EMAIL` trong `wrangler.toml` bằng thông tin được phép công khai.
2. Resend và xác minh email tự động đã được tích hợp. Trước khi mở công khai, dùng tài khoản thật để test cả email quên mật khẩu và email xác minh (Inbox/Spam, liên kết một lần, hết hạn, gửi lại).
3. Cấu hình secret `ALERT_EMAIL` đến hộp thư quản trị riêng tư (hoặc `ALERT_WEBHOOK_URL`), sau đó bấm **Thử cảnh báo** trong admin.
4. Turnstile production đã ghi nhận token thật thành công và chặn dùng lại. Kiểm tra lại sau mỗi lần đổi widget, hostname hoặc secret.
5. Chạy một đơn Shopee giá trị nhỏ qua link của đúng tài khoản. Chờ transaction về và kiểm tra `utm_content/sub3`, `status`, `is_confirmed`, hoa hồng, cashback và trạng thái ví.
6. Test yêu cầu rút tiền với dữ liệu thử: khóa 24 giờ, chống trùng nơi nhận, chống tạo hai lệnh chờ, reveal cần nhập lại mật khẩu admin, paid/rejected chỉ chuyển trạng thái một lần.
7. Kiểm tra trang `/admin`: mọi mục trong “Sẵn sàng mở thương mại” phải xanh. Giải quyết mọi đơn đã duyệt nhưng chưa gán.
8. Nhờ luật sư/kế toán rà soát mô hình affiliate/cashback, thông tin phải công bố, nghĩa vụ thuế, chứng từ và thời hạn lưu trữ trước khi nhận/rút tiền thật.
9. Chụp backup D1 ngoài hệ thống trước mỗi migration lớn. D1 Time Travel là lớp khôi phục ngắn hạn, không thay thế bản xuất SQL định kỳ.
10. Chỉ sau khi hoàn tất các mục trên mới đổi `SERVICE_MODE = "production"`, tạo backup, deploy và chạy `npm run verify:production`.

## Quy trình phát hành an toàn

```powershell
cd C:\Users\tphon\Desktop\cashback-at-cloudflare-strict\cashback-at-cloudflare
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
npm run typecheck
.\backup-d1.ps1
npx wrangler d1 execute cashback-db --remote --file=./migrations/<migration>.sql
npx wrangler deploy
npm run verify:production
```

Không đưa API key, secret, file backup D1 hoặc dữ liệu khách hàng vào Git/chat. Khi một secret từng xuất hiện trong chat hoặc ảnh, thu hồi và tạo lại.

## Sự cố tiền hoặc dữ liệu

- Tạm dừng duyệt rút và chuyển `SERVICE_MODE` về `closed_beta`.
- Không sửa trực tiếp số dư. Lưu evidence, transaction ID, payout ID và audit liên quan.
- Kiểm tra `/health`, Workers Logs, lần sync gần nhất và bảng đối soát admin.
- Nếu dữ liệu bị ảnh hưởng, cô lập khóa/secret, xác định phạm vi, lưu timeline và xin tư vấn nghĩa vụ thông báo.
- Khôi phục D1 chỉ sau khi có backup mới của trạng thái hiện tại và đã xác nhận đúng restore point.
