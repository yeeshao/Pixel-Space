import type { Env } from '../../../../types';
import { resolveAdmin } from '../../../../_shared/auth';
import { badRequest, json, notFound, serverError, unauthorized } from '../../../../_shared/http';
import { keyFromRouteParam } from '../../../../_shared/keys';
import { withRequestLogging } from '../../../../_shared/logger';
import { requireSameOrigin } from '../../../../_shared/security';

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/admin/telegram/discard/:key', async ({ request, env, params }, logger) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();
  const key = keyFromRouteParam(params.key);
  if (!key) return notFound();
  try {
    const row = await env.DB.prepare("SELECT key, tg_status FROM images WHERE key = ?").bind(key).first<{ key: string; tg_status: string }>();
    if (!row) return notFound();
    if (row.tg_status !== 'staged') return badRequest('telegram_image_not_staged');
    await env.DB.prepare('DELETE FROM images WHERE key = ?').bind(key).run();
    return json({ ok: true, key });
  } catch (error) {
    logger.error('POST /api/admin/telegram/discard/:key failed', { error, context: { key } });
    return serverError('telegram_discard_failed');
  }
});
