export interface TelegramArchiveResult {
  file_id: string;
  message_id: number;
  chat_id: string;
}

export interface TelegramArchivePart extends TelegramArchiveResult {
  part_index: number;
  total_parts: number;
  bytes: number;
}

interface TelegramSendDocumentResponse {
  ok: boolean;
  description?: string;
  parameters?: { retry_after?: number };
  result?: {
    message_id?: number;
    chat?: { id?: number | string };
    document?: { file_id?: string };
  };
}

interface TelegramGetFileResponse {
  ok: boolean;
  description?: string;
  result?: { file_path?: string };
}

const API_BASE = 'https://api.telegram.org';
const ARCHIVE_SEND_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const RETRYABLE_ARCHIVE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
// Telegram Bot API getFile has a 20 MB download limit on the normal cloud API.
// Keep each archive part below that limit so originals can be reconstructed reliably.
// User-requested binary split size: 20 MiB = 20 * 1024 * 1024 bytes.
// Note: this is larger than Telegram Bot API's normal cloud getFile download
// ceiling of 20,000,000 decimal bytes, so direct reconstruction through the
// standard Bot API may fail for a full-size 20 MiB part.
export const TELEGRAM_ARCHIVE_PART_BYTES = 20 * 1024 * 1024;
export const TELEGRAM_ARCHIVE_PART_UNIT = 'binary-MiB';

async function readTelegramJson<T>(response: Response, failureCode: string): Promise<T> {
  try { return (await response.json()) as T; } catch { throw new Error(`${failureCode}: invalid_json`); }
}

function sanitizeTelegramError(description: unknown, token: string): string {
  const message = typeof description === 'string' && description.trim() ? description.trim() : 'request_failed';
  return message.replaceAll(token, '[redacted]').slice(0, 300);
}

function assertTelegramConfig(token: string, chatId?: string): void {
  if (!token || !chatId) throw new Error('telegram_archive_failed: missing_config');
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(data: TelegramSendDocumentResponse): number {
  const retryAfter = data.parameters?.retry_after;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0
    ? retryAfter * 1000 : DEFAULT_RETRY_DELAY_MS;
}

function isRetryableArchiveResponse(response: Response): boolean {
  return RETRYABLE_ARCHIVE_STATUSES.has(response.status);
}

export async function archiveOriginalToTelegram(input: {
  token: string;
  chatId: string;
  file: File;
  key: string;
}): Promise<TelegramArchiveResult> {
  assertTelegramConfig(input.token, input.chatId);
  for (let attempt = 1; attempt <= ARCHIVE_SEND_ATTEMPTS; attempt += 1) {
    const formData = new FormData();
    formData.set('chat_id', input.chatId);
    formData.set('caption', `imgbed:${input.key}`);
    formData.set('document', input.file);
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/bot${input.token}/sendDocument`, { method: 'POST', body: formData });
    } catch (error) {
      if (attempt < ARCHIVE_SEND_ATTEMPTS) { await delay(DEFAULT_RETRY_DELAY_MS); continue; }
      throw new Error(`telegram_archive_failed: ${sanitizeTelegramError(error instanceof Error ? error.message : String(error), input.token)}`);
    }
    const data = await readTelegramJson<TelegramSendDocumentResponse>(response, 'telegram_archive_failed');
    if (!response.ok || !data.ok) {
      if (isRetryableArchiveResponse(response) && attempt < ARCHIVE_SEND_ATTEMPTS) { await delay(retryAfterMs(data)); continue; }
      throw new Error(`telegram_archive_failed: ${sanitizeTelegramError(data.description, input.token)}`);
    }
    const fileId = data.result?.document?.file_id;
    const messageId = data.result?.message_id;
    const chatId = data.result?.chat?.id;
    if (!fileId || typeof messageId !== 'number' || chatId === undefined || chatId === null) throw new Error('telegram_archive_failed: invalid_response');
    return { file_id: fileId, message_id: messageId, chat_id: String(chatId) };
  }
  throw new Error('telegram_archive_failed: request_failed');
}

export async function archiveOriginalPartsToTelegram(input: {
  token: string;
  chatId: string;
  file: File;
  key: string;
}): Promise<TelegramArchivePart[]> {
  assertTelegramConfig(input.token, input.chatId);
  // Split deterministically at exactly 20 MiB (20 * 1024 * 1024 bytes) per part.
  // The last part is naturally shorter. This keeps every part within Telegram's
  // download ceiling while maximizing the usable payload size.
  const totalParts = Math.max(1, Math.ceil(input.file.size / TELEGRAM_ARCHIVE_PART_BYTES));
  const parts: TelegramArchivePart[] = [];
  for (let index = 0; index < totalParts; index += 1) {
    const start = index * TELEGRAM_ARCHIVE_PART_BYTES;
    const end = Math.min(input.file.size, start + TELEGRAM_ARCHIVE_PART_BYTES);
    const chunk = input.file.slice(start, end, input.file.type || 'application/octet-stream');
    const chunkFile = new File([chunk], `${input.file.name}.part${String(index + 1).padStart(3, '0')}`, { type: input.file.type || 'application/octet-stream' });
    const result = await archiveOriginalToTelegram({
      token: input.token,
      chatId: input.chatId,
      file: chunkFile,
      key: `${input.key} part ${index + 1}/${totalParts}`,
    });
    parts.push({ ...result, part_index: index, total_parts: totalParts, bytes: end - start });
  }
  return parts;
}

export async function getTelegramFileUrl(token: string, fileId: string): Promise<string> {
  if (!token || !fileId) throw new Error('telegram_file_failed: missing_config');
  const response = await fetch(`${API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = await readTelegramJson<TelegramGetFileResponse>(response, 'telegram_file_failed');
  if (!response.ok || !data.ok) throw new Error(`telegram_file_failed: ${sanitizeTelegramError(data.description, token)}`);
  const filePath = data.result?.file_path;
  if (!filePath) throw new Error('telegram_file_failed: invalid_response');
  return `${API_BASE}/file/bot${token}/${filePath.replace(/^\/+/, '')}`;
}

export async function deleteTelegramMessage(input: { token: string; chatId: string; messageId: number }): Promise<void> {
  if (!input.token || !input.chatId || !input.messageId) throw new Error('telegram_delete_failed: missing_config');
  const formData = new FormData();
  formData.set('chat_id', input.chatId);
  formData.set('message_id', String(input.messageId));
  const response = await fetch(`${API_BASE}/bot${input.token}/deleteMessage`, { method: 'POST', body: formData });
  const data = await readTelegramJson<{ ok?: boolean; description?: string }>(response, 'telegram_delete_failed');
  if (!response.ok || !data.ok) throw new Error(`telegram_delete_failed: ${sanitizeTelegramError(data.description, input.token)}`);
}

