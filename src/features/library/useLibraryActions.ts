import { reactive, ref, type Ref } from 'vue';

import type { ImageRecord } from '@/features/images/image.types';
import { listAdminImages } from '@/features/images/images.api';
import { buildDownloadGrantExpiry } from './download-grant-expiry';
import {
  createDownloadGrant,
  createFolder,
  deleteDownloadGrant,
  deleteFolder,
  deleteImages,
  fetchAdminFolders,
  fetchAiSettings,
  fetchDownloadGrants,
  moveImages,
  batchAnalyzeAi,
  batchUpdateLocation,
  batchUpdateVisibility,
  updateAiSettings,
  updateDownloadGrant,
  updateFolder,
  type AiSettings,
  type CreateDownloadGrantResponse,
  type DownloadGrantRecord,
  type FolderRecord,
} from './library.api';
import { isVirtualId, type FolderOption } from './useLibraryDirectory';

interface UseLibraryActionsOptions {
  folders: Ref<FolderRecord[]>;
  images: Ref<ImageRecord[]>;
  downloadGrants: Ref<DownloadGrantRecord[]>;
  currentFolderId: Ref<string | null>;
  currentFolder: Readonly<Ref<FolderRecord | null>>;
  currentReadonly: Readonly<Ref<boolean>>;
  currentImages: Readonly<Ref<ImageRecord[]>>;
  folderOptions: Readonly<Ref<FolderOption[]>>;
}

export const useLibraryActions = ({
  folders,
  images,
  downloadGrants,
  currentFolderId,
  currentFolder,
  currentReadonly,
  currentImages,
  folderOptions,
}: UseLibraryActionsOptions) => {
  const loading = ref(true);
  const loadError = ref<string | null>(null);
  const actionMessage = ref<string | null>(null);
  const grantDialogOpen = ref(false);
  const grantCreating = ref(false);
  const grantResult = ref<CreateDownloadGrantResponse | null>(null);
  const grantError = ref<string | null>(null);
  const grantManagingId = ref<string | null>(null);
  const grantManagerError = ref<string | null>(null);
  const aiSettingsForm = reactive<AiSettings>({
    proxy_url: '',
    model: '',
    prompt: '',
  });
  const aiSettingsSaving = ref(false);

  const selectedKeys = ref<Set<string>>(new Set());
  const moveTarget = ref<string>('__none__');

  const updateFolderImageCount = (folderId: string | null, delta: number) => {
    if (!folderId) return;
    folders.value = folders.value.map((folder) =>
      folder.id === folderId ? { ...folder, image_count: Math.max(0, folder.image_count + delta) } : folder,
    );
  };

  const refreshAll = async () => {
    loading.value = true;
    loadError.value = null;
    try {
      const [folderList, imageList, aiSettings, grantList] = await Promise.all([
        fetchAdminFolders(),
        listAdminImages(),
        fetchAiSettings(),
        fetchDownloadGrants(),
      ]);
      folders.value = folderList;
      images.value = imageList;
      downloadGrants.value = grantList;
      aiSettingsForm.proxy_url = aiSettings.proxy_url;
      aiSettingsForm.model = aiSettings.model;
      aiSettingsForm.prompt = aiSettings.prompt;
    } catch (error) {
      loadError.value = (error as Error).message;
    } finally {
      loading.value = false;
    }
  };

  const enterFolder = (id: string | null) => {
    currentFolderId.value = id;
    selectedKeys.value = new Set();
    actionMessage.value = null;
    grantManagerError.value = null;
  };

  const toggleSelection = (key: string) => {
    if (currentReadonly.value) return;
    const next = new Set(selectedKeys.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selectedKeys.value = next;
  };

  const selectKey = (key: string) => {
    if (currentReadonly.value || selectedKeys.value.has(key)) return;
    selectedKeys.value = new Set([...selectedKeys.value, key]);
  };

  const selectAllCurrent = () => {
    if (currentReadonly.value) return;
    selectedKeys.value = new Set(currentImages.value.map((img) => img.key));
  };

  const clearSelection = () => {
    selectedKeys.value = new Set();
  };

  const clearGrantResult = () => {
    grantResult.value = null;
    grantError.value = null;
  };

  const handleCreateDownloadGrant = async (expiresAt: string) => {
    if (selectedKeys.value.size === 0) return;
    grantCreating.value = true;
    grantError.value = null;
    try {
      grantResult.value = await createDownloadGrant({
        keys: Array.from(selectedKeys.value),
        expires_at: expiresAt,
      });
      downloadGrants.value = await fetchDownloadGrants();
      actionMessage.value = `已生成 ${grantResult.value.image_count} 张图片的验证码`;
    } catch (error) {
      grantError.value = (error as Error).message;
    } finally {
      grantCreating.value = false;
    }
  };

  const replaceDownloadGrant = (id: string, patch: Partial<DownloadGrantRecord>) => {
    downloadGrants.value = downloadGrants.value.map((grant) => (grant.id === id ? { ...grant, ...patch } : grant));
  };

  const removeDownloadGrant = (id: string) => {
    downloadGrants.value = downloadGrants.value.filter((grant) => grant.id !== id);
  };

  const handleUpdateDownloadGrant = async (id: string, expiresAtValue: string) => {
    const expiresAt = buildDownloadGrantExpiry('custom', expiresAtValue);
    if (!expiresAt) {
      grantManagerError.value = '请选择未来的有效期';
      return;
    }

    grantManagingId.value = id;
    grantManagerError.value = null;
    try {
      const updated = await updateDownloadGrant(id, { expires_at: expiresAt });
      replaceDownloadGrant(id, { expires_at: updated.expires_at });
      actionMessage.value = '验证码有效期已更新';
    } catch (error) {
      grantManagerError.value = `更新失败：${(error as Error).message}`;
    } finally {
      grantManagingId.value = null;
    }
  };

  const handleDeleteDownloadGrant = async (id: string) => {
    const grant = downloadGrants.value.find((item) => item.id === id);
    const label = grant?.code ?? '这个验证码';
    if (!window.confirm(`确定删除验证码「${label}」？授权入口会立即失效。`)) return;

    grantManagingId.value = id;
    grantManagerError.value = null;
    try {
      await deleteDownloadGrant(id);
      removeDownloadGrant(id);
      actionMessage.value = '验证码已删除';
    } catch (error) {
      grantManagerError.value = `删除失败：${(error as Error).message}`;
    } finally {
      grantManagingId.value = null;
    }
  };

  const handleCreateFolder = async () => {
    const name = window.prompt('新建子文件夹，输入名称')?.trim();
    if (!name) return;
    try {
      const created = await createFolder({ name, parent_id: currentFolderId.value });
      folders.value = [...folders.value, created];
      actionMessage.value = `已新建 ${name}`;
    } catch (error) {
      const message = (error as Error).message;
      actionMessage.value = message.includes('name_conflict') ? '同级目录里已经有同名文件夹' : `新建失败：${message}`;
    }
  };

  const handleToggleFolderVisibility = async (folder: FolderRecord) => {
    const next: 0 | 1 = folder.is_public === 0 ? 1 : 0;
    try {
      const updated = await updateFolder(folder.id, { is_public: next });
      folders.value = folders.value.map((item) => (item.id === folder.id ? { ...item, ...updated } : item));
      actionMessage.value = next === 1 ? `文件夹「${folder.name}」已设为公开` : `文件夹「${folder.name}」已设为私有`;
    } catch (error) {
      actionMessage.value = `文件夹权限修改失败：${(error as Error).message}`;
    }
  };

  const handleRenameFolder = async (folder: FolderRecord) => {
    const next = window.prompt('重命名文件夹', folder.name)?.trim();
    if (!next || next === folder.name) return;
    try {
      const updated = await updateFolder(folder.id, { name: next });
      folders.value = folders.value.map((item) =>
        item.id === folder.id ? { ...item, name: updated.name, updated_at: updated.updated_at ?? item.updated_at } : item,
      );
      actionMessage.value = `已重命名「${folder.name}」为「${next}」`;
    } catch (error) {
      const message = (error as Error).message;
      actionMessage.value = message.includes('name_conflict') ? '同级目录里已经有同名文件夹' : `重命名失败：${message}`;
    }
  };

  const handleMoveFolder = async (folder: FolderRecord, targetId: string | null) => {
    if (targetId === folder.id) {
      actionMessage.value = '不能把文件夹移动到自己里面';
      return;
    }

    // 本地先检查目标是否属于当前目录的后代，避免无意义请求；后端仍会再次校验。
    const descendants = new Set<string>();
    let frontier = [folder.id];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const item of folders.value) {
        if (item.parent_id && frontier.includes(item.parent_id) && !descendants.has(item.id)) {
          descendants.add(item.id);
          next.push(item.id);
        }
      }
      frontier = next;
    }
    if (targetId !== null && descendants.has(targetId)) {
      actionMessage.value = '不能把文件夹移动到自己的子文件夹中';
      return;
    }
    if (targetId === folder.parent_id) {
      actionMessage.value = '目标就是当前所在目录';
      return;
    }

    try {
      await updateFolder(folder.id, { parent_id: targetId });
      const targetName = targetId ? folders.value.find((item) => item.id === targetId)?.name ?? '目标文件夹' : '根目录';
      folders.value = folders.value.map((item) =>
        item.id === folder.id ? { ...item, parent_id: targetId, updated_at: new Date().toISOString() } : item,
      );
      await refreshAll();
      actionMessage.value = `已将「${folder.name}」移动到 ${targetName}`;
    } catch (error) {
      const message = (error as Error).message;
      actionMessage.value = message.includes('name_conflict') ? '目标目录里已经有同名文件夹' : `移动文件夹失败：${message}`;
    }
  };

  const handleBatchRenameFolder = async (folder: FolderRecord) => {
    const next = window.prompt('重命名文件夹', folder.name)?.trim();
    if (!next || next === folder.name) return;
    try {
      const updated = await updateFolder(folder.id, { name: next });
      folders.value = folders.value.map((item) => item.id === folder.id ? { ...item, ...updated } : item);
      actionMessage.value = `已重命名「${folder.name}」为「${next}」`;
    } catch (error) {
      const message = (error as Error).message;
      actionMessage.value = message.includes('name_conflict') ? '同级目录里已经有同名文件夹' : `重命名失败：${message}`;
    }
  };

  const handleBatchToggleFolderVisibility = async (selected: FolderRecord[]) => {
    if (!selected.length) return;
    const target: 0 | 1 = selected.every((folder) => folder.is_public !== 0) ? 0 : 1;
    try {
      for (const folder of selected) {
        const updated = await updateFolder(folder.id, { is_public: target });
        folders.value = folders.value.map((item) => item.id === folder.id ? { ...item, ...updated } : item);
      }
      actionMessage.value = `${selected.length} 个文件夹已设为${target === 1 ? '公开' : '私有'}`;
    } catch (error) {
      actionMessage.value = `批量修改文件夹权限失败：${(error as Error).message}`;
      await refreshAll();
    }
  };

  const handleBatchMoveFolders = async (selected: FolderRecord[], targetId: string | null) => {
    if (!selected.length) return;
    const selectedIds = new Set(selected.map((folder) => folder.id));
    const descendants = new Set<string>();
    for (const source of selected) {
      let frontier = [source.id];
      while (frontier.length) {
        const next: string[] = [];
        for (const item of folders.value) {
          if (item.parent_id && frontier.includes(item.parent_id) && !descendants.has(item.id)) {
            descendants.add(item.id);
            next.push(item.id);
          }
        }
        frontier = next;
      }
    }
    if (targetId !== null && (selectedIds.has(targetId) || descendants.has(targetId))) {
      actionMessage.value = '不能移动到所选文件夹自身或其子目录中';
      return;
    }
    try {
      let moved = 0;
      for (const folder of selected) {
        if (folder.parent_id === targetId) continue;
        await updateFolder(folder.id, { parent_id: targetId });
        moved += 1;
      }
      await refreshAll();
      const targetName = targetId ? folders.value.find((item) => item.id === targetId)?.name ?? '目标文件夹' : '根目录';
      actionMessage.value = moved ? `已将 ${moved} 个文件夹移动到 ${targetName}` : '所选文件夹已经位于目标目录';
    } catch (error) {
      actionMessage.value = `批量移动文件夹失败：${(error as Error).message}`;
      await refreshAll();
    }
  };

  const handleBatchDeleteFolders = async (selected: FolderRecord[]) => {
    if (!selected.length) return;
    const blocked = selected.filter((folder) => folder.image_count > 0 || folder.child_count > 0);
    if (blocked.length) {
      actionMessage.value = `有 ${blocked.length} 个文件夹仍包含图片或子目录，无法删除`;
      return;
    }
    if (!window.confirm(`确定删除选中的 ${selected.length} 个空文件夹？此操作不可恢复。`)) return;
    try {
      // 深层目录先删，避免父目录因仍有子目录而暂时无法删除。
      const depthOf = (folder: FolderRecord) => {
        let depth = 0;
        let parentId = folder.parent_id;
        while (parentId) {
          depth += 1;
          parentId = folders.value.find((item) => item.id === parentId)?.parent_id ?? null;
          if (depth > folders.value.length) break;
        }
        return depth;
      };
      const ordered = [...selected].sort((a, b) => depthOf(b) - depthOf(a));
      let deleted = 0;
      for (const folder of ordered) {
        try {
          await deleteFolder(folder.id);
          deleted += 1;
        } catch {
          // 后端仍会做非空/并发校验，失败项保留。
        }
      }
      await refreshAll();
      actionMessage.value = `已删除 ${deleted} 个文件夹${deleted < selected.length ? `，${selected.length - deleted} 个未删除` : ''}`;
    } catch (error) {
      actionMessage.value = `批量删除文件夹失败：${(error as Error).message}`;
      await refreshAll();
    }
  };

  const handleDeleteFolder = async (folder: FolderRecord) => {
    if (folder.image_count > 0 || folder.child_count > 0) {
      actionMessage.value = `「${folder.name}」不为空，请先移走里面的图片和子目录`;
      return;
    }
    if (!window.confirm(`确定删除空文件夹「${folder.name}」？`)) return;
    try {
      await deleteFolder(folder.id);
      folders.value = folders.value.filter((item) => item.id !== folder.id);
      if (currentFolderId.value === folder.id) currentFolderId.value = folder.parent_id;
      actionMessage.value = `已删除「${folder.name}」`;
    } catch (error) {
      const message = (error as Error).message;
      actionMessage.value = message.includes('not_empty')
        ? '当前文件夹不为空，请先移走里面的图片和子目录'
        : `删除文件夹失败：${message}`;
    }
  };

  const handleRenameCurrent = async () => {
    const folder = currentFolder.value;
    if (!folder) return;
    const next = window.prompt('重命名文件夹', folder.name)?.trim();
    if (!next || next === folder.name) return;
    try {
      const updated = await updateFolder(folder.id, { name: next });
      folders.value = folders.value.map((item) => (item.id === folder.id ? { ...item, ...updated } : item));
      actionMessage.value = `已重命名为 ${updated.name}`;
    } catch (error) {
      const message = (error as Error).message;
      actionMessage.value = message.includes('name_conflict') ? '同级目录里已经有同名文件夹' : `重命名失败：${message}`;
    }
  };

  const handleDeleteCurrent = async () => {
    const folder = currentFolder.value;
    if (!folder) return;
    if (folder.image_count > 0 || folder.child_count > 0) {
      actionMessage.value = '当前文件夹不为空，请先移走里面的图片和子目录';
      return;
    }
    if (!window.confirm(`确定删除文件夹「${folder.name}」？`)) return;
    try {
      await deleteFolder(folder.id);
      const parentId = folder.parent_id;
      folders.value = folders.value.filter((item) => item.id !== folder.id);
      currentFolderId.value = parentId;
      actionMessage.value = `已删除 ${folder.name}`;
    } catch (error) {
      const message = (error as Error).message;
      actionMessage.value = message.includes('not_empty')
        ? '当前文件夹不为空，请先移走里面的图片和子目录'
        : `删除失败：${message}`;
    }
  };

  const handleMove = async () => {
    if (selectedKeys.value.size === 0) return;
    const targetId = moveTarget.value === '__none__' ? null : moveTarget.value;
    if (targetId === currentFolderId.value) {
      actionMessage.value = '目标就是当前位置，没必要移动';
      return;
    }
    try {
      const keys = Array.from(selectedKeys.value);
      const previousById = new Map(images.value.map((img) => [img.key, img.folder_id ?? null]));
      await moveImages({ keys, folder_id: targetId });
      images.value = images.value.map((img) =>
        selectedKeys.value.has(img.key) ? { ...img, folder_id: targetId } : img,
      );
      const movedCount = keys.length;
      if (isVirtualId(currentFolderId.value)) {
        for (const key of keys) updateFolderImageCount(previousById.get(key) ?? null, -1);
      } else {
        updateFolderImageCount(currentFolderId.value, -movedCount);
      }
      updateFolderImageCount(targetId, movedCount);
      selectedKeys.value = new Set();
      actionMessage.value = `已移动 ${movedCount} 张到 ${targetId ? folderOptions.value.find((o) => o.id === targetId)?.label ?? '目标文件夹' : '根目录'}`;
    } catch (error) {
      actionMessage.value = `移动失败：${(error as Error).message}`;
    }
  };

  const handleBatchDelete = async () => {
    if (selectedKeys.value.size === 0) return;
    const count = selectedKeys.value.size;
    if (!window.confirm(`确定删除选中的 ${count} 张图片？此操作不可恢复。`)) return;
    try {
      const keys = Array.from(selectedKeys.value);
      const previousById = new Map(images.value.map((img) => [img.key, img.folder_id ?? null]));
      const result = await deleteImages({ keys });
      const deletedSet = new Set(keys.filter((k) => !result.missing.includes(k) && !result.failed.includes(k)));
      images.value = images.value.filter((img) => !deletedSet.has(img.key));
      for (const key of deletedSet) updateFolderImageCount(previousById.get(key) ?? null, -1);
      selectedKeys.value = new Set();
      const failedCount = result.failed.length;
      if (failedCount > 0) {
        const missingSuffix = result.missing.length ? `，${result.missing.length} 张未找到` : '';
        actionMessage.value = `已删除 ${result.deleted} 张，${failedCount} 张清理失败，已保留记录${missingSuffix}`;
      } else {
        actionMessage.value = result.missing.length
          ? `已删除 ${result.deleted} 张，${result.missing.length} 张未找到`
          : `已删除 ${result.deleted} 张`;
      }
    } catch (error) {
      actionMessage.value = `删除失败：${(error as Error).message}`;
    }
  };

  const handleBatchLocation = async (payload: {
    location_name: string | null;
    location_lat: number | null;
    location_lng: number | null;
    location_region: 'china' | 'global' | null;
  }) => {
    if (selectedKeys.value.size === 0) return;
    try {
      const result = await batchUpdateLocation({
        keys: Array.from(selectedKeys.value),
        ...payload,
      });
      images.value = images.value.map((img) => result.items.find((item) => item.key === img.key) ?? img);
      const count = result.processed;
      selectedKeys.value = new Set();
      actionMessage.value = `已批量设置 ${count} 张图片的位置`;
    } catch (error) {
      actionMessage.value = `批量设置位置失败：${(error as Error).message}`;
    }
  };

  const handleToggleImageVisibility = async (image: ImageRecord) => {
    const target: 0 | 1 = Number(image.is_public) !== 0 ? 0 : 1;
    try {
      const result = await batchUpdateVisibility({ keys: [image.key], is_public: target });
      const updated = result.items.find((item) => item.key === image.key);
      if (updated) {
        images.value = images.value.map((img) => (img.key === image.key ? updated : img));
      }
      actionMessage.value = `已将照片设为${target === 1 ? '公开' : '私有'}`;
    } catch (error) {
      actionMessage.value = `修改照片公开状态失败：${(error as Error).message}`;
    }
  };

  const handleBatchVisibility = async () => {
    const keys = Array.from(selectedKeys.value);
    if (!keys.length) return;

    const selected = images.value.filter((img) => selectedKeys.value.has(img.key));
    const target: 0 | 1 =
      selected.length > 0 && selected.every((img) => Number(img.is_public) !== 0) ? 0 : 1;

    try {
      const result = await batchUpdateVisibility({ keys, is_public: target });
      images.value = images.value.map((img) => result.items.find((item) => item.key === img.key) ?? img);
      selectedKeys.value = new Set();
      actionMessage.value = `已将 ${result.processed} 张图片设为${target === 1 ? '公开' : '私有'}`;
    } catch (error) {
      actionMessage.value = `批量修改图片公开状态失败：${(error as Error).message}`;
    }
  };

  const handleBatchAi = async () => {
    const keys = Array.from(selectedKeys.value);
    if (!keys.length) return;

    let processed = 0;
    let failed = 0;
    actionMessage.value = `AI 批量分析：0/${keys.length}`;

    for (const key of keys) {
      try {
        const result = await batchAnalyzeAi([key]);
        const updated = result.items.find((item) => item.key === key);
        if (updated) {
          images.value = images.value.map((img) => (img.key === key ? updated : img));
        }
        if (result.failed.includes(key) || updated?.ai_status === 'failed') {
          failed += 1;
        } else {
          processed += 1;
        }
      } catch (error) {
        failed += 1;
        actionMessage.value = `AI 分析 ${processed + failed}/${keys.length} 失败：${(error as Error).message}`;
      }

      actionMessage.value = failed > 0
        ? `AI 批量分析：${processed + failed}/${keys.length}，成功 ${processed}，失败 ${failed}`
        : `AI 批量分析：${processed}/${keys.length}`;
    }

    if (failed === 0) {
      actionMessage.value = `AI 批量分析完成：成功 ${processed} 张`;
    } else {
      actionMessage.value = `AI 批量分析完成：成功 ${processed} 张，失败 ${failed} 张，请查看图片 AI 状态后重试失败项`;
    }
    selectedKeys.value = new Set();
  };

  const saveAiSettings = async () => {
    aiSettingsSaving.value = true;
    actionMessage.value = null;
    try {
      const saved = await updateAiSettings({
        proxy_url: aiSettingsForm.proxy_url,
        model: aiSettingsForm.model,
        prompt: aiSettingsForm.prompt,
      });
      aiSettingsForm.proxy_url = saved.proxy_url;
      aiSettingsForm.model = saved.model;
      aiSettingsForm.prompt = saved.prompt;
      actionMessage.value = 'AI 配置已保存';
    } catch (error) {
      actionMessage.value = `AI 配置保存失败：${(error as Error).message}`;
    } finally {
      aiSettingsSaving.value = false;
    }
  };

  return {
    loading,
    loadError,
    actionMessage,
    grantDialogOpen,
    grantCreating,
    grantResult,
    grantError,
    grantManagingId,
    grantManagerError,
    aiSettingsForm,
    aiSettingsSaving,
    selectedKeys,
    moveTarget,
    refreshAll,
    enterFolder,
    toggleSelection,
    selectKey,
    selectAllCurrent,
    clearSelection,
    clearGrantResult,
    handleCreateDownloadGrant,
    handleUpdateDownloadGrant,
    handleDeleteDownloadGrant,
    handleCreateFolder,
    handleRenameFolder,
    handleMoveFolder,
    handleDeleteFolder,
    handleBatchRenameFolder,
    handleBatchMoveFolders,
    handleBatchDeleteFolders,
    handleBatchToggleFolderVisibility,
    handleRenameCurrent,
    handleToggleFolderVisibility,
    handleDeleteCurrent,
    handleMove,
    handleBatchDelete,
    handleBatchLocation,
    handleBatchVisibility,
    handleToggleImageVisibility,
    handleBatchAi,
    saveAiSettings,
  };
};


