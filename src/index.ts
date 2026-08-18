interface Env extends Cloudflare.Env {
  AT_ACCESS_KEY: string;
  ADMIN_SECRET: string;
  BANK_DATA_KEY: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET: string;
  ALERT_WEBHOOK_URL?: string;
  ALERT_EMAIL?: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};
const CURRENT_TERMS_VERSION = "2026-08-17";
const CURRENT_PRIVACY_VERSION = "2026-08-17";

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix = "r") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function cleanMemberCode(v: string) {
  return v.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

type AuthUser = {
  memberCode: string;
  email: string;
  displayName: string;
  consentCurrent: boolean;
  emailVerified: boolean;
};
const SESSION_COOKIE = "cashback_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const ADMIN_COOKIE = "cashback_admin";
const ADMIN_SESSION_SECONDS = 60 * 60 * 8;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function recoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const value = Array.from(bytes, byte => alphabet[byte & 31]).join("");
  return `${value.slice(0, 5)}-${value.slice(5)}`;
}

function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 10);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

type ResendEmailResponse = {
  id?: string;
  message?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char] || char));
}

async function sendPasswordResetEmail(env: Env, email: string, code: string, requestId: string): Promise<string> {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const origin = String(env.APP_ORIGIN || "https://hoanlai.id.vn").replace(/\/$/, "");
  const resetUrl = `${origin}/#reset=1&email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`;
  const safeUrl = escapeHtml(resetUrl);
  const safeCode = escapeHtml(code);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `password-reset/${requestId}`,
      "user-agent": "HoanLai-Worker/1.0"
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Hoàn Lại <no-reply@notify.hoanlai.id.vn>",
      to: [email],
      subject: "Mã đặt lại mật khẩu Hoàn Lại",
      text: `Mã đặt lại mật khẩu của bạn là ${code}. Mã có hiệu lực trong 30 phút và chỉ dùng một lần. Mở trang đặt lại mật khẩu: ${resetUrl}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111"><div style="display:inline-block;background:#111;color:#9fe870;border-radius:50%;width:40px;height:40px;line-height:40px;text-align:center;font-weight:800">H</div><h1 style="font-size:28px;margin:20px 0 8px">Đặt lại mật khẩu</h1><p>Bạn vừa yêu cầu đặt lại mật khẩu Hoàn Lại.</p><p style="font-size:28px;font-weight:800;letter-spacing:3px;background:#eef0ec;border-radius:14px;padding:18px;text-align:center">${safeCode}</p><p>Mã có hiệu lực trong <strong>30 phút</strong> và chỉ dùng một lần.</p><p><a href="${safeUrl}" style="display:inline-block;background:#9fe870;color:#111;text-decoration:none;font-weight:700;border-radius:999px;padding:14px 22px">Đặt lại mật khẩu</a></p><p style="color:#666;font-size:13px">Nếu bạn không yêu cầu, hãy bỏ qua email này. Hoàn Lại không bao giờ yêu cầu bạn gửi lại mật khẩu hoặc mã này.</p></div>`
    })
  });
  const payload = await response.json<ResendEmailResponse>().catch(() => ({})) as ResendEmailResponse;
  if (!response.ok || !payload.id) {
    throw new Error(`Resend rejected request with status ${response.status}: ${String(payload.message || "unknown").slice(0, 160)}`);
  }
  return payload.id;
}

async function sendEmailVerificationEmail(env: Env, email: string, token: string, requestId: string): Promise<string> {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const origin = String(env.APP_ORIGIN || "https://hoanlai.id.vn").replace(/\/$/, "");
  const verifyUrl = `${origin}/#verify=1&token=${encodeURIComponent(token)}`;
  const safeUrl = escapeHtml(verifyUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `email-verification/${requestId}`,
      "user-agent": "HoanLai-Worker/1.0"
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Hoàn Lại <no-reply@notify.hoanlai.id.vn>",
      to: [email],
      subject: "Xác minh email Hoàn Lại",
      text: `Xác minh email để bảo vệ tài khoản và sử dụng tính năng tạo link, nhận tiền: ${verifyUrl}\n\nLiên kết có hiệu lực trong 24 giờ và chỉ dùng một lần. Nếu bạn không đăng ký tài khoản, hãy bỏ qua email này.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111"><div style="display:inline-block;background:#111;color:#9fe870;border-radius:50%;width:40px;height:40px;line-height:40px;text-align:center;font-weight:800">H</div><h1 style="font-size:28px;margin:20px 0 8px">Xác minh email</h1><p>Xác minh email để bảo vệ tài khoản Hoàn Lại và sử dụng tính năng tạo link, nhận tiền.</p><p><a href="${safeUrl}" style="display:inline-block;background:#9fe870;color:#111;text-decoration:none;font-weight:700;border-radius:999px;padding:14px 22px">Xác minh email</a></p><p>Liên kết có hiệu lực trong <strong>24 giờ</strong> và chỉ dùng một lần.</p><p style="color:#666;font-size:13px">Nếu bạn không đăng ký tài khoản, hãy bỏ qua email này. Hoàn Lại không bao giờ yêu cầu bạn gửi mật khẩu hoặc mã xác minh.</p></div>`
    })
  });
  const payload = await response.json<ResendEmailResponse>().catch(() => ({})) as ResendEmailResponse;
  if (!response.ok || !payload.id) {
    throw new Error(`Resend rejected request with status ${response.status}: ${String(payload.message || "unknown").slice(0, 160)}`);
  }
  return payload.id;
}

async function processEmailVerificationRequest(env: Env, memberCode: string, email: string): Promise<void> {
  const verified = await env.DB.prepare("SELECT email_verified_at FROM members WHERE member_code=? AND email=? AND account_status='active'")
    .bind(memberCode, email).first();
  if (!verified || verified.email_verified_at) return;
  const recent = await env.DB.prepare("SELECT 1 FROM email_verification_requests WHERE member_code=? AND status='pending' AND created_at>datetime('now','-10 minutes')")
    .bind(memberCode).first();
  if (recent) return;

  await env.DB.prepare("UPDATE email_verification_requests SET status='expired',token_hash=NULL WHERE member_code=? AND status='pending'")
    .bind(memberCode).run();
  const id = randomId("verify");
  const token = randomToken(32);
  await env.DB.prepare(`
    INSERT INTO email_verification_requests(id,member_code,email,token_hash,status,expires_at,created_at)
    VALUES (?,?,?,?, 'pending',datetime('now','+24 hours'),datetime('now'))
  `).bind(id, memberCode, email, await sha256(token)).run();
  await audit(env, memberCode, "email_verification_requested", "email_verification", id);
  try {
    const providerMessageId = await sendEmailVerificationEmail(env, email, token, id);
    await audit(env, "system", "email_verification_email_sent", "email_verification", id, { providerMessageId });
  } catch (error) {
    await env.DB.prepare("UPDATE email_verification_requests SET status='failed',token_hash=NULL WHERE id=? AND status='pending'").bind(id).run();
    await audit(env, "system", "email_verification_email_failed", "email_verification", id);
    console.error(JSON.stringify({ event: "email_verification_email_failed", requestId: id, error: String(error).slice(0, 300) }));
  }
}

async function processPasswordResetRequest(env: Env, email: string, ipHash: string): Promise<void> {
  const recentByIp = await env.DB.prepare("SELECT COUNT(*) AS count FROM password_reset_requests WHERE requested_ip_hash=? AND created_at > datetime('now','-1 hour')").bind(ipHash).first();
  const member = await env.DB.prepare("SELECT member_code FROM members WHERE email=?").bind(email).first();
  if (!member || Number(recentByIp?.count || 0) >= 5) return;
  const recent = await env.DB.prepare("SELECT 1 FROM password_reset_requests WHERE email=? AND status IN ('pending','approved') AND created_at > datetime('now','-10 minutes')").bind(email).first();
  if (recent) return;

  const memberCode = String(member.member_code);
  await env.DB.prepare("UPDATE password_reset_requests SET status='expired' WHERE member_code=? AND status IN ('pending','approved')").bind(memberCode).run();
  const id = randomId("reset");
  if (env.RESEND_API_KEY) {
    const code = recoveryCode();
    await env.DB.prepare(`
      INSERT INTO password_reset_requests(id,member_code,email,status,code_hash,requested_ip_hash,expires_at,created_at,reviewed_at)
      VALUES (?,?,?,'approved',?,?,datetime('now','+30 minutes'),datetime('now'),datetime('now'))
    `).bind(id, memberCode, email, await sha256(normalizeRecoveryCode(code)), ipHash).run();
    await audit(env, memberCode, "password_reset_requested", "password_reset", id, { delivery: "email" });
    try {
      const providerMessageId = await sendPasswordResetEmail(env, email, code, id);
      await audit(env, "system", "password_reset_email_sent", "password_reset", id, { providerMessageId });
    } catch (error) {
      await env.DB.prepare("UPDATE password_reset_requests SET status='rejected',code_hash=NULL,expires_at=NULL WHERE id=? AND status='approved'").bind(id).run();
      await audit(env, "system", "password_reset_email_failed", "password_reset", id);
      console.error(JSON.stringify({ event: "password_reset_email_failed", requestId: id, error: String(error).slice(0, 300) }));
    }
    return;
  }

  await env.DB.prepare("INSERT INTO password_reset_requests(id,member_code,email,status,requested_ip_hash,created_at) VALUES (?,?,?,'pending',?,datetime('now'))")
    .bind(id, memberCode, email, ipHash).run();
  await audit(env, memberCode, "password_reset_requested", "password_reset", id, { delivery: "manual" });
}

async function rateLimited(env: Env, req: Request, action: string, limit: number, windowSeconds: number): Promise<boolean> {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const bucketKey = await sha256(`${action}:${ip}`);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`
    INSERT INTO rate_limit_buckets(bucket_key,request_count,window_started_at) VALUES (?,1,?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      request_count=CASE WHEN ?-window_started_at>=? THEN 1 ELSE request_count+1 END,
      window_started_at=CASE WHEN ?-window_started_at>=? THEN ? ELSE window_started_at END
    RETURNING request_count
  `).bind(bucketKey, now, now, windowSeconds, now, windowSeconds, now).first();
  return Number(row?.request_count || 0) > limit;
}

function tooManyRequests(): Response {
  return json({ error: "Bạn thao tác quá nhanh. Vui lòng thử lại sau." }, 429, { "retry-after": "60" });
}

type TurnstileResult = {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
};

async function callTurnstile(env: Env, token: string, remoteIp: string): Promise<TurnstileResult> {
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: remoteIp })
  });
  if (!response.ok) return { success: false, "error-codes": [`http-${response.status}`] };
  return response.json<TurnstileResult>();
}

async function recordTurnstileCheck(
  env: Env,
  action: string,
  result: TurnstileResult,
  ipHash: string,
  verified: boolean
): Promise<void> {
  const errors = Array.isArray(result["error-codes"])
    ? result["error-codes"].filter(value => typeof value === "string").slice(0, 8)
    : [];
  try {
    await env.DB.prepare(`
      INSERT INTO turnstile_checks(id,action,success,hostname,error_codes,ip_hash,created_at)
      VALUES (?,?,?,?,?,?,datetime('now'))
    `).bind(randomId("ts"), action, verified ? 1 : 0, String(result.hostname || "").slice(0, 253), JSON.stringify(errors), ipHash).run();
  } catch (error) {
    console.error(JSON.stringify({ event: "turnstile_check_log_failed", action, error: String(error).slice(0, 300) }));
  }
}

async function verifyTurnstile(req: Request, env: Env, body: any, expectedAction: "login" | "signup" | "payout"): Promise<boolean> {
  const token = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
  const expectedHostnames = new Set(
    String(env.TURNSTILE_HOSTNAMES || "").split(",").map(value => value.trim()).filter(Boolean)
  );
  if (!env.TURNSTILE_SECRET || !token || token.length > 2048 || expectedHostnames.size === 0) return false;

  const remoteIp = req.headers.get("CF-Connecting-IP") || "";
  const ipHash = await sha256(remoteIp || "unknown");
  let result: TurnstileResult;
  try {
    result = await callTurnstile(env, token, remoteIp);
  } catch (error) {
    console.error(JSON.stringify({ event: "turnstile_siteverify_failed", action: expectedAction, error: String(error).slice(0, 300) }));
    return false;
  }
  const verified = result.success === true
    && result.action === expectedAction
    && expectedHostnames.has(String(result.hostname || ""));
  await recordTurnstileCheck(env, expectedAction, result, ipHash, verified);
  if (!verified) return false;

  // Tự kiểm chứng token chỉ dùng một lần đúng theo Siteverify. Không lưu token.
  try {
    const health = await env.DB.prepare("SELECT replay_rejected_at FROM turnstile_health WHERE id=1").first();
    let replayRejectedAt: string | null = health?.replay_rejected_at ? String(health.replay_rejected_at) : null;
    if (!replayRejectedAt) {
      const replay = await callTurnstile(env, token, remoteIp);
      const replayErrors = Array.isArray(replay["error-codes"]) ? replay["error-codes"] : [];
      if (replay.success !== true && replayErrors.includes("timeout-or-duplicate")) replayRejectedAt = nowIso();
    }
    await env.DB.prepare(`
      INSERT INTO turnstile_health(id,first_success_at,replay_rejected_at,last_action,last_hostname,updated_at)
      VALUES (1,datetime('now'),?,?,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        first_success_at=COALESCE(turnstile_health.first_success_at,excluded.first_success_at),
        replay_rejected_at=COALESCE(turnstile_health.replay_rejected_at,excluded.replay_rejected_at),
        last_action=excluded.last_action,last_hostname=excluded.last_hostname,updated_at=datetime('now')
    `).bind(replayRejectedAt, expectedAction, String(result.hostname || "").slice(0, 253)).run();
  } catch (error) {
    console.error(JSON.stringify({ event: "turnstile_replay_probe_failed", action: expectedAction, error: String(error).slice(0, 300) }));
  }
  return true;
}

function turnstileRejected(): Response {
  return json({ error: "Xác minh chống bot không hợp lệ hoặc đã hết hạn. Vui lòng thử lại." }, 403);
}

async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt ? base64ToBytes(salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 100_000 },
    key,
    256
  );
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(saltBytes) };
}

async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const actual = await hashPassword(password, salt);
  return crypto.subtle.timingSafeEqual(base64ToBytes(actual.hash), base64ToBytes(expected));
}

function cookieValue(req: Request, name: string): string {
  const source = req.headers.get("cookie") || "";
  for (const item of source.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function sessionCookie(req: Request, token: string, maxAge = SESSION_SECONDS): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function jsonCookie(data: unknown, req: Request, token: string, status = 200, maxAge = SESSION_SECONDS): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, "set-cookie": sessionCookie(req, token, maxAge), "cache-control": "no-store" }
  });
}

async function createSession(env: Env, memberCode: string): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO sessions(token_hash, member_code, expires_at, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).bind(tokenHash, memberCode, expiresAt).run();
  return token;
}

async function currentUser(req: Request, env: Env): Promise<AuthUser | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(`
    SELECT m.member_code, m.email, m.display_name, m.terms_version, m.privacy_version, m.email_verified_at
    FROM sessions s JOIN members m ON m.member_code=s.member_code
    WHERE s.token_hash=? AND s.expires_at > datetime('now') AND m.account_status='active'
  `).bind(await sha256(token)).first();
  if (!row?.member_code || !row?.email) return null;
  return {
    memberCode: String(row.member_code),
    email: String(row.email),
    displayName: String(row.display_name || ""),
    consentCurrent: row.terms_version === CURRENT_TERMS_VERSION && row.privacy_version === CURRENT_PRIVACY_VERSION,
    emailVerified: Boolean(row.email_verified_at)
  };
}

function consentRequired(user: AuthUser): Response | null {
  return user.consentCurrent
    ? null
    : json({ error: "Vui lòng chấp thuận phiên bản điều khoản và chính sách bảo mật hiện tại trong mục Tài khoản." }, 428);
}

function emailVerificationRequired(user: AuthUser): Response | null {
  return user.emailVerified
    ? null
    : json({ error: "Vui lòng xác minh email trong mục Tài khoản trước khi tạo link hoặc thực hiện thao tác tiền." }, 428);
}

function detectPlatform(input: string): "shopee" | "tiktok" | null {
  try {
    const u = new URL(input);
    const h = u.hostname.toLowerCase();
    if (
      h === "shopee.vn" ||
      h.endsWith(".shopee.vn") ||
      h === "shope.ee" ||
      h.endsWith(".shope.ee")
    ) return "shopee";

    if (
      h === "tiktok.com" ||
      h.endsWith(".tiktok.com") ||
      h === "tiktokshop.com" ||
      h.endsWith(".tiktokshop.com")
    ) return "tiktok";
  } catch {}
  return null;
}

async function resolveUrl(input: string): Promise<string> {
  try {
    const hostname = new URL(input).hostname.toLowerCase();
    // Link Shopee đầy đủ không cần tải HTML; gọi trực tiếp thường chậm hoặc bị chặn bot.
    if (hostname === "shopee.vn" || hostname.endsWith(".shopee.vn")) return input;
  } catch {
    return input;
  }
  // Nhiều short-link sẽ redirect. Nếu nền tảng chặn bot, giữ nguyên URL gốc.
  try {
    const r = await fetch(input, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; CashbackLinkResolver/1.0)",
        "accept": "text/html,application/xhtml+xml"
      }
    });
    // Không cần đọc body.
    try { await r.body?.cancel(); } catch {}
    return r.url || input;
  } catch {
    return input;
  }
}

function extractTikTokProductId(url: string): string | undefined {
  const patterns = [
    /\/product\/(\d{12,25})/i,
    /[?&]product_id=(\d{12,25})/i,
    /[?&]productId=(\d{12,25})/i
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return undefined;
}

function collectHttpStrings(x: unknown, path = ""): Array<{path:string,value:string}> {
  const out: Array<{path:string,value:string}> = [];
  if (typeof x === "string" && /^https?:\/\//i.test(x)) {
    out.push({ path, value: x });
  } else if (Array.isArray(x)) {
    x.forEach((v, i) => out.push(...collectHttpStrings(v, `${path}[${i}]`)));
  } else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      out.push(...collectHttpStrings(v, path ? `${path}.${k}` : k));
    }
  }
  return out;
}

function extractAffiliateUrl(payload: unknown): string | null {
  const hits = collectHttpStrings(payload);
  if (!hits.length) return null;
  const keyPriority = [
    "aff_link", "affLink", "short_link", "shortLink", "affiliate_link", "affiliateLink",
    "tracking_link", "trackingLink", "click_url", "clickUrl", "link"
  ];
  for (const key of keyPriority) {
    const h = hits.find(x => x.path.toLowerCase().endsWith(key.toLowerCase()));
    if (h) return h.value;
  }
  // Ưu tiên domain tracking của ACCESSTRADE.
  const at = hits.find(x => /accesstrade|isclix|at\.com|shorten/i.test(x.value));
  return at?.value ?? hits[0].value;
}

function extractAtLinkFailure(payload: any): string {
  const candidates = [
    payload?.message,
    payload?.error,
    payload?.detail,
    payload?.data?.message,
    payload?.data?.error,
    payload?.data?.detail,
    ...(Array.isArray(payload?.data?.error_link) ? payload.data.error_link : []),
    ...(Array.isArray(payload?.data?.suspend_url) ? payload.data.suspend_url : [])
  ];
  const messages: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const clean = value.trim();
      if (clean && !/^https?:\/\//i.test(clean) && clean.length <= 300) messages.push(clean);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["message", "error", "detail", "reason", "status"]) {
        if (record[key] !== undefined) visit(record[key]);
      }
    }
  };
  candidates.forEach(visit);
  return [...new Set(messages)].slice(0, 3).join("; ");
}

function friendlyAtLinkFailure(reason: string): string {
  if (/not registered for campaign/i.test(reason)) {
    return "API key ACCESSTRADE chưa được đăng ký hoặc duyệt cho chiến dịch Shopee này. Hãy dùng API key của đúng tài khoản đã tham gia chiến dịch.";
  }
  return reason;
}

async function atFetch(env: Env, path: string, init: RequestInit = {}) {
  if (!env.AT_ACCESS_KEY) throw new Error("Thiếu AT_ACCESS_KEY");
  const base = (env.AT_API_BASE || "https://api.accesstrade.vn").replace(/\/+$/, "");
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Token ${env.AT_ACCESS_KEY}`);
  headers.set("Content-Type", "application/json");
  const method = String(init.method || "GET").toUpperCase();
  const attempts = method === "GET" ? 3 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await fetch(`${base}${path}`, {
        ...init,
        headers,
        signal: init.signal || AbortSignal.timeout(25_000)
      });
      const text = await r.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
      if (r.ok) return payload;
      const error = new Error(`ACCESSTRADE ${r.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
      const retryable = [429, 500, 502, 503, 504].includes(r.status);
      (error as any).retryable = retryable;
      if (!retryable || attempt === attempts) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if ((error as any)?.retryable === false) throw error;
      if (attempt === attempts) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  throw lastError || new Error("ACCESSTRADE request failed");
}

async function createShopeeLink(
  env: Env,
  sourceUrl: string,
  memberCode: string,
  requestId: string
) {
  if (!env.AT_SHOPEE_CAMPAIGN_ID || env.AT_SHOPEE_CAMPAIGN_ID.startsWith("REPLACE")) {
    throw new Error("Chưa cấu hình AT_SHOPEE_CAMPAIGN_ID trong wrangler.toml");
  }
  const resolved = await resolveUrl(sourceUrl);

  const body = {
    campaign_id: env.AT_SHOPEE_CAMPAIGN_ID,
    // ACCESSTRADE yêu cầu urls là một danh sách, kể cả khi chỉ có một URL.
    urls: [resolved],
    url_enc: true,
    utm_source: "cashback_zalo",
    utm_medium: "affiliate",
    utm_campaign: "cashback_shopee",
    utm_content: requestId,
    sub1: memberCode,
    sub2: "shopee",
    sub3: requestId
  };

  const payload = await atFetch(env, "/v1/product_link/create", {
    method: "POST",
    body: JSON.stringify(body)
  });

  const affiliateUrl = extractAffiliateUrl(payload);
  if (!affiliateUrl) {
    const reason = extractAtLinkFailure(payload);
    const error = new Error(reason
      ? `ACCESSTRADE không tạo được link: ${friendlyAtLinkFailure(reason)}`
      : "ACCESSTRADE không trả về link cho sản phẩm này.");
    (error as any).atPayload = payload;
    throw error;
  }
  return { resolved, affiliateUrl, payload };
}

async function createTikTokLink(
  env: Env,
  sourceUrl: string,
  memberCode: string,
  requestId: string
) {
  const resolved = await resolveUrl(sourceUrl);
  const productId = extractTikTokProductId(resolved);

  const body: Record<string, string> = {
    product_url: resolved,
    utm_source: "cashback_zalo",
    utm_medium: "affiliate",
    utm_campaign: "cashback_tiktok",
    utm_content: requestId,
    sub1: memberCode,
    sub2: "tiktok",
    sub3: requestId,
    sub4: "cashback_v1"
  };
  if (productId) body.product_id = productId;

  const payload = await atFetch(env, "/v2/tiktokshop_product_feeds/create_link", {
    method: "POST",
    body: JSON.stringify(body)
  });

  const affiliateUrl = extractAffiliateUrl(payload);
  if (!affiliateUrl) throw new Error("AT trả về thành công nhưng không tìm thấy TikTok affiliate URL.");
  return { resolved, affiliateUrl, payload };
}

function getArrayFromAtPayload(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.data,
    payload?.data?.data,
    payload?.transactions,
    payload?.results,
    payload?.items
  ];
  for (const x of candidates) if (Array.isArray(x)) return x;
  return [];
}

function num(v: any): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replaceAll(",", ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pick(obj: any, keys: string[]): any {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

type CampaignRecord = {
  campaignId: string;
  name: string;
  merchant: string;
  approval: string;
  status: number;
  platform: "shopee" | "tiktok";
};

function normalizeCampaign(raw: any): CampaignRecord | null {
  const campaignId = String(pick(raw, ["id", "campaign_id", "campaignId"]) || "").trim();
  const name = String(pick(raw, ["name", "campaign_name", "campaignName", "title"]) || "").trim();
  const merchant = String(pick(raw, ["merchant", "merchant_name", "merchantName", "advertiser", "brand"]) || "").trim();
  const haystack = [
    name,
    merchant,
    raw?.url,
    raw?.domain,
    raw?.description,
    raw?.campaign_type,
    raw?.category_name
  ].filter(Boolean).join(" ").toLowerCase();
  const platform = haystack.includes("shopee")
    ? "shopee"
    : haystack.includes("tiktok")
      ? "tiktok"
      : null;
  if (!campaignId || !platform) return null;

  const approvalValue = pick(raw, ["approval", "approval_status", "approvalStatus"]);
  const statusValue = pick(raw, ["status", "campaign_status", "campaignStatus", "is_active"]);
  return {
    campaignId,
    name: name || merchant || campaignId,
    merchant,
    approval: approvalValue === undefined ? "unknown" : String(approvalValue).toLowerCase(),
    status: statusValue === true ? 1 : Number(statusValue || 0),
    platform
  };
}

function isApprovedCampaign(campaign: CampaignRecord): boolean {
  return ["successful", "approved", "success", "1", "true"].includes(campaign.approval);
}

function normalizeTransaction(raw: any, cashbackRate: number) {
  const transactionId = String(
    pick(raw, ["transaction_id", "transactionId", "id", "conversion_id", "conversionId"]) || ""
  );
  if (!transactionId) return null;

  // ACCESSTRADE:
  // status: 0=hold/chưa duyệt, 1=approved, 2=rejected.
  // is_confirmed: 1 = đã đối soát thành công và đồng ý thanh toán.
  const status = Number(pick(raw, ["status"]) ?? 0);
  const isConfirmed = Number(pick(raw, ["is_confirmed", "isConfirmed"]) ?? 0);

  const commission = num(pick(raw, ["commission", "pub_commission", "publisher_commission"]));
  const orderValue = num(pick(raw, ["transaction_value", "order_value", "sales", "amount"]));

  // STRICT MODE: utm_content/sub3 phải là requestId do chính hệ thống tạo.
  // Không dùng memberCode từ transaction để cộng tiền trực tiếp.
  const trackingRequestId = String(
    pick(raw, ["utm_content", "sub3", "sub_3"]) || ""
  ).trim();

  const merchant = String(pick(raw, ["merchant", "merchant_name", "campaign_name"]) || "");
  const transactionTime = String(
    pick(raw, ["transaction_time", "transactionTime", "conversion_time", "created_at"]) || ""
  );
  const approvalTime = String(
    pick(raw, ["approval_time", "approvalTime", "approved_at", "confirmed_at"]) || ""
  );

  let platform: "shopee" | "tiktok" | null = null;
  const hay = `${merchant} ${JSON.stringify(raw)}`.toLowerCase();
  if (hay.includes("shopee")) platform = "shopee";
  else if (hay.includes("tiktok")) platform = "tiktok";

  // CHỈ tính cashback thật khi AT đã:
  //   status = 1 AND is_confirmed = 1.
  // Pending / tạm duyệt / chưa đối soát = 0đ khả dụng.
  const cashback =
    status === 1 && isConfirmed === 1 && commission > 0
      ? Math.floor(commission * cashbackRate)
      : 0;

  return {
    transactionId,
    trackingRequestId,
    platform,
    merchant,
    status,
    isConfirmed,
    commission,
    orderValue,
    cashback,
    transactionTime,
    approvalTime,
    raw
  };
}

function minimizedTransactionJson(tx: ReturnType<typeof normalizeTransaction>): string {
  if (!tx) return JSON.stringify({ redacted: true });
  return JSON.stringify({
    transactionId: tx.transactionId,
    trackingRequestId: tx.trackingRequestId,
    platform: tx.platform,
    merchant: tx.merchant,
    status: tx.status,
    isConfirmed: tx.isConfirmed,
    commission: tx.commission,
    orderValue: tx.orderValue,
    transactionTime: tx.transactionTime,
    approvalTime: tx.approvalTime
  });
}

function minimizedLinkResponse(affiliateUrl: string): string {
  let host = "";
  try { host = new URL(affiliateUrl).hostname; } catch {}
  return JSON.stringify({ created: true, affiliateHost: host });
}

async function upsertMember(env: Env, memberCode: string, displayName?: string) {
  await env.DB.prepare(`
    INSERT INTO members(member_code, display_name, created_at, updated_at)
    VALUES (?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(member_code) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, members.display_name),
      updated_at = datetime('now')
  `).bind(memberCode, displayName || null).run();
}

async function syncApprovedCampaigns(env: Env) {
  try {
    // Giao diện ACCESSTRADE mới và endpoint campaign cũ có thể cập nhật lệch nhau.
    // Đọc cả danh sách cũ (có approval/name) và API cashback mới, sau đó đối chiếu theo ID.
    const results = await Promise.allSettled([
      atFetch(env, "/v1/campaigns?limit=500&page=1", { method: "GET" }),
      atFetch(env, "/v1/cashback/campaigns?page=1&page_size=500", { method: "GET" })
    ]);
    const successfulPayloads = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (!successfulPayloads.length) {
      const reasons = results.flatMap(result => result.status === "rejected" ? [safeSyncError(result.reason)] : []);
      throw new Error(reasons.join("; ") || "Không đọc được danh sách campaign ACCESSTRADE");
    }

    const sourceRows = successfulPayloads.flatMap(getArrayFromAtPayload);
    const byId = new Map<string, CampaignRecord>();
    for (const raw of sourceRows) {
      const campaign = normalizeCampaign(raw);
      if (!campaign) continue;
      const existing = byId.get(campaign.campaignId);
      // Ưu tiên record có approval rõ ràng từ API campaign cũ.
      if (!existing || (existing.approval === "unknown" && campaign.approval !== "unknown")) {
        byId.set(campaign.campaignId, campaign);
      }
    }
    const matches = [...byId.values()];
    const approvedCount = matches.filter(isApprovedCampaign).length;
    const statements = [env.DB.prepare("DELETE FROM campaign_catalog")];
    for (const campaign of matches) {
      statements.push(env.DB.prepare(`
        INSERT INTO campaign_catalog(campaign_id,name,merchant,approval,status,platform,checked_at)
        VALUES (?,?,?,?,?,?,datetime('now'))
      `).bind(campaign.campaignId, campaign.name, campaign.merchant || null, campaign.approval, campaign.status, campaign.platform));
    }
    statements.push(env.DB.prepare(`
      INSERT INTO campaign_checks(id,status,approved_count,matched_count,error_message,checked_at)
      VALUES (1,'success',?,?,NULL,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET status='success',approved_count=excluded.approved_count,
        matched_count=excluded.matched_count,error_message=NULL,checked_at=datetime('now')
    `).bind(approvedCount, matches.length));
    await env.DB.batch(statements);
    return { approvedCount, matchedCount: matches.length };
  } catch (error) {
    await env.DB.prepare(`
      INSERT INTO campaign_checks(id,status,approved_count,matched_count,error_message,checked_at)
      VALUES (1,'failed',0,0,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET status='failed',error_message=excluded.error_message,checked_at=datetime('now')
    `).bind(safeSyncError(error)).run();
    throw error;
  }
}

async function syncTransactions(env: Env) {
  const cashbackRate = Number(env.CASHBACK_RATE || "0.60");
  const until = new Date();
  const since = new Date(until.getTime() - 90 * 24 * 3600 * 1000);
  const limit = 100;
  let offset = 0;
  let total = 0;
  let imported = 0;

  // Hai request campaign + tối đa 8 request giao dịch = 10 request/phút.
  for (let page = 0; page < 8; page++) {
    const qs = new URLSearchParams({
      since: since.toISOString(),
      until: until.toISOString(),
      limit: String(limit),
      offset: String(offset)
    });
    const payload = await atFetch(env, `/v1/transactions?${qs.toString()}`, { method: "GET" });
    const rows = getArrayFromAtPayload(payload);
    total += rows.length;

    for (const raw of rows) {
      const tx = normalizeTransaction(raw, cashbackRate);
      if (!tx) continue;

      // STRICT ATTRIBUTION:
      // Chỉ gán giao dịch cho thành viên nếu utm_content/sub3 khớp request_id
      // đã được chính hệ thống tạo trước đó.
      let memberCode: string | null = null;
      let requestPlatform: "shopee" | "tiktok" | null = null;

      if (tx.trackingRequestId) {
        const reqRow = await env.DB.prepare(`
          SELECT member_code, platform
          FROM link_requests
          WHERE request_id=? AND status='created'
          LIMIT 1
        `).bind(tx.trackingRequestId).first();

        if (reqRow?.member_code) {
          memberCode = String(reqRow.member_code);
          requestPlatform =
            reqRow.platform === "shopee" || reqRow.platform === "tiktok"
              ? reqRow.platform
              : null;
        }
      }

      await env.DB.prepare(`
        INSERT INTO transactions(
          transaction_id, member_code, platform, merchant, status,
          is_confirmed, approval_time,
          commission_vnd, order_value_vnd, cashback_vnd,
          transaction_time, updated_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT(transaction_id) DO UPDATE SET
          member_code=excluded.member_code,
          platform=COALESCE(excluded.platform, transactions.platform),
          merchant=excluded.merchant,
          status=excluded.status,
          is_confirmed=excluded.is_confirmed,
          approval_time=excluded.approval_time,
          commission_vnd=excluded.commission_vnd,
          order_value_vnd=excluded.order_value_vnd,
          cashback_vnd=excluded.cashback_vnd,
          transaction_time=excluded.transaction_time,
          updated_at=datetime('now'),
          raw_json=excluded.raw_json
      `).bind(
        tx.transactionId,
        memberCode,
        requestPlatform || tx.platform,
        tx.merchant,
        tx.status,
        tx.isConfirmed,
        tx.approvalTime || null,
        tx.commission,
        tx.orderValue,
        memberCode ? tx.cashback : 0,
        tx.transactionTime || null,
        minimizedTransactionJson(tx)
      ).run();
      imported++;
    }

    if (rows.length < limit) break;
    offset += limit;
  }

  return { ok: true, totalFetched: total, imported, syncedAt: nowIso() };
}

function safeSyncError(error: unknown): string {
  const message = String((error as any)?.message || error || "");
  const status = message.match(/ACCESSTRADE\s+(\d{3})/i)?.[1];
  if (status) return `ACCESSTRADE HTTP ${status}`;
  if (/timeout|timed out|abort/i.test(message) || (error as any)?.name === "TimeoutError") return "ACCESSTRADE timeout";
  return "Đồng bộ thất bại";
}

type OperationalAlertEvent = "sync_failed" | "sync_recovered" | "alert_test";

async function sendSyncAlert(env: Env, event: OperationalAlertEvent, detail: Record<string, unknown>): Promise<{ webhook: boolean; email: boolean }> {
  const payload = { service: "hoanlai", event, occurredAt: nowIso(), ...detail };
  let webhook = false;
  let email = false;

  if (env.ALERT_WEBHOOK_URL) {
    let url: URL | null = null;
    try { url = new URL(env.ALERT_WEBHOOK_URL); } catch {}
    if (url?.protocol === "https:") {
      try {
        const response = await fetch(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000)
        });
        webhook = response.ok;
        if (!response.ok) console.error(JSON.stringify({ event: "operational_alert_webhook_failed", status: response.status }));
      } catch (error) {
        console.error(JSON.stringify({ event: "operational_alert_webhook_failed", error: String(error).slice(0, 300) }));
      }
    }
  }

  const alertEmail = String(env.ALERT_EMAIL || "").trim().toLowerCase();
  if (env.RESEND_API_KEY && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail)) {
    const labels: Record<OperationalAlertEvent, string> = {
      sync_failed: "Đồng bộ ACCESSTRADE thất bại",
      sync_recovered: "Đồng bộ ACCESSTRADE đã phục hồi",
      alert_test: "Kiểm thử cảnh báo vận hành"
    };
    const safeDetail = escapeHtml(JSON.stringify(detail, null, 2));
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
          "idempotency-key": `operational-alert/${event}/${String(detail.alertId || randomId("alert"))}`,
          "user-agent": "HoanLai-Worker/1.0"
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          from: env.EMAIL_FROM || "Hoàn Lại <no-reply@notify.hoanlai.id.vn>",
          to: [alertEmail],
          subject: `[Hoàn Lại] ${labels[event]}`,
          text: `${labels[event]}\nThời gian: ${payload.occurredAt}\nChi tiết: ${JSON.stringify(detail)}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111"><h1 style="font-size:24px">${escapeHtml(labels[event])}</h1><p>Thời gian: <strong>${escapeHtml(payload.occurredAt)}</strong></p><pre style="white-space:pre-wrap;background:#eef0ec;border-radius:12px;padding:16px">${safeDetail}</pre><p style="color:#666;font-size:13px">Email tự động từ hệ thống Hoàn Lại.</p></div>`
        })
      });
      const result = await response.json<ResendEmailResponse>().catch(() => ({})) as ResendEmailResponse;
      email = response.ok && Boolean(result.id);
      if (!email) console.error(JSON.stringify({ event: "operational_alert_email_failed", status: response.status }));
    } catch (error) {
      console.error(JSON.stringify({ event: "operational_alert_email_failed", error: String(error).slice(0, 300) }));
    }
  }
  return { webhook, email };
}

async function runTrackedSync(env: Env, triggerSource: "cron" | "manual") {
  const id = randomId("sync");
  const previous = await env.DB.prepare("SELECT status FROM sync_runs ORDER BY started_at DESC LIMIT 1").first();
  await env.DB.prepare("INSERT INTO sync_runs(id,trigger_source,status,started_at) VALUES (?,?,'running',datetime('now'))")
    .bind(id, triggerSource).run();
  try {
    const result = await syncTransactions(env);
    await env.DB.prepare("UPDATE sync_runs SET status='success',total_fetched=?,imported=?,finished_at=datetime('now') WHERE id=? AND status='running'")
      .bind(result.totalFetched, result.imported, id).run();
    if (previous?.status === "failed") {
      await sendSyncAlert(env, "sync_recovered", { triggerSource, totalFetched: result.totalFetched, imported: result.imported });
    }
    return result;
  } catch (error) {
    const safeError = safeSyncError(error);
    await env.DB.prepare("UPDATE sync_runs SET status='failed',error_message=?,finished_at=datetime('now') WHERE id=? AND status='running'")
      .bind(safeError, id).run();
    if (previous?.status !== "failed") {
      await sendSyncAlert(env, "sync_failed", { triggerSource, error: safeError });
    }
    throw error;
  }
}

async function walletSummary(env: Env, memberCode: string) {
  const tx = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN status=1 AND is_confirmed=1 THEN cashback_vnd
        ELSE 0 END),0) AS confirmed_cashback,
      COALESCE(SUM(CASE
        WHEN status<>2 AND is_confirmed=0 THEN 1
        ELSE 0 END),0) AS pending_orders,
      COALESCE(SUM(CASE
        WHEN status<>2 AND is_confirmed=0 THEN commission_vnd
        ELSE 0 END),0) AS pending_commission,
      COALESCE(SUM(CASE
        WHEN status=2 THEN 1
        ELSE 0 END),0) AS rejected_orders
    FROM transactions
    WHERE member_code=?
  `).bind(memberCode).first();

  const payouts = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status='paid' THEN amount_vnd ELSE 0 END),0) AS paid,
      COALESCE(SUM(CASE WHEN status='requested' THEN amount_vnd ELSE 0 END),0) AS requested
    FROM payout_requests
    WHERE member_code=?
  `).bind(memberCode).first();

  const confirmed = Number(tx?.confirmed_cashback || 0);
  const estimated = Math.max(0, Math.floor(Number(tx?.pending_commission || 0) * Number(env.CASHBACK_RATE || "0.60")));
  const paid = Number(payouts?.paid || 0);
  const requested = Number(payouts?.requested || 0);
  const available = Math.max(0, confirmed - paid - requested);

  return {
    memberCode,
    pendingOrders: Number(tx?.pending_orders || 0),
    estimatedCashback: estimated,
    rejectedOrders: Number(tx?.rejected_orders || 0),
    confirmedCashback: confirmed,
    payoutRequested: requested,
    paid,
    available,
    minimumPayout: Number(env.MIN_PAYOUT_VND || "50000"),
    cashbackRate: Number(env.CASHBACK_RATE || "0.60"),
    strictMode: true,
    rule: "Chỉ giao dịch đã được đối tác xác nhận mới được cộng vào số dư."
  };
}

async function safeSecretEqual(supplied: string, expected: string): Promise<boolean> {
  if (!supplied || !expected) return false;
  const [a, b] = await Promise.all([sha256(supplied), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(base64ToBytes(a), base64ToBytes(b));
}

async function bankKey(env: Env): Promise<CryptoKey> {
  if (!env.BANK_DATA_KEY || env.BANK_DATA_KEY.length < 32) throw new Error("BANK_DATA_KEY chưa được cấu hình an toàn.");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.BANK_DATA_KEY));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptAccount(env: Env, account: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await bankKey(env), new TextEncoder().encode(account));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptAccount(env: Env, ciphertext: string, iv: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await bankKey(env), base64ToBytes(ciphertext));
  return new TextDecoder().decode(plain);
}

async function accountFingerprint(env: Env, method: string, bankCode: string, account: string): Promise<string> {
  if (!env.BANK_DATA_KEY || env.BANK_DATA_KEY.length < 32) throw new Error("BANK_DATA_KEY chưa được cấu hình an toàn.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BANK_DATA_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const normalized = `${method}:${bankCode.trim().toUpperCase()}:${account.replace(/\s+/g, "")}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(normalized));
  return bytesToBase64(new Uint8Array(signature));
}

async function audit(env: Env, actor: string, action: string, targetType: string, targetId: string, detail: unknown = {}) {
  await env.DB.prepare("INSERT INTO audit_logs(id, actor, action, target_type, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
    .bind(randomId("audit"), actor, action, targetType, targetId, JSON.stringify(detail)).run();
}

function adminCookie(req: Request, token: string, maxAge = ADMIN_SESSION_SECONDS): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function requireAdmin(req: Request, env: Env): Promise<boolean> {
  const token = cookieValue(req, ADMIN_COOKIE);
  if (!token) return false;
  const row = await env.DB.prepare(`
    SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires_at > datetime('now')
  `).bind(await sha256(token)).first();
  return !!row;
}

async function verifyAdminPassword(env: Env, password: string): Promise<boolean> {
  const credential = await env.DB.prepare("SELECT password_hash, password_salt FROM admin_credentials WHERE id=1").first();
  if (credential?.password_hash && credential?.password_salt) {
    return verifyPassword(password, String(credential.password_salt), String(credential.password_hash));
  }
  return safeSecretEqual(password, env.ADMIN_SECRET || "");
}

function validAdminPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

async function apiRouter(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const u = new URL(req.url);
  const path = u.pathname;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (origin && origin !== u.origin) return json({ error: "Yêu cầu không cùng nguồn." }, 403);
  }

  if (path === "/api/admin/login" && req.method === "POST") {
    if (await rateLimited(env, req, "admin_login", 8, 900)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    if (!await verifyAdminPassword(env, String(body?.secret || ""))) {
      return json({ error: "Mã quản trị không đúng." }, 401);
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000).toISOString();
    await env.DB.prepare("INSERT INTO admin_sessions(token_hash, expires_at, created_at) VALUES (?, ?, datetime('now'))")
      .bind(await sha256(token), expiresAt).run();
    await audit(env, "admin", "admin_login", "admin", "primary");
    return new Response(JSON.stringify({ ok: true }), { headers: { ...JSON_HEADERS, "set-cookie": adminCookie(req, token), "cache-control": "no-store" } });
  }

  if (path === "/api/admin/logout" && req.method === "POST") {
    const token = cookieValue(req, ADMIN_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { ...JSON_HEADERS, "set-cookie": adminCookie(req, "", 0), "cache-control": "no-store" } });
  }

  if (path === "/api/admin/security" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const tokenHash = await sha256(cookieValue(req, ADMIN_COOKIE));
    const rows = await env.DB.prepare("SELECT token_hash, created_at, expires_at FROM admin_sessions WHERE expires_at > datetime('now') ORDER BY created_at DESC").all();
    return json({ sessions: (rows.results || []).map((row: any) => ({ createdAt: row.created_at, expiresAt: row.expires_at, current: row.token_hash === tokenHash })) });
  }

  if (path === "/api/admin/change-password" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const currentPassword = String(body?.currentPassword || "");
    const newPassword = String(body?.newPassword || "");
    if (!await verifyAdminPassword(env, currentPassword)) return json({ error: "Mật khẩu hiện tại không đúng." }, 401);
    if (!validAdminPassword(newPassword)) return json({ error: "Mật khẩu mới cần 12–128 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt." }, 400);
    if (await verifyAdminPassword(env, newPassword)) return json({ error: "Mật khẩu mới phải khác mật khẩu hiện tại." }, 400);
    const passwordData = await hashPassword(newPassword);
    const token = randomToken();
    const tokenHash = await sha256(token);
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO admin_credentials(id,password_hash,password_salt,updated_at) VALUES (1,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,password_salt=excluded.password_salt,updated_at=datetime('now')").bind(passwordData.hash, passwordData.salt),
      env.DB.prepare("DELETE FROM admin_sessions"),
      env.DB.prepare("INSERT INTO admin_sessions(token_hash,expires_at,created_at) VALUES (?,?,datetime('now'))").bind(tokenHash, expiresAt),
      env.DB.prepare("INSERT INTO audit_logs(id,actor,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,?,?,?,datetime('now'))").bind(randomId("audit"), "admin", "admin_password_changed", "admin", "primary", JSON.stringify({ allOtherSessionsRevoked: true }))
    ]);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...JSON_HEADERS, "set-cookie": adminCookie(req, token), "cache-control": "no-store" } });
  }

  if (path === "/api/admin/revoke-other-sessions" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const tokenHash = await sha256(cookieValue(req, ADMIN_COOKIE));
    const result = await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash<>?").bind(tokenHash).run();
    await audit(env, "admin", "admin_sessions_revoked", "admin", "primary", { revoked: Number(result.meta?.changes || 0) });
    return json({ ok: true, revoked: Number(result.meta?.changes || 0) });
  }

  if (path === "/api/admin/summary" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const [members, transactions, payouts, lastSync] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM members").first(),
      env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(cashback_vnd),0) AS cashback FROM transactions").first(),
      env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_vnd),0) AS amount FROM payout_requests WHERE status='requested'").first(),
      env.DB.prepare("SELECT trigger_source,status,total_fetched,imported,error_message,started_at,finished_at FROM sync_runs ORDER BY started_at DESC LIMIT 1").first()
    ]);
    const alertWebhookConfigured = Boolean(env.ALERT_WEBHOOK_URL);
    const alertEmailConfigured = Boolean(env.RESEND_API_KEY && env.ALERT_EMAIL);
    return json({ members: Number(members?.count || 0), transactions: Number(transactions?.count || 0), cashback: Number(transactions?.cashback || 0), pendingPayouts: Number(payouts?.count || 0), pendingAmount: Number(payouts?.amount || 0), lastSync: lastSync || null, alertsConfigured: alertWebhookConfigured || alertEmailConfigured, alertWebhookConfigured, alertEmailConfigured });
  }

  if (path === "/api/admin/campaigns" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const [check, campaigns] = await Promise.all([
      env.DB.prepare("SELECT status,approved_count,matched_count,error_message,checked_at FROM campaign_checks WHERE id=1").first(),
      env.DB.prepare("SELECT campaign_id,name,merchant,approval,status,platform,checked_at FROM campaign_catalog ORDER BY platform,name").all()
    ]);
    return json({ check: check || null, campaigns: campaigns.results || [], configuredShopeeCampaignId: env.AT_SHOPEE_CAMPAIGN_ID?.startsWith("REPLACE") ? null : env.AT_SHOPEE_CAMPAIGN_ID });
  }

  if (path === "/api/auth/register" && req.method === "POST") {
    if (await rateLimited(env, req, "register", 8, 3600)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    if (!await verifyTurnstile(req, env, body, "signup")) return turnstileRejected();
    const email = String(body?.email || "").trim().toLowerCase().slice(0, 254);
    const displayName = String(body?.displayName || "").trim().slice(0, 80);
    const password = String(body?.password || "");
    const acceptedTerms = body?.acceptedTerms === true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Email không hợp lệ." }, 400);
    if (displayName.length < 2) return json({ error: "Tên cần ít nhất 2 ký tự." }, 400);
    if (password.length < 6 || password.length > 128) return json({ error: "Mật khẩu cần từ 6 đến 128 ký tự." }, 400);
    if (!acceptedTerms) return json({ error: "Bạn cần đồng ý Điều khoản hoàn tiền và Chính sách bảo mật để đăng ký." }, 400);
    const existing = await env.DB.prepare("SELECT 1 FROM members WHERE email=?").bind(email).first();
    if (existing) return json({ error: "Email này đã được đăng ký." }, 409);
    const memberCode = randomId("m");
    const passwordData = await hashPassword(password);
    try {
      await env.DB.prepare(`
        INSERT INTO members(member_code, display_name, email, password_hash, password_salt,
          account_status, terms_version, privacy_version, consented_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'), datetime('now'))
      `).bind(memberCode, displayName, email, passwordData.hash, passwordData.salt,
        CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION).run();
    } catch {
      return json({ error: "Email này đã được đăng ký." }, 409);
    }
    const token = await createSession(env, memberCode);
    await audit(env, memberCode, "legal_consent_accepted", "member", memberCode, {
      termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION, source: "registration"
    });
    ctx.waitUntil(processEmailVerificationRequest(env, memberCode, email).catch(error => {
      console.error(JSON.stringify({ event: "email_verification_processing_failed", memberCode, error: String(error).slice(0, 300) }));
    }));
    return jsonCookie({ ok: true, user: { memberCode, email, displayName, consentCurrent: true, emailVerified: false } }, req, token, 201);
  }

  if (path === "/api/auth/login" && req.method === "POST") {
    if (await rateLimited(env, req, "login", 12, 600)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    if (!await verifyTurnstile(req, env, body, "login")) return turnstileRejected();
    const email = String(body?.email || "").trim().toLowerCase().slice(0, 254);
    const password = String(body?.password || "");
    const row = await env.DB.prepare(`
      SELECT member_code, email, display_name, password_hash, password_salt,
        account_status, terms_version, privacy_version, email_verified_at
      FROM members WHERE email=?
    `).bind(email).first();
    const valid = row?.password_hash && row?.password_salt
      ? await verifyPassword(password, String(row.password_salt), String(row.password_hash))
      : false;
    if (!valid || !row || row.account_status !== "active") return json({ error: "Email hoặc mật khẩu không đúng." }, 401);
    const memberCode = String(row.member_code);
    const token = await createSession(env, memberCode);
    return jsonCookie({ ok: true, user: {
      memberCode,
      email: String(row.email),
      displayName: String(row.display_name || ""),
      consentCurrent: row.terms_version === CURRENT_TERMS_VERSION && row.privacy_version === CURRENT_PRIVACY_VERSION,
      emailVerified: Boolean(row.email_verified_at)
    } }, req, token);
  }

  if (path === "/api/auth/me" && req.method === "GET") {
    const user = await currentUser(req, env);
    return user ? json({ user }) : json({ user: null }, 401);
  }

  if (path === "/api/auth/request-email-verification" && req.method === "POST") {
    if (await rateLimited(env, req, "request_email_verification", 5, 3600)) return tooManyRequests();
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    if (!user.emailVerified) {
      ctx.waitUntil(processEmailVerificationRequest(env, user.memberCode, user.email).catch(error => {
        console.error(JSON.stringify({ event: "email_verification_processing_failed", memberCode: user.memberCode, error: String(error).slice(0, 300) }));
      }));
    }
    return json({ ok: true, message: user.emailVerified
      ? "Email đã được xác minh."
      : "Nếu email hợp lệ, liên kết xác minh sẽ được gửi. Hãy kiểm tra hộp thư đến và thư rác." });
  }

  if (path === "/api/auth/verify-email" && req.method === "POST") {
    if (await rateLimited(env, req, "verify_email", 10, 900)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const token = String(body?.token || "").trim();
    if (token.length < 40 || token.length > 128) return json({ error: "Liên kết xác minh không hợp lệ." }, 400);
    const tokenHash = await sha256(token);
    const request = await env.DB.prepare(`
      UPDATE email_verification_requests
      SET status='used',used_at=datetime('now'),token_hash=NULL
      WHERE token_hash=? AND status='pending' AND expires_at>datetime('now')
        AND EXISTS (
          SELECT 1 FROM members m
          WHERE m.member_code=email_verification_requests.member_code
            AND m.email=email_verification_requests.email AND m.account_status='active'
        )
      RETURNING id,member_code
    `).bind(tokenHash).first();
    if (!request) return json({ error: "Liên kết xác minh không đúng, đã hết hạn hoặc đã được sử dụng." }, 400);
    const requestId = String(request.id);
    const memberCode = String(request.member_code);
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET email_verified_at=COALESCE(email_verified_at,datetime('now')),updated_at=datetime('now') WHERE member_code=?").bind(memberCode),
      env.DB.prepare("UPDATE email_verification_requests SET status='expired',token_hash=NULL WHERE member_code=? AND id<>? AND status='pending'").bind(memberCode, requestId),
      env.DB.prepare("INSERT INTO audit_logs(id,actor,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,?,?,?,datetime('now'))")
        .bind(randomId("audit"), memberCode, "email_verified", "member", memberCode, JSON.stringify({ requestId }))
    ]);
    return json({ ok: true, message: "Email đã được xác minh thành công." });
  }

  if (path === "/api/auth/logout" && req.method === "POST") {
    const token = cookieValue(req, SESSION_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return jsonCookie({ ok: true }, req, "", 200, 0);
  }

  if (path === "/api/auth/forgot-password" && req.method === "POST") {
    if (await rateLimited(env, req, "forgot_password", 5, 3600)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const email = String(body?.email || "").trim().toLowerCase().slice(0, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Email không hợp lệ." }, 400);
    const ipHash = await sha256(req.headers.get("CF-Connecting-IP") || "unknown");
    ctx.waitUntil(processPasswordResetRequest(env, email, ipHash).catch(error => {
      console.error(JSON.stringify({ event: "password_reset_processing_failed", error: String(error).slice(0, 300) }));
    }));
    return json({ ok: true, message: env.RESEND_API_KEY
      ? "Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi. Hãy kiểm tra hộp thư đến và thư rác."
      : "Nếu email tồn tại, yêu cầu đã được ghi nhận. Vui lòng liên hệ hỗ trợ để xác minh." });
  }

  if (path === "/api/auth/reset-password" && req.method === "POST") {
    if (await rateLimited(env, req, "reset_password", 10, 900)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const email = String(body?.email || "").trim().toLowerCase().slice(0, 254);
    const code = normalizeRecoveryCode(String(body?.code || ""));
    const password = String(body?.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || code.length !== 10) return json({ error: "Email hoặc mã khôi phục không hợp lệ." }, 400);
    if (password.length < 6 || password.length > 128) return json({ error: "Mật khẩu cần từ 6 đến 128 ký tự." }, 400);
    const codeHash = await sha256(code);
    const reset = await env.DB.prepare("SELECT id,member_code FROM password_reset_requests WHERE email=? AND code_hash=? AND status='approved' AND expires_at > datetime('now') ORDER BY reviewed_at DESC LIMIT 1")
      .bind(email, codeHash).first();
    if (!reset) return json({ error: "Mã không đúng, đã hết hạn hoặc đã được sử dụng." }, 400);
    const passwordData = await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET password_hash=?,password_salt=?,updated_at=datetime('now') WHERE member_code=?").bind(passwordData.hash, passwordData.salt, String(reset.member_code)),
      env.DB.prepare("DELETE FROM sessions WHERE member_code=?").bind(String(reset.member_code)),
      env.DB.prepare("UPDATE password_reset_requests SET status='used',used_at=datetime('now'),code_hash=NULL WHERE id=? AND status='approved'").bind(String(reset.id)),
      env.DB.prepare("INSERT INTO audit_logs(id,actor,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,?,?,?,datetime('now'))").bind(randomId("audit"), String(reset.member_code), "password_reset_completed", "password_reset", String(reset.id), "{}")
    ]);
    return json({ ok: true, message: "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới." });
  }

  if (path === "/api/account/consent" && req.method === "POST") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    if (body?.accepted !== true) return json({ error: "Bạn cần xác nhận đã đọc và đồng ý." }, 400);
    await env.DB.prepare(`
      UPDATE members SET terms_version=?,privacy_version=?,consented_at=datetime('now'),updated_at=datetime('now')
      WHERE member_code=? AND account_status='active'
    `).bind(CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, user.memberCode).run();
    await audit(env, user.memberCode, "legal_consent_accepted", "member", user.memberCode, {
      termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION, source: "account"
    });
    return json({ ok: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION });
  }

  if (path === "/api/account/change-password" && req.method === "POST") {
    if (await rateLimited(env, req, "account_change_password", 5, 3600)) return tooManyRequests();
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const currentPassword = String(body?.currentPassword || "");
    const newPassword = String(body?.newPassword || "");
    if (newPassword.length < 6 || newPassword.length > 128) return json({ error: "Mật khẩu mới cần từ 6 đến 128 ký tự." }, 400);
    const member = await env.DB.prepare("SELECT password_hash,password_salt FROM members WHERE member_code=?").bind(user.memberCode).first();
    if (!member?.password_hash || !member?.password_salt || !await verifyPassword(currentPassword, String(member.password_salt), String(member.password_hash))) {
      return json({ error: "Mật khẩu hiện tại không đúng." }, 401);
    }
    if (await verifyPassword(newPassword, String(member.password_salt), String(member.password_hash))) {
      return json({ error: "Mật khẩu mới phải khác mật khẩu hiện tại." }, 400);
    }
    const passwordData = await hashPassword(newPassword);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET password_hash=?,password_salt=?,updated_at=datetime('now') WHERE member_code=?").bind(passwordData.hash, passwordData.salt, user.memberCode),
      env.DB.prepare("DELETE FROM sessions WHERE member_code=?").bind(user.memberCode),
      env.DB.prepare("INSERT INTO sessions(token_hash,member_code,expires_at,created_at) VALUES (?,?,?,datetime('now'))").bind(await sha256(token), user.memberCode, expiresAt),
      env.DB.prepare("INSERT INTO audit_logs(id,actor,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,?,?,?,datetime('now'))").bind(randomId("audit"), user.memberCode, "account_password_changed", "member", user.memberCode, JSON.stringify({ allOtherSessionsRevoked: true }))
    ]);
    return jsonCookie({ ok: true, message: "Đã đổi mật khẩu và đăng xuất các phiên khác." }, req, token);
  }

  if (path === "/api/account/export" && req.method === "GET") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const [member, transactions, payouts, profile, support, dataRequests] = await Promise.all([
      env.DB.prepare("SELECT member_code,display_name,email,email_verified_at,account_status,terms_version,privacy_version,consented_at,created_at,updated_at FROM members WHERE member_code=?").bind(user.memberCode).first(),
      env.DB.prepare("SELECT transaction_id,platform,merchant,status,is_confirmed,approval_time,commission_vnd,order_value_vnd,cashback_vnd,transaction_time,updated_at FROM transactions WHERE member_code=? ORDER BY updated_at DESC").bind(user.memberCode).all(),
      env.DB.prepare("SELECT id,amount_vnd,status,note,payment_method,payment_bank_code,payment_account_last4,reviewed_at,created_at,updated_at FROM payout_requests WHERE member_code=? ORDER BY created_at DESC").bind(user.memberCode).all(),
      env.DB.prepare("SELECT method,bank_code,account_name,account_last4,payout_available_at,updated_at FROM payment_profiles WHERE member_code=?").bind(user.memberCode).first(),
      env.DB.prepare("SELECT id,category,order_reference,subject,message,status,admin_note,created_at,updated_at,resolved_at FROM support_cases WHERE member_code=? ORDER BY created_at DESC").bind(user.memberCode).all(),
      env.DB.prepare("SELECT id,request_type,status,message,admin_note,created_at,updated_at,completed_at FROM data_requests WHERE member_code=? ORDER BY created_at DESC").bind(user.memberCode).all()
    ]);
    await audit(env, user.memberCode, "personal_data_exported", "member", user.memberCode);
    return json({ exportedAt: nowIso(), member, transactions: transactions.results || [], payouts: payouts.results || [], paymentProfile: profile || null, supportCases: support.results || [], dataRequests: dataRequests.results || [] }, 200, {
      "content-disposition": `attachment; filename="hoanlai-data-${user.memberCode}.json"`
    });
  }

  if (path === "/api/account/data-requests" && req.method === "GET") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const rows = await env.DB.prepare("SELECT id,request_type,status,message,admin_note,created_at,updated_at,completed_at FROM data_requests WHERE member_code=? ORDER BY created_at DESC LIMIT 20").bind(user.memberCode).all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/account/data-requests" && req.method === "POST") {
    if (await rateLimited(env, req, "data_request", 3, 86400)) return tooManyRequests();
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const requestType = String(body?.requestType || "");
    const message = String(body?.message || "").trim().slice(0, 2000);
    const password = String(body?.password || "");
    if (!new Set(["correction", "deletion"]).has(requestType)) return json({ error: "Loại yêu cầu không hợp lệ." }, 400);
    if (message.length < 10) return json({ error: "Vui lòng mô tả yêu cầu ít nhất 10 ký tự." }, 400);
    const member = await env.DB.prepare("SELECT password_hash,password_salt FROM members WHERE member_code=?").bind(user.memberCode).first();
    if (!member?.password_hash || !member?.password_salt || !await verifyPassword(password, String(member.password_salt), String(member.password_hash))) {
      return json({ error: "Mật khẩu hiện tại không đúng." }, 401);
    }
    const id = randomId("privacy");
    try {
      await env.DB.prepare("INSERT INTO data_requests(id,member_code,request_type,status,message,created_at,updated_at) VALUES (?,?,?,'open',?,datetime('now'),datetime('now'))")
        .bind(id, user.memberCode, requestType, message).run();
    } catch (error: any) {
      if (String(error?.message || error).toLowerCase().includes("unique")) return json({ error: "Bạn đã có một yêu cầu cùng loại đang được xử lý." }, 409);
      throw error;
    }
    await audit(env, user.memberCode, "personal_data_request_created", "data_request", id, { requestType });
    return json({ ok: true, requestId: id, message: "Đã tiếp nhận yêu cầu dữ liệu cá nhân." }, 201);
  }

  if (path === "/api/create-link" && req.method === "POST") {
    if (await rateLimited(env, req, "create_link", 30, 60)) return tooManyRequests();
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập để tạo link." }, 401);
    const missingVerification = emailVerificationRequired(user);
    if (missingVerification) return missingVerification;
    const missingConsent = consentRequired(user);
    if (missingConsent) return missingConsent;
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }

    const memberCode = user.memberCode;
    const displayName = user.displayName;
    const sourceUrl = String(body?.url || "").trim();

    if (memberCode.length < 6) {
      return json({ error: "memberCode cần tối thiểu 6 ký tự." }, 400);
    }
    const platform = detectPlatform(sourceUrl);
    if (!platform) {
      return json({ error: "Hiện chỉ nhận link Shopee hoặc TikTok Shop." }, 400);
    }

    await upsertMember(env, memberCode, displayName);
    const requestId = randomId("link");

    try {
      const result = platform === "shopee"
        ? await createShopeeLink(env, sourceUrl, memberCode, requestId)
        : await createTikTokLink(env, sourceUrl, memberCode, requestId);

      await env.DB.prepare(`
        INSERT INTO link_requests(
          request_id, member_code, platform, source_url, resolved_url,
          affiliate_url, at_response_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'created', datetime('now'))
      `).bind(
        requestId, memberCode, platform, sourceUrl, result.resolved,
        result.affiliateUrl, minimizedLinkResponse(result.affiliateUrl)
      ).run();

      return json({
        ok: true,
        platform,
        requestId,
        affiliateUrl: result.affiliateUrl,
        cashbackPolicy: {
          rate: Number(env.CASHBACK_RATE || "0.60"),
          note: "Hoàn tiền chỉ được cộng khi giao dịch đã được đối tác xác nhận."
        }
      });
    } catch (e: any) {
      const atResponse = JSON.stringify({ error: safeSyncError(e), providerPayloadStored: false });
      await env.DB.prepare(`
        INSERT INTO link_requests(
          request_id, member_code, platform, source_url, at_response_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'error', datetime('now'))
      `).bind(requestId, memberCode, platform, sourceUrl, atResponse).run();
      return json({ error: e?.message || "Không tạo được affiliate link." }, 502);
    }
  }

  if (path === "/api/wallet" && req.method === "GET") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    return json(await walletSummary(env, user.memberCode));
  }

  if (path === "/api/savings-goal" && req.method === "GET") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const [goal, wallet] = await Promise.all([
      env.DB.prepare("SELECT title,target_vnd,created_at,updated_at FROM savings_goals WHERE member_code=?").bind(user.memberCode).first(),
      walletSummary(env, user.memberCode)
    ]);
    if (!goal) return json({ goal: null, confirmedCashback: wallet.confirmedCashback });
    const targetVnd = Number(goal.target_vnd);
    const confirmedCashback = wallet.confirmedCashback;
    return json({
      goal: {
        title: String(goal.title),
        targetVnd,
        confirmedCashback,
        remainingVnd: Math.max(0, targetVnd - confirmedCashback),
        progressPercent: Math.min(100, Math.floor((confirmedCashback / targetVnd) * 100)),
        achieved: confirmedCashback >= targetVnd,
        createdAt: goal.created_at,
        updatedAt: goal.updated_at
      }
    });
  }

  if (path === "/api/savings-goal" && req.method === "PUT") {
    if (await rateLimited(env, req, "savings_goal_update", 10, 3600)) return tooManyRequests();
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const title = String(body?.title || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const targetVnd = Number(body?.targetVnd);
    if (title.length < 2) return json({ error: "Tên mục tiêu cần ít nhất 2 ký tự." }, 400);
    if (!Number.isSafeInteger(targetVnd) || targetVnd < 50000 || targetVnd > 1000000000) {
      return json({ error: "Mục tiêu cần từ 50.000đ đến 1 tỷ đồng." }, 400);
    }
    await env.DB.prepare(`
      INSERT INTO savings_goals(member_code,title,target_vnd,created_at,updated_at)
      VALUES (?,?,?,datetime('now'),datetime('now'))
      ON CONFLICT(member_code) DO UPDATE SET title=excluded.title,target_vnd=excluded.target_vnd,updated_at=datetime('now')
    `).bind(user.memberCode, title, targetVnd).run();
    await audit(env, user.memberCode, "savings_goal_updated", "member", user.memberCode, { targetVnd });
    return json({ ok: true, message: "Đã lưu mục tiêu tiết kiệm." });
  }

  if (path === "/api/transactions" && req.method === "GET") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const rows = await env.DB.prepare(`
      SELECT transaction_id, platform, merchant, status, is_confirmed, approval_time,
             commission_vnd, order_value_vnd, cashback_vnd, transaction_time, updated_at
      FROM transactions
      WHERE member_code=?
      ORDER BY COALESCE(transaction_time, updated_at) DESC
      LIMIT 100
    `).bind(user.memberCode).all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/payment-profile" && req.method === "GET") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const row = await env.DB.prepare(`
      SELECT method, bank_code, account_name, account_last4, payout_available_at, updated_at,
        CASE WHEN payout_available_at IS NOT NULL AND payout_available_at > datetime('now') THEN 1 ELSE 0 END AS payout_locked
      FROM payment_profiles WHERE member_code=?
    `)
      .bind(user.memberCode).first();
    return json({ profile: row || null });
  }

  if (path === "/api/payment-profile" && req.method === "PUT") {
    if (await rateLimited(env, req, "payment_profile", 6, 3600)) return tooManyRequests();
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const missingVerification = emailVerificationRequired(user);
    if (missingVerification) return missingVerification;
    const missingConsent = consentRequired(user);
    if (missingConsent) return missingConsent;
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const method = String(body?.method || "bank");
    const bankCode = String(body?.bankCode || "").trim().toUpperCase().slice(0, 30);
    const accountName = String(body?.accountName || "").trim().toUpperCase().slice(0, 100);
    const accountNumber = String(body?.accountNumber || "").replace(/\s+/g, "");
    const password = String(body?.password || "");
    if (method !== "bank" && method !== "momo") return json({ error: "Phương thức không hợp lệ." }, 400);
    if (!/^[A-Z0-9_-]{2,30}$/.test(bankCode)) return json({ error: "Mã ngân hàng/ví không hợp lệ." }, 400);
    if (accountName.length < 4) return json({ error: "Tên chủ tài khoản không hợp lệ." }, 400);
    if (!/^\d{6,24}$/.test(accountNumber)) return json({ error: "Số tài khoản phải có 6–24 chữ số." }, 400);
    const member = await env.DB.prepare("SELECT password_hash, password_salt FROM members WHERE member_code=?").bind(user.memberCode).first();
    if (!member?.password_hash || !member?.password_salt || !await verifyPassword(password, String(member.password_salt), String(member.password_hash))) {
      return json({ error: "Mật khẩu hiện tại không đúng." }, 401);
    }
    const fingerprint = await accountFingerprint(env, method, bankCode, accountNumber);
    const duplicate = await env.DB.prepare("SELECT member_code FROM payment_profiles WHERE account_fingerprint=? AND member_code<>?")
      .bind(fingerprint, user.memberCode).first();
    if (duplicate) return json({ error: "Tài khoản nhận tiền này đã được liên kết với một tài khoản khác." }, 409);
    const encrypted = await encryptAccount(env, accountNumber);
    try {
      await env.DB.prepare(`
        INSERT INTO payment_profiles(member_code, method, bank_code, account_name, account_ciphertext, account_iv,
          account_last4, account_fingerprint, payout_available_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+24 hours'), datetime('now'))
        ON CONFLICT(member_code) DO UPDATE SET method=excluded.method, bank_code=excluded.bank_code,
          account_name=excluded.account_name, account_ciphertext=excluded.account_ciphertext,
          account_iv=excluded.account_iv, account_last4=excluded.account_last4,
          payout_available_at=CASE
            WHEN payment_profiles.account_fingerprint=excluded.account_fingerprint
              THEN COALESCE(payment_profiles.payout_available_at,datetime('now'))
            ELSE datetime('now','+24 hours')
          END,
          account_fingerprint=excluded.account_fingerprint, updated_at=datetime('now')
      `).bind(user.memberCode, method, bankCode, accountName, encrypted.ciphertext, encrypted.iv,
        accountNumber.slice(-4), fingerprint).run();
    } catch (error: any) {
      if (String(error?.message || error).toLowerCase().includes("unique")) {
        return json({ error: "Tài khoản nhận tiền này đã được liên kết với một tài khoản khác." }, 409);
      }
      throw error;
    }
    await audit(env, user.memberCode, "payment_profile_updated", "member", user.memberCode, {
      method, bankCode, last4: accountNumber.slice(-4), payoutCooldownHours: 24
    });
    return json({
      ok: true,
      profile: { method, bank_code: bankCode, account_name: accountName, account_last4: accountNumber.slice(-4) },
      message: "Đã lưu. Vì an toàn, tài khoản nhận tiền mới có hiệu lực rút sau 24 giờ."
    });
  }

  if (path === "/api/payouts" && req.method === "GET") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const rows = await env.DB.prepare(`
      SELECT id,amount_vnd,status,note,payment_method,payment_bank_code,payment_account_last4,created_at,reviewed_at,updated_at
      FROM payout_requests WHERE member_code=? ORDER BY created_at DESC LIMIT 50
    `).bind(user.memberCode).all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/payout-request" && req.method === "POST") {
    if (await rateLimited(env, req, "payout_request", 3, 3600)) return tooManyRequests();
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const missingVerification = emailVerificationRequired(user);
    if (missingVerification) return missingVerification;
    const missingConsent = consentRequired(user);
    if (missingConsent) return missingConsent;
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    if (!await verifyTurnstile(req, env, body, "payout")) return turnstileRejected();
    const memberCode = user.memberCode;

    const payment = await env.DB.prepare(`
      SELECT *,CASE WHEN payout_available_at IS NOT NULL AND payout_available_at>datetime('now') THEN 1 ELSE 0 END AS payout_locked
      FROM payment_profiles WHERE member_code=?
    `).bind(memberCode).first();
    if (!payment) return json({ error: "Hãy thêm tài khoản nhận tiền trước khi rút." }, 400);
    let fingerprint = String(payment.account_fingerprint || "");
    if (!fingerprint) {
      const accountNumber = await decryptAccount(env, String(payment.account_ciphertext), String(payment.account_iv));
      fingerprint = await accountFingerprint(env, String(payment.method), String(payment.bank_code), accountNumber);
      const duplicate = await env.DB.prepare("SELECT member_code FROM payment_profiles WHERE account_fingerprint=? AND member_code<>?")
        .bind(fingerprint, memberCode).first();
      if (duplicate) return json({ error: "Tài khoản nhận tiền này đang được dùng bởi một tài khoản khác. Vui lòng liên hệ hỗ trợ." }, 409);
      try {
        await env.DB.prepare("UPDATE payment_profiles SET account_fingerprint=?,payout_available_at=COALESCE(payout_available_at,datetime('now')) WHERE member_code=?")
          .bind(fingerprint, memberCode).run();
      } catch (error: any) {
        if (String(error?.message || error).toLowerCase().includes("unique")) {
          return json({ error: "Tài khoản nhận tiền này đang được dùng bởi một tài khoản khác. Vui lòng liên hệ hỗ trợ." }, 409);
        }
        throw error;
      }
    }
    if (Number(payment.payout_locked || 0) === 1) {
      return json({ error: `Tài khoản nhận tiền vừa được thay đổi. Bạn có thể rút sau ${String(payment.payout_available_at)} (giờ hệ thống).` }, 423);
    }
    const existing = await env.DB.prepare("SELECT id FROM payout_requests WHERE member_code=? AND status='requested'").bind(memberCode).first();
    if (existing) return json({ error: "Bạn đã có một yêu cầu rút đang chờ xử lý." }, 409);
    const wallet = await walletSummary(env, memberCode);
    if (wallet.available < wallet.minimumPayout) {
      return json({
        error: `Chưa đủ ngưỡng rút ${wallet.minimumPayout.toLocaleString("vi-VN")}đ`,
        wallet
      }, 400);
    }

    const id = randomId("pay");
    try {
      await env.DB.prepare(`
        INSERT INTO payout_requests(id, member_code, amount_vnd, status,
          payment_method, payment_bank_code, payment_account_name, payment_account_ciphertext, payment_account_iv,
          payment_account_last4, payment_account_fingerprint,
          created_at, updated_at)
        VALUES (?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(id, memberCode, wallet.available, payment.method, payment.bank_code, payment.account_name,
        payment.account_ciphertext, payment.account_iv, payment.account_last4, fingerprint).run();
    } catch (error: any) {
      if (String(error?.message || error).toLowerCase().includes("unique")) {
        return json({ error: "Bạn đã có một yêu cầu rút đang chờ xử lý." }, 409);
      }
      throw error;
    }
    await audit(env, memberCode, "payout_requested", "payout", id, { amount: wallet.available, last4: payment.account_last4 });

    return json({ ok: true, payoutRequestId: id, amount: wallet.available });
  }

  if (path === "/api/support-cases" && req.method === "GET") {
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    const rows = await env.DB.prepare(`
      SELECT id,category,order_reference,subject,message,status,admin_note,created_at,updated_at,resolved_at
      FROM support_cases WHERE member_code=? ORDER BY created_at DESC LIMIT 50
    `).bind(user.memberCode).all();
    return json({ data: rows.results || [] }, 200, { "cache-control": "no-store" });
  }

  if (path === "/api/support-cases" && req.method === "POST") {
    if (await rateLimited(env, req, "support_case", 5, 86400)) return tooManyRequests();
    const user = await currentUser(req, env);
    if (!user) return json({ error: "Vui lòng đăng nhập." }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const category = String(body?.category || "other");
    const allowedCategories = new Set(["missing_order", "wrong_status", "payout", "account", "other"]);
    const orderReference = String(body?.orderReference || "").trim().slice(0, 100);
    const subject = String(body?.subject || "").trim().slice(0, 120);
    const message = String(body?.message || "").trim().slice(0, 2000);
    if (!allowedCategories.has(category)) return json({ error: "Loại khiếu nại không hợp lệ." }, 400);
    if (subject.length < 5) return json({ error: "Tiêu đề cần ít nhất 5 ký tự." }, 400);
    if (message.length < 20) return json({ error: "Nội dung cần ít nhất 20 ký tự để có đủ thông tin xử lý." }, 400);
    if ((category === "missing_order" || category === "wrong_status") && !orderReference) {
      return json({ error: "Vui lòng nhập mã đơn cần đối soát." }, 400);
    }
    const id = randomId("case");
    await env.DB.prepare(`
      INSERT INTO support_cases(id,member_code,category,order_reference,subject,message,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'open',datetime('now'),datetime('now'))
    `).bind(id, user.memberCode, category, orderReference || null, subject, message).run();
    await audit(env, user.memberCode, "support_case_created", "support_case", id, { category, hasOrderReference: Boolean(orderReference) });
    return json({ ok: true, caseId: id, message: "Đã tiếp nhận khiếu nại và cấp mã theo dõi." }, 201);
  }

  if (path === "/api/admin/sync" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    try {
      return json(await runTrackedSync(env, "manual"));
    } catch (e: any) {
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  if (path === "/api/admin/test-alert" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    if (await rateLimited(env, req, "admin_alert_test", 5, 3600)) return tooManyRequests();
    const alertId = randomId("alert");
    const delivery = await sendSyncAlert(env, "alert_test", { alertId, source: "admin", createdAt: nowIso() });
    await audit(env, "admin", "operational_alert_tested", "alert", alertId, delivery);
    if (!delivery.webhook && !delivery.email) {
      return json({ error: "Chưa cấu hình kênh cảnh báo hoặc gửi thử thất bại. Hãy kiểm tra ALERT_EMAIL/RESEND_API_KEY hoặc ALERT_WEBHOOK_URL." }, 503);
    }
    return json({ ok: true, delivery });
  }

  if (path === "/api/admin/support-cases" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const rows = await env.DB.prepare(`
      SELECT id,member_code,category,order_reference,subject,message,status,admin_note,created_at,updated_at,resolved_at
      FROM support_cases ORDER BY
        CASE status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
        created_at DESC LIMIT 200
    `).all();
    return json({ data: rows.results || [] }, 200, { "cache-control": "no-store" });
  }

  if (path === "/api/admin/support-cases/update" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    if (await rateLimited(env, req, "admin_support_update", 60, 3600)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const id = String(body?.id || "");
    const status = String(body?.status || "");
    const note = String(body?.note || "").trim().slice(0, 2000);
    if (!id || !new Set(["reviewing", "resolved", "rejected"]).has(status)) return json({ error: "Dữ liệu xử lý không hợp lệ." }, 400);
    if (note.length < 4) return json({ error: "Cần ghi nội dung xử lý ít nhất 4 ký tự." }, 400);
    const result = await env.DB.prepare(`
      UPDATE support_cases SET status=?,admin_note=?,updated_at=datetime('now'),
        resolved_at=CASE WHEN ? IN ('resolved','rejected') THEN datetime('now') ELSE NULL END
      WHERE id=? AND status IN ('open','reviewing')
    `).bind(status, note, status, id).run();
    if (Number(result.meta?.changes || 0) !== 1) return json({ error: "Khiếu nại không tồn tại hoặc đã kết thúc." }, 409);
    await audit(env, "admin", "support_case_updated", "support_case", id, { status, note });
    return json({ ok: true });
  }

  if (path === "/api/admin/data-requests" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const rows = await env.DB.prepare(`
      SELECT d.id,d.member_code,m.email,d.request_type,d.status,d.message,d.admin_note,
        d.created_at,d.updated_at,d.completed_at
      FROM data_requests d JOIN members m ON m.member_code=d.member_code
      ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,d.created_at DESC
      LIMIT 200
    `).all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/admin/data-requests/update" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    if (await rateLimited(env, req, "admin_data_request_update", 30, 3600)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const id = String(body?.id || "");
    const status = String(body?.status || "");
    const note = String(body?.note || "").trim().slice(0, 2000);
    if (!id || !new Set(["reviewing", "completed", "rejected"]).has(status)) return json({ error: "Dữ liệu xử lý không hợp lệ." }, 400);
    if (note.length < 4) return json({ error: "Cần ghi nội dung xử lý ít nhất 4 ký tự." }, 400);
    const request = await env.DB.prepare("SELECT member_code,request_type,status FROM data_requests WHERE id=?").bind(id).first();
    if (!request || !new Set(["open", "reviewing"]).has(String(request.status))) return json({ error: "Yêu cầu không tồn tại hoặc đã kết thúc." }, 409);
    const statements = [env.DB.prepare(`
      UPDATE data_requests SET status=?,admin_note=?,updated_at=datetime('now'),
        completed_at=CASE WHEN ? IN ('completed','rejected') THEN datetime('now') ELSE NULL END
      WHERE id=? AND status IN ('open','reviewing')
    `).bind(status, note, status, id)];
    if (status === "completed" && request.request_type === "deletion") {
      const pending = await env.DB.prepare("SELECT 1 FROM payout_requests WHERE member_code=? AND status='requested' LIMIT 1").bind(String(request.member_code)).first();
      if (pending) return json({ error: "Không thể đóng tài khoản khi còn yêu cầu rút tiền đang chờ." }, 409);
      statements.push(
        env.DB.prepare("UPDATE members SET account_status='closed',email=NULL,email_verified_at=NULL,password_hash=NULL,password_salt=NULL,display_name='Tài khoản đã đóng',updated_at=datetime('now') WHERE member_code=?").bind(String(request.member_code)),
        env.DB.prepare("DELETE FROM sessions WHERE member_code=?").bind(String(request.member_code)),
        env.DB.prepare("DELETE FROM payment_profiles WHERE member_code=?").bind(String(request.member_code))
      );
    }
    statements.push(env.DB.prepare("INSERT INTO audit_logs(id,actor,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,?,?,?,datetime('now'))")
      .bind(randomId("audit"), "admin", "personal_data_request_updated", "data_request", id, JSON.stringify({ status, requestType: request.request_type, note })));
    await env.DB.batch(statements);
    return json({ ok: true });
  }

  if (path === "/api/admin/launch-readiness" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const [unconsented, unverified, openDataRequests, lastSync, turnstile, anomalies, lastVerificationEmail] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM members WHERE account_status='active' AND (terms_version IS NULL OR terms_version<>? OR privacy_version IS NULL OR privacy_version<>?)").bind(CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM members WHERE account_status='active' AND email_verified_at IS NULL").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM data_requests WHERE status IN ('open','reviewing')").first(),
      env.DB.prepare("SELECT status,finished_at,error_message FROM sync_runs ORDER BY started_at DESC LIMIT 1").first(),
      env.DB.prepare("SELECT first_success_at,replay_rejected_at FROM turnstile_health WHERE id=1").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM transactions WHERE status=1 AND is_confirmed=1 AND (member_code IS NULL OR member_code='')").first(),
      env.DB.prepare("SELECT created_at FROM audit_logs WHERE action='email_verification_email_sent' ORDER BY created_at DESC LIMIT 1").first()
    ]);
    const checks = {
      productionMode: String(env.SERVICE_MODE) === "production",
      legalIdentity: Boolean(env.BUSINESS_LEGAL_NAME?.trim() && env.BUSINESS_ADDRESS?.trim()),
      supportChannel: Boolean(env.SUPPORT_EMAIL?.trim()),
      automatedEmail: Boolean(env.RESEND_API_KEY),
      emailDeliveryTested: Boolean(lastVerificationEmail?.created_at),
      alertChannel: Boolean(env.ALERT_WEBHOOK_URL || (env.RESEND_API_KEY && env.ALERT_EMAIL)),
      accessTradeSync: lastSync?.status === "success",
      turnstileVerified: Boolean(turnstile?.first_success_at && turnstile?.replay_rejected_at),
      allActiveMembersConsented: Number(unconsented?.count || 0) === 0,
      allActiveEmailsVerified: Number(unverified?.count || 0) === 0,
      noUnattributedConfirmedOrders: Number(anomalies?.count || 0) === 0
    };
    return json({
      ready: Object.values(checks).every(Boolean),
      checks,
      counts: { membersNeedingConsent: Number(unconsented?.count || 0), membersNeedingEmailVerification: Number(unverified?.count || 0), openDataRequests: Number(openDataRequests?.count || 0) },
      versions: { terms: CURRENT_TERMS_VERSION, privacy: CURRENT_PRIVACY_VERSION },
      lastSync: lastSync || null,
      note: "Chỉ chuyển SERVICE_MODE sang production sau khi mọi kiểm tra đều đạt và đã được tư vấn pháp lý/kế toán."
    });
  }

  if (path === "/api/admin/payouts" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const rows = await env.DB.prepare(`
      SELECT id, member_code, amount_vnd, status, note, payment_method, payment_bank_code,
        payment_account_name, payment_account_last4,
        created_at, updated_at, reviewed_at
      FROM payout_requests
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/admin/payouts/reveal" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    if (await rateLimited(env, req, "admin_payout_reveal", 10, 900)) return tooManyRequests();
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const id = String(body?.id || "");
    const currentPassword = String(body?.currentPassword || "");
    if (!id || !await verifyAdminPassword(env, currentPassword)) return json({ error: "Mật khẩu quản trị không đúng." }, 401);
    const payout = await env.DB.prepare(`
      SELECT payment_account_ciphertext,payment_account_iv,payment_account_last4
      FROM payout_requests WHERE id=?
    `).bind(id).first();
    if (!payout?.payment_account_ciphertext || !payout?.payment_account_iv) return json({ error: "Không tìm thấy thông tin nhận tiền." }, 404);
    const accountNumber = await decryptAccount(env, String(payout.payment_account_ciphertext), String(payout.payment_account_iv));
    await audit(env, "admin", "payout_account_revealed", "payout", id, { last4: payout.payment_account_last4 });
    return json({ accountNumber }, 200, { "cache-control": "no-store" });
  }

  if (path === "/api/admin/payouts/mark-paid" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const id = String(body?.id || "");
    const note = String(body?.note || "").trim().slice(0, 500);
    if (!id) return json({ error: "Thiếu id" }, 400);
    if (note.length < 4) return json({ error: "Cần nhập mã giao dịch hoặc nội dung chuyển khoản (ít nhất 4 ký tự)." }, 400);
    const result = await env.DB.prepare(`
      UPDATE payout_requests
      SET status='paid', note=?, reviewed_at=datetime('now'), updated_at=datetime('now')
      WHERE id=? AND status='requested'
    `).bind(note || null, id).run();
    if (Number(result.meta?.changes || 0) !== 1) {
      return json({ error: "Yêu cầu không tồn tại hoặc đã được xử lý trước đó." }, 409);
    }
    await audit(env, "admin", "payout_marked_paid", "payout", id, { note });
    return json({ ok: true });
  }

  if (path === "/api/admin/payouts/reject" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const id = String(body?.id || "");
    const note = String(body?.note || "").trim().slice(0, 500);
    if (!id) return json({ error: "Thiếu id" }, 400);
    if (note.length < 4) return json({ error: "Cần nhập lý do từ chối (ít nhất 4 ký tự)." }, 400);
    const result = await env.DB.prepare("UPDATE payout_requests SET status='rejected', note=?, reviewed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='requested'")
      .bind(note || null, id).run();
    if (Number(result.meta?.changes || 0) !== 1) {
      return json({ error: "Yêu cầu không tồn tại hoặc đã được xử lý trước đó." }, 409);
    }
    await audit(env, "admin", "payout_rejected", "payout", id, { note });
    return json({ ok: true });
  }

  if (path === "/api/admin/members" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const rows = await env.DB.prepare(`
      SELECT m.member_code, m.display_name, m.email, m.email_verified_at, m.account_status,m.terms_version,m.privacy_version,m.consented_at,m.created_at,
        COALESCE(SUM(CASE WHEN t.status=1 AND t.is_confirmed=1 THEN t.cashback_vnd ELSE 0 END),0) AS confirmed_cashback
      FROM members m LEFT JOIN transactions t ON t.member_code=m.member_code
      GROUP BY m.member_code ORDER BY m.created_at DESC LIMIT 200
    `).all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/admin/password-resets" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    await env.DB.prepare("UPDATE password_reset_requests SET status='expired' WHERE status='approved' AND expires_at <= datetime('now')").run();
    const rows = await env.DB.prepare("SELECT id,email,status,created_at,reviewed_at,expires_at FROM password_reset_requests WHERE status IN ('pending','approved') ORDER BY created_at DESC LIMIT 100").all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/admin/password-resets/approve" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const id = String(body?.id || "");
    const code = recoveryCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const result = await env.DB.prepare("UPDATE password_reset_requests SET status='approved',code_hash=?,expires_at=datetime('now','+30 minutes'),reviewed_at=datetime('now') WHERE id=? AND status='pending'")
      .bind(await sha256(normalizeRecoveryCode(code)), id).run();
    if (!Number(result.meta?.changes || 0)) return json({ error: "Yêu cầu không còn chờ duyệt." }, 409);
    await audit(env, "admin", "password_reset_approved", "password_reset", id, { expiresInMinutes: 30 });
    return json({ ok: true, code, expiresInMinutes: 30, expiresAt });
  }

  if (path === "/api/admin/password-resets/reject" && req.method === "POST") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "JSON không hợp lệ" }, 400); }
    const id = String(body?.id || "");
    const result = await env.DB.prepare("UPDATE password_reset_requests SET status='rejected',code_hash=NULL,reviewed_at=datetime('now') WHERE id=? AND status IN ('pending','approved')").bind(id).run();
    if (!Number(result.meta?.changes || 0)) return json({ error: "Yêu cầu không thể từ chối." }, 409);
    await audit(env, "admin", "password_reset_rejected", "password_reset", id);
    return json({ ok: true });
  }

  if (path === "/api/admin/audit" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const rows = await env.DB.prepare("SELECT actor, action, target_type, target_id, detail_json, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 200").all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/admin/unattributed" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const rows = await env.DB.prepare(`
      SELECT transaction_id, merchant, status, commission_vnd, transaction_time, raw_json
      FROM transactions
      WHERE member_code IS NULL OR member_code=''
      ORDER BY updated_at DESC
      LIMIT 50
    `).all();
    return json({ data: rows.results || [] });
  }

  if (path === "/api/admin/reconciliation" && req.method === "GET") {
    if (!await requireAdmin(req, env)) return json({ error: "Unauthorized" }, 401);
    const rate = Number(env.CASHBACK_RATE || "0.60");
    const [money, unattributed, mismatches, overcommitted, duplicateDestinations, lockedProfiles, turnstile, recentChecks, lastSync] = await Promise.all([
      env.DB.prepare(`
        SELECT
          COALESCE((SELECT SUM(cashback_vnd) FROM transactions WHERE status=1 AND is_confirmed=1),0) AS confirmed_cashback,
          COALESCE((SELECT SUM(amount_vnd) FROM payout_requests WHERE status='requested'),0) AS requested,
          COALESCE((SELECT SUM(amount_vnd) FROM payout_requests WHERE status='paid'),0) AS paid
      `).first(),
      env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(commission_vnd),0) AS commission FROM transactions WHERE (member_code IS NULL OR member_code='') AND status=1 AND is_confirmed=1").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM transactions WHERE status=1 AND is_confirmed=1 AND ABS(cashback_vnd-CAST(commission_vnd*? AS INTEGER))>1").bind(rate).first(),
      env.DB.prepare(`
        WITH tx AS (SELECT member_code,SUM(cashback_vnd) confirmed FROM transactions WHERE status=1 AND is_confirmed=1 GROUP BY member_code),
        po AS (SELECT member_code,SUM(amount_vnd) committed FROM payout_requests WHERE status IN ('requested','paid') GROUP BY member_code)
        SELECT COUNT(*) AS count FROM po LEFT JOIN tx USING(member_code) WHERE po.committed>COALESCE(tx.confirmed,0)
      `).first(),
      env.DB.prepare(`
        SELECT COUNT(*) AS count FROM (
          SELECT account_fingerprint FROM payment_profiles
          WHERE account_fingerprint IS NOT NULL GROUP BY account_fingerprint HAVING COUNT(*)>1
        )
      `).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM payment_profiles WHERE payout_available_at>datetime('now')").first(),
      env.DB.prepare("SELECT first_success_at,replay_rejected_at,last_action,last_hostname,updated_at FROM turnstile_health WHERE id=1").first(),
      env.DB.prepare("SELECT action,success,hostname,error_codes,created_at FROM turnstile_checks ORDER BY created_at DESC LIMIT 20").all(),
      env.DB.prepare("SELECT status,finished_at,started_at,error_message FROM sync_runs ORDER BY started_at DESC LIMIT 1").first()
    ]);
    return json({
      money: {
        confirmedCashback: Number(money?.confirmed_cashback || 0),
        requested: Number(money?.requested || 0),
        paid: Number(money?.paid || 0),
        liability: Number(money?.requested || 0) + Number(money?.paid || 0)
      },
      anomalies: {
        unattributedConfirmed: Number(unattributed?.count || 0),
        unattributedCommission: Number(unattributed?.commission || 0),
        cashbackMismatches: Number(mismatches?.count || 0),
        overcommittedMembers: Number(overcommitted?.count || 0),
        duplicatePaymentDestinations: Number(duplicateDestinations?.count || 0),
        payoutLockedProfiles: Number(lockedProfiles?.count || 0)
      },
      turnstile: turnstile || null,
      recentTurnstileChecks: recentChecks.results || [],
      lastSync: lastSync || null,
      config: {
        alertsConfigured: Boolean(env.ALERT_WEBHOOK_URL || (env.RESEND_API_KEY && env.ALERT_EMAIL)),
        bankEncryptionConfigured: Boolean(env.BANK_DATA_KEY && env.BANK_DATA_KEY.length >= 32),
        turnstileConfigured: Boolean(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY && env.TURNSTILE_HOSTNAMES),
        accessTradeConfigured: Boolean(env.AT_ACCESS_KEY && env.AT_SHOPEE_CAMPAIGN_ID)
      }
    });
  }

  return json({ error: "Not found" }, 404);
}

const PAGE = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#123c32"/>
<meta name="description" content="Tạo link mua sắm và nhận lại một phần hoa hồng."/>
<title>Hoàn Lại — Mua sắm có hoàn tiền</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='18' fill='%239fe870'/%3E%3Cpath d='M17 15h10v12h10V15h10v34H37V37H27v12H17z' fill='%23111512'/%3E%3Ccircle cx='50' cy='14' r='5' fill='white'/%3E%3C/svg%3E"/>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoaded&render=explicit" defer></script>
<style>
:root{font-family:Inter,"Segoe UI",system-ui,-apple-system,sans-serif;color:#0e0f0c;background:#e8ebe6;line-height:1.5;--primary:#9fe870;--primary-hover:#cdffad;--pale:#e2f6d5;--ink:#0e0f0c;--deep:#163300;--body:#454745;--mute:#868685;--canvas:#fff;--soft:#e8ebe6}
html[data-theme="dark"]{color-scheme:dark;--primary:#9fe870;--primary-hover:#b8f58f;--pale:#263c25;--ink:#f2f5ef;--deep:#bdf09d;--body:#c2c8bf;--mute:#929b90;--canvas:#171a17;--soft:#0f120f}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--soft)}button,input{font:inherit}button{cursor:pointer}.shell{width:min(1200px,calc(100% - 48px));margin:auto}
header{height:76px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:-.03em}.mark{width:36px;height:36px;display:grid;place-items:center;border-radius:50%;background:var(--ink);color:var(--primary);font-size:18px}.header-note{font-size:14px;color:var(--body);font-weight:600}.secure{display:inline-flex;align-items:center;gap:8px}.secure:before{content:"";width:8px;height:8px;border-radius:50%;background:#2ead4b}
.app-nav{display:none;position:sticky;top:0;z-index:9;background:rgba(232,235,230,.96);backdrop-filter:blur(12px);border:1px solid rgba(14,15,12,.12);border-radius:999px;padding:5px;margin:4px auto 0;gap:4px}.app-nav.visible{display:flex}.nav-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border:0;background:transparent;border-radius:999px;padding:9px 12px;font-weight:700;color:var(--body);white-space:nowrap}.nav-icon{width:21px;height:21px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.nav-tab.active{background:var(--ink);color:var(--primary)}.tab-page{display:none!important}.tab-page.active{display:block!important}.hero.tab-page.active,.how.tab-page.active{display:grid!important}.account-sections[data-page="profile"]{grid-template-columns:minmax(0,640px)}.order-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}.order-stat{background:var(--canvas);border:1px solid var(--ink);border-radius:18px;padding:18px}.order-stat span{display:block;color:var(--mute);font-size:12px}.order-stat b{display:block;font-size:25px;margin-top:4px}.status-guide{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 18px}.status-pill.pending{background:#fff2bd}.status-pill.approved{background:#dff5d2;color:#185c2c}.status-pill.rejected{background:#ffe0e0;color:#9b2020}.detail-button{min-height:34px;border:1px solid var(--ink);border-radius:999px;background:transparent;padding:0 12px;font-size:12px;font-weight:700}.order-dialog{width:min(520px,calc(100% - 28px));border:1px solid var(--ink);border-radius:24px;padding:0;background:var(--canvas);color:var(--ink);box-shadow:0 24px 80px rgba(0,0,0,.28)}.order-dialog::backdrop{background:rgba(14,15,12,.62)}.dialog-inner{padding:24px}.dialog-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.dialog-head h3{margin:0;font-size:24px}.dialog-close{width:40px;height:40px;border:1px solid var(--ink);border-radius:50%;background:transparent;font-size:20px}.detail-list{display:grid;grid-template-columns:1fr 1fr;gap:0 18px;margin:20px 0}.detail-item{padding:12px 0;border-bottom:1px solid #e1e3df}.detail-item span{display:block;color:var(--mute);font-size:12px}.detail-item b{display:block;margin-top:3px;word-break:break-word}.detail-note{background:var(--pale);border-radius:14px;padding:13px;font-size:12px;color:var(--deep)}
main{padding:72px 0 56px}.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr);gap:72px;align-items:center}.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--deep);font-size:13px;font-weight:600}.eyebrow:before{content:"";width:24px;height:2px;background:var(--ink)}h1{font-size:clamp(48px,6vw,76px);line-height:.88;letter-spacing:-.055em;margin:24px 0;max-width:680px;color:var(--ink);font-weight:900}.lead{font-size:20px;color:var(--body);max-width:570px;margin:0 0 32px}.trust-row{display:flex;gap:24px;flex-wrap:wrap;color:var(--body);font-size:14px}.trust-row span{display:flex;align-items:center;gap:8px}.check{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--primary);color:var(--ink);font-size:12px;font-weight:900}
.panel{background:var(--canvas);border:1px solid var(--ink);border-radius:24px;padding:32px}.panel-head{display:flex;justify-content:space-between;gap:20px;align-items:start;margin-bottom:24px}.step{color:var(--mute);font-size:12px;font-weight:600}.panel h2{font-size:24px;letter-spacing:-.025em;margin:4px 0 0}.rate{background:var(--pale);color:var(--deep);font-size:13px;font-weight:600;padding:7px 12px;border-radius:999px;white-space:nowrap}.field{margin-top:16px}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block;font-size:14px;font-weight:600;margin-bottom:7px;color:var(--ink)}input{width:100%;height:52px;padding:0 16px;border-radius:12px;border:1px solid var(--ink);background:var(--canvas);color:var(--ink);outline:none;transition:.15s}input::placeholder{color:var(--mute)}input:focus{box-shadow:0 0 0 3px var(--primary)}.hint{display:block;color:var(--mute);font-size:12px;margin-top:8px}
.primary,.secondary{border:0;border-radius:24px;font-weight:600;transition:background .15s}.primary{width:100%;height:52px;margin-top:20px;background:var(--primary);color:var(--ink)}.primary:hover{background:var(--primary-hover)}.primary:disabled{opacity:.65;cursor:wait}.status{min-height:21px;margin-top:11px;font-size:13px}.result{word-break:break-all;background:var(--pale);padding:16px;border-radius:16px;margin-top:10px;font-size:13px}.result a{color:var(--deep)}.buy-link{display:flex;align-items:center;justify-content:center;margin-top:12px;text-decoration:none}
.wallet-section{margin-top:80px}.section-title{display:flex;justify-content:space-between;align-items:end;margin-bottom:18px}.section-title h2{font-size:40px;line-height:.9;font-weight:900;letter-spacing:-.04em;margin:0}.section-title p{color:var(--body);font-size:14px;margin:0}.wallet{display:grid;grid-template-columns:1.2fr .8fr;background:var(--ink);color:var(--canvas);border-radius:24px;overflow:hidden}.balance{padding:32px}.wallet-label{color:#b9bdb7;font-size:13px}.money{font-size:42px;font-weight:900;letter-spacing:-.04em;margin:7px 0 24px;color:var(--primary)}.wallet-meta{display:flex;gap:34px}.meta-value{display:block;font-size:18px;font-weight:600;margin-top:3px}.wallet-note{color:#b9bdb7;font-size:12px;margin-top:22px;max-width:560px}.wallet-actions{background:#171916;padding:32px;display:flex;flex-direction:column;justify-content:center;gap:10px}.secondary{min-height:48px;padding:0 24px;background:var(--primary);color:var(--ink)}.secondary:hover{background:var(--primary-hover)}.secondary.ghost{background:transparent;color:var(--canvas);border:1px solid var(--canvas)}.secondary.ghost:hover{background:rgba(255,255,255,.08)}
.account-sections{display:grid;grid-template-columns:.8fr 1.2fr;gap:18px;margin-top:18px}.account-card{background:var(--canvas);border:1px solid var(--ink);border-radius:24px;padding:24px}.account-card h3{margin:0 0 6px;font-size:21px}.account-card select,.account-card textarea{width:100%;border:1px solid var(--ink);border-radius:12px;padding:0 14px;background:var(--canvas);color:var(--ink);font:inherit}.account-card select{height:52px}.account-card textarea{min-height:130px;padding-top:14px;resize:vertical}.profile-summary{padding:12px 14px;background:var(--pale);border-radius:12px;margin:14px 0;font-size:13px}.history{width:100%;border-collapse:collapse;font-size:13px}.history th,.history td{text-align:left;padding:11px 8px;border-bottom:1px solid color-mix(in srgb,var(--ink) 14%,transparent)}.history th{color:var(--mute)}.table-scroll{overflow:auto}.status-pill{display:inline-block;border-radius:999px;padding:4px 8px;background:color-mix(in srgb,var(--ink) 8%,var(--canvas));white-space:nowrap}.theme-toggle{width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--ink);border-radius:50%;background:transparent;color:var(--ink);font-size:17px;padding:0}
.how{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:64px}.how-item{padding:22px 4px;border-top:1px solid rgba(18,60,50,.16)}.number{font-size:12px;color:#718079;font-weight:800}.how-item h3{margin:10px 0 6px;font-size:16px}.how-item p{color:#748079;font-size:13px;margin:0;max-width:290px}footer{padding:30px 0 38px;border-top:1px solid rgba(18,60,50,.1);display:flex;justify-content:space-between;color:#7c8782;font-size:12px}.account{display:none;align-items:center;gap:10px}.account-name{font-size:13px;font-weight:700}.logout{border:1px solid rgba(18,60,50,.18);background:transparent;border-radius:9px;padding:7px 10px;color:#53635d;font-size:12px}
.auth-layer{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:var(--ink)}.auth-card{width:min(440px,100%);background:var(--soft);border-radius:24px;padding:32px}.auth-brand{display:flex;align-items:center;gap:10px;font-weight:900;margin-bottom:24px}.auth-card h2{font-size:32px;line-height:1;font-weight:900;letter-spacing:-.04em;margin:0 0 10px}.auth-copy{font-size:14px;color:var(--body);margin:0 0 22px}.auth-tabs{display:grid;grid-template-columns:1fr 1fr;background:#daddd8;padding:4px;border-radius:24px;margin-bottom:18px}.auth-tab{border:0;background:transparent;border-radius:20px;padding:10px;color:var(--body);font-weight:600}.auth-tab.active{background:var(--canvas);color:var(--ink)}.auth-submit{margin-top:20px}.auth-message{min-height:20px;margin-top:10px;font-size:13px}.auth-links{display:flex;justify-content:center;gap:14px;margin-top:12px}.text-button{border:0;background:transparent;color:var(--deep);font-size:13px;font-weight:700;padding:5px;text-decoration:underline}.auth-foot{font-size:12px;color:var(--mute);text-align:center;margin:16px 0 0}.turnstile-slot{min-height:70px;margin:12px 0;display:flex;align-items:center;justify-content:center}.consent-row{display:flex;align-items:flex-start;gap:10px;margin-top:15px;font-size:12px;color:var(--body)}.consent-row input{width:18px;height:18px;flex:0 0 auto;margin:1px 0}.consent-row a{color:var(--deep);font-weight:700}.err{color:#d03238}.ok{color:#054d28}.hide{display:none!important}
@media(max-width:800px){
  body{padding-bottom:calc(82px + env(safe-area-inset-bottom));overflow-x:hidden}button,input{touch-action:manipulation}.shell{width:100%;padding:0 16px}
  header{height:64px;position:sticky;top:0;z-index:10;margin:0 -16px;padding:0 16px;background:var(--soft);border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}.mark{width:34px;height:34px}.brand{font-size:15px}.header-note{display:none}.account{min-width:0}.account-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.logout{min-height:40px;padding:0 12px;border-color:var(--ink);border-radius:20px;color:var(--ink)}.app-nav{position:fixed;inset:auto 0 0 0;z-index:19;width:100%;margin:0;padding:7px 8px calc(7px + env(safe-area-inset-bottom));border:0;border-top:1px solid color-mix(in srgb,var(--ink) 16%,transparent);border-radius:18px 18px 0 0;background:var(--canvas);box-shadow:0 -8px 30px rgba(0,0,0,.18)}.nav-tab{flex-direction:column;gap:2px;min-height:58px;padding:5px 4px;border-radius:14px;font-size:11px}.nav-icon{width:23px;height:23px}.nav-tab.active{background:var(--pale);color:var(--deep)}.order-summary{grid-template-columns:1fr 1fr}.order-stat:last-child{grid-column:1/-1}
  main{padding:18px 0 40px}.hero{display:flex;flex-direction:column;gap:34px}.hero.tab-page.active{display:flex!important}.panel{order:-1;width:100%;padding:22px 18px;border-radius:20px}.panel-head{margin-bottom:18px}.panel h2{font-size:22px}.field{margin-top:14px}input{height:56px;font-size:16px}.primary{height:56px;margin-top:18px}.hint{line-height:1.45}.result{font-size:12px}.result .secondary{width:100%}
  .eyebrow{font-size:12px}h1{font-size:44px;line-height:.9;margin:18px 0}.lead{font-size:16px;line-height:1.55;margin-bottom:24px}.trust-row{display:grid;grid-template-columns:1fr 1fr;gap:12px 10px;font-size:13px}
  .wallet-section{margin-top:46px}.section-title{display:block;margin-bottom:14px}.section-title h2{font-size:34px}.section-title p{margin-top:8px;line-height:1.45}.wallet{grid-template-columns:1fr;border-radius:20px}.balance{padding:24px 20px}.money{font-size:40px;margin-bottom:22px}.wallet-meta{display:grid;grid-template-columns:1fr 1fr;gap:16px}.wallet-actions{padding:18px 20px 20px}.secondary{min-height:52px}.wallet-note{line-height:1.5;margin-top:20px}
  .account-sections{grid-template-columns:1fr}.account-card{padding:20px 18px;border-radius:20px}.detail-list{grid-template-columns:1fr}.dialog-inner{padding:20px}
  .how{grid-template-columns:1fr;gap:0;margin-top:44px}.how-item{padding:20px 0}.how-item p{max-width:none}.field-row{grid-template-columns:1fr}footer{display:block;padding:26px 0 calc(30px + env(safe-area-inset-bottom))}.footer-right{display:block;margin-top:5px}
  .auth-layer{align-items:end;padding:0;background:rgba(14,15,12,.7)}.auth-card{width:100%;max-height:94dvh;overflow-y:auto;border-radius:24px 24px 0 0;padding:24px 20px calc(24px + env(safe-area-inset-bottom))}.auth-brand{margin-bottom:20px}.auth-card h2{font-size:30px}.auth-tabs{position:sticky;top:-24px;z-index:2}.auth-foot{line-height:1.5}
}
@media(max-width:380px){.shell{padding:0 12px}header{margin:0 -12px;padding:0 12px}.account-name{display:none}h1{font-size:39px}.panel{padding:20px 15px}.trust-row{grid-template-columns:1fr}.wallet-meta{gap:10px}.rate{font-size:12px}}
</style>
</head>
<body>
<div id="authLayer" class="auth-layer">
  <div class="auth-card">
    <div class="auth-brand"><span class="mark">H</span><span>Hoàn Lại</span></div>
    <h2 id="authTitle">Chào mừng trở lại</h2><p id="authCopy" class="auth-copy">Đăng nhập để xem ví và tiếp tục nhận hoàn tiền.</p>
    <div class="auth-tabs"><button id="loginTab" class="auth-tab active" onclick="setAuthMode('login')">Đăng nhập</button><button id="registerTab" class="auth-tab" onclick="setAuthMode('register')">Đăng ký</button></div>
    <div id="registerName" class="field hide"><label for="authName">Tên của bạn</label><input id="authName" autocomplete="name" placeholder="Ví dụ: Nguyễn Minh Anh"/></div>
    <div id="authEmailField" class="field"><label for="authEmail">Email</label><input id="authEmail" type="email" autocomplete="email" placeholder="ban@email.com"/></div>
    <div id="passwordField" class="field"><label id="passwordLabel" for="authPassword">Mật khẩu</label><input id="authPassword" type="password" autocomplete="current-password" placeholder="Tối thiểu 6 ký tự" minlength="6" maxlength="128" onkeydown="if(event.key==='Enter')submitAuth()"/></div>
    <div id="recoveryCodeField" class="field hide"><label for="recoveryCode">Mã khôi phục</label><input id="recoveryCode" autocomplete="one-time-code" placeholder="XXXXX-XXXXX" maxlength="11"/></div>
    <label id="registrationConsent" class="consent-row hide"><input id="acceptTerms" type="checkbox"/><span>Tôi đã đọc và đồng ý <a href="/dieu-khoan-hoan-tien" target="_blank">Điều khoản hoàn tiền</a> và <a href="/chinh-sach-bao-mat" target="_blank">Chính sách bảo mật</a>.</span></label>
    <div id="authTurnstile" class="turnstile-slot" aria-label="Xác minh chống bot"></div>
    <button id="authSubmit" class="primary auth-submit" onclick="submitAuth()">Đăng nhập</button><div id="authMessage" class="auth-message"></div>
    <div class="auth-links"><button id="forgotButton" class="text-button" onclick="setAuthMode('forgot')">Quên mật khẩu?</button><button id="haveCodeButton" class="text-button hide" onclick="setAuthMode('reset')">Tôi đã có mã</button><button id="backLoginButton" class="text-button hide" onclick="setAuthMode('login')">Quay lại đăng nhập</button></div>
    <p class="auth-foot">Thông tin đăng nhập được bảo vệ và không chia sẻ với đối tác mua sắm.</p>
  </div>
</div>
<div class="shell">
  <header><div class="brand"><span class="mark">H</span><span>Hoàn Lại</span></div><div id="headerNote" class="header-note secure">Đối soát đơn hàng minh bạch</div><div id="account" class="account"><button id="themeToggle" class="theme-toggle" onclick="toggleTheme()" aria-label="Đổi giao diện sáng tối">◐</button><span id="accountName" class="account-name"></span><button class="logout" onclick="logout()">Đăng xuất</button></div></header>
  <nav id="appNav" class="app-nav" aria-label="Khu vực tài khoản">
    <button class="nav-tab active" data-tab="home" onclick="switchTab('home')" aria-label="Tạo link"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg><span>Tạo link</span></button>
    <button class="nav-tab" data-tab="wallet" onclick="switchTab('wallet')" aria-label="Ví và số dư"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H18a2 2 0 0 1 2 2v13H5a2 2 0 0 1-2-2z"/><path d="M3 8h17M16 12h5v4h-5a2 2 0 0 1 0-4z"/></svg><span>Ví</span></button>
    <button class="nav-tab" data-tab="orders" onclick="switchTab('orders')" aria-label="Theo dõi đơn hàng"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16l-1 13H5zM8 7a4 4 0 0 1 8 0"/><path d="m9 14 2 2 4-4"/></svg><span>Đơn hàng</span></button>
    <button class="nav-tab" data-tab="support" onclick="switchTab('support')" aria-label="Khiếu nại và hỗ trợ"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H9l-5 4z"/><path d="M8 9h8M8 13h5"/></svg><span>Hỗ trợ</span></button>
    <button class="nav-tab" data-tab="profile" onclick="switchTab('profile')" aria-label="Tài khoản"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>Tài khoản</span></button>
  </nav>
  <main>
    <section class="hero tab-page active" data-page="home">
      <div><div class="eyebrow">Mua như thường, nhận thêm tiền</div><h1>Mỗi đơn hàng<br/>đều đáng giá hơn.</h1><p class="lead">Dán link sản phẩm Shopee hoặc TikTok Shop. Chúng tôi tạo link riêng để ghi nhận và hoàn lại 60% hoa hồng cho bạn.</p><div class="trust-row"><span><i class="check">✓</i> Không mất phí</span><span><i class="check">✓</i> Theo dõi rõ ràng</span><span><i class="check">✓</i> Rút từ 50.000đ</span></div></div>
      <div class="panel">
        <div class="panel-head"><div><div class="step">Bắt đầu tại đây</div><h2>Tạo link hoàn tiền</h2></div><span class="rate">Hoàn 60%</span></div>
        <div class="field"><label for="url">Link sản phẩm</label><input id="url" inputmode="url" autocomplete="url" placeholder="Dán link Shopee hoặc TikTok Shop"/></div>
        <span class="hint">Link được tự động gắn với tài khoản đang đăng nhập.</span>
        <button id="createBtn" class="primary" onclick="createLink()">Tạo link và mua sắm</button><div id="msg" class="status"></div><div id="result" class="result hide"></div>
      </div>
    </section>
    <section class="wallet-section tab-page" data-page="wallet">
      <div class="section-title"><h2>Ví của bạn</h2><p>Cập nhật sau khi đối tác xác nhận giao dịch</p></div>
      <div class="wallet"><div class="balance"><div class="wallet-label">Số dư có thể rút</div><div class="money" id="available">—</div><div class="wallet-meta"><div><span class="wallet-label">Hoàn dự kiến</span><span class="meta-value" id="pending">—</span></div><div><span class="wallet-label">Đã xác nhận</span><span class="meta-value" id="confirmed">—</span></div></div><div class="wallet-note" id="walletNote">Đang tải thông tin ví…</div></div><div class="wallet-actions"><div id="payoutTurnstile" class="turnstile-slot" aria-label="Xác minh chống bot"></div><button class="secondary" onclick="requestPayout()">Yêu cầu rút tiền</button><button class="secondary ghost" onclick="loadWallet()">Làm mới số dư</button></div></div>
      <div class="account-card" style="margin-top:18px"><h3>Lịch thanh toán</h3><p class="hint">Yêu cầu hợp lệ được xử lý vào ngày 15 và ngày cuối cùng mỗi tháng. Chỉ số dư đã được đối tác xác nhận và đạt tối thiểu 50.000đ mới được thanh toán.</p><div class="table-scroll"><table class="history"><thead><tr><th>Ngày yêu cầu</th><th>Số tiền</th><th>Tài khoản nhận</th><th>Trạng thái</th><th>Xử lý lúc</th></tr></thead><tbody id="payoutRows"></tbody></table></div></div>
    </section>
    <section class="account-sections tab-page" data-page="profile">
      <div class="account-card"><h3>Xác minh email</h3><div id="emailVerificationStatus" class="profile-summary">Đang kiểm tra trạng thái email…</div><p class="hint">Email đã xác minh giúp bảo vệ quyền sở hữu tài khoản. Bạn cần hoàn tất bước này trước khi tạo link, đổi tài khoản nhận tiền hoặc rút tiền.</p><button id="emailVerificationButton" class="primary" onclick="requestEmailVerification()">Gửi email xác minh</button><div id="emailVerificationMsg" class="status"></div></div>
      <div class="account-card"><h3>Tài khoản nhận tiền</h3><p class="hint">Thông tin được mã hóa. Cần nhập mật khẩu hiện tại khi thay đổi. Vì an toàn, thay đổi mới sẽ khóa rút tiền trong 24 giờ và một tài khoản nhận tiền không thể dùng cho nhiều tài khoản.</p><div id="profileSummary" class="profile-summary">Chưa thiết lập</div><div class="field"><label>Phương thức</label><select id="paymentMethod"><option value="bank">Ngân hàng</option><option value="momo">Ví MoMo</option></select></div><div class="field"><label>Mã ngân hàng / ví</label><input id="bankCode" placeholder="Ví dụ: VCB, MB, MOMO"/></div><div class="field"><label>Tên chủ tài khoản</label><input id="accountHolder" autocomplete="name" placeholder="NGUYEN VAN A"/></div><div class="field"><label>Số tài khoản / số điện thoại</label><input id="accountNumber" inputmode="numeric" autocomplete="off" placeholder="Chỉ nhập chữ số"/></div><div class="field"><label>Mật khẩu hiện tại</label><input id="paymentPassword" type="password" autocomplete="current-password"/></div><button class="primary" onclick="savePaymentProfile()">Lưu tài khoản nhận tiền</button><div id="paymentMsg" class="status"></div></div>
      <div class="account-card"><h3>Bảo mật tài khoản</h3><p class="hint">Đổi mật khẩu sẽ đăng xuất các phiên khác.</p><div class="field"><label>Mật khẩu hiện tại</label><input id="currentUserPassword" type="password" autocomplete="current-password"/></div><div class="field"><label>Mật khẩu mới</label><input id="newUserPassword" type="password" minlength="6" maxlength="128" autocomplete="new-password"/></div><div class="field"><label>Nhập lại mật khẩu mới</label><input id="confirmUserPassword" type="password" minlength="6" maxlength="128" autocomplete="new-password"/></div><button class="primary" onclick="changeUserPassword()">Đổi mật khẩu</button><div id="userPasswordMsg" class="status"></div></div>
      <div class="account-card"><h3>Quyền dữ liệu cá nhân</h3><div id="consentStatus" class="profile-summary">Đang kiểm tra phiên bản điều khoản…</div><label class="consent-row"><input id="accountConsent" type="checkbox"/><span>Tôi đồng ý phiên bản hiện tại của <a href="/dieu-khoan-hoan-tien" target="_blank">Điều khoản</a> và <a href="/chinh-sach-bao-mat" target="_blank">Chính sách bảo mật</a>.</span></label><button class="primary" onclick="acceptCurrentTerms()">Lưu chấp thuận</button><button class="secondary ghost" style="color:var(--ink);border-color:var(--ink);width:100%;margin-top:10px" onclick="exportMyData()">Tải dữ liệu của tôi</button><div class="field"><label>Yêu cầu sửa hoặc xóa dữ liệu</label><select id="dataRequestType"><option value="correction">Yêu cầu chỉnh sửa</option><option value="deletion">Yêu cầu đóng tài khoản / xóa dữ liệu</option></select></div><div class="field"><label>Nội dung yêu cầu</label><textarea id="dataRequestMessage" maxlength="2000"></textarea></div><div class="field"><label>Mật khẩu hiện tại</label><input id="dataRequestPassword" type="password" autocomplete="current-password"/></div><button class="primary" onclick="createDataRequest()">Gửi yêu cầu dữ liệu</button><div id="dataRequestMsg" class="status"></div></div>
    </section>
    <section class="tab-page" data-page="orders"><div class="section-title"><h2>Theo dõi đơn hàng</h2><p>Dữ liệu cập nhật theo kết quả đối soát từ đối tác</p></div><div class="order-summary"><div class="order-stat"><span>Đang chờ duyệt</span><b id="ordersPending">0</b></div><div class="order-stat"><span>Đã duyệt tiền</span><b id="ordersApproved">0</b></div><div class="order-stat"><span>Không được duyệt</span><b id="ordersRejected">0</b></div></div><div class="account-card"><h3>Lịch sử và tình trạng duyệt tiền</h3><div class="status-guide"><span class="status-pill pending">Đang đối soát</span><span class="status-pill approved">Đã duyệt tiền</span><span class="status-pill rejected">Không được duyệt</span></div><p class="hint">Tiền chỉ chuyển sang số dư có thể rút khi đơn được đối tác xác nhận. Đơn hủy/hoàn sẽ không được cộng tiền.</p><div class="table-scroll"><table class="history"><thead><tr><th>Thời gian</th><th>Mã đơn</th><th>Nền tảng</th><th>Giá trị đơn</th><th>Hoàn tiền</th><th>Trạng thái</th><th>Duyệt lúc</th><th></th></tr></thead><tbody id="transactionRows"></tbody></table></div></div></section>
    <section class="tab-page" data-page="support"><div class="section-title"><h2>Khiếu nại & hỗ trợ</h2><p>Mỗi yêu cầu có mã theo dõi và lịch sử xử lý riêng</p></div><div class="account-sections"><div class="account-card"><h3>Gửi yêu cầu mới</h3><p class="hint">Cung cấp mã đơn và mô tả cụ thể. Không gửi mật khẩu, mã OTP hoặc toàn bộ số tài khoản.</p><div class="field"><label>Loại yêu cầu</label><select id="supportCategory"><option value="missing_order">Chưa thấy đơn hàng</option><option value="wrong_status">Trạng thái đơn chưa đúng</option><option value="payout">Rút tiền / thanh toán</option><option value="account">Tài khoản</option><option value="other">Khác</option></select></div><div class="field"><label>Mã đơn (nếu liên quan)</label><input id="supportOrderRef" maxlength="100" placeholder="Mã đơn cần đối soát"/></div><div class="field"><label>Tiêu đề</label><input id="supportSubject" maxlength="120" placeholder="Tóm tắt vấn đề"/></div><div class="field"><label>Nội dung</label><textarea id="supportMessage" maxlength="2000" placeholder="Mô tả thời gian mua, trạng thái hiện tại và kết quả bạn cần hỗ trợ"></textarea></div><button class="primary" onclick="createSupportCase()">Gửi yêu cầu</button><div id="supportMsg" class="status"></div></div><div class="account-card"><h3>Yêu cầu của bạn</h3><div class="table-scroll"><table class="history"><thead><tr><th>Mã</th><th>Ngày gửi</th><th>Nội dung</th><th>Trạng thái</th><th>Phản hồi</th></tr></thead><tbody id="supportRows"></tbody></table></div></div></div></section>
    <section class="how tab-page active" data-page="home"><div class="how-item"><span class="number">01</span><h3>Dán link sản phẩm</h3><p>Chọn món bạn muốn mua trên Shopee hoặc TikTok Shop.</p></div><div class="how-item"><span class="number">02</span><h3>Mua qua link riêng</h3><p>Dùng link được tạo để đơn hàng được ghi nhận đúng cho bạn.</p></div><div class="how-item"><span class="number">03</span><h3>Nhận hoàn tiền</h3><p>Số dư được cộng sau khi đơn hoàn tất và đối tác xác nhận.</p></div></section>
  </main>
  <footer><span>© 2026 Hoàn Lại</span><span class="footer-right"><a href="/dieu-khoan-hoan-tien">Điều khoản hoàn tiền</a> · <a href="/chinh-sach-bao-mat">Bảo mật</a> · <a href="/quy-trinh-khieu-nai">Khiếu nại</a></span></footer>
</div>
<dialog id="orderDialog" class="order-dialog"><div class="dialog-inner"><div class="dialog-head"><h3>Chi tiết đơn hàng</h3><button class="dialog-close" onclick="closeOrderDetail()" aria-label="Đóng">×</button></div><div id="orderDetail" class="detail-list"></div><div id="orderDetailNote" class="detail-note"></div></div></dialog>
<script>
const $ = id => document.getElementById(id);
const money = value => Number(value||0).toLocaleString("vi-VN")+"đ";
const TURNSTILE_SITE_KEY="0x4AAAAAAESsPyHuWNfILVqI";
const turnstileWidgets={};
function mountTurnstile(name,containerId,action){
  if(!window.turnstile)return;
  if(turnstileWidgets[name]!==undefined){try{window.turnstile.remove(turnstileWidgets[name])}catch{}}
  turnstileWidgets[name]=window.turnstile.render("#"+containerId,{sitekey:TURNSTILE_SITE_KEY,action,theme:"auto"});
}
function turnstileToken(name){const id=turnstileWidgets[name],token=id===undefined?"":window.turnstile?.getResponse(id);if(!token)throw new Error("Vui lòng hoàn tất xác minh chống bot.");return token}
function resetTurnstile(name){const id=turnstileWidgets[name];if(id!==undefined)try{window.turnstile.reset(id)}catch{}}
function unmountTurnstile(name){const id=turnstileWidgets[name];if(id!==undefined){try{window.turnstile?.remove(id)}catch{}delete turnstileWidgets[name]}}
function mountMemberTurnstile(){window.turnstile?.ready(()=>mountTurnstile("payout","payoutTurnstile","payout"))}
let transactionCache=[];
let currentAccountUser=null;
function applyTheme(theme){document.documentElement.dataset.theme=theme;localStorage.setItem("theme",theme);const button=$("themeToggle");if(button)button.textContent=theme==="dark"?"☀":"◐"}
function toggleTheme(){applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark")}
applyTheme(localStorage.getItem("theme")||((matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"));
let authMode="login";
let verificationToken="";
function setAuthMode(mode){
  authMode=mode;
  const register=mode==="register";
  const recovery=mode==="forgot"||mode==="reset"||mode==="verify";
  $("loginTab").classList.toggle("active",mode==="login");$("registerTab").classList.toggle("active",register);
  $("loginTab").parentElement.classList.toggle("hide",recovery);
  $("registerName").classList.toggle("hide",!register);
  $("registrationConsent").classList.toggle("hide",!register);
  $("authEmailField").classList.toggle("hide",mode==="verify");
  $("passwordField").classList.toggle("hide",mode==="forgot"||mode==="verify");
  $("recoveryCodeField").classList.toggle("hide",mode!=="reset");
  $("forgotButton").classList.toggle("hide",mode!=="login");
  $("haveCodeButton").classList.toggle("hide",mode!=="forgot");
  $("backLoginButton").classList.toggle("hide",!recovery);
  const titles={login:"Chào mừng trở lại",register:"Tạo tài khoản",forgot:"Yêu cầu khôi phục",reset:"Đặt lại mật khẩu",verify:"Xác minh email"};
  const copies={login:"Đăng nhập để xem ví và tiếp tục nhận hoàn tiền.",register:"Đăng ký để bắt đầu tích lũy hoàn tiền.",forgot:"Nhập email đã đăng ký. Mã đặt lại mật khẩu sẽ được gửi tự động và có hiệu lực trong 30 phút.",reset:"Nhập mã trong email. Mã chỉ dùng một lần và hết hạn sau 30 phút.",verify:"Nhấn nút bên dưới để hoàn tất xác minh. Liên kết chỉ dùng một lần."};
  const submits={login:"Đăng nhập",register:"Tạo tài khoản",forgot:"Gửi mã qua email",reset:"Đặt lại mật khẩu",verify:"Xác minh email"};
  $("authTitle").textContent=titles[mode];$("authCopy").textContent=copies[mode];$("authSubmit").textContent=submits[mode];
  $("passwordLabel").textContent=mode==="reset"?"Mật khẩu mới":"Mật khẩu";
  $("authPassword").autocomplete=(register||mode==="reset")?"new-password":"current-password";
  $("authMessage").textContent="";
  $("authTurnstile").classList.toggle("hide",recovery);
  if(recovery)unmountTurnstile("auth");
  else window.turnstile?.ready(()=>mountTurnstile("auth","authTurnstile",register?"signup":"login"));
}
function showUser(user){
  currentAccountUser=user;
  $("authLayer").classList.add("hide");$("headerNote").classList.add("hide");$("account").style.display="flex";
  $("appNav").classList.add("visible");
  $("accountName").textContent=user.displayName||user.email;
  $("emailVerificationStatus").textContent=user.emailVerified?"Email đã được xác minh.":"Email chưa được xác minh. Hãy kiểm tra hộp thư đến hoặc gửi lại liên kết.";
  $("emailVerificationStatus").className="profile-summary "+(user.emailVerified?"ok":"err");
  $("emailVerificationButton").classList.toggle("hide",user.emailVerified);
  $("consentStatus").textContent=user.consentCurrent?"Bạn đã đồng ý phiên bản điều khoản hiện tại.":"Bạn cần chấp thuận điều khoản hiện tại trước khi tạo link, thay đổi nơi nhận tiền hoặc rút tiền.";
  $("consentStatus").className="profile-summary "+(user.consentCurrent?"ok":"err");
  mountMemberTurnstile();
  loadWallet();loadPayouts();loadPaymentProfile();loadTransactions();
  if(!user.consentCurrent||!user.emailVerified)switchTab("profile");
}
function switchTab(name){document.querySelectorAll("[data-page]").forEach(el=>el.classList.toggle("active",el.dataset.page===name));document.querySelectorAll(".nav-tab").forEach(el=>el.classList.toggle("active",el.dataset.tab===name));window.scrollTo({top:0,behavior:"smooth"});if(name==="wallet"){loadWallet();loadPayouts()}if(name==="orders")loadTransactions();if(name==="support")loadSupportCases();if(name==="profile")loadPaymentProfile()}
async function submitAuth(){
  const btn=$("authSubmit");btn.disabled=true;
  btn.textContent="Đang xử lý…";$("authMessage").textContent="";
  try{
    const body=authMode==="verify"?{token:verificationToken}:{email:$("authEmail").value.trim()};
    if(authMode==="login"||authMode==="register") body.turnstileToken=turnstileToken("auth");
    if(authMode!=="forgot"&&authMode!=="verify") body.password=$("authPassword").value;
    if(authMode==="reset") body.code=$("recoveryCode").value;
    if(authMode==="register"){body.displayName=$("authName").value.trim();body.acceptedTerms=$("acceptTerms").checked}
    const endpoint=authMode==="forgot"?"forgot-password":authMode==="reset"?"reset-password":authMode==="verify"?"verify-email":authMode;
    const r=await fetch("/api/auth/"+endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const j=await r.json();if(!r.ok) throw new Error(j.error||"Không thể tiếp tục");
    if(authMode==="forgot"){setAuthMode("reset");$("authMessage").textContent=j.message;$("authMessage").className="auth-message ok";return}
    if(authMode==="reset"){setAuthMode("login");$("authMessage").textContent="Đổi mật khẩu thành công. Hãy đăng nhập.";$("authMessage").className="auth-message ok";$("authPassword").value="";$("recoveryCode").value="";return}
    if(authMode==="verify"){
      verificationToken="";
      try{const me=await fetch("/api/auth/me"),account=await me.json();if(me.ok&&account.user){showUser(account.user);switchTab("profile");$("emailVerificationMsg").textContent=j.message;$("emailVerificationMsg").className="status ok";return}}catch{}
      setAuthMode("login");$("authMessage").textContent=j.message+" Hãy đăng nhập.";$("authMessage").className="auth-message ok";return
    }
    showUser(j.user);
  }catch(e){$("authMessage").textContent=e.message;$("authMessage").className="auth-message err"}
  finally{if(authMode==="login"||authMode==="register")resetTurnstile("auth");btn.disabled=false;btn.textContent={login:"Đăng nhập",register:"Tạo tài khoản",forgot:"Gửi mã qua email",reset:"Đặt lại mật khẩu",verify:"Xác minh email"}[authMode]}
}
async function logout(){
  await fetch("/api/auth/logout",{method:"POST"});location.reload();
}
async function init(){
  const fragment=new URLSearchParams(location.hash.slice(1));
  const params=fragment.has("reset")||fragment.has("verify")?fragment:new URLSearchParams(location.search);
  if(params.get("verify")==="1"){
    verificationToken=(params.get("token")||"").slice(0,128);
    history.replaceState({},document.title,location.pathname);
    setAuthMode("verify");
    return;
  }
  if(params.get("reset")==="1"){
    $("authEmail").value=(params.get("email")||"").slice(0,254);
    $("recoveryCode").value=(params.get("code")||"").slice(0,11);
    history.replaceState({},document.title,location.pathname);
    setAuthMode("reset");
    $("authMessage").textContent="Mã đã được điền từ email. Hãy nhập mật khẩu mới.";
    $("authMessage").className="auth-message ok";
    return;
  }
  try{const r=await fetch("/api/auth/me");const j=await r.json();if(r.ok&&j.user)showUser(j.user)}catch{}
}

async function requestEmailVerification(){const msg=$("emailVerificationMsg"),button=$("emailVerificationButton");button.disabled=true;msg.textContent="Đang gửi…";msg.className="status";try{const r=await fetch("/api/auth/request-email-verification",{method:"POST"}),j=await r.json();if(!r.ok)throw new Error(j.error||"Không thể gửi email xác minh");msg.textContent=j.message;msg.className="status ok"}catch(e){msg.textContent=e.message;msg.className="status err"}finally{button.disabled=false}}
async function createLink(){
  const btn=$("createBtn"); btn.disabled=true; btn.textContent="Đang tạo link…";
  $("msg").textContent="";
  $("result").classList.add("hide");
  try{
    const r=await fetch("/api/create-link",{method:"POST",headers:{"content-type":"application/json"},
      signal:AbortSignal.timeout(25000),body:JSON.stringify({url:$("url").value.trim()})});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||"Không thể tạo link");
    $("msg").textContent="Link của bạn đã sẵn sàng.";$("msg").className="status ok";
    const destination=new URL(j.affiliateUrl);
    if(destination.protocol!=="https:"&&destination.protocol!=="http:") throw new Error("Link mua hàng không hợp lệ");
    const title=document.createElement("b"); title.textContent="Link hoàn tiền đã sẵn sàng";
    const estimate=document.createElement("div"); estimate.className="hint";
    estimate.textContent="Hoàn dự kiến: chờ đối tác ghi nhận đơn hàng";
    const buy=document.createElement("a"); buy.className="secondary buy-link"; buy.href=destination.href;
    buy.target="_blank"; buy.rel="noopener noreferrer"; buy.textContent="Mua hàng ngay →";
    $("result").replaceChildren(title,estimate,buy);
    $("result").classList.remove("hide");
  }catch(e){$("msg").textContent=e?.name==="TimeoutError"?"ACCESSTRADE phản hồi quá lâu. Vui lòng thử lại sau ít phút.":e.message;$("msg").className="status err";}
  finally{btn.disabled=false;btn.textContent="Tạo link và mua sắm"}
}
async function loadWallet(){
  try{
    const r=await fetch("/api/wallet");
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||"Không tải được ví");
    $("available").textContent=money(j.available);
    $("pending").textContent=money(j.estimatedCashback);
    $("confirmed").textContent=money(j.confirmedCashback);
    $("walletNote").classList.remove("err");
    $("walletNote").textContent=Number(j.pendingOrders||0).toLocaleString("vi-VN")+" đơn đang đối soát · Đã thanh toán "+money(j.paid)+" · Ngưỡng rút "+money(j.minimumPayout);
  }catch(e){$("walletNote").textContent=e.message;$("walletNote").classList.add("err")}
}
async function requestPayout(){
  try{
    const r=await fetch("/api/payout-request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({turnstileToken:turnstileToken("payout")})});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||"Không thể tạo yêu cầu");
    alert("Đã gửi yêu cầu rút "+money(j.amount));
    loadWallet();loadPayouts();
  }catch(e){alert(e.message)}finally{resetTurnstile("payout")}
}
async function loadPayouts(){try{const r=await fetch("/api/payouts"),j=await r.json();if(!r.ok)return;const body=$("payoutRows");body.replaceChildren();const labels={requested:"Chờ xử lý",paid:"Đã thanh toán",rejected:"Từ chối"};for(const x of j.data){const tr=document.createElement("tr");for(const value of [x.created_at,money(x.amount_vnd),(x.payment_bank_code||x.payment_method||"—")+" · •••• "+(x.payment_account_last4||"—"),labels[x.status]||x.status,x.reviewed_at||"—"]){const td=document.createElement("td");td.textContent=value;tr.appendChild(td)}body.appendChild(tr)}if(!j.data.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="Chưa có yêu cầu rút tiền.";tr.appendChild(td);body.appendChild(tr)}}catch{}}
async function loadPaymentProfile(){try{const r=await fetch("/api/payment-profile"),j=await r.json();if(!r.ok)return;const p=j.profile;if(p){$("profileSummary").textContent=(p.method==="momo"?"MoMo":"Ngân hàng")+" · "+p.bank_code+" · •••• "+p.account_last4+" · "+p.account_name+(Number(p.payout_locked||0)===1?" · Khóa rút đến "+p.payout_available_at:"");$("paymentMethod").value=p.method;$("bankCode").value=p.bank_code;$("accountHolder").value=p.account_name}}catch{}}
async function savePaymentProfile(){const msg=$("paymentMsg");msg.textContent="Đang lưu…";try{const r=await fetch("/api/payment-profile",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({method:$("paymentMethod").value,bankCode:$("bankCode").value,accountName:$("accountHolder").value,accountNumber:$("accountNumber").value,password:$("paymentPassword").value})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Không thể lưu");$("accountNumber").value="";$("paymentPassword").value="";msg.textContent=j.message||"Đã lưu an toàn.";msg.className="status ok";loadPaymentProfile()}catch(e){msg.textContent=e.message;msg.className="status err"}}
async function changeUserPassword(){const msg=$("userPasswordMsg"),current=$("currentUserPassword").value,next=$("newUserPassword").value,confirm=$("confirmUserPassword").value;msg.className="status";if(next!==confirm){msg.textContent="Mật khẩu nhập lại không khớp.";msg.className="status err";return}try{const r=await fetch("/api/account/change-password",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({currentPassword:current,newPassword:next})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Không thể đổi mật khẩu");$("currentUserPassword").value=$("newUserPassword").value=$("confirmUserPassword").value="";msg.textContent=j.message;msg.className="status ok"}catch(e){msg.textContent=e.message;msg.className="status err"}}
async function acceptCurrentTerms(){const msg=$("dataRequestMsg");if(!$("accountConsent").checked){msg.textContent="Vui lòng đánh dấu xác nhận đã đọc và đồng ý.";msg.className="status err";return}try{const r=await fetch("/api/account/consent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accepted:true})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Không thể lưu chấp thuận");if(currentAccountUser)currentAccountUser.consentCurrent=true;$("consentStatus").textContent="Bạn đã đồng ý phiên bản điều khoản hiện tại.";$("consentStatus").className="profile-summary ok";msg.textContent="Đã lưu chấp thuận cùng thời gian và phiên bản chính sách.";msg.className="status ok"}catch(e){msg.textContent=e.message;msg.className="status err"}}
function exportMyData(){window.location.assign("/api/account/export")}
async function createDataRequest(){const msg=$("dataRequestMsg");msg.textContent="Đang gửi…";msg.className="status";try{const r=await fetch("/api/account/data-requests",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestType:$("dataRequestType").value,message:$("dataRequestMessage").value,password:$("dataRequestPassword").value})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Không thể gửi yêu cầu");$("dataRequestMessage").value=$("dataRequestPassword").value="";msg.textContent=j.message+" Mã: "+j.requestId;msg.className="status ok"}catch(e){msg.textContent=e.message;msg.className="status err"}}
async function loadTransactions(){try{const r=await fetch("/api/transactions"),j=await r.json();if(!r.ok)return;transactionCache=j.data;const body=$("transactionRows");body.replaceChildren();let pending=0,approved=0,rejected=0;for(const x of j.data){const isRejected=x.status===2,isApproved=x.status===1&&x.is_confirmed===1;isRejected?rejected++:isApproved?approved++:pending++;const tr=document.createElement("tr");for(const value of [x.transaction_time||x.updated_at,x.transaction_id||"—",x.platform||x.merchant||"—",money(x.order_value_vnd),money(isRejected?0:(x.cashback_vnd||Math.floor(Number(x.commission_vnd||0)*.6)))]){const td=document.createElement("td");td.textContent=value;tr.appendChild(td)}const statusTd=document.createElement("td"),pill=document.createElement("span");pill.className="status-pill "+(isRejected?"rejected":isApproved?"approved":"pending");pill.textContent=isRejected?"Không được duyệt":isApproved?"Đã duyệt tiền":"Đang đối soát";statusTd.appendChild(pill);tr.appendChild(statusTd);const approvedTd=document.createElement("td");approvedTd.textContent=isApproved?(x.approval_time||x.updated_at||"—"):"—";tr.appendChild(approvedTd);const actionTd=document.createElement("td"),detail=document.createElement("button"),complaint=document.createElement("button");detail.className=complaint.className="detail-button";detail.textContent="Chi tiết";detail.onclick=()=>showOrderDetail(x.transaction_id);complaint.textContent="Khiếu nại";complaint.onclick=()=>startOrderComplaint(x.transaction_id);actionTd.append(detail,complaint);tr.appendChild(actionTd);body.appendChild(tr)}$("ordersPending").textContent=pending;$("ordersApproved").textContent=approved;$("ordersRejected").textContent=rejected;if(!j.data.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=8;td.textContent="Chưa có đơn hàng được ghi nhận.";tr.appendChild(td);body.appendChild(tr)}}catch{}}
function startOrderComplaint(id){$("supportCategory").value="wrong_status";$("supportOrderRef").value=id||"";$("supportSubject").value="Yêu cầu đối soát đơn "+(id||"");switchTab("support")}
async function createSupportCase(){const msg=$("supportMsg");msg.textContent="Đang gửi…";try{const r=await fetch("/api/support-cases",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({category:$("supportCategory").value,orderReference:$("supportOrderRef").value,subject:$("supportSubject").value,message:$("supportMessage").value})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Không thể gửi yêu cầu");msg.textContent=j.message+" Mã: "+j.caseId;msg.className="status ok";$("supportSubject").value="";$("supportMessage").value="";loadSupportCases()}catch(e){msg.textContent=e.message;msg.className="status err"}}
async function loadSupportCases(){try{const r=await fetch("/api/support-cases"),j=await r.json();if(!r.ok)return;const body=$("supportRows"),labels={open:"Đã tiếp nhận",reviewing:"Đang xử lý",resolved:"Đã giải quyết",rejected:"Không chấp nhận"};body.replaceChildren();for(const x of j.data){const tr=document.createElement("tr");for(const value of [x.id,x.created_at,x.subject+(x.order_reference?" · Đơn "+x.order_reference:""),labels[x.status]||x.status,x.admin_note||"Chưa có phản hồi"]){const td=document.createElement("td");td.textContent=value;tr.appendChild(td)}body.appendChild(tr)}if(!j.data.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="Chưa có yêu cầu hỗ trợ.";tr.appendChild(td);body.appendChild(tr)}}catch{}}
function showOrderDetail(id){const x=transactionCache.find(item=>String(item.transaction_id)===String(id));if(!x)return;const isRejected=x.status===2,isApproved=x.status===1&&x.is_confirmed===1,status=isRejected?"Không được duyệt":isApproved?"Đã duyệt tiền":"Đang đối soát",cashback=isRejected?0:(x.cashback_vnd||Math.floor(Number(x.commission_vnd||0)*.6));const fields=[["Mã đơn",x.transaction_id],["Nền tảng",x.platform||x.merchant||"—"],["Thời gian ghi nhận",x.transaction_time||x.updated_at||"—"],["Giá trị đơn",money(x.order_value_vnd)],["Hoa hồng đối tác",money(x.commission_vnd)],["Hoàn cho bạn",money(cashback)],["Trạng thái",status],["Thời điểm duyệt",isApproved?(x.approval_time||x.updated_at||"—"):"—"]];const box=$("orderDetail");box.replaceChildren(...fields.map(([label,value])=>{const item=document.createElement("div"),a=document.createElement("span"),b=document.createElement("b");item.className="detail-item";a.textContent=label;b.textContent=String(value??"—");item.append(a,b);return item}));$("orderDetailNote").textContent=isRejected?"Đơn bị hủy, hoàn hoặc không đáp ứng điều kiện của đối tác nên không được cộng tiền.":isApproved?"Đơn đã được đối tác xác nhận. Khoản hoàn này được tính vào số dư theo quy định rút tiền.":"Đơn đã được ghi nhận và đang chờ đối tác đối soát. Số tiền hiện tại chỉ là dự kiến.";$("orderDialog").showModal()}
function closeOrderDetail(){$("orderDialog").close()}
function onTurnstileLoaded(){
  mountTurnstile("auth","authTurnstile",authMode==="register"?"signup":"login");
  mountTurnstile("payout","payoutTurnstile","payout");
}
init();
</script>
</body></html>`;

function legalPage(title: string, content: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title} — Hoàn Lại</title><style>:root{font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#111;background:#eef0ec;line-height:1.65}body{margin:0}.wrap{width:min(760px,calc(100% - 32px));margin:40px auto}.back{color:#163300;font-weight:700}.card{margin-top:24px;background:#fff;border:1px solid #111;border-radius:24px;padding:clamp(22px,5vw,46px)}h1{font-size:clamp(32px,6vw,52px);line-height:1;margin:0 0 12px}h2{margin-top:28px;font-size:20px}p,li{color:#454745}.updated{font-size:13px;color:#777}.notice{background:#fff2bd;border-radius:14px;padding:14px}@media(prefers-color-scheme:dark){:root{color:#f2f5ef;background:#0f120f}.card{background:#171a17;border-color:#f2f5ef}p,li{color:#c2c8bf}.back{color:#9fe870}.notice{background:#4b421f}}</style></head><body><main class="wrap"><a class="back" href="/">← Về trang chủ</a><article class="card"><h1>${title}</h1><p class="updated">Phiên bản hiệu lực: 17/08/2026</p>${content}<p class="notice"><strong>Trạng thái thử nghiệm có kiểm soát:</strong> chưa mở thương mại rộng rãi cho tới khi thông tin pháp nhân, địa chỉ, email hỗ trợ và rà soát pháp lý/kế toán được hoàn tất.</p></article></main></body></html>`;
}

const LEGAL_PAGES: Record<string, string> = {
  "/dieu-khoan-hoan-tien": legalPage("Điều khoản hoàn tiền", `<p>Hoàn Lại ghi nhận giao dịch phát sinh từ liên kết do hệ thống tạo. Số tiền hiển thị khi đơn chưa được duyệt chỉ là dự kiến, không phải cam kết thanh toán.</p><h2>Điều kiện được hoàn</h2><ul><li>Đơn được đối tác ghi nhận đúng mã theo dõi do Hoàn Lại phát hành.</li><li>Đơn hoàn tất, không bị hủy, hoàn hàng hoặc vi phạm điều kiện chiến dịch.</li><li>Hoa hồng đã được đối tác xác nhận và đủ điều kiện thanh toán.</li></ul><h2>Cách tính</h2><p>Người dùng nhận 60% hoa hồng thực tế đã được đối tác đối soát. Tỷ lệ này áp dụng trên hoa hồng, không phải trên giá trị đơn hàng.</p><h2>Thanh toán</h2><p>Ngưỡng rút tối thiểu là 50.000đ. Yêu cầu hợp lệ được xử lý vào ngày 15 và ngày cuối cùng mỗi tháng. Thay đổi nơi nhận tiền sẽ khóa rút trong 24 giờ.</p><h2>Chống gian lận</h2><p>Đơn không được ghi nhận, bị hủy/hoàn, tự tạo nhiều tài khoản, dùng chung nơi nhận tiền, can thiệp tracking hoặc có dấu hiệu gian lận sẽ bị từ chối và lưu dấu vết kiểm tra.</p>`),
  "/chinh-sach-bao-mat": legalPage("Chính sách bảo mật", `<p>Hệ thống xử lý tên, email, phiên đăng nhập, lịch sử link/đơn, khiếu nại và thông tin nhận tiền để vận hành dịch vụ.</p><h2>Mục đích và phạm vi</h2><p>Dữ liệu được dùng để xác thực tài khoản, gán đơn, đối soát hoa hồng, xử lý rút tiền, ngăn gian lận, hỗ trợ khách hàng và thực hiện nghĩa vụ pháp luật.</p><h2>Bảo vệ và tối thiểu hóa</h2><p>Mật khẩu được băm; số tài khoản được mã hóa; giao diện quản trị che số tài khoản và ghi audit khi xem. Payload thô từ đối tác không được giữ lâu dài; hệ thống chỉ lưu các trường cần cho đối soát.</p><h2>Chia sẻ dữ liệu</h2><p>Dữ liệu chỉ được chuyển cho nhà cung cấp hạ tầng, mạng tiếp thị liên kết hoặc cơ quan có thẩm quyền trong phạm vi cần thiết và có căn cứ phù hợp. Mật khẩu không được chia sẻ.</p><h2>Quyền của người dùng</h2><p>Trong mục Tài khoản, người dùng có thể tải bản sao dữ liệu và gửi yêu cầu sửa hoặc xóa. Dữ liệu tài chính, chống gian lận và audit có thể phải tiếp tục được lưu theo nghĩa vụ pháp luật hoặc để giải quyết tranh chấp.</p><h2>Sự cố dữ liệu</h2><p>Khi phát hiện sự cố, đơn vị vận hành sẽ cô lập, ghi nhận, đánh giá phạm vi ảnh hưởng và thực hiện thông báo/xử lý theo quy định áp dụng.</p>`),
  "/quy-trinh-khieu-nai": legalPage("Quy trình khiếu nại", `<p>Khi đơn chưa được ghi nhận hoặc trạng thái chưa đúng, người dùng cần cung cấp mã đơn, thời gian mua, nền tảng và bằng chứng đặt hàng; không gửi mật khẩu, OTP hoặc toàn bộ số tài khoản.</p><h2>Quy trình xử lý</h2><ol><li>Tiếp nhận và cấp mã yêu cầu trên tài khoản.</li><li>Kiểm tra click, mã tracking, dữ liệu đơn và trạng thái đối tác.</li><li>Ghi phản hồi trong hồ sơ yêu cầu; chỉ cộng tiền khi có xác nhận hợp lệ.</li></ol><h2>Thời hạn phụ thuộc đối soát</h2><p>Thời gian giải quyết đơn hàng phụ thuộc dữ liệu và chu kỳ đối soát của đối tác. Trạng thái “đang đối soát” không có nghĩa đơn đã được duyệt tiền.</p>`)
};

const ADMIN_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#9fe870"/><title>Quản trị — Hoàn Lại</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='18' fill='%239fe870'/%3E%3Cpath d='M17 15h10v12h10V15h10v34H37V37H27v12H17z' fill='%23111512'/%3E%3Ccircle cx='50' cy='14' r='5' fill='white'/%3E%3C/svg%3E"/><style>
:root{font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#111;background:#eef0ec}*{box-sizing:border-box}body{margin:0}.wrap{width:min(1180px,calc(100% - 32px));margin:auto;padding:28px 0}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}h1{font-size:32px;margin:0}.card{background:#fff;border:1px solid #151515;border-radius:20px;padding:20px;margin-bottom:18px}.login{max-width:420px;margin:12vh auto}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.security-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.metric b{display:block;font-size:25px;margin-top:6px}.muted{color:#686b67;font-size:13px}input,button{font:inherit;border-radius:12px;min-height:46px;padding:0 14px}input{width:100%;border:1px solid #222;margin:10px 0}button{border:0;background:#9fe870;font-weight:700;cursor:pointer}.danger{background:#ffd7d7}.ghost{background:#e4e6e2}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #e1e3df}th{color:#62645f}.actions{display:flex;gap:6px}.actions button{min-height:36px;padding:0 10px}.hide{display:none!important}.err{color:#c42828}.ok{color:#18753c}.turnstile-slot{min-height:70px;margin:12px 0;display:flex;justify-content:center}@media(max-width:760px){.grid,.security-grid{grid-template-columns:1fr}.table-wrap{overflow:auto}h1{font-size:25px}}
</style></head><body><div class="wrap"><section id="login" class="card login"><h1>Quản trị Hoàn Lại</h1><p class="muted">Nhập mật khẩu quản trị. Thông tin không được lưu trong trình duyệt.</p><input id="secret" type="password" autocomplete="current-password" placeholder="Mật khẩu quản trị"/><button onclick="login()">Đăng nhập</button><p id="loginMsg" class="err"></p></section><main id="app" class="hide"><header><div><h1>Bảng điều khiển</h1><span class="muted">Dữ liệu tiền cần kiểm tra trước khi duyệt</span></div><div class="actions"><button class="ghost" onclick="sync()">Đồng bộ AT</button><button class="ghost" onclick="logout()">Đăng xuất</button></div></header><section id="metrics" class="grid"></section><section class="card"><h2>Bảo mật quản trị</h2><div class="security-grid"><div><h3>Đổi mật khẩu</h3><input id="currentAdminPassword" type="password" autocomplete="current-password" placeholder="Mật khẩu hiện tại"/><input id="newAdminPassword" type="password" autocomplete="new-password" placeholder="Mật khẩu mới"/><input id="confirmAdminPassword" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu mới"/><p class="muted">Tối thiểu 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</p><button onclick="changeAdminPassword()">Đổi mật khẩu</button><p id="securityMsg"></p></div><div><h3>Phiên đăng nhập</h3><p id="sessionSummary" class="muted">Đang tải…</p><button class="ghost" onclick="revokeOtherSessions()">Đăng xuất khỏi thiết bị khác</button></div></div></section><section class="card"><h2>Yêu cầu rút tiền</h2><div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Thành viên</th><th>Số tiền</th><th>Nhận tiền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody id="payouts"></tbody></table></div></section><section class="card"><h2>Thành viên</h2><div class="table-wrap"><table><thead><tr><th>Ngày tạo</th><th>Tên</th><th>Email</th><th>Xác minh email</th><th>Trạng thái</th><th>Điều khoản</th><th>Đã xác nhận</th></tr></thead><tbody id="members"></tbody></table></div></section><section class="card"><h2>Nhật ký quản trị</h2><div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th></tr></thead><tbody id="audit"></tbody></table></div></section></main></div><script>
const $=id=>document.getElementById(id), money=v=>Number(v||0).toLocaleString("vi-VN")+"đ";
async function api(path,options){const r=await fetch(path,options),j=await r.json();if(!r.ok)throw new Error(j.error||"Có lỗi xảy ra");return j}
function cell(row,value){const td=document.createElement("td");td.textContent=String(value??"");row.appendChild(td);return td}
async function login(){try{await api("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({secret:$("secret").value})});$("secret").value="";await load()}catch(e){$("loginMsg").textContent=e.message}}
async function logout(){await api("/api/admin/logout",{method:"POST"});location.reload()}
async function load(){try{const [s,p,m,audit,security,resets,reconciliation,support,readiness,dataRequests]=await Promise.all([api("/api/admin/summary"),api("/api/admin/payouts"),api("/api/admin/members"),api("/api/admin/audit"),api("/api/admin/security"),api("/api/admin/password-resets"),api("/api/admin/reconciliation"),api("/api/admin/support-cases"),api("/api/admin/launch-readiness"),api("/api/admin/data-requests")]);$("login").classList.add("hide");$("app").classList.remove("hide");const values=[["Thành viên",s.members],["Giao dịch",s.transactions],["Chờ thanh toán",s.pendingPayouts],["Tổng chờ",money(s.pendingAmount)]];$("metrics").replaceChildren(...values.map(x=>{const d=document.createElement("div");d.className="card metric";const a=document.createElement("span");a.className="muted";a.textContent=x[0];const b=document.createElement("b");b.textContent=x[1];d.append(a,b);return d}));$("sessionSummary").textContent=security.sessions.length+" phiên đang hoạt động · phiên hiện tại hết hạn "+(security.sessions.find(x=>x.current)?.expiresAt||"—");renderLaunchReadiness(readiness);renderReconciliation(reconciliation);renderPayouts(p.data);renderPasswordResets(resets.data);renderSupportCases(support.data);renderDataRequests(dataRequests.data);renderMembers(m.data);renderAudit(audit.data)}catch(e){$("login").classList.remove("hide");$("app").classList.add("hide")}}
function renderPayouts(items){const body=$("payouts");body.replaceChildren();for(const x of items){const tr=document.createElement("tr");cell(tr,x.created_at);cell(tr,x.member_code);cell(tr,money(x.amount_vnd));const destination=cell(tr,[x.payment_bank_code,"•••• "+(x.payment_account_last4||""),x.payment_account_name].filter(Boolean).join(" · "));const reveal=document.createElement("button");reveal.className="ghost";reveal.textContent="Xem STK";reveal.onclick=()=>revealAccount(x.id,destination,x);destination.append(document.createElement("br"),reveal);cell(tr,x.status+(x.note?" · "+x.note:""));const td=document.createElement("td");if(x.status==="requested"){const paid=document.createElement("button");paid.textContent="Đã trả";paid.onclick=()=>decide(x.id,"mark-paid");const reject=document.createElement("button");reject.className="danger";reject.textContent="Từ chối";reject.onclick=()=>decide(x.id,"reject");td.className="actions";td.append(paid,reject)}tr.appendChild(td);body.appendChild(tr)}}
async function revealAccount(id,cellNode,item){const currentPassword=prompt("Nhập mật khẩu quản trị để xem số tài khoản một lần:");if(!currentPassword)return;try{const result=await api("/api/admin/payouts/reveal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,currentPassword})});const value=[item.payment_bank_code,result.accountNumber,item.payment_account_name].filter(Boolean).join(" · ");try{await navigator.clipboard.writeText(result.accountNumber)}catch{}cellNode.firstChild.textContent=value;alert("Đã hiển thị và ghi nhật ký truy cập. Số tài khoản đã được sao chép nếu trình duyệt cho phép.")}catch(e){alert(e.message)}}
function renderReconciliation(data){let box=$("reconciliation");if(!box){box=document.createElement("section");box.id="reconciliation";box.className="card";$("metrics").after(box)}const h=document.createElement("h2");h.textContent="Đối soát tiền & chống gian lận";const m=document.createElement("p");m.textContent="Cashback đã xác nhận: "+money(data.money.confirmedCashback)+" · đang yêu cầu: "+money(data.money.requested)+" · đã trả: "+money(data.money.paid);const a=document.createElement("p");const total=data.anomalies.unattributedConfirmed+data.anomalies.cashbackMismatches+data.anomalies.overcommittedMembers+data.anomalies.duplicatePaymentDestinations;a.textContent="Bất thường: "+data.anomalies.unattributedConfirmed+" đơn chưa gán · "+data.anomalies.cashbackMismatches+" lệch công thức · "+data.anomalies.overcommittedMembers+" tài khoản vượt số dư · "+data.anomalies.duplicatePaymentDestinations+" nơi nhận tiền bị trùng · "+data.anomalies.payoutLockedProfiles+" hồ sơ đang khóa 24 giờ";a.className=total?"err":"ok";const t=document.createElement("p");t.textContent=data.turnstile?.first_success_at&&data.turnstile?.replay_rejected_at?"Turnstile: đã xác minh token thật và chặn dùng lại.":"Turnstile: chờ một lần đăng nhập/đăng ký/rút tiền thành công để tự kiểm thử token dùng một lần.";t.className=data.turnstile?.first_success_at&&data.turnstile?.replay_rejected_at?"ok":"muted";const c=document.createElement("p");const labels={alertsConfigured:"webhook cảnh báo",bankEncryptionConfigured:"mã hóa ngân hàng",turnstileConfigured:"Turnstile",accessTradeConfigured:"ACCESSTRADE"};const missing=Object.entries(data.config).filter(x=>!x[1]).map(x=>labels[x[0]]||x[0]);c.textContent=missing.length?"Cấu hình còn thiếu: "+missing.join(", "):"Các cấu hình vận hành chính đã đủ.";c.className=missing.length?"muted":"ok";box.replaceChildren(h,m,a,t,c)}
function passwordResetBody(){let body=$("passwordResets");if(body)return body;const section=document.createElement("section");section.className="card";section.innerHTML='<h2>Hỗ trợ quên mật khẩu</h2><p class="muted">Chỉ duyệt sau khi đã xác minh đúng chủ tài khoản. Mã chỉ hiển thị một lần và hết hạn sau 30 phút.</p><div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Email</th><th>Trạng thái</th><th>Hết hạn</th><th>Thao tác</th></tr></thead><tbody id="passwordResets"></tbody></table></div>';$("members").closest("section").before(section);return $("passwordResets")}
function renderPasswordResets(items){const body=passwordResetBody();body.replaceChildren();for(const x of items){const tr=document.createElement("tr");cell(tr,x.created_at);cell(tr,x.email);cell(tr,x.status);cell(tr,x.expires_at||"—");const td=document.createElement("td");td.className="actions";if(x.status==="pending"){const approve=document.createElement("button");approve.textContent="Duyệt & cấp mã";approve.onclick=()=>approveReset(x.id);td.appendChild(approve)}const reject=document.createElement("button");reject.className="danger";reject.textContent="Từ chối";reject.onclick=()=>rejectReset(x.id);td.appendChild(reject);tr.appendChild(td);body.appendChild(tr)}}
function supportCasesBody(){let body=$("supportCases");if(body)return body;const section=document.createElement("section");section.className="card";section.innerHTML='<h2>Khiếu nại & hỗ trợ</h2><p class="muted">Mở yêu cầu để ghi nhận đang xử lý; chỉ kết thúc sau khi đã ghi rõ kết quả đối soát.</p><div class="table-wrap"><table><thead><tr><th>Ngày gửi</th><th>Thành viên</th><th>Mã yêu cầu / đơn</th><th>Nội dung</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody id="supportCases"></tbody></table></div>';$("members").closest("section").before(section);return $("supportCases")}
function renderSupportCases(items){const body=supportCasesBody();body.replaceChildren();const labels={open:"Mới",reviewing:"Đang xử lý",resolved:"Đã giải quyết",rejected:"Không chấp nhận"};for(const x of items){const tr=document.createElement("tr");cell(tr,x.created_at);cell(tr,x.member_code);cell(tr,x.id+(x.order_reference?" · "+x.order_reference:""));cell(tr,x.subject+" · "+x.message);cell(tr,(labels[x.status]||x.status)+(x.admin_note?" · "+x.admin_note:""));const td=document.createElement("td");td.className="actions";if(x.status==="open"){const review=document.createElement("button");review.textContent="Tiếp nhận";review.onclick=()=>updateSupportCase(x.id,"reviewing");td.appendChild(review)}if(x.status==="open"||x.status==="reviewing"){const resolve=document.createElement("button");resolve.textContent="Giải quyết";resolve.onclick=()=>updateSupportCase(x.id,"resolved");const reject=document.createElement("button");reject.className="danger";reject.textContent="Từ chối";reject.onclick=()=>updateSupportCase(x.id,"rejected");td.append(resolve,reject)}tr.appendChild(td);body.appendChild(tr)}}
async function updateSupportCase(id,status){const note=prompt(status==="reviewing"?"Ghi nội dung đang kiểm tra:":status==="resolved"?"Ghi kết quả giải quyết:":"Ghi lý do không chấp nhận:");if(!note)return;try{await api("/api/admin/support-cases/update",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,status,note})});await load()}catch(e){alert(e.message)}}
function renderLaunchReadiness(data){let box=$("launchReadiness");if(!box){box=document.createElement("section");box.id="launchReadiness";box.className="card";$("metrics").after(box)}const title=document.createElement("h2"),summary=document.createElement("p"),list=document.createElement("div"),labels={productionMode:"Chế độ production",legalIdentity:"Thông tin pháp nhân và địa chỉ",supportChannel:"Email hỗ trợ",automatedEmail:"Đã cấu hình email tự động",emailDeliveryTested:"Đã gửi thử email xác minh",alertChannel:"Kênh cảnh báo sự cố",accessTradeSync:"Đồng bộ ACCESSTRADE",turnstileVerified:"Turnstile token thật",allActiveMembersConsented:"Chấp thuận điều khoản",allActiveEmailsVerified:"Mọi tài khoản hoạt động đã xác minh email",noUnattributedConfirmedOrders:"Không có đơn duyệt chưa gán"};title.textContent="Sẵn sàng mở thương mại";summary.textContent=data.ready?"ĐẠT — các chốt kỹ thuật đã sẵn sàng.":"CHƯA MỞ CÔNG KHAI — còn chốt bắt buộc chưa hoàn tất.";summary.className=data.ready?"ok":"err";for(const [key,value] of Object.entries(data.checks)){const row=document.createElement("p");row.textContent=(value?"✓ ":"✕ ")+(labels[key]||key);row.className=value?"ok":"err";list.appendChild(row)}const note=document.createElement("p");note.className="muted";note.textContent=data.note+" · Thành viên cần đồng ý lại: "+data.counts.membersNeedingConsent+" · Chưa xác minh email: "+data.counts.membersNeedingEmailVerification+" · Yêu cầu dữ liệu đang xử lý: "+data.counts.openDataRequests;box.replaceChildren(title,summary,list,note)}
function dataRequestsBody(){let body=$("dataRequests");if(body)return body;const section=document.createElement("section");section.className="card";section.innerHTML='<h2>Quyền dữ liệu cá nhân</h2><p class="muted">Không xóa dữ liệu tài chính/audit khi còn nghĩa vụ lưu trữ. Đóng tài khoản chỉ được hoàn tất khi không còn lệnh rút đang chờ.</p><div class="table-wrap"><table><thead><tr><th>Ngày gửi</th><th>Thành viên</th><th>Loại</th><th>Nội dung</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody id="dataRequests"></tbody></table></div>';$("members").closest("section").before(section);return $("dataRequests")}
function renderDataRequests(items){const body=dataRequestsBody();body.replaceChildren();const labels={correction:"Chỉnh sửa",deletion:"Đóng tài khoản/xóa dữ liệu",open:"Mới",reviewing:"Đang xử lý",completed:"Hoàn tất",rejected:"Từ chối"};for(const x of items){const tr=document.createElement("tr");cell(tr,x.created_at);cell(tr,(x.email||"Đã ẩn")+" · "+x.member_code);cell(tr,labels[x.request_type]||x.request_type);cell(tr,x.message+(x.admin_note?" · "+x.admin_note:""));cell(tr,labels[x.status]||x.status);const td=document.createElement("td");td.className="actions";if(x.status==="open"){const review=document.createElement("button");review.textContent="Tiếp nhận";review.onclick=()=>updateDataRequest(x.id,"reviewing");td.appendChild(review)}if(x.status==="open"||x.status==="reviewing"){const done=document.createElement("button");done.textContent="Hoàn tất";done.onclick=()=>updateDataRequest(x.id,"completed");const reject=document.createElement("button");reject.className="danger";reject.textContent="Từ chối";reject.onclick=()=>updateDataRequest(x.id,"rejected");td.append(done,reject)}tr.appendChild(td);body.appendChild(tr)}}
async function updateDataRequest(id,status){const note=prompt(status==="reviewing"?"Ghi nội dung đang xử lý:":status==="completed"?"Ghi kết quả hoàn tất (đóng tài khoản sẽ vô hiệu hóa đăng nhập):":"Ghi lý do từ chối:");if(!note)return;if(status==="completed"&&!confirm("Xác nhận đã hoàn tất yêu cầu? Với yêu cầu xóa, tài khoản sẽ bị đóng và dữ liệu đăng nhập/thanh toán bị loại bỏ."))return;try{await api("/api/admin/data-requests/update",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,status,note})});await load()}catch(e){alert(e.message)}}
async function approveReset(id){if(!confirm("Bạn đã xác minh đúng chủ tài khoản và muốn cấp mã khôi phục?"))return;try{const result=await api("/api/admin/password-resets/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});try{await navigator.clipboard.writeText(result.code)}catch{}alert("Mã khôi phục (chỉ hiện lần này): "+result.code+"\\nMã đã được sao chép nếu trình duyệt cho phép. Hết hạn: "+result.expiresAt);await load()}catch(e){alert(e.message)}}
async function rejectReset(id){if(!confirm("Từ chối yêu cầu khôi phục này?"))return;try{await api("/api/admin/password-resets/reject",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});await load()}catch(e){alert(e.message)}}
function renderMembers(items){const body=$("members");body.replaceChildren();for(const x of items){const tr=document.createElement("tr");cell(tr,x.created_at);cell(tr,x.display_name);cell(tr,x.email||"Đã ẩn");cell(tr,x.email_verified_at?"Đã xác minh · "+x.email_verified_at:"Chưa xác minh");cell(tr,x.account_status);cell(tr,x.consented_at?"Đã đồng ý · "+x.terms_version:"Chưa đồng ý");cell(tr,money(x.confirmed_cashback));body.appendChild(tr)}}
function renderAudit(items){const body=$("audit");body.replaceChildren();for(const x of items){const tr=document.createElement("tr");cell(tr,x.created_at);cell(tr,x.actor);cell(tr,x.action);cell(tr,x.target_type+" · "+x.target_id);body.appendChild(tr)}}
async function decide(id,action){const note=prompt(action==="mark-paid"?"Nhập mã giao dịch/nội dung chuyển khoản:":"Nhập lý do từ chối:");if(!note)return;if(!confirm(action==="mark-paid"?"Xác nhận đã chuyển khoản và khóa số tiền này?":"Xác nhận từ chối yêu cầu?"))return;try{await api("/api/admin/payouts/"+action,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,note})});await load()}catch(e){alert(e.message)}}
async function sync(){try{await api("/api/admin/sync",{method:"POST"});alert("Đồng bộ xong");await load()}catch(e){alert(e.message)}}
async function testAlert(){if(!confirm("Gửi một cảnh báo thử đến kênh vận hành đã cấu hình?"))return;try{const result=await api("/api/admin/test-alert",{method:"POST"}),channels=[];if(result.delivery.email)channels.push("email");if(result.delivery.webhook)channels.push("webhook");alert("Đã gửi cảnh báo thử qua "+channels.join(" và "));await loadSyncHealth()}catch(e){alert(e.message)}}
function installAlertButton(){const actions=document.querySelector("main header .actions");if(!actions||$("testAlertButton"))return;const button=document.createElement("button");button.id="testAlertButton";button.className="ghost";button.textContent="Thử cảnh báo";button.onclick=testAlert;actions.insertBefore(button,actions.lastElementChild)}
async function changeAdminPassword(){const msg=$("securityMsg"),current=$("currentAdminPassword").value,next=$("newAdminPassword").value,confirm=$("confirmAdminPassword").value;msg.className="";if(next!==confirm){msg.textContent="Mật khẩu nhập lại không khớp.";msg.className="err";return}try{await api("/api/admin/change-password",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({currentPassword:current,newPassword:next})});$("currentAdminPassword").value=$("newAdminPassword").value=$("confirmAdminPassword").value="";msg.textContent="Đã đổi mật khẩu và thu hồi mọi phiên cũ.";msg.className="ok";await load()}catch(e){msg.textContent=e.message;msg.className="err"}}
async function revokeOtherSessions(){if(!confirm("Đăng xuất mọi phiên quản trị trên thiết bị khác?"))return;try{const result=await api("/api/admin/revoke-other-sessions",{method:"POST"});alert("Đã thu hồi "+result.revoked+" phiên.");await load()}catch(e){alert(e.message)}}
async function loadSyncHealth(){try{const summary=await api("/api/admin/summary"),sync=summary.lastSync;let box=$("syncHealth");if(!box){box=document.createElement("section");box.id="syncHealth";box.className="card";$("metrics").after(box)}const title=document.createElement("h2"),text=document.createElement("p"),config=document.createElement("p");title.textContent="Sức khỏe đồng bộ ACCESSTRADE";if(!sync){text.textContent="Chưa có lần đồng bộ nào được ghi nhận.";text.className="muted"}else{const labels={success:"Thành công",failed:"Thất bại",running:"Đang chạy"};text.textContent=(labels[sync.status]||sync.status)+" · "+(sync.trigger_source==="cron"?"Tự động":"Thủ công")+" · "+(sync.finished_at||sync.started_at)+" · lấy "+sync.total_fetched+" / ghi "+sync.imported+(sync.error_message?" · "+sync.error_message:"");text.className=sync.status==="failed"?"err":sync.status==="success"?"ok":"muted"}config.textContent=summary.alertsConfigured?"Cảnh báo ngoài hệ thống: đã bật":"Cảnh báo ngoài hệ thống: chưa cấu hình email/webhook";config.className=summary.alertsConfigured?"ok":"muted";box.replaceChildren(title,text,config)}catch{}}
async function loadCampaigns(){try{const data=await api("/api/admin/campaigns");let box=$("campaignHealth");if(!box){box=document.createElement("section");box.id="campaignHealth";box.className="card";$("syncHealth")?.after(box)}const title=document.createElement("h2"),status=document.createElement("p"),list=document.createElement("div");title.textContent="Campaign Shopee/TikTok trên ACCESSTRADE";if(!data.check){status.textContent="Đang chờ lần kiểm tra tự động đầu tiên.";status.className="muted"}else{status.textContent=(data.check.status==="success"?"Đã đối chiếu":"Đối chiếu thất bại")+" · "+data.check.checked_at+" · tìm thấy "+data.check.matched_count+", API xác nhận duyệt "+data.check.approved_count;status.className=data.check.status==="success"?"ok":"err"}for(const campaign of data.campaigns){const row=document.createElement("p"),approval={successful:"đã duyệt",approved:"đã duyệt",success:"đã duyệt",pending:"đang chờ duyệt",unregistered:"chưa đăng ký",unknown:"chưa có trạng thái từ API"}[campaign.approval]||campaign.approval;row.textContent=(campaign.platform==="shopee"?"Shopee":"TikTok Shop")+" · "+campaign.name+" · ID "+campaign.campaign_id+" · "+approval+" · "+(campaign.status===1?"đang chạy":"chưa xác định trạng thái chạy");list.appendChild(row)}if(!data.campaigns.length){const empty=document.createElement("p");empty.className="muted";empty.textContent="API chưa trả về campaign Shopee/TikTok; trạng thái trên dashboard có thể cập nhật trước API.";list.appendChild(empty)}box.replaceChildren(title,status,list)}catch{}}
installAlertButton();load();loadSyncHealth();loadCampaigns();setInterval(loadSyncHealth,15000);setInterval(loadCampaigns,60000);
</script></body></html>`;

async function healthResponse(env: Env): Promise<Response> {
  try {
    const [database, sync] = await Promise.all([
      env.DB.prepare("SELECT 1 AS ok").first(),
      env.DB.prepare("SELECT status,finished_at,started_at FROM sync_runs ORDER BY started_at DESC LIMIT 1").first()
    ]);
    const lastAt = String(sync?.finished_at || sync?.started_at || "");
    const ageMinutes = lastAt ? Math.floor((Date.now() - Date.parse(lastAt.endsWith("Z") ? lastAt : `${lastAt}Z`)) / 60_000) : null;
    const syncHealthy = sync?.status === "success" && ageMinutes !== null && ageMinutes <= 45;
    return json({
      ok: Boolean(database?.ok),
      database: Boolean(database?.ok) ? "healthy" : "unhealthy",
      sync: syncHealthy ? "healthy" : sync ? "degraded" : "pending",
      checkedAt: nowIso()
    }, database?.ok ? 200 : 503, { "cache-control": "no-store" });
  } catch (error) {
    console.error(JSON.stringify({ event: "health_check_failed", error: String(error).slice(0, 300) }));
    return json({ ok: false, database: "unhealthy", sync: "unknown", checkedAt: nowIso() }, 503, { "cache-control": "no-store" });
  }
}

async function cleanupExpiredData(env: Env): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<=datetime('now')"),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<=datetime('now')"),
    env.DB.prepare("DELETE FROM rate_limit_buckets WHERE window_started_at<?").bind(cutoff),
    env.DB.prepare("UPDATE password_reset_requests SET status='expired',code_hash=NULL WHERE status='approved' AND expires_at<=datetime('now')"),
    env.DB.prepare("DELETE FROM password_reset_requests WHERE status IN ('used','expired','rejected') AND created_at<datetime('now','-30 days')"),
    env.DB.prepare("UPDATE email_verification_requests SET status='expired',token_hash=NULL WHERE status='pending' AND expires_at<=datetime('now')"),
    env.DB.prepare("DELETE FROM email_verification_requests WHERE status IN ('used','expired','failed') AND created_at<datetime('now','-30 days')"),
    env.DB.prepare("DELETE FROM turnstile_checks WHERE created_at<datetime('now','-30 days')")
  ]);
  console.log(JSON.stringify({ event: "expired_data_cleanup", changes: results.map(result => Number(result.meta?.changes || 0)) }));
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const u = new URL(req.url);
    if (u.hostname === "www.hoanlai.id.vn" || u.protocol !== "https:") {
      u.hostname = "hoanlai.id.vn";
      u.protocol = "https:";
      return Response.redirect(u.toString(), 308);
    }
    if (u.pathname.startsWith("/api/")) return apiRouter(req, env, ctx);
    const pageHeaders = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "strict-transport-security": "max-age=31536000; includeSubDomains", "x-frame-options": "DENY", "x-content-type-options": "nosniff", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "same-origin", "referrer-policy": "strict-origin-when-cross-origin", "permissions-policy": "camera=(), microphone=(), geolocation=()", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    if (u.pathname === "/" || u.pathname === "/index.html") {
      return new Response(PAGE, { headers: pageHeaders });
    }
    if (LEGAL_PAGES[u.pathname]) return new Response(LEGAL_PAGES[u.pathname], { headers: pageHeaders });
    if (u.pathname === "/admin") {
      return new Response(ADMIN_PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" } });
    }
    if (u.pathname === "/health") return healthResponse(env);
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try { await cleanupExpiredData(env); }
        catch (err) { console.error(JSON.stringify({ event: "expired_data_cleanup_failed", error: safeSyncError(err) })); }
        try { await syncApprovedCampaigns(env); }
        catch (err) { console.error(JSON.stringify({ event: "campaign_sync_failed", error: safeSyncError(err) })); }
        try { await runTrackedSync(env, "cron"); }
        catch (err) { console.error(JSON.stringify({ event: "transaction_sync_failed", error: safeSyncError(err) })); }
      })()
    );
  }
} satisfies ExportedHandler<Env>;
