import type { Env } from '../types';
import { json, serverError } from '../_shared/http';
import { withRequestLogging } from '../_shared/logger';
import { recordSiteVisit } from '../_shared/analytics';

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/visit', async ({ env, request }, logger) => {
  try {
    let action: 'enter' | 'heartbeat' | 'leave' = 'enter';
    try {
      const body = await request.clone().json() as { action?: string };
      if (body.action === 'leave' || body.action === 'heartbeat') action = body.action;
    } catch {
      // Empty body = normal enter request.
    }

    const result = await recordSiteVisit(env.DB, request, logger, action);

    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (action === 'enter' && result.counted) {
      headers['Set-Cookie'] = `ps_visit_session=${encodeURIComponent(result.sessionCookie)}; Path=/; SameSite=Lax; HttpOnly`;
    }

    return json({ ok: true, counted: result.counted, action }, 200, headers);
  } catch (error) {
    logger.error('POST /api/visit failed', { error });
    return serverError('visit_failed');
  }
});
