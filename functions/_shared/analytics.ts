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
export async function recordSiteVisit(
  db: D1Database,
  request: Request,
  logger?: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For') ??
    'unknown';
  const userAgent = request.headers.get('User-Agent');
  const cfRay = request.headers.get('CF-Ray');

  try {
    await db.prepare(`
      INSERT INTO analytics_events
        (event_type, target_type, target_key, created_at, ip, user_agent, cf_ray)
      VALUES (?, 'site', NULL, ?, ?, ?, ?)
    `).bind('site_visit', now, ip, userAgent, cfRay).run();
  } catch (error) {
    // Analytics must never make the public visit endpoint fail.
    if (logger && typeof logger === 'object' && 'error' in logger) {
      try {
        (logger as { error: (message: string, data?: unknown) => void }).error(
          'recordSiteVisit analytics insert failed',
          { error },
        );
      } catch {
        // ignore logger errors
      }
    }
  }
}
