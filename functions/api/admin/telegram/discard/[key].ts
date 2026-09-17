import type { Env } from '../../../../types';
import { badRequest, json, notFound, serverError, unauthorized } from '../../../../_shared/http';
import { resolveAdmin } from '../../../../_shared/auth';
import { requireSameOrigin } from '../../../../_shared/security';
import { withRequestLogging } from '../../../../_shared/logger';
import { keyFromRouteParam } from '../../../../_shared/keys';

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/admin/telegram/discard/:key', async ({ request, env, params }, logger) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();

  const key = keyFromRouteParam(params.key);
  if (!key) return notFound();

  try {
    const row = await env.DB.prepare(
      `SELECT key, tg_status FROM images WHERE key = ? LIMIT 1`,
    ).bind(key).first<{ key: string; tg_status: string | null }>();

    if (!row) return notFound();
    if (row.tg_status !== 'staged') return badRequest('telegram_image_not_staged');

    // “不入库”只移除 Pixel-Space 的暂存记录，不删除 Telegram 频道原消息。
    await env.DB.prepare(`DELETE FROM images WHERE key = ? AND tg_status = 'staged'`).bind(key).run();

    return json({ ok: true, discarded: key });
  } catch (error) {
    logger.error('POST /api/admin/telegram/discard/:key failed', { error, context: { key } });
    return serverError('telegram_discard_failed');
  }
});

