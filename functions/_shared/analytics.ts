import type { RequestLogger } from './logger';

export type AnalyticsEvent = 'view' | 'download';

export const visitorIp = (request: Request): string =>
  request.headers.get('cf-connecting-ip') ??
  request.headers.get('x-real-ip') ??
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
  'unknown';

export const recordImageEvent = async (
  db: D1Database,
  request: Request,
  key: string,
  event: AnalyticsEvent,
  logger?: RequestLogger,
): Promise<void> => {
  const column = event === 'download' ? 'download_count' : 'view_count';
  try {
    await db
      .prepare(`UPDATE images SET ${column} = COALESCE(${column}, 0) + 1 WHERE key = ?`)
      .bind(key)
      .run();

    await db
      .prepare(`INSERT INTO analytics_events (image_key, event, ip, user_agent, cf_ray) VALUES (?, ?, ?, ?, ?)` )
      .bind(
        key,
        event,
        visitorIp(request),
        request.headers.get('user-agent') ?? null,
        request.headers.get('cf-ray') ?? null,
      )
      .run();

    logger?.info(`image ${event}`, {
      context: {
        key,
        event,
        ip: visitorIp(request),
        userAgent: request.headers.get('user-agent') ?? null,
        cfRay: request.headers.get('cf-ray') ?? null,
      },
    });
  } catch (error) {
    // Analytics must never make a valid image request fail.
    logger?.warn(`record image ${event} failed`, {
      error,
      context: { key, event, ip: visitorIp(request) },
    });
  }
};


/**
 * Records a site visit for the public /api/visit endpoint.
 * The logger argument is intentionally optional/unknown to match the
 * request logger contract without coupling analytics to logger types.
 */
export type SiteVisitAction = 'enter' | 'leave';

/**
 * Records one website presence record per IP.
 * `enter` starts/resets the current visit and clears left_at.
 * `leave` closes the current visit.
 *
 * Timestamps are stored as UTC ISO strings; the admin UI formats them
 * as Asia/Shanghai (China Standard Time).
 */
export async function recordSiteVisit(
  db: D1Database,
  request: Request,
  logger?: unknown,
  action: SiteVisitAction = 'enter',
): Promise<void> {
  const now = new Date().toISOString();
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    request.headers.get('X-Real-IP') ??
    'unknown';
  const userAgent = request.headers.get('User-Agent');
  const cfRay = request.headers.get('CF-Ray');

  try {
    if (action === 'leave') {
      await db.prepare(`
        UPDATE visitor_presence
        SET left_at = ?,
            last_seen_at = ?,
            user_agent = COALESCE(?, user_agent),
            cf_ray = COALESCE(?, cf_ray)
        WHERE ip = ?
      `).bind(now, now, userAgent, cfRay, ip).run();
      return;
    }

    await db.prepare(`
      INSERT INTO visitor_presence
        (ip, first_seen_at, last_seen_at, entered_at, left_at, user_agent, cf_ray, last_event)
      VALUES (?, ?, ?, ?, NULL, ?, ?, 'view')
      ON CONFLICT(ip) DO UPDATE SET
        first_seen_at = excluded.first_seen_at,
        last_seen_at = excluded.last_seen_at,
        entered_at = excluded.entered_at,
        left_at = NULL,
        user_agent = excluded.user_agent,
        cf_ray = excluded.cf_ray,
        last_event = 'view'
    `).bind(ip, now, now, now, userAgent, cfRay).run();

    // Site visit count is independent from photo view_count.
    await db.prepare(`
      INSERT INTO site_stats (id, page_views)
      VALUES (1, 1)
      ON CONFLICT(id) DO UPDATE SET page_views = page_views + 1
    `).run();
  } catch (error) {
    // Analytics must never make the public visit endpoint fail.
    if (logger && typeof logger === 'object' && 'error' in logger) {
      try {
        (logger as { error: (message: string, data?: unknown) => void }).error(
          `recordSiteVisit ${action} failed`,
          { error, ip },
        );
      } catch {
        // ignore logger errors
      }
    }
  }
}
