import type { ImageRecord } from '@/features/images/image.types';
import { readHttpError } from '@/shared/api/http';

export function listTelegramInbox(): Promise<ImageRecord[]> {
  return fetch('/api/admin/telegram-inbox').then(async (response) => {
    if (!response.ok) throw new Error(`Telegram 暂存加载失败：${await readHttpError(response)}`);
    return (await response.json()) as ImageRecord[];
  });
}

export interface TelegramProcessPayload {
  compressed: File;
  dimensions: { width: number; height: number };
  exif: Record<string, unknown>;
  meta: {
    title: string;
    caption: string;
    original_filename: string;
    location_name: string;
    location_lat: number | null;
    location_lng: number | null;
    location_region: string | null;
    tags: string;
    search_content: string;
    dominant_color: string;
    palette: string;
    composition: string;
    is_public: 0 | 1;
    location_public: 0 | 1;
  };
  ai?: {
    failed: boolean;
    title: string;
    caption: string;
    tags: string[];
    search_content: string;
    dominant_color: string;
    palette: string[];
    composition: string;
  };
}

export async function processTelegramImage(key: string, payload: TelegramProcessPayload): Promise<ImageRecord> {
  const formData = new FormData();
  formData.append('compressed', payload.compressed, payload.compressed.name);
  formData.append('dimensions', JSON.stringify(payload.dimensions));
  formData.append('exif', JSON.stringify(payload.exif));
  formData.append('meta', JSON.stringify(payload.meta));
  if (payload.ai) formData.append('ai', JSON.stringify(payload.ai));

  const response = await fetch(`/api/admin/telegram/process/${encodeURIComponent(key)}`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error(`Telegram 图片处理失败：${await readHttpError(response)}`);
  return (await response.json()) as ImageRecord;
}
