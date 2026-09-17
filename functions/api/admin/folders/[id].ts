import type { Env } from '../../../types';
import { resolveAdmin } from '../../../_shared/auth';
import { badRequest, json, notFound, serverError, unauthorized } from '../../../_shared/http';
import {
  collectDescendantIds,
  normalizeParentId,
  sanitizeFolderName,
} from '../../../_shared/folders';
import { withRequestLogging } from '../../../_shared/logger';
import { parseJsonObject } from '../../../_shared/request';
import { requireSameOrigin } from '../../../_shared/security';

interface PatchPayload {
  name?: string;
  parent_id?: string | null;
  is_public?: 0 | 1;
}

const parsePatchPayload = async (request: Request): Promise<PatchPayload | null> => {
  const raw = await parseJsonObject(request);
  if (!raw) return null;

  const payload: PatchPayload = {};

  if ('name' in raw) {
    const name = sanitizeFolderName(raw.name);
    if (!name) return null;
    payload.name = name;
  }

  if ('is_public' in raw) {
    if (raw.is_public !== 0 && raw.is_public !== 1) return null;
    payload.is_public = raw.is_public as 0 | 1;
  }

  if ('parent_id' in raw) {
    const parentId = normalizeParentId(raw.parent_id);
    if (parentId === undefined) return null;
    payload.parent_id = parentId;
  }

  if (payload.name === undefined && payload.parent_id === undefined && payload.is_public === undefined) return null;
  return payload;
};

const keyFromParams = (params: EventContext<Env, string, unknown>['params']): string =>
  String(params.id ?? '');

export const onRequestPatch: PagesFunction<Env> = withRequestLogging('/api/admin/folders/:id', async ({ request, env, params }, logger) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();

  const id = keyFromParams(params);
  if (!id) return notFound();

  const payload = await parsePatchPayload(request);
  if (!payload) return badRequest('invalid_folder_payload');

  const current = await env.DB
    .prepare('SELECT id, parent_id, name, is_public FROM folders WHERE id = ?')
    .bind(id)
    .first<{ id: string; parent_id: string | null; name: string; is_public: number }>();
  if (!current) return notFound();

  if (payload.parent_id !== undefined && payload.parent_id !== null) {
    if (payload.parent_id === id) return badRequest('parent_cycle');
    // 检查目标父目录是否落在当前目录的子树内（防止把目录移到自己后代下）。
    const descendants = await collectDescendantIds(env.DB, id);
    if (descendants.has(payload.parent_id)) return badRequest('parent_cycle');
    const parent = await env.DB
      .prepare('SELECT id FROM folders WHERE id = ?')
      .bind(payload.parent_id)
      .first<{ id: string }>();
    if (!parent) return badRequest('parent_not_found');
  }

  const nextName = payload.name ?? current.name;
  const nextParent = payload.parent_id !== undefined ? payload.parent_id : current.parent_id;
  const nextPublic = payload.is_public !== undefined ? payload.is_public : current.is_public;

  try {
    await env.DB
      .prepare("UPDATE folders SET name = ?, parent_id = ?, is_public = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(nextName, nextParent, nextPublic, id)
      .run();
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (message.includes('UNIQUE')) return badRequest('name_conflict');
    logger.error('PATCH /api/admin/folders/:id failed', {
      error,
      context: {
        id,
        parentId: nextParent,
        isPublic: nextPublic,
      },
    });
    return serverError('folder_update_failed');
  }

  return json({ id, parent_id: nextParent, name: nextName, is_public: nextPublic, image_count: 0, child_count: 0 });
});

export const onRequestDelete: PagesFunction<Env> = withRequestLogging('/api/admin/folders/:id', async ({ request, env, params }, logger) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();

  const id = keyFromParams(params);
  if (!id) return notFound();

  const current = await env.DB
    .prepare('SELECT id FROM folders WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!current) return notFound();

  // 非空目录直接 400，让前端把空目录这个前置条件做掉。
  const childFolder = await env.DB
    .prepare('SELECT id FROM folders WHERE parent_id = ? LIMIT 1')
    .bind(id)
    .first<{ id: string }>();
  if (childFolder) return badRequest('not_empty');

  const childImage = await env.DB
    .prepare('SELECT key FROM images WHERE folder_id = ? LIMIT 1')
    .bind(id)
    .first<{ key: string }>();
  if (childImage) return badRequest('not_empty');

  try {
    await env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(id).run();
    return json({ ok: true, id });
  } catch (error) {
    logger.error('DELETE /api/admin/folders/:id failed', {
      error,
      context: { id },
    });
    return serverError('folder_delete_failed');
  }
});
