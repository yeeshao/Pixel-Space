import type { ImageRecord } from '@/features/images/image.types';
import { readHttpError } from '@/shared/api/http';

const UPLOAD_REQUEST_TIMEOUT_MS = 45000;

export class UploadNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadNetworkError';
  }
}

export async function uploadImage(formData: FormData): Promise<ImageRecord> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), UPLOAD_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('/api/admin/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`上传失败：${await readHttpError(response)}`);
    }

    return (await response.json()) as ImageRecord;
  } catch (error) {
    if (error instanceof UploadNetworkError) throw error;

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new UploadNetworkError('网络请求超时，正在自动重试。');
    }

    if (error instanceof TypeError) {
      throw new UploadNetworkError('网络连接失败，正在自动重试。');
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function retryTelegramArchive(key: string, original: File): Promise<ImageRecord> {
  const formData = new FormData();
  formData.set('original', original);

  const response = await fetch(`/api/admin/image/${encodeURIComponent(key)}/archive`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`归档重试失败：${await readHttpError(response)}`);
  }

  return (await response.json()) as ImageRecord;
}
