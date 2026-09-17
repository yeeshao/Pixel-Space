import type { Env } from '../../../../../types';
import { resolveAdmin } from '../../../../../_shared/auth';
import { badRequest, json, notFound, serverError, unauthorized } from '../../../../../_shared/http';
import { IMAGE_SELECT_COLUMNS, type ImageRow, rowToAdminRecord, normalizeTagsJson, normalizeColorPaletteJson } from '../../../../../_shared/images';
import { requireSameOrigin } from '../../../../../_shared/security';
import { withRequestLogging } from '../../../../../_shared/logger';
import { createImageKey, keyFromRouteParam } from '../../../../../_shared/keys';
import { coordinateOrNull, integerOrNull, numberOrNull, stringOrEmpty, stringOrNull, normalizeStringList } from '../../../../../_shared/request';

interface TelegramStagedImageRow extends ImageRow {
  hash: string | null;
  tg_file_id: string | null;
  tg_message_id: number | null;
  tg_chat_id: string | null;
}

const MAX_COMPRESSED_BYTES = 15 * 1024 * 1024;

const fileFromForm = (formData: FormData, name: string): File | null => {
  const value = formData.get(name);
  return value && typeof value !== 'string' ? value : null;
};

const jsonField = (formData: FormData, name: string): Record<string, unknown> | null => {
  const value = formData.get(name);
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
};

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/admin/telegram/process/:key', async (context, logger) => {
  const { request, env, params } = context;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();

  const key = keyFromRouteParam(params.key);
  if (!key) return notFound();

  let formData: FormData;
  try { formData = await request.formData(); } catch { return badRequest('invalid_form_data'); }

  const compressed = fileFromForm(formData, 'compressed');
  const hashValue = formData.get('hash');
  const hash = typeof hashValue === 'string' ? hashValue.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(hash)) return badRequest('invalid_hash');
  if (!compressed || compressed.type !== 'image/webp') return badRequest('invalid_compressed_mime');
  if (compressed.size > MAX_COMPRESSED_BYTES) return badRequest('compressed_too_large');

  const dimensions = jsonField(formData, 'dimensions');
  const originalDimensions = jsonField(formData, 'original_dimensions');
  const originalBytesValue = formData.get('original_bytes');
  const exif = jsonField(formData, 'exif');
  const meta = jsonField(formData, 'meta');
  const ai = jsonField(formData, 'ai');
  if (!dimensions || !exif || !meta) return badRequest('missing_process_fields');

  const originalWidth = integerOrNull(originalDimensions?.width);
  const originalHeight = integerOrNull(originalDimensions?.height);
  const originalBytes = typeof originalBytesValue === 'string' ? Number.parseInt(originalBytesValue, 10) : Number.NaN;
  if (originalWidth === null || originalHeight === null || originalWidth <= 0 || originalHeight <= 0) {
    return badRequest('invalid_original_dimensions');
  }
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) return badRequest('invalid_original_bytes');

  const width = integerOrNull(dimensions.width);
  const height = integerOrNull(dimensions.height);
  if (width === null || height === null || width <= 0 || height <= 0) return badRequest('invalid_dimensions');

  const lat = coordinateOrNull(meta.location_lat, -90, 90);
  const lng = coordinateOrNull(meta.location_lng, -180, 180);
  if (meta.location_lat !== null && lat === null) return badRequest('invalid_location_lat');
  if (meta.location_lng !== null && lng === null) return badRequest('invalid_location_lng');

  const isPublic = meta.is_public === 0 ? 0 : 1;
  const locationPublic = meta.location_public === 0 ? 0 : 1;
  const region = meta.location_region === 'china' || meta.location_region === 'global' ? meta.location_region : null;

  try {
    const row = await env.DB.prepare(`SELECT * FROM images WHERE key = ?`).bind(key).first<TelegramStagedImageRow>();
    if (!row) return notFound();
    if (row.tg_status !== 'staged') return badRequest('telegram_image_not_staged');

    // 原图仍在 Telegram；hash 在浏览器读取 Telegram 原图后计算。
    // 如果已经存在相同原图，则直接结束当前暂存记录，不重复入库。
    const existing = await env.DB.prepare(`SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE hash = ? AND tg_status != 'staged' LIMIT 1`).bind(hash).first<ImageRow>();
    if (existing) {
      await env.DB.prepare('DELETE FROM images WHERE key = ?').bind(key).run();
      return json(rowToAdminRecord(existing), 200);
    }

    const newKey = createImageKey();
    await env.BUCKET.put(newKey, compressed, { httpMetadata: { contentType: 'image/webp' } });

    const aiTitle = ai && typeof ai.title === 'string' ? ai.title.trim() : '';
    const aiCaption = ai && typeof ai.caption === 'string' ? ai.caption.trim() : '';
    const aiSearch = ai && typeof ai.search_content === 'string' ? ai.search_content.trim() : '';
    const aiDominant = ai && typeof ai.dominant_color === 'string' ? ai.dominant_color.trim() : '';
    const aiComposition = ai && typeof ai.composition === 'string' ? ai.composition.trim() : '';
    const aiTags = ai ? normalizeStringList(ai.tags, { min: 0, max: 100 }) : null;
    const aiPalette = ai ? normalizeStringList(ai.palette, { min: 0, max: 100 }) : null;
    const finalTags = aiTags !== null ? (aiTags.length ? JSON.stringify(aiTags) : null) : normalizeTagsJson(meta.tags);
    const finalPalette = aiPalette !== null ? (aiPalette.length ? JSON.stringify(aiPalette) : null) : normalizeColorPaletteJson(meta.palette);
    const finalAiStatus = ai ? (ai.failed === true ? 'failed' : 'done') : 'pending';

    try {
      await env.DB.prepare(`
        INSERT INTO images (
          key,title,caption,original_filename,width,height,format,bytes_compressed,original_bytes,original_width,original_height,hash,
          location_name,location_lat,location_lng,location_region,
          exif_taken_at,exif_camera,exif_iso,exif_aperture,exif_shutter,exif_focal_length,
          tags_json,search_content,dominant_color,color_palette_json,composition,ai_status,
          tg_file_id,tg_message_id,tg_chat_id,tg_status,tg_error,is_public,location_public,folder_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        newKey,
        aiTitle || stringOrEmpty(meta.title),
        aiCaption || stringOrNull(meta.caption),
        stringOrEmpty(meta.original_filename) || row.original_filename,
        width,
        height,
        'webp',
        compressed.size,
        originalBytes,
        originalWidth,
        originalHeight,
        hash,
        stringOrNull(meta.location_name),
        lat,
        lng,
        region,
        stringOrNull(exif.taken_at),
        stringOrNull(exif.camera),
        integerOrNull(exif.iso),
        numberOrNull(exif.aperture),
        stringOrNull(exif.shutter),
        numberOrNull(exif.focal_length),
        finalTags,
        aiSearch || stringOrNull(meta.search_content),
        aiDominant || stringOrNull(meta.dominant_color),
        finalPalette,
        aiComposition || stringOrNull(meta.composition),
        finalAiStatus,
        row.tg_file_id,
        row.tg_message_id,
        row.tg_chat_id,
        'done',
        null,
        isPublic,
        locationPublic,
        stringOrNull(meta.folder_id),
      ).run();

      await env.DB.prepare('DELETE FROM images WHERE key = ?').bind(key).run();
      await env.BUCKET.delete(key);
    } catch (error) {
      await env.BUCKET.delete(newKey).catch(() => undefined);
      throw error;
    }

    const fresh = await env.DB.prepare(`SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE key = ?`).bind(newKey).first<ImageRow>();
    if (!fresh) return serverError('telegram_process_row_missing');
    return json(rowToAdminRecord(fresh), 200);
  } catch (error) {
    logger.error('POST /api/admin/telegram/process/:key failed', { error, context: { key } });
    return serverError('telegram_process_failed');
  }
});
