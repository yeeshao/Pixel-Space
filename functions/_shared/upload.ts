import type { Env } from '../types';
import { badRequest, json, serverError, unauthorized } from './http';
import type { RequestLogger } from './logger';
import { resolveAdmin } from './auth';
import type { ImageRow } from './images';
import {
  IMAGE_SELECT_COLUMNS,
  normalizeColorPaletteJson,
  normalizeRegion,
  normalizeTagsJson,
  rowToRecord,
} from './images';
import {
  coordinateOrNull,
  flagOrDefault,
  integerOrNull,
  numberOrNull,
  stringOrEmpty,
  stringOrNull,
} from './request';
import { createImageKey } from './keys';
import { archiveOriginalAfterUpload } from './archive';
import { requireSameOrigin } from './security';
import { createStaticMapCacheTask, staticMapRefererFromRequest } from './static-map';

const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

const INSERT_SQL = `
INSERT INTO images (
  key,
  title,
  caption,
  original_filename,
  width,
  height,
  format,
  bytes_compressed,
  hash,
  location_name,
  location_lat,
  location_lng,
  location_region,
  exif_taken_at,
  exif_camera,
  exif_iso,
  exif_aperture,
  exif_shutter,
  exif_focal_length,
  tags_json,
  search_content,
  dominant_color,
  color_palette_json,
  composition,
  ai_status,
  tg_status,
  is_public,
  location_public,
  folder_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const SELECT_SQL =
  `SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE key = ?`;

const SELECT_BY_HASH_SQL =
  `SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE hash = ? LIMIT 1`;

interface UploadMeta {
  title: string;
  caption: string | null;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  location_region: 'china' | 'global' | null;
  tags_json: string | null;
  search_content: string | null;
  dominant_color: string | null;
  color_palette_json: string | null;
  composition: string | null;
  ai_status: 'pending' | 'done' | 'failed';
  is_public: 0 | 1;
  location_public: 0 | 1;
  folder_id: string | null;
}

interface UploadExif {
  taken_at: string | null;
  camera: string | null;
  iso: number | null;
  aperture: number | null;
  shutter: string | null;
  focal_length: number | null;
}

interface UploadDimensions {
  width: number;
  height: number;
}

const fileFromForm = (formData: FormData, name: string): File | null => {
  const value = formData.get(name);
  return value && typeof value !== 'string' ? value : null;
};

const hashFromForm = (formData: FormData): string | null => {
  const value = formData.get('hash');
  if (typeof value !== 'string') return null;
  const hash = value.trim();
  return SHA256_HEX_PATTERN.test(hash) ? hash.toLowerCase() : null;
};

const objectFromJsonField = (formData: FormData, name: string): Record<string, unknown> | null => {
  const value = formData.get(name);
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const normalizeAiStatus = (value: unknown): UploadMeta['ai_status'] => {
  if (value === 'done' || value === 'failed' || value === 'pending') return value;
  return 'pending';
};

const normalizeMeta = (raw: Record<string, unknown>): UploadMeta => {
  const location_lat = coordinateOrNull(raw.location_lat, -90, 90);
  const location_lng = coordinateOrNull(raw.location_lng, -180, 180);
  return {
    title: stringOrEmpty(raw.title),
    caption: stringOrNull(raw.caption),
    location_name: stringOrNull(raw.location_name),
    location_lat,
    location_lng,
    location_region: normalizeRegion(raw.location_region, location_lat, location_lng),
    tags_json: normalizeTagsJson(raw.tags),
    search_content: stringOrNull(raw.search_content),
    dominant_color: stringOrNull(raw.dominant_color),
    color_palette_json: normalizeColorPaletteJson(raw.palette),
    composition: stringOrNull(raw.composition),
    ai_status: normalizeAiStatus(raw.ai_status),
    is_public: flagOrDefault(raw.is_public, 1),
    location_public: flagOrDefault(raw.location_public, 1),
    folder_id: stringOrNull(raw.folder_id),
  };
};

const normalizeExif = (raw: Record<string, unknown>): UploadExif => ({
  taken_at: stringOrNull(raw.taken_at),
  camera: stringOrNull(raw.camera),
  iso: integerOrNull(raw.iso),
  aperture: numberOrNull(raw.aperture),
  shutter: stringOrNull(raw.shutter),
  focal_length: numberOrNull(raw.focal_length),
});

const normalizeDimensions = (raw: Record<string, unknown>): UploadDimensions | null => {
  const width = integerOrNull(raw.width);
  const height = integerOrNull(raw.height);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return { width, height };
};

const deferTask = (task: () => Promise<void>): Promise<void> =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      task().then(resolve, reject);
    }, 0);
  });

export const handleUploadPost = async (
  context: EventContext<Env, string, Record<string, unknown>>,
  logger: RequestLogger,
): Promise<Response> => {
  const { request, env } = context;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest('invalid_form_data');
  }

  const original = fileFromForm(formData, 'original');
  const compressed = fileFromForm(formData, 'compressed');
  const hash = hashFromForm(formData);
  const rawExif = objectFromJsonField(formData, 'exif');
  const rawMeta = objectFromJsonField(formData, 'meta');
  const rawDimensions = objectFromJsonField(formData, 'dimensions');

  const telegramInboxIdValue = formData.get('telegram_inbox_id');
  const telegramInboxId = typeof telegramInboxIdValue === 'string' ? telegramInboxIdValue.trim() : '';

  if (!original || !compressed || !hash || !rawExif || !rawMeta || !rawDimensions) {
    return badRequest('missing_upload_fields');
  }
  if (!original.type.startsWith('image/')) return badRequest('invalid_original_mime');
  if (original.size > MAX_ORIGINAL_BYTES) return badRequest('original_too_large');
  if (compressed.type !== 'image/webp') return badRequest('invalid_compressed_mime');

  const dimensions = normalizeDimensions(rawDimensions);
  if (!dimensions) return badRequest('invalid_dimensions');

  const meta = normalizeMeta(rawMeta);
  const exif = normalizeExif(rawExif);
  const key = createImageKey();
  const originalFilename = original.name.trim() || key;

  if (meta.folder_id) {
    const folderRow = await env.DB
      .prepare('SELECT id FROM folders WHERE id = ?')
      .bind(meta.folder_id)
      .first<{ id: string }>();
    if (!folderRow) return badRequest('folder_not_found');
  }

  let r2ObjectWritten = false;
  let d1ImageInserted = false;
  interface TelegramInboxRow {
    id: string;
    r2_key: string;
    tg_file_id: string;
    tg_message_id: number;
    tg_chat_id: string;
    original_filename: string;
  }
  let telegramInbox: TelegramInboxRow | null = null;

  try {
    const existing = await env.DB.prepare(SELECT_BY_HASH_SQL).bind(hash).first<ImageRow>();
    if (existing) {
      if (telegramInboxId) {
        const staged = await env.DB.prepare("SELECT id,r2_key FROM telegram_inbox WHERE id = ? AND status = 'pending'").bind(telegramInboxId).first<{ id: string; r2_key: string }>();
        if (staged) {
          await env.BUCKET.delete(staged.r2_key);
          await env.DB.prepare('DELETE FROM telegram_inbox WHERE id = ?').bind(staged.id).run();
        }
      }
      return json(rowToRecord(existing, env.PUBLIC_BASE_URL), 200);
    }

    if (telegramInboxId) {
      telegramInbox = await env.DB.prepare("SELECT id,r2_key,tg_file_id,tg_message_id,tg_chat_id,original_filename FROM telegram_inbox WHERE id = ? AND status = 'pending' AND hash = ?").bind(telegramInboxId, hash).first<TelegramInboxRow>();
      if (!telegramInbox) return badRequest('telegram_inbox_not_found_or_hash_mismatch');
    }

    const staticMapReferer = staticMapRefererFromRequest(request);

    await env.BUCKET.put(key, compressed, {
      httpMetadata: {
        contentType: compressed.type,
      },
    });
    r2ObjectWritten = true;

    await env.DB.prepare(INSERT_SQL)
      .bind(
        key,
        meta.title,
        meta.caption,
        originalFilename,
        dimensions.width,
        dimensions.height,
        'webp',
        compressed.size,
        hash,
        meta.location_name,
        meta.location_lat,
        meta.location_lng,
        meta.location_region,
        exif.taken_at,
        exif.camera,
        exif.iso,
        exif.aperture,
        exif.shutter,
        exif.focal_length,
        meta.tags_json,
        meta.search_content,
        meta.dominant_color,
        meta.color_palette_json,
        meta.composition,
        meta.ai_status,
        'pending',
        meta.is_public,
        meta.location_public,
        meta.folder_id,
      )
      .run();
    d1ImageInserted = true;

    if (telegramInbox) {
      await env.DB.prepare(`UPDATE images SET tg_file_id=?,tg_message_id=?,tg_chat_id=?,tg_status='done',tg_error=NULL,updated_at=datetime('now') WHERE key=?`)
        .bind(telegramInbox.tg_file_id, telegramInbox.tg_message_id, telegramInbox.tg_chat_id, key)
        .run();
    }

    const staticMapTask = createStaticMapCacheTask(
      env,
      meta.location_lat,
      meta.location_lng,
      meta.location_region,
      logger,
      staticMapReferer,
    );
    if (staticMapTask) await staticMapTask;

    if (telegramInbox) {
      await env.BUCKET.delete(telegramInbox.r2_key);
      await env.DB.prepare('DELETE FROM telegram_inbox WHERE id = ?').bind(telegramInbox.id).run();
    } else {
      if (typeof context.waitUntil === 'function') {
        context.waitUntil(deferTask(() => archiveOriginalAfterUpload(env, original, key, logger)));
      } else {
        await archiveOriginalAfterUpload(env, original, key, logger);
      }
    }

    const row = await env.DB.prepare(SELECT_SQL).bind(key).first<ImageRow>();
    if (!row) return serverError('upload_row_missing');

    return json(rowToRecord(row, env.PUBLIC_BASE_URL), 201);
  } catch (error) {
    if (r2ObjectWritten && !d1ImageInserted) {
      try {
        await env.BUCKET.delete(key);
      } catch (cleanupError) {
        logger.error('R2 cleanup failed', {
          error: cleanupError,
          context: { key },
        });
      }
    }
    logger.error('POST /api/admin/upload failed', {
      error,
      context: {
        key,
        r2ObjectWritten,
        d1ImageInserted,
      },
    });
    return serverError('upload_failed');
  }
};
