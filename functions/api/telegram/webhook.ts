import type { Env } from '../../types';
import { createImageKey } from '../../_shared/keys';
import { json, serverError } from '../../_shared/http';
import { withRequestLogging } from '../../_shared/logger';

interface TelegramPhotoSize { file_id: string; width: number; height: number; file_size?: number }
interface TelegramDocument { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
interface TelegramMessage {
  message_id: number;
  chat?: { id?: number | string };
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
}
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

const sendMessage = async (env: Env, chatId: string, text: string, replyTo?: number): Promise<void> => {
  if (!env.TG_BOT_TOKEN) return;
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (typeof replyTo === 'number') body.reply_parameters = { message_id: replyTo };
  const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

const extensionFromDocument = (fileName: string | undefined, mimeType: string | undefined): string => {
  const match = fileName?.match(/\.([a-z0-9]+)$/i);
  if (match?.[1]) return match[1].toLowerCase();
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'jpg';
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

  // 私聊/群组使用 message；频道发帖使用 channel_post。
  const message = update.message ?? update.channel_post;
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
    // 非图片消息不进入暂存区。
    return json({ ok: true, ignored: true });
  }

  try {
    // 重要：这里只保存 Telegram 的 file_id/消息元数据，不下载图片、不写 R2。
    // 原图继续由 Telegram 保存；网页需要处理时，再通过 preview endpoint 按 file_id 读取。
    const existing = await env.DB.prepare(
      `SELECT key FROM images WHERE tg_chat_id = ? AND tg_message_id = ? AND tg_status = 'staged' LIMIT 1`,
    ).bind(chatId, message.message_id).first<{ key: string }>();

    if (existing) {
      await sendMessage(env, chatId, 'ℹ️ 这条 Telegram 图片已经在 Pixel-Space 暂存区。', message.message_id).catch((error) => {
        logger.warn('Telegram duplicate reply failed', { context: { error, chatId, updateId: update.update_id } });
      });
      return json({ ok: true, staged: true, duplicate: true, key: existing.key });
    }

    const key = createImageKey();
    const parsed = parseCaption(message.caption ?? '');
    const tags = parsed.tags.length ? JSON.stringify(parsed.tags) : null;
    const searchContent = [parsed.title, message.caption ?? '', ...parsed.tags].filter(Boolean).join(' ') || null;
    const filename = document?.file_name?.trim() || `telegram-${message.message_id}.${extensionFromDocument(undefined, document?.mime_type)}`;
    const width = photo?.width ?? 0;
    const height = photo?.height ?? 0;
    const bytes = document?.file_size ?? photo?.file_size ?? 0;

    // hash 在网页端读取 Telegram 原图后计算；这里必须给 images.hash 一个非空暂存标记。
    const stagingHash = `telegram:${chatId}:${message.message_id}`;
    const format = document?.mime_type?.startsWith('image/')
      ? extensionFromDocument(document.file_name, document.mime_type)
      : (photo ? 'jpg' : 'unknown');

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
      width,
      height,
      format,
      bytes,
      stagingHash,
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

    // 频道需要 bot 具备发帖权限；即使回复失败，也不能影响暂存成功。
    await sendMessage(
      env,
      chatId,
      `📥 已收到图片\n\n已进入 Pixel-Space「Telegram 暂存」\n原图仍保存在 Telegram，不占用 R2。\n打开网页后可预览，点击「处理并入库」后才会进行 EXIF / WebP / AI 处理。`,
      message.message_id,
    ).catch((error) => {
      logger.warn('Telegram staging reply failed', { context: { error, chatId, updateId: update.update_id } });
    });

    return json({ ok: true, staged: true, key });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'unknown_error';
    logger.error('Telegram image staging failed', { error, context: { chatId, updateId: update.update_id } });
    return json({ ok: false, error: messageText }, 500);
  }
});
