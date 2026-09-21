import type { Env } from '../types';
import { json, serverError } from '../_shared/http';
import { withRequestLogging } from '../_shared/logger';
import { resolveAdmin } from '../_shared/auth';
import type { ImageRow } from '../_shared/images';
import { IMAGE_SELECT_COLUMNS, rowToRecord, scrubRecordForVisitor } from '../_shared/images';

// 首页站点统计：默认按公开聚合视角，访客与管理员看到一致的对外口径。
// photos: 公开图片总数
// storage_bytes: 公开图片压缩后总字节
// places: 标注了 location_name 且 location_public=1 的去重地点数
// latest: 最近 6 张公开图，作为首页的视觉钩子
const SUMMARY_SQL = `
SELECT
  COUNT(*) AS photos,
  COALESCE(SUM(bytes_compressed), 0) AS storage_bytes,
  COALESCE(COUNT(DISTINCT CASE WHEN location_name IS NOT NULL AND location_public = 1 THEN location_name END), 0) AS places,
  COALESCE(SUM(view_count), 0) AS views,
  COALESCE(SUM(download_count), 0) AS downloads
FROM images
WHERE is_public = 1
`;

const LATEST_SQL = `
SELECT ${IMAGE_SELECT_COLUMNS}
FROM images
WHERE is_public = 1
  AND (
    folder_id IS NULL OR NOT EXISTS (
      WITH RECURSIVE ancestors(id, parent_id, is_public) AS (
        SELECT id, parent_id, is_public FROM folders WHERE id = images.folder_id
        UNION ALL
        SELECT f.id, f.parent_id, f.is_public
        FROM folders f JOIN ancestors a ON f.id = a.parent_id
      )
      SELECT 1 FROM ancestors WHERE is_public != 1 LIMIT 1
    )
  )
ORDER BY created_at DESC
LIMIT 6
`;

interface SummaryRow {
  photos: number;
  storage_bytes: number;
  places: number;
  views: number;
  downloads: number;
}

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/stats', async ({ env, request }, logger) => {
  try {
    const isAdmin = (await resolveAdmin(request, env)) !== null;
    const [summary, latest] = await Promise.all([
      env.DB.prepare(SUMMARY_SQL).first<SummaryRow>(),
      env.DB.prepare(LATEST_SQL).all<ImageRow>(),
    ]);

    const latestRecords = (latest.results ?? []).map((row) => {
      const record = rowToRecord(row, env.PUBLIC_BASE_URL);
      return isAdmin ? record : scrubRecordForVisitor(record);
    });

    return json({
      photos: summary?.photos ?? 0,
      storage_bytes: summary?.storage_bytes ?? 0,
      places: summary?.places ?? 0,
      views: summary?.views ?? 0,
      downloads: summary?.downloads ?? 0,
      latest: latestRecords,
    });
  } catch (error) {
    logger.error('GET /api/stats failed', { error });
    return serverError('stats_failed');
  }
});
