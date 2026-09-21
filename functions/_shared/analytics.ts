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
): Promise<{ counted: boolean; sessionCookie: string }> {
  const now = new Date().toISOString();
  const ip = visitorIp(request);
  const userAgent = request.headers.get('User-Agent');
  const cfRay = request.headers.get('CF-Ray');
  const cookieHeader = request.headers.get('Cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)ps_visit_session=([^;]+)/);
  const existingSession = match?.[1] ?? '';

  // A session cookie survives refreshes and SPA navigation, but is normally
  // removed when the browser session is closed. Therefore one browser session
  // counts once instead of counting every route change or refresh.
  if (existingSession) {
    return { counted: false, sessionCookie: existingSession };
  }

  const sessionId = crypto.randomUUID();

  try {
    await db.batch([
      db.prepare(`
        INSERT INTO analytics_events
          (event_type, target_type, target_key, created_at, ip, user_agent, cf_ray)
        VALUES (?, 'site', NULL, ?, ?, ?, ?)
      `).bind('site_visit', now, ip, userAgent, cfRay),
      db.prepare(`
        INSERT INTO site_stats (id, page_views)
        VALUES (1, 1)
        ON CONFLICT(id) DO UPDATE SET page_views = page_views + 1
      `),
    ]);

    // Keep the existing one-row-per-IP presence record updated without
    // changing the per-photo view/download counters.
    try {
      await db.prepare(`
        INSERT INTO visitor_presence
          (ip, first_seen_at, last_seen_at, user_agent, cf_ray, last_event)
        VALUES (?, ?, ?, ?, ?, 'view')
        ON CONFLICT(ip) DO UPDATE SET
          last_seen_at = excluded.last_seen_at,
          user_agent = excluded.user_agent,
          cf_ray = excluded.cf_ray,
          last_event = 'view'
      `).bind(ip, now, now, userAgent, cfRay).run();
    } catch {
      // Older databases may not have visitor_presence yet; site statistics
      // should still work.
    }
  } catch (error) {
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

  return { counted: true, sessionCookie: sessionId };
}
