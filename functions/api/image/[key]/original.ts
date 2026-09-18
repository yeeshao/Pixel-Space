import type { Env } from '../../../types';
import { notFound, serverError } from '../../../_shared/http';
import { withRequestLogging } from '../../../_shared/logger';
import { keyFromRouteParam } from '../../../_shared/keys';
import { isFolderPublic } from '../../../_shared/folders';
import { streamTelegramOriginal, type OriginalImageRow } from '../../../_shared/original';

const ORIGINAL_SQL = 'SELECT key, original_filename, tg_file_id, tg_status, tg_error, is_public, folder_id FROM images WHERE key = ?';

interface PublicOriginalRow extends OriginalImageRow {
  tg_status?: string | null;
  tg_error?: string | null;
  is_public: number;
  folder_id: string;
}

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/image/:key/original', async ({ env, params }, logger) => {
  const key = keyFromRouteParam(params.key);
  if (!key) return notFound();

  try {
    const row = await env.DB.prepare(ORIGINAL_SQL).bind(key).first<PublicOriginalRow>();
    if (!row) return notFound();
    if (row.is_public !== 1 || !(await isFolderPublic(env.DB, row.folder_id))) return notFound();

    const response = await streamTelegramOriginal(env.TG_BOT_TOKEN, row);
    if (!response) {
      return new Response(JSON.stringify({
        error: 'original_not_archived',
        message: row.tg_status === 'failed' ? '原图归档失败，请重新归档' : '该图片暂无 Telegram 原图归档',
        tg_status: row.tg_status ?? 'unknown',
        tg_error: row.tg_error ?? null,
      }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    return response;
  } catch (error) {
    logger.error('GET /api/image/:key/original failed', { error, context: { key } });
    return serverError('original_failed');
  }
});
