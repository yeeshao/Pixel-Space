import type { Env } from '../types';
import { json, serverError } from '../_shared/http';
import { withRequestLogging } from '../_shared/logger';
import { recordSiteVisit } from '../_shared/analytics';

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/visit', async ({ env, request, waitUntil }, logger) => {
  try {
    const task = recordSiteVisit(env.DB, request, logger);
    if (typeof waitUntil === 'function') {
      waitUntil(task);
    } else {
      await task;
    }
    return json({ ok: true });
  } catch (error) {
    logger.error('POST /api/visit failed', { error });
    return serverError('visit_failed');
  }
});
