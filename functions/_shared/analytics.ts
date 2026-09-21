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
  const ip = visitorIp(request);
  try {
    await db
      .prepare(`UPDATE images SET ${column} = COALESCE(${column}, 0) + 1 WHERE key = ?`)
      .bind(key)
      .run();

    // 访问记录按 IP 去重：同一个 IP 不再不断写入明细事件，
    // 只更新该 IP 的最后在线时间；图片自身的访问/下载计数仍正常累计。
    await db
      .prepare(`
        INSERT INTO visitor_presence (
          ip, first_seen_at, last_seen_at, user_agent, cf_ray, last_event
        ) VALUES (?, datetime('now'), datetime('now'), ?, ?, ?)
        ON CONFLICT(ip) DO UPDATE SET
          last_seen_at = datetime('now'),
          user_agent = excluded.user_agent,
          cf_ray = excluded.cf_ray,
          last_event = excluded.last_event
      `)
      .bind(
        ip,
        request.headers.get('user-agent') ?? null,
        request.headers.get('cf-ray') ?? null,
        event,
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
