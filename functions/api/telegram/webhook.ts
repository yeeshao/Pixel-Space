import type { Env } from '../../types';
import { analyzeImageWithAi } from '../../_shared/ai';
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
  await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
};

const parseCaption = (caption: string) => {
  const text = caption.trim();
  const geo = text.match(/@geo\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  const hashtags = [...text.matchAll(/#([^\s#]+)/g)].map((m) => m[1]).filter(Boolean);
  const title = text.replace(/@geo\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/gi, '').replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
  return { title, tags: [...new Set(hashtags)], lat: geo ? Number(geo[1]) : null, lng: geo ? Number(geo[2]) : null };
};

const isAllowedChat = (env: Env, chatId: string) => (env.TG_CHAT_ID?.split(',').map((v) => v.trim()).filter(Boolean) ?? []).includes(chatId);
const webhookSecretValid = (request: Request, env: Env) => !env.TG_WEBHOOK_SECRET?.trim() || request.headers.get('X-Telegram-Bot-Api-Secret-Token') === env.TG_WEBHOOK_SECRET.trim();

export const onRequestGet: PagesFunction<Env> = async () => json({ ok: true, service: 'pixel-space-telegram-webhook' });

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (!webhookSecretValid(request, env)) return new Response('forbidden', { status: 403 });
  let update: TelegramUpdate;
  try { update = (await request.json()) as TelegramUpdate; } catch { return new Response('bad request', { status: 400 }); }
  const message = update.message;
  if (!message?.chat?.id) return json({ ok: true, ignored: true });
  const chatId = String(message.chat.id);
  if (!isAllowedChat(env, chatId)) return json({ ok: true, ignored: true });

  try {
    const photo = message.photo?.length ? [...message.photo].sort((a, b) => (a.width * a.height) - (b.width * b.height)).at(-1) : undefined;
    const document = message.document;
    const fileId = document?.file_id ?? photo?.file_id;
    if (!fileId) { await sendMessage(env, chatId, 'ℹ️ 请发送图片（照片或图片文件）。'); return json({ ok: true, ignored: true }); }

    const telegramUrl = await getTelegramFileUrl(env.TG_BOT_TOKEN, fileId);
    const response = await fetch(telegramUrl);
    if (!response.ok) throw new Error(`telegram_download_failed_${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ORIGINAL_BYTES) throw new Error('telegram_image_too_large');

    const info = inspectImage(bytes, document?.mime_type);
    const hash = await sha256Hex(bytes);
    const existing = await env.DB.prepare('SELECT key FROM images WHERE hash = ? LIMIT 1').bind(hash).first<{ key: string }>();
    if (existing) { await sendMessage(env, chatId, `ℹ️ 图片已存在：${existing.key}`); return json({ ok: true, duplicate: true, key: existing.key }); }

    const key = createImageKey();
    const filename = filenameForTelegram(document?.file_name, key, info.extension);
    const parsed = parseCaption(message.caption ?? '');
    const lat = parsed.lat !== null && Number.isFinite(parsed.lat) && parsed.lat >= -90 && parsed.lat <= 90 ? parsed.lat : null;
    const lng = parsed.lng !== null && Number.isFinite(parsed.lng) && parsed.lng >= -180 && parsed.lng <= 180 ? parsed.lng : null;
    const region = lat !== null && lng !== null ? (lng >= 73.5 && lng <= 135.1 && lat >= 3.5 && lat <= 53.6 ? 'china' : 'global') : null;
    const tags = parsed.tags.length ? JSON.stringify(parsed.tags) : null;

    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: info.mime } });
    try {
      await env.DB.prepare(`INSERT INTO images (key,title,caption,original_filename,width,height,format,bytes_compressed,hash,location_name,location_lat,location_lng,location_region,tags_json,search_content,ai_status,tg_file_id,tg_message_id,tg_chat_id,tg_status,is_public,location_public) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(key, parsed.title, message.caption?.trim() || null, filename, info.width, info.height, info.extension, bytes.byteLength, hash, null, lat, lng, region, tags, [parsed.title, message.caption ?? '', ...parsed.tags].filter(Boolean).join(' ') || null, 'pending', fileId, message.message_id, chatId, 'done', 1, 1).run();
    } catch (error) { await env.BUCKET.delete(key); throw error; }

    const runAi = env.TG_AUTO_AI !== 'false' && env.TG_AUTO_AI !== '0';
    const aiTask = async () => {
      if (!runAi) return;
      try {
        const result = await analyzeImageWithAi({ env, image: new File([bytes], filename, { type: info.mime }) });
        await env.DB.prepare(`UPDATE images SET title=?,caption=?,tags_json=?,search_content=?,dominant_color=?,color_palette_json=?,composition=?,ai_status='done',updated_at=datetime('now') WHERE key=?`)
          .bind(result.title || parsed.title, result.caption || message.caption?.trim() || null, result.tags.length ? JSON.stringify(result.tags) : tags, result.search_content || null, result.dominant_color || null, result.palette.length ? JSON.stringify(result.palette) : null, result.composition || null, key).run();
      } catch { await env.DB.prepare(`UPDATE images SET ai_status='failed',updated_at=datetime('now') WHERE key=?`).bind(key).run(); }
    };
    if (typeof waitUntil === 'function') waitUntil(aiTask()); else await aiTask();
    await sendMessage(env, chatId, `✅ 已导入 Pixel-Space\n${parsed.title || filename}\n${info.width}×${info.height}${runAi ? '\nAI：后台分析中' : ''}`);
    return json({ ok: true, key });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'unknown_error';
    await sendMessage(env, chatId, `❌ 导入失败：${messageText}`).catch(() => undefined);
    return json({ ok: false, error: messageText }, 500);
  }
};
