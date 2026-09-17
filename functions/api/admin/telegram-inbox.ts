import type { Env } from '../../types';
import { resolveAdmin } from '../../_shared/auth';
import { unauthorized, json, serverError } from '../../_shared/http';
import { IMAGE_SELECT_COLUMNS, type ImageRow, rowToAdminRecord } from '../../_shared/images';
import { withRequestLogging } from '../../_shared/logger';

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/admin/telegram-inbox', async ({ env, request }, logger) => {
  if (!(await resolveAdmin(request, env))) return unauthorized();
  try {
    const result = await env.DB.prepare(
      `SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE tg_status = 'staged' ORDER BY created_at DESC, key DESC`,
    ).all<ImageRow>();

    const records = (result.results ?? []).map((row) => ({
      ...rowToAdminRecord(row),
      // 暂存图片不在 R2，浏览器通过这个受保护的代理从 Telegram 读取。
      public_url: `/api/admin/telegram/preview/${encodeURIComponent(row.key)}`,
    }));

    return json(records);
  } catch (error) {
    logger.error('GET /api/admin/telegram-inbox failed', { error });
    return serverError('telegram_inbox_failed');
  }
});
