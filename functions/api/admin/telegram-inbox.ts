import type { Env } from '../../types';
import { resolveAdmin } from '../../_shared/auth';
import { unauthorized, json, serverError } from '../../_shared/http';
import { IMAGE_SELECT_COLUMNS, type ImageRow, rowToAdminRecord } from '../../_shared/images';
import { withRequestLogging } from '../../_shared/logger';

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/admin/telegram-inbox', async ({ env, request }, logger) => {
  if (!(await resolveAdmin(request, env))) return unauthorized();
  try {
    const result = await env.DB.prepare(`SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE tg_status = 'staged' ORDER BY created_at DESC, key DESC`).all<ImageRow>();
    return json((result.results ?? []).map(rowToAdminRecord));
  } catch (error) {
    logger.error('GET /api/admin/telegram-inbox failed', { error });
    return serverError('telegram_inbox_failed');
  }
});
