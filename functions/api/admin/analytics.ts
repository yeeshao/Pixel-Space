import type { Env } from '../../types';
import { json, serverError, unauthorized } from '../../_shared/http';
import { withRequestLogging } from '../../_shared/logger';
import { resolveAdmin } from '../../_shared/auth';

const VISITOR_PRESENCE_SQL = `
SELECT ip, first_seen_at, last_seen_at, user_agent, cf_ray, last_event
FROM visitor_presence
ORDER BY last_seen_at DESC
LIMIT 100
`;

const TOP_SQL = `
SELECT key, original_filename, view_count, download_count
FROM images
ORDER BY (COALESCE(view_count, 0) + COALESCE(download_count, 0)) DESC, created_at DESC
LIMIT 20
`;

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/admin/analytics', async ({ env, request }, logger) => {
  if (!(await resolveAdmin(request, env))) return unauthorized();

  try {
    const totals = await env.DB.prepare(`
      SELECT
        COALESCE(SUM(download_count), 0) AS downloads
      FROM images
    `).first<{ downloads: number }>();

    const siteStats = await env.DB
      .prepare('SELECT page_views FROM site_stats WHERE id = 1')
      .first<{ page_views: number }>();

    const top = await env.DB.prepare(TOP_SQL).all<{
      key: string;
      original_filename: string;
      view_count: number;
      download_count: number;
    }>();

    const visitors = await env.DB.prepare(VISITOR_PRESENCE_SQL).all<{
      ip: string;
      first_seen_at: string;
      last_seen_at: string;
      user_agent: string | null;
      cf_ray: string | null;
      last_event: 'view' | 'download';
    }>();

    return json({
      views: Number(siteStats?.page_views ?? 0),
      downloads: Number(totals?.downloads ?? 0),
      top: top.results ?? [],
      visitors: visitors.results ?? [],
    });
  } catch (error) {
    logger.error('GET /api/admin/analytics failed', { error });
    return serverError('analytics_failed');
  }
});
