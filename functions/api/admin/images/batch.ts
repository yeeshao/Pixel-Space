import type { Env } from '../../../types';
import { analyzeImageWithAi } from '../../../_shared/ai';
import { resolveAdmin } from '../../../_shared/auth';
import { json, badRequest, serverError, unauthorized } from '../../../_shared/http';
import { IMAGE_SELECT_COLUMNS, type ImageRow, rowToAdminRecord } from '../../../_shared/images';
import { parseJsonObject, normalizeStringList, optionalCoordinate, stringOrNull } from '../../../_shared/request';
import { requireSameOrigin } from '../../../_shared/security';
import { withRequestLogging } from '../../../_shared/logger';

const MAX_LOCATION_BATCH = 200;
const MAX_VISIBILITY_BATCH = 200;
const MAX_AI_BATCH = 1;
// D1/SQLite 对一次 SQL bind 数量有限制，批量照片操作需要分批处理
const LOCATION_CHUNK_SIZE = 50;
const VISIBILITY_CHUNK_SIZE = 50;

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/admin/images/batch', async ({ request, env }, logger) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();
  const raw = await parseJsonObject(request);
  if (!raw) return badRequest('invalid_batch_payload');
  const action = raw.action === 'location' || raw.action === 'visibility' || raw.action === 'ai' ? raw.action : null;
  const maxKeys = action === 'ai' ? MAX_AI_BATCH : action === 'visibility' ? MAX_VISIBILITY_BATCH : MAX_LOCATION_BATCH;
  const keys = normalizeStringList(raw.keys, { min: 1, max: maxKeys });
  if (!action || !keys) return badRequest('invalid_batch_payload');

  try {
    if (action === 'location') {
      const lat = optionalCoordinate(raw.location_lat, -90, 90);
      const lng = optionalCoordinate(raw.location_lng, -180, 180);
      if (lat === undefined || lng === undefined) return badRequest('invalid_location_payload');
      const name = stringOrNull(raw.location_name);
      const region = raw.location_region === 'china' || raw.location_region === 'global' ? raw.location_region : null;
      const updatedRows: ImageRow[] = [];
      for (let i = 0; i < keys.length; i += LOCATION_CHUNK_SIZE) {
        const chunk = keys.slice(i, i + LOCATION_CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        await env.DB.prepare(`UPDATE images SET location_name=?, location_lat=?, location_lng=?, location_region=?, updated_at=datetime('now') WHERE key IN (${placeholders})`)
          .bind(name, lat, lng, region, ...chunk)
          .run();
        const rows = await env.DB.prepare(`SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE key IN (${placeholders})`)
          .bind(...chunk)
          .all<ImageRow>();
        updatedRows.push(...(rows.results ?? []));
      }
      return json({ ok: true, action, processed: updatedRows.length, items: updatedRows.map(rowToAdminRecord) });
    }

    if (action === 'visibility') {
      const isPublic = raw.is_public === 0 || raw.is_public === 1 ? raw.is_public : null;
      if (isPublic === null) return badRequest('invalid_visibility_payload');
      const updatedRows: ImageRow[] = [];
      for (let i = 0; i < keys.length; i += VISIBILITY_CHUNK_SIZE) {
        const chunk = keys.slice(i, i + VISIBILITY_CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        await env.DB.prepare(
          `UPDATE images SET is_public=?, updated_at=datetime('now') WHERE key IN (${placeholders})`,
        ).bind(isPublic, ...chunk).run();
        const rows = await env.DB.prepare(`SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE key IN (${placeholders})`)
          .bind(...chunk)
          .all<ImageRow>();
        updatedRows.push(...(rows.results ?? []));
      }
      return json({
        ok: true,
        action,
        processed: updatedRows.length,
        items: updatedRows.map(rowToAdminRecord),
      });
    }

    const updated: ImageRow[] = [];
    const failed: string[] = [];
    for (const key of keys) {
      const row = await env.DB.prepare(`SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE key = ?`).bind(key).first<ImageRow>();
      if (!row) {
        failed.push(key);
        continue;
      }

      await env.DB.prepare("UPDATE images SET ai_status='pending', updated_at=datetime('now') WHERE key=?").bind(key).run();
      const object = await env.BUCKET.get(key);
      if (!object) {
        failed.push(key);
        await env.DB.prepare("UPDATE images SET ai_status='failed', updated_at=datetime('now') WHERE key=?").bind(key).run();
        continue;
      }

      try {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        const mime = headers.get('content-type') || (row.format === 'webp' ? 'image/webp' : `image/${row.format}`);
        const result = await analyzeImageWithAi({
          env,
          image: new File([await object.arrayBuffer()], row.original_filename || key, { type: mime }),
        });
        await env.DB.prepare("UPDATE images SET title=?,caption=?,tags_json=?,search_content=?,dominant_color=?,color_palette_json=?,composition=?,ai_status='done',updated_at=datetime('now') WHERE key=?")
          .bind(
            result.title,
            result.caption || null,
            result.tags.length ? JSON.stringify(result.tags) : null,
            result.search_content || null,
            result.dominant_color || null,
            result.palette.length ? JSON.stringify(result.palette) : null,
            result.composition || null,
            key,
          )
          .run();
        const fresh = await env.DB.prepare(`SELECT ${IMAGE_SELECT_COLUMNS} FROM images WHERE key = ?`).bind(key).first<ImageRow>();
        if (fresh) updated.push(fresh);
        else failed.push(key);
      } catch (error) {
        logger.error('Batch AI analysis failed', { error, context: { key } });
        failed.push(key);
        await env.DB.prepare("UPDATE images SET ai_status='failed', updated_at=datetime('now') WHERE key=?").bind(key).run();
      }
    }
    return json({ ok: true, action, processed: updated.length, failed, items: updated.map(rowToAdminRecord) });
  } catch (error) {
    logger.error('POST /api/admin/images/batch failed', { error, context: { action, keyCount: keys.length } });
    return serverError('images_batch_failed');
  }
});

