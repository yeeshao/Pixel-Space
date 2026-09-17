import type { Env } from '../../../../../types';
import { notFound, serverError, unauthorized } from '../../../../../_shared/http';
import { resolveAdmin } from '../../../../../_shared/auth';
import { requireSameOrigin } from '../../../../../_shared/security';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();
  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return notFound();
  try {
    const row = await env.DB.prepare('SELECT r2_key,original_filename,mime,status FROM telegram_inbox WHERE id = ?').bind(id).first<{ r2_key: string; original_filename: string; mime: string; status: string }>();
    if (!row || row.status !== 'pending') return notFound();
    const object = await env.BUCKET.get(row.r2_key);
    if (!object) return notFound('telegram_inbox_file_missing');
    const headers = new Headers();
    headers.set('content-type', row.mime);
    headers.set('cache-control', 'private, max-age=60');
    const safeName = row.original_filename.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || `telegram-${id}`;
    headers.set('content-disposition', `inline; filename="${safeName}"`);
    return new Response(object.body, { headers });
  } catch { return serverError('telegram_inbox_original_failed'); }
};
