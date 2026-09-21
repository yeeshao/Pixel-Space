import type { RequestLogger } from './logger';

const shanghaiNow = (): string => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
};

export type AnalyticsEvent = 'view' | 'download';

export const visitorIp = (request: Request): string => {
  const candidates = [
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
  ];

  return candidates.find((value) => value && value.trim())?.trim() ?? 'unknown';
};

const touchVisitorPresence = async (
  db: D1Database,
  request: Request,
  event: AnalyticsEvent = 'view',
): Promise<void> => {
  const ip = visitorIp(request);
  if (ip === 'unknown') return;

  const now = shanghaiNow();
  await db
    .prepare(`
      INSERT INTO visitor_presence (ip, first_seen_at, last_seen_at, user_agent, cf_ray, last_event)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        user_agent = excluded.user_agent,
        cf_ray = excluded.cf_ray,
        last_event = excluded.last_event
    `)
    .bind(
      ip,
      now,
      now,
      request.headers.get('user-agent') ?? null,
      request.headers.get('cf-ray') ?? null,
      event,
    )
    .run();
};

export const recordSiteVisit = async (
  db: D1Database,
  request: Request,
  logger?: RequestLogger,
): Promise<void> => {
  try {
    await db
      .prepare('UPDATE site_stats SET page_views = COALESCE(page_views, 0) + 1 WHERE id = 1')
      .run();

    // 同一个 IP 永远只保留一条在线记录；这里只更新最后在线时间。
    // visitor_presence 的 last_event 使用 view，避免破坏旧表的 CHECK 约束。
    await touchVisitorPresence(db, request, 'view');

    logger?.info('site page view', {
      context: {
        ip: visitorIp(request),
        userAgent: request.headers.get('user-agent') ?? null,
        cfRay: request.headers.get('cf-ray') ?? null,
      },
    });
  } catch (error) {
    // 网站访问统计失败不能影响正常页面访问。
    logger?.warn('record site visit failed', {
      error,
      context: { ip: visitorIp(request) },
    });
  }
};

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
      .prepare(`INSERT INTO analytics_events (image_key, event, ip, user_agent, cf_ray, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        key,
        event,
        ip,
        request.headers.get('user-agent') ?? null,
        request.headers.get('cf-ray') ?? null,
        shanghaiNow(),
      )
      .run();

    // 照片访问/下载也会刷新该 IP 的最后在线时间，但不会新增 IP 记录。
    await touchVisitorPresence(db, request, event);

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
