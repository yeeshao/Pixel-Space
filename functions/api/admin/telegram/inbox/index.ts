import type { Env } from '../../../../types';
import { json, serverError, unauthorized } from '../../../../_shared/http';
import { resolveAdmin } from '../../../../_shared/auth';
import { requireSameOrigin } from '../../../../_shared/security';

export interface TelegramInboxRow {
  id: string;
  original_filename: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  caption: string | null;
  status: string;
  error: string | null;
  tg_message_id: number;
  created_at: string;
  updated_at: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();
  try {
    const result = await env.DB.prepare(`SELECT id,original_filename,mime,width,height,bytes,caption,status,error,tg_message_id,created_at,updated_at FROM telegram_inbox WHERE status = 'pending' ORDER BY created_at DESC LIMIT 200`).all<TelegramInboxRow>();
    return json({ items: result.results ?? [] });
  } catch { return serverError('telegram_inbox_list_failed'); }
};
