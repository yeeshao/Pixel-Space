import type { Env } from '../../../../types';
import { resolveAdmin } from '../../../../_shared/auth';
import { unauthorized, notFound, serverError } from '../../../../_shared/http';
import { getTelegramFileUrl } from '../../../../_shared/telegram';
import { keyFromRouteParam } from '../../../../_shared/keys';
import { withRequestLogging } from '../../../../_shared/logger';

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/admin/telegram/preview/:key', async ({ env, request, params }, logger) => {
  if (!(await resolveAdmin(request, env))) return unauthorized();

  const key = keyFromRouteParam(params.key);
  if (!key) return notFound();

  try {
    const row = await env.DB.prepare(
      `SELECT tg_file_id, tg_status FROM images WHERE key = ? LIMIT 1`,
    ).bind(key).first<{ tg_file_id: string | null; tg_status: string }>();

    if (!row || row.tg_status !== 'staged' || !row.tg_file_id) return notFound();

    const telegramUrl = await getTelegramFileUrl(env.TG_BOT_TOKEN, row.tg_file_id);
    const response = await fetch(telegramUrl);
    if (!response.ok) throw new Error(`telegram_preview_failed_${response.status}`);

    const headers = new Headers();
    const contentType = response.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    headers.set('cache-control', 'private, max-age=300');

    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    logger.error('GET /api/admin/telegram/preview/:key failed', { error, context: { key } });
    return serverError('telegram_preview_failed');
  }
});
