import type { Env } from '../../../types';
import { withRequestLogging } from '../../../_shared/logger';
import { notFound, serverError } from '../../../_shared/http';
import { keyFromRouteParam } from '../../../_shared/keys';
import { isFolderPublic } from '../../../_shared/folders';
import { streamTelegramOriginal } from '../../../_shared/original';

const ORIGINAL_SQL = `
  SELECT key, original_filename, tg_file_id, tg_status, tg_error, folder_id, is_public
  FROM images
  WHERE key = ?
`;

interface PublicOriginalRow {
  key: string;
  original_filename: string;
  tg_file_id: string | null;
  tg_status: string | null;
  tg_error: string | null;
  folder_id: string | null;
  is_public: number;
}

export const onRequestGet: PagesFunction<Env> = withRequestLogging(
  '/api/image/:key/original',
  async ({ env, params, request }, logger) => {
    const key = keyFromRouteParam(params.key);
    if (!key) return notFound();

    try {
      const row = await env.DB.prepare(ORIGINAL_SQL).bind(key).first<PublicOriginalRow>();
      if (!row || row.is_public !== 1 || !(await isFolderPublic(env.DB, row.folder_id))) {
        return notFound();
      }

      const response = await streamTelegramOriginal(env.TG_BOT_TOKEN, row);
      if (!response) {
        return new Response(JSON.stringify({
          error: 'original_not_archived',
          message: row.tg_status === 'failed'
            ? '原图归档失败，请重新归档'
            : '该图片暂无 Telegram 原图归档',
          tg_status: row.tg_status ?? 'unknown',
          tg_error: row.tg_error ?? null,
        }), {
          status: 404,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }

      // 默认 inline，供访客查看器加载原图；?download=1 时改为附件下载。
      const headers = new Headers(response.headers);
      const disposition = headers.get('content-disposition');
      if (disposition) {
        headers.set('content-disposition', request.url.includes('download=1')
          ? disposition
          : disposition.replace(/^attachment/i, 'inline'));
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      logger.error('GET /api/image/:key/original failed', { error, context: { key } });
      return serverError('original_failed');
    }
  },
);
