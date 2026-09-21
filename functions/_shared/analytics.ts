import type { RequestLogger } from './logger';


const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const shanghaiNow = () => {
  const shifted = new Date(Date.now() + SHANGHAI_OFFSET_MS);
  return shifted.toISOString().replace('Z', '+08:00');
};

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
  const ip = visitorIp(request);
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
        ip,
        request.headers.get('user-agent') ?? null,
        request.headers.get('cf-ray') ?? null,
      )
      .run();

    logger?.info(`image ${event}`, {
      context: {
        key,
        event,
        ip,
        userAgent: request.headers.get('user-agent') ?? null,
        cfRay: request.headers.get('cf-ray') ?? null,
      },
    });
  } catch (error) {
    // Analytics must never make a valid image request fail.
    logger?.warn(`record image ${event} failed`, {
      error,
      context: { key, event, ip },
    });
  }
};
