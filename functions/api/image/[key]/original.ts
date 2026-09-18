import type { Env } from '../../../types';
import { notFound, serverError } from '../../../_shared/http';
import { withRequestLogging } from '../../../_shared/logger';
import { keyFromRouteParam } from '../../../_shared/keys';
import { isFolderPublic } from '../../../_shared/folders';
import { streamTelegramOriginal, type OriginalImageRow } from '../../../_shared/original';

const ORIGINAL_SQL = 'SELECT key, original_filename, tg_file_id, folder_id FROM images WHERE key = ? AND is_public = 1';

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/image/:key/original', async ({ env, params }, logger) => {
  const key = keyFromRouteParam(params.key);
  if (!key) return notFound();

  try {
    const row = await env.DB.prepare(ORIGINAL_SQL).bind(key).first<OriginalImageRow & { folder_id: string | null }>();
    if (!row) return notFound();

    // 公开原图必须同时满足：图片公开 + 所属文件夹公开。
    if (!(await isFolderPublic(env.DB, row.folder_id))) return notFound();

    const response = await streamTelegramOriginal(env.TG_BOT_TOKEN, row);
    if (!response) {
      return new Response(JSON.stringify({
        error: 'original_not_archived',
        message: '该图片暂无 Telegram 原图归档',
      }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    // streamTelegramOriginal 已使用 attachment，直接访问该地址即可下载；
    // 前端加载原图时使用 fetch + blob，因此同一接口也可用于原图预览。
    return response;
  } catch (error) {
    logger.error('GET /api/image/:key/original failed', {
      error,
      context: { key },
    });
    return serverError('original_failed');
  }
});
