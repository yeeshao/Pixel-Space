import type { Env } from '../../types';
import { createImageKey } from '../../_shared/keys';
import { inspectImage, filenameForTelegram, sha256Hex } from '../../_shared/telegram-image';
import { getTelegramFileUrl } from '../../_shared/telegram';
import { json } from '../../_shared/http';

const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
interface TelegramPhotoSize { file_id: string; width: number; height: number; file_size?: number }
interface TelegramDocument { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
interface TelegramMessage { message_id: number; chat?: { id?: number | string }; caption?: string; photo?: TelegramPhotoSize[]; document?: TelegramDocument }
interface TelegramUpdate { update_id: number; message?: TelegramMessage }

const sendMessage = async (env: Env, chatId: string, text: string) => {
  if (!env.TG_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
};

const isAllowedChat = (env: Env, chatId: string) =>
  (env.TG_CHAT_ID?.split(',').map((v) => v.trim()).filter(Boolean) ?? []).includes(chatId);

const webhookSecretValid = (request: Request, env: Env) => {
  const secret = env.TG_WEBHOOK_SECRET?.trim();
  return !secret || request.headers.get('X-Telegram-Bot-Api-Secret-Token') === secret;
};

const safeFilename = (value: string | undefined, fallback: string) => {
  const name = value?.trim();
  if (!name) return fallback;
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 240) || fallback;
};

export const onRequestGet: PagesFunction<Env> = async () => json({ ok: true, service: 'pixel-space-telegram-webhook' });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!webhookSecretValid(request, env)) return new Response('forbidden', { status: 403 });

  let update: TelegramUpdate;
  try { update = (await request.json()) as TelegramUpdate; } catch { return new Response('bad request', { status: 400 }); }

  const message = update.message;
  if (!message?.chat?.id) return json({ ok: true, ignored: true });
  const chatId = String(message.chat.id);
  if (!isAllowedChat(env, chatId)) return json({ ok: true, ignored: true });

  try {
    const photo = message.photo?.length
      ? [...message.photo].sort((a, b) => a.width * a.height - b.width * b.height).at(-1)
      : undefined;
    const document = message.document;
    const fileId = document?.file_id ?? photo?.file_id;
    if (!fileId) {
      await sendMessage(env, chatId, 'ℹ️ 请发送图片（照片或图片文件）。');
      return json({ ok: true, ignored: true });
    }

    const telegramUrl = await getTelegramFileUrl(env.TG_BOT_TOKEN, fileId);
    const response = await fetch(telegramUrl);
    if (!response.ok) throw new Error(`telegram_download_failed_${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ORIGINAL_BYTES) throw new Error('telegram_image_too_large');

    const info = inspectImage(bytes, document?.mime_type);
    const hash = await sha256Hex(bytes);
    const existingImage = await env.DB.prepare('SELECT key FROM images WHERE hash = ? LIMIT 1').bind(hash).first<{ key: string }>();
    if (existingImage) {
      await sendMessage(env, chatId, `ℹ️ 图片已存在于图库：${existingImage.key}`);
      return json({ ok: true, duplicate: true, key: existingImage.key });
    }

    const existingInbox = await env.DB.prepare('SELECT id FROM telegram_inbox WHERE hash = ? AND status = ? LIMIT 1').bind(hash, 'pending').first<{ id: string }>();
    if (existingInbox) {
      await sendMessage(env, chatId, 'ℹ️ 这张图片已经在 Telegram 待处理区，请打开网页处理。');
      return json({ ok: true, duplicate: true, inbox_id: existingInbox.id });
    }

    const id = createImageKey();
    const r2Key = `telegram-inbox/${id}`;
    const filename = safeFilename(document?.file_name, filenameForTelegram(undefined, id, info.extension));

    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: info.mime } });
    try {
      await env.DB.prepare(`INSERT INTO telegram_inbox (id,r2_key,tg_file_id,tg_message_id,tg_chat_id,original_filename,mime,width,height,bytes,hash,caption,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, r2Key, fileId, message.message_id, chatId, filename, info.mime, info.width, info.height, bytes.byteLength, hash, message.caption?.trim() || null, 'pending')
        .run();
    } catch (error) {
      await env.BUCKET.delete(r2Key);
      throw error;
    }

    await sendMessage(env, chatId, `✅ 已收到图片，已放入 Pixel-Space「Telegram 待处理」\n${filename}\n${info.width}×${info.height}\n请打开网页，在待处理区点击「处理并导入」。`);
    return json({ ok: true, inbox_id: id, status: 'pending' });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'unknown_error';
    await sendMessage(env, chatId, `❌ Telegram 图片接收失败：${messageText}`).catch(() => undefined);
    return json({ ok: false, error: messageText }, 500);
  }
};
