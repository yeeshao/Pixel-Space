export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
  is_public: number;
}

export interface FolderRecord extends FolderRow {
  image_count: number;
  child_count: number;
}

// SQL：递归统计文件夹自身及所有子目录图片数量。
export const LIST_FOLDERS_SQL = `
WITH RECURSIVE
descendants(root_id, id) AS (
  SELECT id, id
  FROM folders
  UNION
  SELECT d.root_id, f.id
  FROM descendants d
  JOIN folders f ON f.parent_id = d.id
),
image_counts AS (
  SELECT d.root_id AS folder_id, COUNT(i.id) AS image_count
  FROM descendants d
  LEFT JOIN images i ON i.folder_id = d.id
  GROUP BY d.root_id
),
child_counts AS (
  SELECT parent_id, COUNT(*) AS child_count
  FROM folders
  WHERE parent_id IS NOT NULL
  GROUP BY parent_id
)
SELECT
  f.id,
  f.parent_id,
  f.name,
  f.created_at,
  f.updated_at,
  f.is_public,
  COALESCE(image_counts.image_count, 0) AS image_count,
  COALESCE(child_counts.child_count, 0) AS child_count
FROM folders f
LEFT JOIN image_counts ON image_counts.folder_id = f.id
LEFT JOIN child_counts ON child_counts.parent_id = f.id
ORDER BY f.parent_id, f.name COLLATE NOCASE
`;

// 公开探索页只展示至少包含一张公开图片的目录分支。
// 父目录自己没有图片、但后代目录有公开图片时仍保留，避免子目录在树里失去入口。
export const LIST_PUBLIC_FOLDERS_SQL = `
WITH RECURSIVE
public_image_folders(id) AS (
  SELECT DISTINCT i.folder_id AS id
  FROM images i
  WHERE i.folder_id IS NOT NULL
    AND i.is_public = 1
),
visible_folders(id) AS (
  SELECT f.id
  FROM folders f
  JOIN public_image_folders pif ON pif.id = f.id
  WHERE f.is_public = 1
  UNION
  SELECT parent.id
  FROM folders parent
  JOIN (SELECT id, parent_id FROM folders WHERE is_public = 1) child ON child.parent_id = parent.id
  JOIN visible_folders vf ON vf.id = child.id
  WHERE parent.is_public = 1
),
descendants(root_id, id) AS (
  SELECT id, id
  FROM folders
  WHERE id IN (SELECT id FROM visible_folders)
  UNION
  SELECT d.root_id, f.id
  FROM descendants d
  JOIN folders f ON f.parent_id = d.id
  WHERE f.is_public = 1
),
image_counts AS (
  SELECT d.root_id AS folder_id, COUNT(i.id) AS image_count
  FROM descendants d
  LEFT JOIN images i ON i.folder_id = d.id AND i.is_public = 1
  GROUP BY d.root_id
),
child_counts AS (
  SELECT f.parent_id, COUNT(*) AS child_count
  FROM folders f
  WHERE f.parent_id IS NOT NULL
    AND f.is_public = 1
    AND f.id IN (SELECT id FROM visible_folders)
  GROUP BY f.parent_id
)
SELECT
  f.id,
  f.parent_id,
  f.name,
  f.created_at,
  f.updated_at,
  f.is_public,
  COALESCE(image_counts.image_count, 0) AS image_count,
  COALESCE(child_counts.child_count, 0) AS child_count
FROM folders f
JOIN visible_folders vf ON vf.id = f.id
LEFT JOIN image_counts ON image_counts.folder_id = f.id
LEFT JOIN child_counts ON child_counts.parent_id = f.id
ORDER BY f.parent_id, f.name COLLATE NOCASE
`;

// 名字规则：长度 1..64，禁用控制字符与 /\ 让前端路径展示不至于歧义。
const NAME_MIN = 1;
const NAME_MAX = 64;
const NAME_FORBIDDEN = /[\\/\x00-\x1f]/;

export const sanitizeFolderName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) return null;
  if (NAME_FORBIDDEN.test(trimmed)) return null;
  return trimmed;
};

// parent_id 输入可能是 null/undefined/空字符串/字符串，前两者统一为 null（表示「在根下」）。
export const normalizeParentId = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function isFolderPublic(db: D1Database, folderId: string | null): Promise<boolean> {
  if (!folderId) return true;
  const row = await db.prepare(`
    WITH RECURSIVE ancestors(id, parent_id, is_public) AS (
      SELECT id, parent_id, is_public FROM folders WHERE id = ?
      UNION ALL
      SELECT f.id, f.parent_id, f.is_public
      FROM folders f
      JOIN ancestors a ON f.id = a.parent_id
    )
    SELECT 1 AS ok FROM ancestors WHERE is_public != 1 LIMIT 1
  `).bind(folderId).first<{ ok: number }>();
  return !row;
}

// 给一个文件夹 id，返回它的全部后代 id（含自身）。用于校验「不能把目录移到自己子树里」。
export async function collectDescendantIds(db: D1Database, rootId: string): Promise<Set<string>> {
  const visited = new Set<string>([rootId]);
  let frontier: string[] = [rootId];
  while (frontier.length > 0) {
    const placeholders = frontier.map(() => '?').join(',');
    const result = await db
      .prepare(`SELECT id FROM folders WHERE parent_id IN (${placeholders})`)
      .bind(...frontier)
      .all<{ id: string }>();
    const next: string[] = [];
    for (const row of result.results ?? []) {
      if (!visited.has(row.id)) {
        visited.add(row.id);
        next.push(row.id);
      }
    }
    frontier = next;
  }
  return visited;
}
