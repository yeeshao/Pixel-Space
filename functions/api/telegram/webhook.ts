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
  const secret = (env as Env & { TG_WEBHOOK_SECRET?: string }).TG_WEBHOOK_SECRET?.trim();
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

/**
 * GET /api/telegram/webhook
 *
 * 默认：查看当前 Telegram Webhook 状态。
 * ?setup=1：直接使用 Cloudflare 中的 TG_BOT_TOKEN 注册当前站点的 Webhook。
 * 因此无需把 Bot Token 粘贴到 PowerShell 或发送给任何人。
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  if (!env.TG_BOT_TOKEN) return serverError('telegram_not_configured');

  try {
    const url = new URL(request.url);
    const setup = url.searchParams.get('setup') === '1';

    if (setup) {
      const webhookUrl = `${url.origin}/api/telegram/webhook`;
      const webhookSecret = (env as Env & { TG_WEBHOOK_SECRET?: string }).TG_WEBHOOK_SECRET?.trim();
      const form = new URLSearchParams();
      form.set('url', webhookUrl);
      form.set('allowed_updates', JSON.stringify(['message', 'channel_post']));
      if (webhookSecret) form.set('secret_token', webhookSecret);

      const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const data = await response.json() as {
        ok?: boolean;
        description?: string;
        result?: boolean;
      };

      if (!response.ok || !data.ok) {
        return json({
          ok: false,
          service: 'pixel-space-telegram-webhook',
          action: 'setup',
          webhook_url: webhookUrl,
          telegram_error: data.description || `HTTP ${response.status}`,
        }, 502);
      }

      return json({
        ok: true,
        service: 'pixel-space-telegram-webhook',
        action: 'setup',
        message: 'Webhook 设置成功',
        webhook_url: webhookUrl,
        allowed_updates: ['message', 'channel_post'],
        secret_token_enabled: Boolean(webhookSecret),
      });
    }

    const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getWebhookInfo`);
    const data = await response.json() as {
      ok?: boolean;
      description?: string;
      result?: {
        url?: string;
        has_custom_certificate?: boolean;
        pending_update_count?: number;
        ip_address?: string;
        last_error_date?: number;
        last_error_message?: string;
        max_connections?: number;
        allowed_updates?: string[];
      };
    };
    if (!response.ok || !data.ok) {
      return json({
        ok: false,
        service: 'pixel-space-telegram-webhook',
        telegram_error: data.description || `HTTP ${response.status}`,
      }, 502);
    }
    return json({
      ok: true,
      service: 'pixel-space-telegram-webhook',
      webhook: {
        url: data.result?.url || '',
        pending_update_count: data.result?.pending_update_count ?? 0,
        allowed_updates: data.result?.allowed_updates ?? [],
        last_error_date: data.result?.last_error_date ?? null,
        last_error_message: data.result?.last_error_message ?? null,
        max_connections: data.result?.max_connections ?? null,
      },
    });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : 'telegram_webhook_info_failed');
  }
};

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

  if (!fileId) return json({ ok: true, ignored: true });

  try {
    // 这里只保存 Telegram file_id/消息元数据，不下载图片、不写 R2。
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
