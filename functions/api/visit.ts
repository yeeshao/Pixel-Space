import type { Env } from '../types';
import { json, serverError } from '../_shared/http';
import { withRequestLogging } from '../_shared/logger';
import { recordSiteVisit } from '../_shared/analytics';

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/visit', async ({ env, request, waitUntil }, logger) => {
  try {
    const task = recordSiteVisit(env.DB, request, logger);

    // The session cookie must be returned in the HTTP response. Do not defer
    // this part with waitUntil, otherwise the browser cannot establish the
    // session before the next SPA navigation/refresh.
    const result = await task;
    return json(
      { ok: true, counted: result.counted },
      200,
      result.counted
        ? {
            'Set-Cookie': `ps_visit_session=${encodeURIComponent(result.sessionCookie)}; Path=/; SameSite=Lax; HttpOnly`,
          }
        : undefined,
    );
  } catch (error) {
    logger.error('POST /api/visit failed', { error });
    return serverError('visit_failed');
  }
});
