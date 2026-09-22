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
  const userAgent = request.headers.get('user-agent');
  const cfRay = request.headers.get('cf-ray');
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)ps_visit_session=([^;]+)/);
  const existingSession = match?.[1] ?? '';

  // A session cookie survives refreshes and SPA navigation, but normally
  // disappears when the browser session is closed. Do not count refreshes,
  // route changes, or photo views as additional site visits.
  if (existingSession) {
    return { counted: false, sessionCookie: existingSession };
  }

  const sessionId = crypto.randomUUID();

  try {
    // Do NOT write site visits into analytics_events.
    // analytics_events is the photo-event table and requires image_key/event.
    // The old implementation attempted to insert event_type/target_type,
    // which do not exist in the production schema, causing the whole batch
    // to fail and preventing both page_views and visitor_presence from being
    // recorded.
    await db
      .prepare(`
        INSERT INTO site_stats (id, page_views)
        VALUES (1, 1)
        ON CONFLICT(id) DO UPDATE SET page_views = page_views + 1
      `)
      .run();
  } catch (error) {
    if (logger && typeof logger === 'object' && 'error' in logger) {
      try {
        (logger as { error: (message: string, data?: unknown) => void }).error(
          'recordSiteVisit page_views update failed',
          { error },
        );
      } catch {
        // ignore logger errors
      }
    }
  }

  try {
    // Keep exactly one current record per IP. A new browser session updates
    // the entry time for that IP; left_at is cleared because the visitor is
    // currently online. All timestamps are stored as UTC ISO strings and are
    // converted to Asia/Shanghai only when displayed by the admin UI.
    await db
      .prepare(`
        INSERT INTO visitor_presence
          (ip, first_seen_at, last_seen_at, user_agent, cf_ray, last_event, entered_at, left_at)
        VALUES (?, ?, ?, ?, ?, 'view', ?, NULL)
        ON CONFLICT(ip) DO UPDATE SET
          last_seen_at = excluded.last_seen_at,
          user_agent = excluded.user_agent,
          cf_ray = excluded.cf_ray,
          last_event = 'view',
          entered_at = excluded.entered_at,
          left_at = NULL
      `)
      .bind(ip, now, now, userAgent, cfRay, now)
      .run();
  } catch (error) {
    if (logger && typeof logger === 'object' && 'error' in logger) {
      try {
        (logger as { error: (message: string, data?: unknown) => void }).error(
          'recordSiteVisit visitor_presence update failed',
          { error, ip },
        );
      } catch {
        // ignore logger errors
      }
    }
  }

  return { counted: true, sessionCookie: sessionId };
}

