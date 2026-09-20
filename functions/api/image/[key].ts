import type { Env } from '../../types';
import { json, notFound, serverError } from '../../_shared/http';
import { withRequestLogging } from '../../_shared/logger';
import type { ImageRow } from '../../_shared/images';
import { IMAGE_SELECT_COLUMNS, rowToRecord, scrubRecordForVisitor } from '../../_shared/images';
import { keyFromRouteParam } from '../../_shared/keys';
import { isFolderPublic } from '../../_shared/folders';
import { recordImageEvent } from '../../_shared/analytics';

// 单图详情公开入口：访客只能访问公开图，且对 location_public=0 的图擦掉地名与坐标。
const DETAIL_SQL = `SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE key = ?`;

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/image/:key', async ({ env, params, request }, logger) => {
  const key = keyFromRouteParam(params.key);
  if (!key) return notFound();
  try {
    const row = await env.DB.prepare(DETAIL_SQL).bind(key).first<ImageRow>();
    if (!row) return notFound();
    if (row.is_public !== 1 || !(await isFolderPublic(env.DB, row.folder_id))) return notFound();
    await recordImageEvent(env.DB, request, key, 'view', logger);
    const record = rowToRecord(row, env.PUBLIC_BASE_URL);
    return json(scrubRecordForVisitor(record));
  } catch (error) {
    logger.error('GET /api/image/:key failed', {
      error,
      context: { key },
    });
    return serverError('image_failed');
  }
});
