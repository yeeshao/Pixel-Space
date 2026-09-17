import type { Env } from '../../types';
import { clearAdminSessionCookie, deleteAdminSession } from '../../_shared/auth';
import { json } from '../../_shared/http';
import { withRequestLogging } from '../../_shared/logger';

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/auth/logout', async ({ request, env }) => {
  await deleteAdminSession(request, env);
  return json({ ok: true }, 200, {
    'Set-Cookie': clearAdminSessionCookie(request),
    'Cache-Control': 'no-store',
  });
});
