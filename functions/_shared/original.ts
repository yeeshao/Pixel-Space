import type { Env } from '../types';
import { keyFromRouteParam } from './keys';
import { notFound, serverError, unauthorized } from './http';
import { resolveAdmin } from './auth';
import type { RequestLogger } from './logger';
import { getTelegramFileUrl } from './telegram';

export interface OriginalImageRow { key: string; original_filename: string; tg_file_id: string | null; }
const ORIGINAL_SQL = 'SELECT key,title,original_filename,tg_file_id,tg_status,tg_error FROM images WHERE key=?';
interface OriginalRow extends OriginalImageRow { title: string; tg_status?: string | null; tg_error?: string | null; }
export function downloadName(name: string): string { return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'original'; }

async function singleTelegramResponse(token: string, fileId: string): Promise<Response> {
  const fileUrl = await getTelegramFileUrl(token, fileId);
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`telegram_download_failed:${response.status}`);
  return response;
}

export async function streamTelegramOriginal(token: string, row: OriginalImageRow, db?: D1Database): Promise<Response | null> {
  if (!row.tg_file_id) return null;
  const parts = db
    ? (await db.prepare('SELECT tg_file_id FROM telegram_archive_parts WHERE image_key=? ORDER BY part_index ASC').bind(row.key).all<{tg_file_id:string}>()).results ?? []
    : [];
  if (!parts || parts.length === 0) {
    const fileResponse = await singleTelegramResponse(token, row.tg_file_id);
    const headers = new Headers();
    headers.set('content-type', fileResponse.headers.get('content-type') ?? 'application/octet-stream');
    headers.set('content-disposition', `attachment; filename="${downloadName(row.original_filename || row.key)}"`);
    headers.set('cache-control', 'no-store');
    return new Response(fileResponse.body, { headers });
  }
  const streams = parts as Array<{ tg_file_id: string }>;
  let streamIndex = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (streamIndex >= streams.length) { controller.close(); return; }
      const response = await singleTelegramResponse(token, streams[streamIndex++].tg_file_id);
      if (!response.body) throw new Error('telegram_download_failed:empty_body');
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          controller.enqueue(chunk.value);
        }
      } finally { reader.releaseLock(); }
    },
    cancel() { return; },
  });
  const headers = new Headers();
  headers.set('content-type', 'application/octet-stream');
  headers.set('content-disposition', `attachment; filename="${downloadName(row.original_filename || row.key)}"`);
  headers.set('cache-control', 'no-store');
  return new Response(body, { headers });
}

export const handleOriginalGet = async ({ env, params, request }: EventContext<Env,string,Record<string,unknown>>, logger: RequestLogger): Promise<Response> => {
  if (!(await resolveAdmin(request, env))) return unauthorized();
  const key = keyFromRouteParam(params.key); if (!key) return notFound();
  try {
    const row = await env.DB.prepare(ORIGINAL_SQL).bind(key).first<OriginalRow>(); if (!row) return notFound();
    const response = await streamTelegramOriginal(env.TG_BOT_TOKEN, row, env.DB);
    if (!response) return new Response(JSON.stringify({ error:'original_not_archived', message: row.tg_status === 'failed' ? '原图归档失败，请重新归档' : '该图片暂无 Telegram 原图归档', tg_status: row.tg_status ?? 'unknown', tg_error: row.tg_error ?? null }), { status:404, headers:{'content-type':'application/json; charset=utf-8'} });
    return response;
  } catch (error) { logger.error('GET /api/admin/original/:key failed', { error, context:{key} }); return serverError('original_failed'); }
};
