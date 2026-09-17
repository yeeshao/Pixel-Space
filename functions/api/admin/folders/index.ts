import type { Env } from '../../../types';
import { resolveAdmin } from '../../../_shared/auth';
import { badRequest, json, serverError, unauthorized } from '../../../_shared/http';
import { LIST_FOLDERS_SQL, normalizeParentId, sanitizeFolderName, type FolderRecord } from '../../../_shared/folders';
import { withRequestLogging } from '../../../_shared/logger';
import { parseJsonObject } from '../../../_shared/request';
import { requireSameOrigin } from '../../../_shared/security';

interface CreatePayload {
  name: string;
  parent_id: string | null;
  is_public: 0 | 1;
}

const parseCreatePayload = async (request: Request): Promise<CreatePayload | null> => {
  const raw = await parseJsonObject(request);
  if (!raw) return null;
  const name = sanitizeFolderName(raw.name);
  if (!name) return null;
  const parentId = normalizeParentId(raw.parent_id);
  if (parentId === undefined) return null;
  const isPublic = raw.is_public === undefined ? 1 : (raw.is_public === 0 ? 0 : 1);
  return { name, parent_id: parentId, is_public: isPublic };
};

const cryptoUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('crypto.randomUUID is unavailable');
};

export const onRequestPost: PagesFunction<Env> = withRequestLogging('/api/admin/folders', async ({ request, env }, logger) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!(await resolveAdmin(request, env))) return unauthorized();

  const payload = await parseCreatePayload(request);
  if (!payload) return badRequest('invalid_folder_payload');

  // parent_id 不为 null 时要验证目标父目录存在，避免悬空引用。
  if (payload.parent_id !== null) {
    const parent = await env.DB
      .prepare('SELECT id FROM folders WHERE id = ?')
      .bind(payload.parent_id)
      .first<{ id: string }>();
    if (!parent) return badRequest('parent_not_found');
  }

  const id = cryptoUUID();
  try {
    await env.DB
      .prepare('INSERT INTO folders (id, parent_id, name, is_public) VALUES (?, ?, ?, ?)')
      .bind(id, payload.parent_id, payload.name, payload.is_public)
      .run();
  } catch (error) {
    const message = (error as Error).message ?? '';
    // SQLite UNIQUE 冲突在 D1 上返回的 message 包含 UNIQUE 关键字。
    if (message.includes('UNIQUE')) return badRequest('name_conflict');
    logger.error('POST /api/admin/folders failed', {
      error,
      context: {
        id,
        parentId: payload.parent_id,
      },
    });
    return serverError('folder_create_failed');
  }

  return json({
    id,
    parent_id: payload.parent_id,
    name: payload.name,
    is_public: payload.is_public,
    image_count: 0,
    child_count: 0,
  }, 201);
});

export const onRequestGet: PagesFunction<Env> = withRequestLogging('/api/admin/folders', async ({ env, request }, logger) => {
  if (!(await resolveAdmin(request, env))) return unauthorized();

  try {
    const result = await env.DB.prepare(LIST_FOLDERS_SQL).all<FolderRecord>();
    const folders = result.results ?? [];

    // 兼容 D1：不在 SQL 中做递归 CTE，避免部分 SQLite/D1 环境递归查询失败。
    // 在 Worker 内存中递归汇总当前目录及所有子目录图片数量。
    const children = new Map<string, FolderRecord[]>();
    for (const folder of folders) {
      if (folder.parent_id) {
        const list = children.get(folder.parent_id) ?? [];
        list.push(folder);
        children.set(folder.parent_id, list);
      }
    }

    const memo = new Map<string, number>();
    const countImages = (folder: FolderRecord): number => {
      const cached = memo.get(folder.id);
      if (cached !== undefined) return cached;
      let total = Number(folder.image_count ?? 0);
      for (const child of children.get(folder.id) ?? []) {
        total += countImages(child);
      }
      memo.set(folder.id, total);
      return total;
    };

    return json({
      folders: folders.map((folder) => ({
        ...folder,
        image_count: countImages(folder),
      })),
    });
  } catch (error) {
    logger.error('GET /api/admin/folders failed', { error });
    return serverError('folders_list_failed');
  }
});
