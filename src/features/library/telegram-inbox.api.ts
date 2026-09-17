import { readHttpError } from '@/shared/api/http';

export interface TelegramInboxItem {
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

export function listTelegramInbox(): Promise<TelegramInboxItem[]> {
  return fetch('/api/admin/telegram/inbox').then(async (response) => {
    if (!response.ok) throw new Error(`Telegram 待处理列表加载失败：${await readHttpError(response)}`);
    const data = (await response.json()) as { items: TelegramInboxItem[] };
    return data.items ?? [];
  });
}

export async function fetchTelegramInboxOriginal(id: string): Promise<File> {
  const response = await fetch(`/api/admin/telegram/inbox/${encodeURIComponent(id)}/original`);
  if (!response.ok) throw new Error(`Telegram 原图读取失败：${await readHttpError(response)}`);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/i);
  return new File([blob], match?.[1] ?? `telegram-${id}`, { type: blob.type || 'application/octet-stream' });
}
