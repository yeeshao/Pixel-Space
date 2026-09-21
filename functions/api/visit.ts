import type { Env } from '../types';
import { json, serverError } from '../_shared/http';
import { withRequestLogging } from '../_shared/logger';

// 统计网站公开页面访问次数。
// 这里不修改 images.view_count，照片访问次数仍由公开图片详情接口单独统计，
// 并继续只在控制台显示。
export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/visit', async ({ env }, logger) => {
  try {
    await env.DB.prepare(`
      INSERT INTO site_stats (id, page_views)
      VALUES (1, 1)
      ON CONFLICT(id) DO UPDATE SET page_views = page_views + 1
    `).run();

    return json({ ok: true });
  } catch (error) {
    logger.error('POST /api/visit failed', { error });
    return serverError('visit_failed');
  }
});
