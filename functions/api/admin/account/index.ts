import type { Env } from '../../../types';
import { resolveAdmin, updateAdminCredentials } from '../../../_shared/auth';
import { json } from '../../../_shared/http';
import { withRequestLogging } from '../../../_shared/logger';

export const onRequestPut: PagesFunction<Env> = withRequestLogging('/api/admin/account', async ({ request, env }) => {
  const admin = await resolveAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const data = body as {
    currentUsername?: unknown;
    currentPassword?: unknown;
    username?: unknown;
    password?: unknown;
    confirmPassword?: unknown;
  };

  const currentPassword = typeof data.currentPassword === 'string' ? data.currentPassword : '';
  const username = typeof data.username === 'string' ? data.username.trim() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  const confirmPassword = typeof data.confirmPassword === 'string' ? data.confirmPassword : '';

  if (!username || !password) return json({ error: 'username_and_password_required' }, 400);
  if (password !== confirmPassword) return json({ error: 'password_mismatch' }, 400);

  const ok = await updateAdminCredentials(admin.email, currentPassword, username, password, env);
  if (!ok) return json({ error: 'current_credentials_invalid' }, 401);

  return json({ ok: true, username });
});
