# Cashback Shopee + TikTok qua ACCESSTRADE (Cloudflare Workers + D1)

MVP này làm 4 việc:

1. Thành viên dán link Shopee/TikTok.
2. Worker gọi ACCESSTRADE để tạo affiliate link và gắn `request_id` riêng cho từng lần bấm.
3. Cron 15 phút/lần lấy `/v1/transactions`, đối chiếu `utm_content` với `request_id` do chính hệ thống tạo.
4. **STRICT MODE:** chỉ khi `status=1` **và** `is_confirmed=1` mới cộng 60% commission vào cashback. Giao dịch chưa đối soát chỉ hiển thị số đơn đang chờ, không hiển thị thành tiền đã xác nhận.

## Vì sao dùng Cloudflare?
Không cần VPS và không cần bật máy tính 24/7. Worker + D1 phù hợp để test MVP miễn phí trong giới hạn Free plan.

## API ACCESSTRADE đang dùng

- Auth: `Authorization: Token <access_key>`
- Shopee/generic: `POST /v1/product_link/create`
- TikTok Shop V2: `POST /v2/tiktokshop_product_feeds/create_link`
- Transactions: `GET /v1/transactions`
- Transactions rate limit công bố: 10 request/phút.
- Status: `0 = Pending/Hold`, `1 = Approved`, `2 = Rejected`.
- `is_confirmed=1`: ACCESSTRADE đã đối soát thành công và đồng ý thanh toán.
- Hệ thống này yêu cầu **cả `status=1` và `is_confirmed=1`** trước khi cộng cashback.

> Quan trọng: đừng gửi Access Key cho người khác và đừng commit key vào Git.

---

## 1. Chuẩn bị

Cần:
- Tài khoản Cloudflare miễn phí
- Node.js 20+ trên máy dùng để deploy (chỉ cần lúc cài/deploy, không cần chạy 24/7)
- ACCESSTRADE API Access Key
- Campaign Shopee trên ACCESSTRADE đã được duyệt và Campaign ID tương ứng
- TikTok Shop/TTS CPS trên ACCESSTRADE đã được phép chạy API

Cài dependency:

```bash
npm install
```

Đăng nhập Cloudflare:

```bash
npx wrangler login
```

## 2. Tạo D1

```bash
npx wrangler d1 create cashback-db
```

Cloudflare trả về `database_id`. Thay:

```toml
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

trong `wrangler.toml`.

Khởi tạo bảng:

```bash
npm run db:init:remote
```

## 3. Cấu hình Campaign Shopee

Trong `wrangler.toml`, thay:

```toml
AT_SHOPEE_CAMPAIGN_ID = "REPLACE_WITH_SHOPEE_CAMPAIGN_ID"
```

bằng campaign ID Shopee đã được duyệt của chính tài khoản ACCESSTRADE.

Có thể kiểm tra campaign đã duyệt qua API:

```bash
curl -H "Authorization: Token YOUR_KEY" \
"https://api.accesstrade.vn/v1/campaigns?approval=successful"
```

## 4. Lưu secret an toàn

Không đặt API key vào source code.

```bash
npx wrangler secret put AT_ACCESS_KEY
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put BANK_DATA_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ALERT_EMAIL
```

`ADMIN_SECRET` và `BANK_DATA_KEY` phải là chuỗi dài ngẫu nhiên. Không đưa bất kỳ secret nào vào `wrangler.toml`, Git hoặc nội dung chat.

`RESEND_API_KEY` dùng để gửi email khôi phục mật khẩu và xác minh email từ tên miền đã xác minh `notify.hoanlai.id.vn`. `ALERT_EMAIL` là địa chỉ quản trị riêng tư nhận cảnh báo đồng bộ; giá trị chỉ lưu trong Cloudflare Secret và không xuất hiện trên website. Token xác minh chỉ lưu dưới dạng SHA-256, hết hạn sau 24 giờ và chỉ dùng một lần.

## 5. Deploy

```bash
npm run deploy
```

Sau deploy sẽ có URL dạng:

```text
https://cashback-at.<ten-ban>.workers.dev
```

Mở URL đó trên điện thoại. Thành viên dán link và nhận affiliate link tự động.

## 6. Test trước khi mời người thật

### Test tạo link
- Dán 1 link Shopee.
- Dán 1 link TikTok Shop.
- Kiểm tra link trả về mở đúng sản phẩm.
- Trong ACCESSTRADE, kiểm tra click có được ghi nhận.

### Test đồng bộ và đối soát

Mở `https://hoanlai.id.vn/admin`, đăng nhập quản trị rồi bấm **Đồng bộ AT**. Bảng đối soát hiển thị đơn chưa gán, cashback lệch công thức và tài khoản có số tiền rút vượt cashback đã xác nhận.

Chạy smoke test công khai, không cần mật khẩu:

```powershell
npm run verify:production
```

Nếu transaction của AT không trả `utm_content` đúng như dự kiến, KHÔNG trả cashback vội. Dùng báo cáo ACCESSTRADE và log tạm thời đã được kiểm soát để xác định field tracking rồi chỉnh `normalizeTransaction()`. Production chỉ lưu snapshot trường chuẩn hóa, không giữ payload thô có thể chứa dữ liệu dư thừa.

## 7. Chính sách tiền hiện tại

Mặc định:

```text
CASHBACK_RATE = 0.60
MIN_PAYOUT_VND = 50000
```

- Chưa xác nhận (`is_confirmed=0`): chỉ ghi nhận là **đang đối soát**, không cộng tiền.
- Chỉ `status=1` **và** `is_confirmed=1`: cộng cashback thật.
- Rejected (`status=2`): cashback = 0.
- Transaction không map được về `request_id` do hệ thống tạo: **không cộng tiền**, đưa vào danh sách `unattributed` để kiểm tra.
- Yêu cầu rút vẫn cần admin chuyển tiền và đánh dấu `paid`.
- Một tài khoản ngân hàng/ví không thể liên kết với nhiều thành viên. Hệ thống chỉ lưu HMAC fingerprint để so trùng, không thể khôi phục số tài khoản từ fingerprint.
- Sau khi thêm hoặc đổi nơi nhận tiền, chức năng rút bị khóa 24 giờ để giảm rủi ro chiếm tài khoản.

Đánh dấu đã trả trong `/admin`: bấm **Xem STK**, nhập lại mật khẩu quản trị, chuyển khoản, sau đó bấm **Đã trả** và nhập mã giao dịch/nội dung chuyển khoản. Không dùng API admin bằng secret đặt trong header.

## 8. Zalo

Bản này cố ý **không dùng automation Zalo cá nhân không chính thức**. Cách dùng an toàn cho MVP:

- Ghim URL Worker trong nhóm Zalo.
- Thành viên mở trang → dán link → nhận link ngay.
- Sau khi hệ thống chạy ổn, có thể nối thêm Zalo OA/webhook nếu tài khoản/kênh của bạn đáp ứng điều kiện chính thức.

Core cashback không phụ thuộc Zalo, nên đổi kênh sau này không phải làm lại hệ thống.

## 9. Một điểm cần kiểm tra với ACCESSTRADE trước khi scale

Xác nhận traffic/cashback của bạn được campaign chấp nhận, đặc biệt với Shopee. Hệ thống kỹ thuật chạy được không có nghĩa mọi hình thức incentive/cashback đều mặc nhiên được phép theo điều khoản campaign.

## 10. Cấu trúc tracking

Mỗi link tạo ra được gắn:

```text
utm_source   = cashback_zalo
utm_medium   = affiliate
utm_campaign = cashback_shopee / cashback_tiktok
utm_content  = <requestId>
sub1         = <memberCode>
sub2         = shopee / tiktok
sub3         = <requestId>
```

`utm_content`/`sub3` phải khớp một `request_id` đã được hệ thống tạo. Sau đó `request_id` mới được dùng để tìm thành viên; client không thể tự khai một member code để nhận tiền của người khác.

---

## Việc còn lại trước khi mở thương mại

- Mua thử một đơn giá trị nhỏ và chờ ACCESSTRADE trả transaction thật để xác nhận tracking/status/is_confirmed.
- Chạy trọn luồng đăng ký → đăng nhập → tạo link → đơn → duyệt → rút → admin chuyển tiền.
- Cấu hình secret `ALERT_EMAIL` để nhận cảnh báo đồng bộ qua Resend; `ALERT_WEBHOOK_URL` là kênh dự phòng tùy chọn. Trong admin bấm **Thử cảnh báo** để xác nhận gửi thành công.
- Điền pháp nhân, địa chỉ, kênh hỗ trợ và nhờ luật sư/kế toán rà soát chính sách.
- Chuyển tiền tự động và OTP/KYC là giai đoạn sau; hiện admin chuyển khoản thủ công có mã tham chiếu, audit, chống trùng nơi nhận tiền và khóa 24 giờ sau khi đổi thông tin.
- Người dùng gửi khiếu nại ngay trong tab **Hỗ trợ**; admin tiếp nhận, ghi kết quả và đóng yêu cầu tại `/admin`.
- Người dùng có thể tự đổi mật khẩu, tải bản sao dữ liệu và gửi yêu cầu chỉnh sửa/đóng tài khoản trong tab **Tài khoản**.
- Đăng ký mới bắt buộc chấp thuận đúng phiên bản điều khoản/chính sách; tài khoản cũ phải đồng ý lại trước khi tạo link, đổi nơi nhận tiền hoặc rút tiền.
- Đăng ký mới được gửi email xác minh tự động. Tài khoản chưa xác minh vẫn xem được dữ liệu và gửi hỗ trợ, nhưng không thể tạo link, đổi nơi nhận tiền hoặc rút tiền.
- Admin có bảng **Sẵn sàng mở thương mại**. Xem quy trình đầy đủ tại `COMMERCIAL_LAUNCH.md`.

Khi Shopee cấp Open API, chỉ cần thêm một adapter `ShopeeDirectAdapter`; phần member/wallet/payout không phải viết lại.


## STRICT MODE - nguyên tắc an toàn

Hệ thống không coi "có đơn" hay "tạm duyệt" là tiền của khách.

Một giao dịch chỉ được cộng cashback nếu đồng thời thỏa:
1. Transaction map chính xác tới một `request_id` do hệ thống đã tạo.
2. `status = 1`.
3. `is_confirmed = 1`.
4. `commission > 0`.
5. Không phải transaction bị reject.

Nếu một trong các điều kiện trên thiếu, số dư khả dụng không tăng.

Nếu đã tạo D1 bằng bản cũ, chỉ áp dụng lần lượt các migration chưa có. Không chạy lại migration `ALTER TABLE` đã áp dụng. Ví dụ migration mới nhất:

```bash
npx wrangler d1 execute cashback-db --remote --file=./migrations/013_email_verification.sql
```
