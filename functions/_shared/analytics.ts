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
 * Records a public-site browser session.
 *
 * The session cookie is used only to prevent refreshes / SPA navigation from
 * creating extra page views. Presence itself is tracked with enter/heartbeat/
 * leave events so the admin page can show a real exit time when the browser
 * fires pagehide, and can consider abandoned sessions offline after a timeout.
 */
export async function recordSiteVisit(
  db: D1Database,
  request: Request,
  logger?: unknown,
  action: 'enter' | 'heartbeat' | 'leave' = 'enter',
): Promise<{ counted: boolean; sessionCookie: string }> {
  const now = new Date().toISOString();
  const ip = visitorIp(request);
  const userAgent = request.headers.get('User-Agent');
  const cfRay = request.headers.get('CF-Ray');
  const cookieHeader = request.headers.get('Cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)ps_visit_session=([^;]+)/);
  const existingSession = match?.[1] ? decodeURIComponent(match[1]) : '';

  // Leave is sent from pagehide/sendBeacon. It must not create a new visit.
  if (action === 'leave') {
    try {
      await db.prepare(`
        UPDATE visitor_presence
        SET last_seen_at = ?, left_at = ?, last_event = 'leave',
            user_agent = COALESCE(?, user_agent),
            cf_ray = COALESCE(?, cf_ray)
        WHERE ip = ?
      `).bind(now, now, userAgent, cfRay, ip).run();
    } catch (error) {
      logAnalyticsError(logger, 'recordSiteVisit leave failed', error);
    }
    return { counted: false, sessionCookie: existingSession || crypto.randomUUID() };
  }

  // Heartbeats keep the presence record fresh but never increment page views.
  if (action === 'heartbeat') {
    try {
      await db.prepare(`
        UPDATE visitor_presence
        SET last_seen_at = ?, last_event = 'view',
            user_agent = COALESCE(?, user_agent),
            cf_ray = COALESCE(?, cf_ray),
            left_at = NULL
        WHERE ip = ?
      `).bind(now, userAgent, cfRay, ip).run();
    } catch (error) {
      logAnalyticsError(logger, 'recordSiteVisit heartbeat failed', error);
    }
    return { counted: false, sessionCookie: existingSession || crypto.randomUUID() };
  }

  // A session cookie survives refreshes and SPA navigation, but normally
  // represents one browser session. A missing cookie starts a new visit.
  if (existingSession) {
    // The cookie can survive browser restore on some mobile browsers. Re-open
    // the presence interval whenever the browser actually sends a visit again.
    try {
      await db.prepare(`
        UPDATE visitor_presence
        SET last_seen_at = ?, entered_at = COALESCE(entered_at, ?),
            left_at = NULL, last_event = 'view',
            user_agent = COALESCE(?, user_agent),
            cf_ray = COALESCE(?, cf_ray)
        WHERE ip = ?
      `).bind(now, now, userAgent, cfRay, ip).run();
    } catch (error) {
      logAnalyticsError(logger, 'recordSiteVisit existing-session update failed', error);
    }
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
      db.prepare(`
        INSERT INTO visitor_presence
          (ip, first_seen_at, last_seen_at, user_agent, cf_ray, last_event, entered_at, left_at)
        VALUES (?, ?, ?, ?, ?, 'view', ?, NULL)
        ON CONFLICT(ip) DO UPDATE SET
          last_seen_at = excluded.last_seen_at,
          entered_at = excluded.entered_at,
          left_at = NULL,
          user_agent = excluded.user_agent,
          cf_ray = excluded.cf_ray,
          last_event = 'view'
      `).bind(ip, now, now, userAgent, cfRay, now),
    ]);
  } catch (error) {
    logAnalyticsError(logger, 'recordSiteVisit analytics insert failed', error);
  }

  return { counted: true, sessionCookie: sessionId };
}

function logAnalyticsError(logger: unknown, message: string, error: unknown): void {
  if (logger && typeof logger === 'object' && 'error' in logger) {
    try {
      (logger as { error: (message: string, data?: unknown) => void }).error(message, { error });
    } catch {
      // ignore logger errors
    }
  }
}

