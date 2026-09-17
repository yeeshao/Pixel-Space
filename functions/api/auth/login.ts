import type { Env } from '../../types';
import { adminSessionCookie, createAdminSession, verifyAdminCredentials } from '../../_shared/auth';
import { json } from '../../_shared/http';
import { withRequestLogging } from '../../_shared/logger';

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/auth/login', async ({ request, env }) => {
  if (request.headers.get('Content-Type')?.toLowerCase().split(';')[0] !== 'application/json') {
    return json({ error: 'invalid_content_type' }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const data = body as { username?: unknown; password?: unknown };
  const username = typeof data.username === 'string' ? data.username : '';
  const password = typeof data.password === 'string' ? data.password : '';

  // 不区分“账号不存在”和“密码错误”，避免泄露账号信息。
  const admin = await verifyAdminCredentials(username, password, env);
  if (!admin) return json({ error: 'invalid_credentials' }, 401, {
    'Cache-Control': 'no-store',
  });

  const token = await createAdminSession(admin, request, env);
  return json({ ok: true, email: admin.email }, 200, {
    'Set-Cookie': adminSessionCookie(request, token),
    'Cache-Control': 'no-store',
  });
});
