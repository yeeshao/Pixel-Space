import type { Env } from '../../types';
import { createImageKey } from '../../_shared/keys';
import { inspectImage, filenameForTelegram, sha256Hex } from '../../_shared/telegram-image';
import { getTelegramFileUrl } from '../../_shared/telegram';
import { json, serverError } from '../../_shared/http';
import { withRequestLogging } from '../../_shared/logger';

const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;

interface TelegramPhotoSize { file_id: string; width: number; height: number; file_size?: number }
interface TelegramDocument { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
interface TelegramMessage { message_id: number; chat?: { id?: number | string }; caption?: string; photo?: TelegramPhotoSize[]; document?: TelegramDocument }
interface TelegramUpdate { update_id: number; message?: TelegramMessage }

const sendMessage = async (env: Env, chatId: string, text: string): Promise<void> => {
  if (!env.TG_BOT_TOKEN) return;
  const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error(`telegram_send_message_${response.status}`);
};

const parseCaption = (caption: string) => {
  const text = caption.trim();
  const hashtags = [...text.matchAll(/#([^\s#]+)/g)].map((m) => m[1]).filter(Boolean);
  const title = text.replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
  return { title, tags: [...new Set(hashtags)] };
};

const isAllowedChat = (env: Env, chatId: string): boolean => {
  const configured = env.TG_CHAT_ID?.split(',').map((v) => v.trim()).filter(Boolean) ?? [];
  return configured.includes(chatId);
};

const webhookSecretValid = (request: Request, env: Env): boolean => {
  const secret = env.TG_WEBHOOK_SECRET?.trim();
  return !secret || request.headers.get('X-Telegram-Bot-Api-Secret-Token') === secret;
};

export const onRequestGet: PagesFunction<Env> = async () => json({ ok: true, service: 'pixel-space-telegram-webhook' });

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/telegram/webhook', async ({ request, env }, logger) => {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return serverError('telegram_not_configured');
  if (!webhookSecretValid(request, env)) return new Response('forbidden', { status: 403 });

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const message = update.message;
  if (!message?.chat?.id) return json({ ok: true, ignored: true });
  const chatId = String(message.chat.id);
  if (!isAllowedChat(env, chatId)) {
    logger.warn('Telegram update ignored: chat not allowed', { context: { chatId, updateId: update.update_id } });
    return json({ ok: true, ignored: true });
  }

  const photo = message.photo?.length
    ? [...message.photo].sort((a, b) => (a.width * a.height) - (b.width * b.height)).at(-1)
    : undefined;
  const document = message.document;
  const fileId = document?.file_id ?? photo?.file_id;
  if (!fileId) {
    await sendMessage(env, chatId, 'ℹ️ 请发送图片或图片文件。');
    return json({ ok: true, ignored: true });
  }

  try {
    const telegramUrl = await getTelegramFileUrl(env.TG_BOT_TOKEN, fileId);
    const response = await fetch(telegramUrl);
    if (!response.ok) throw new Error(`telegram_download_failed_${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ORIGINAL_BYTES) throw new Error('telegram_image_too_large_20mb');

    const info = inspectImage(bytes);
    const hash = await sha256Hex(bytes);
    const existing = await env.DB.prepare('SELECT key, tg_status FROM images WHERE hash = ? LIMIT 1').bind(hash).first<{ key: string; tg_status: string }>();
    if (existing) {
      await sendMessage(env, chatId, `ℹ️ 这张图片已经存在于 Pixel-Space：${existing.key}`);
      return json({ ok: true, duplicate: true, key: existing.key });
    }

    const key = createImageKey();
    const filename = filenameForTelegram(document?.file_name, key, info.extension);
    const parsed = parseCaption(message.caption ?? '');
    const tags = parsed.tags.length ? JSON.stringify(parsed.tags) : null;
    const searchContent = [parsed.title, message.caption ?? '', ...parsed.tags].filter(Boolean).join(' ') || null;

    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: info.mime } });
    try {
      await env.DB.prepare(`
        INSERT INTO images (
          key,title,caption,original_filename,width,height,format,bytes_compressed,hash,
          location_name,location_lat,location_lng,location_region,tags_json,search_content,
          ai_status,tg_file_id,tg_message_id,tg_chat_id,tg_status,is_public,location_public
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        key,
        parsed.title,
        message.caption?.trim() || null,
        filename,
        info.width,
        info.height,
        info.extension,
        bytes.byteLength,
        hash,
        null,
        null,
        null,
        null,
        tags,
        searchContent,
        'pending',
        fileId,
        message.message_id,
        chatId,
        'staged',
        1,
        1,
      ).run();
    } catch (error) {
      await env.BUCKET.delete(key);
      throw error;
    }

    await sendMessage(
      env,
      chatId,
      `📥 已收到图片并保存到 Telegram 暂存区\n${filename}\n${info.width}×${info.height}\n\n请打开 Pixel-Space，在「Telegram 暂存」中点击「处理并入库」。\n原图仍保留在 Telegram（tg_file_id 已保存）。`,
    );

    return json({ ok: true, staged: true, key });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'unknown_error';
    logger.error('Telegram image staging failed', { error, context: { chatId, updateId: update.update_id } });
    await sendMessage(env, chatId, `❌ Telegram 图片导入暂存失败：${messageText}`).catch(() => undefined);
    return json({ ok: false, error: messageText }, 500);
  }
});
