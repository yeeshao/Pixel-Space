import type { Env } from '../../types';
import { json, serverError, unauthorized } from '../../_shared/http';
import { withRequestLogging } from '../../_shared/logger';
import { resolveAdmin } from '../../_shared/auth';

const RECENT_EVENTS_SQL = `
SELECT e.id, e.image_key, i.original_filename, e.event, e.ip, e.user_agent, e.cf_ray, e.created_at
FROM analytics_events e
LEFT JOIN images i ON i.key = e.image_key
ORDER BY e.id DESC
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
        COALESCE(SUM(view_count), 0) AS views,
        COALESCE(SUM(download_count), 0) AS downloads
      FROM images
    `).first<{ views: number; downloads: number }>();

    const top = await env.DB.prepare(TOP_SQL).all<{
      key: string;
      original_filename: string;
      view_count: number;
      download_count: number;
    }>();

    const visitors = await env.DB.prepare(`
      SELECT ip, entered_at, left_at, user_agent, cf_ray
      FROM visitor_presence
      ORDER BY COALESCE(entered_at, first_seen_at) DESC
      LIMIT 100
    `).all<{
      ip: string;
      entered_at: string | null;
      left_at: string | null;
      user_agent: string | null;
      cf_ray: string | null;
    }>();

    const siteStats = await env.DB.prepare(`
      SELECT page_views FROM site_stats WHERE id = 1
    `).first<{ page_views: number }>();

    const recent = await env.DB.prepare(RECENT_EVENTS_SQL).all<{
      id: number;
      image_key: string;
      original_filename: string | null;
      event: 'view' | 'download';
      ip: string;
      user_agent: string | null;
      cf_ray: string | null;
      created_at: string;
    }>();

    return json({
      views: Number(totals?.views ?? 0),
      downloads: Number(totals?.downloads ?? 0),
      pageViews: Number(siteStats?.page_views ?? 0),
      visitors: visitors.results ?? [],
      top: top.results ?? [],
      recent: recent.results ?? [],
    });
  } catch (error) {
    logger.error('GET /api/admin/analytics failed', { error });
    return serverError('analytics_failed');
  }
});
