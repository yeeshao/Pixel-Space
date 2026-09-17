import type { Env } from '../types';

export interface AdminIdentity {
  email: string;
}

const SESSION_COOKIE = '__Host-pixel_admin_session';
const LOCAL_SESSION_COOKIE = 'pixel_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 310_000;
const PASSWORD_HASH_PREFIX = 'pbkdf2_sha256$';


const DEV_ADMIN_EMAIL = 'dev@local';

// 身份判定的唯一信号是请求 hostname：
// - hostname 不是 localhost/127.0.0.1/0.0.0.0 → 边缘运行时（线上），只信 Access JWT，env 与请求头里的角色标记一律忽略。
// - 是 localhost 系列 → 本地 wrangler pages dev，按 X-Dev-Role > LOCAL_ROLE > 默认 admin 决定身份。
// 之所以不用 request.cf：wrangler pages dev 也会模拟该对象，无法据此区分。
// 生产域名永远不可能是 localhost，所以 hostname 作为信号最稳。
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

interface AccessJwtHeader {
  alg?: unknown;
  kid?: unknown;
}

interface AccessJwtPayload {
  aud?: unknown;
  email?: unknown;
  exp?: unknown;
  iss?: unknown;
  nbf?: unknown;
}

interface AccessCertsResponse {
  keys?: JsonWebKey[];
}

type AccessPublicJwk = JsonWebKey & { kid?: string };

const certsCache = new Map<string, Promise<JsonWebKey[]>>();

const base64UrlToBytes = (value: string): Uint8Array => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const base64UrlToJson = <T>(value: string): T => {
  const text = new TextDecoder().decode(base64UrlToBytes(value));
  return JSON.parse(text) as T;
};

const normalizeTeamDomain = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  return trimmed.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
};

const accessCertsUrl = (teamDomain: string): string => `https://${teamDomain}/cdn-cgi/access/certs`;

const loadAccessCerts = async (teamDomain: string): Promise<JsonWebKey[]> => {
  const url = accessCertsUrl(teamDomain);
  const cached = certsCache.get(url);
  if (cached) return cached;

  const next = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`access_certs_http_${response.status}`);
      const data = (await response.json()) as AccessCertsResponse;
      return Array.isArray(data.keys) ? data.keys : [];
    })
    .catch((error) => {
      certsCache.delete(url);
      throw error;
    });
  certsCache.set(url, next);
  return next;
};

const audMatches = (claim: unknown, expected: string): boolean => {
  if (typeof claim === 'string') return claim === expected;
  if (Array.isArray(claim)) return claim.includes(expected);
  return false;
};

const importRsaPublicKey = (jwk: JsonWebKey): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

const verifyAccessJwt = async (jwt: string, env: Env): Promise<AdminIdentity | null> => {
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const expectedAud = env.CF_ACCESS_AUD?.trim() ?? '';
  if (!teamDomain || !expectedAud) return null;

  const parts = jwt.split('.');
  if (parts.length !== 3) return null;

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = base64UrlToJson<AccessJwtHeader>(encodedHeader);
    const payload = base64UrlToJson<AccessJwtPayload>(encodedPayload);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    if (payload.iss !== `https://${teamDomain}`) return null;
    if (!audMatches(payload.aud, expectedAud)) return null;
    if (typeof payload.email !== 'string' || !payload.email.trim()) return null;

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > now) return null;

    const cert = (await loadAccessCerts(teamDomain)).find((key) => (key as AccessPublicJwk).kid === header.kid);
    if (!cert) return null;

    const key = await importRsaPublicKey(cert);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    return valid ? { email: payload.email.trim() } : null;
  } catch {
    return null;
  }
};

const getCookie = (request: Request, name: string): string | null => {
  const cookieHeader = request.headers.get('Cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const base64UrlToBase64 = (value: string): string =>
  value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');

const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
};

const hashSessionToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
};

const verifyPassword = (password: string, expected: string): boolean => {
  // 按用户要求：ADMIN_PASSWORD_HASH 直接保存/比较登录密码。
  // 注意：这是明文密码存储方案，仅适合个人/私有部署，不推荐公网高安全场景。
  return password.length > 0 && expected.length > 0 && password === expected;
};

export const verifyAdminCredentials = async (
  username: string,
  password: string,
  env: Env,
): Promise<AdminIdentity | null> => {
  let expectedUsername = env.ADMIN_USERNAME?.trim() ?? '';
  let expectedPassword = env.ADMIN_PASSWORD_HASH ?? '';

  // D1 中存在管理员配置时，以后台修改后的配置为准。
  try {
    const row = await env.DB.prepare(
      `SELECT username, password FROM admin_credentials WHERE id = 1 LIMIT 1`,
    ).first<{ username: string; password: string }>();
    if (row?.username && row.password) {
      expectedUsername = row.username;
      expectedPassword = row.password;
    }
  } catch {
    // 兼容尚未执行管理员配置迁移的旧数据库，回退到环境变量。
  }

  if (!expectedUsername || !expectedPassword || !username.trim() || !password) return null;

  const usernameBytes = new TextEncoder().encode(username.trim());
  const expectedBytes = new TextEncoder().encode(expectedUsername);
  if (!timingSafeEqual(usernameBytes, expectedBytes)) return null;
  if (!verifyPassword(password, expectedPassword)) return null;

  return { email: expectedUsername };
};

export const updateAdminCredentials = async (
  currentUsername: string,
  currentPassword: string,
  newUsername: string,
  newPassword: string,
  env: Env,
): Promise<boolean> => {
  const current = await verifyAdminCredentials(currentUsername, currentPassword, env);
  if (!current || !newUsername.trim() || !newPassword) return false;

  await env.DB.prepare(
    `INSERT INTO admin_credentials (id, username, password, updated_at)
     VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username,
       password = excluded.password,
       updated_at = excluded.updated_at`,
  ).bind(newUsername.trim(), newPassword).run();

  // 修改密码/账号后让全部旧 Session 失效。
  await env.DB.prepare(`DELETE FROM admin_sessions`).run();
  return true;
};

export const createAdminSession = async (
  identity: AdminIdentity,
  request: Request,
  env: Env,
): Promise<string> => {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(tokenBytes);
  const tokenHash = await hashSessionToken(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + SESSION_TTL_SECONDS) * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO admin_sessions (token_hash, email, expires_at, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  ).bind(tokenHash, identity.email, expiresAt).run();

  // 每次登录顺便清理过期 session，避免表无限增长。
  await env.DB.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`)
    .bind(new Date(now * 1000).toISOString())
    .run();

  return token;
};

export const resolvePasswordSession = async (
  request: Request,
  env: Env,
): Promise<AdminIdentity | null> => {
  const hostname = new URL(request.url).hostname;
  const cookieName = LOCAL_HOSTS.has(hostname) ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
  const token = getCookie(request, cookieName);
  if (!token || token.length > 256) return null;

  const tokenHash = await hashSessionToken(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT email FROM admin_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1`,
  ).bind(tokenHash, now).first<{ email: string }>();

  return row?.email ? { email: row.email } : null;
};

export const deleteAdminSession = async (request: Request, env: Env): Promise<void> => {
  const hostname = new URL(request.url).hostname;
  const cookieName = LOCAL_HOSTS.has(hostname) ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
  const token = getCookie(request, cookieName);
  if (!token) return;
  const tokenHash = await hashSessionToken(token);
  await env.DB.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).bind(tokenHash).run();
};

export const adminSessionCookie = (request: Request, token: string): string => {
  const hostname = new URL(request.url).hostname;
  const local = LOCAL_HOSTS.has(hostname);
  const name = local ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
  const secure = local ? '' : ' Secure;';
  return `${name}=${token}; Path=/;${secure} HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
};

export const clearAdminSessionCookie = (request: Request): string => {
  const hostname = new URL(request.url).hostname;
  const local = LOCAL_HOSTS.has(hostname);
  const name = local ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
  const secure = local ? '' : ' Secure;';
  return `${name}=; Path=/;${secure} HttpOnly; SameSite=Strict; Max-Age=0`;
};

export const resolveAdmin = async (request: Request, env: Env): Promise<AdminIdentity | null> => {
  const hostname = new URL(request.url).hostname;
  const isLocal = LOCAL_HOSTS.has(hostname);

  // 线上优先使用账号密码 Session。
  if (!isLocal) {
    const sessionAdmin = await resolvePasswordSession(request, env);
    if (sessionAdmin) return sessionAdmin;

    // 兼容旧的 Cloudflare Access：如果暂时没有登录 Session，仍可使用已有 Access 配置。
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion')?.trim() ?? '';
    return jwt ? await verifyAccessJwt(jwt, env) : null;
  }

  // 本地开发保留原有角色切换能力。
  const sessionAdmin = await resolvePasswordSession(request, env);
  if (sessionAdmin) return sessionAdmin;

  const headerRole = request.headers.get('X-Dev-Role')?.trim().toLowerCase();
  const envRole = env.LOCAL_ROLE?.trim().toLowerCase();
  const role = headerRole || envRole || 'admin';
  return role === 'visitor' ? null : { email: DEV_ADMIN_EMAIL };
};
