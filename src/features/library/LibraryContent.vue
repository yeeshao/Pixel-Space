<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ImageRecord } from '@/features/images/image.types';
import { imageSortOptions, type ImageSortMode } from '@/features/images/image-sort';
import SelectPopover from '@/shared/ui/SelectPopover.vue';
import DownloadGrantManager from './DownloadGrantManager.vue';
import type { DownloadGrantRecord, FolderRecord } from './library.api';
import { useLibraryDragSelection } from './useLibraryDragSelection';
import { VIRTUAL_DOWNLOAD_GRANTS, type VirtualFolder } from './useLibraryDirectory';

const props = defineProps<{
  currentFolderId: string | null;
  currentImages: ImageRecord[];
  imageStats: {
    rootDirect: number;
    rootRecursive: number;
    currentDirect: number;
    currentRecursive: number;
    totalImages: number;
    totalFolders: number;
    publicImages: number;
    privateImages: number;
  };
  currentReadonly: boolean;
  currentVirtual: VirtualFolder | null;
  downloadGrants: DownloadGrantRecord[];
  grantManagerError: string | null;
  grantManagingId: string | null;
  selectedKeys: Set<string>;
  subfolders: FolderRecord[];
  folders: FolderRecord[];
  folderOptions: Array<{ id: string; label: string; depth: number }>;
}>();

const sortMode = defineModel<ImageSortMode>('sortMode', { required: true });

const emit = defineEmits<{
  clearSelection: [];
  deleteGrant: [id: string];
  enterFolder: [id: string | null];
  openLightbox: [image: ImageRecord];
  selectAllCurrent: [];
  toggleSelection: [key: string];
  dragSelect: [key: string];
  updateGrant: [id: string, expiresAt: string];
  toggleFolderVisibility: [folder: FolderRecord];
  renameFolder: [folder: FolderRecord];
  moveFolder: [folder: FolderRecord, targetId: string | null];
  deleteFolder: [folder: FolderRecord];
}>();

const {
  isDragSelecting,
  onTilePointerDown,
  onTilePointerEnter,
  onTilePointerUp,
  onTilePointerCancel,
  shouldSuppressClick,
} = useLibraryDragSelection({
  canSelect: () => !props.currentReadonly,
  select: (key) => emit('dragSelect', key),
});

const folderMoveOpen = ref(false);
const folderMoveSource = ref<FolderRecord | null>(null);
const folderMoveTarget = ref<string>('__root__');

const folderMoveDescendants = computed(() => {
  const source = folderMoveSource.value;
  if (!source) return new Set<string>();
  const result = new Set<string>();
  let frontier = [source.id];
  while (frontier.length) {
    const next: string[] = [];
    for (const folder of props.folders) {
      if (folder.parent_id && frontier.includes(folder.parent_id) && !result.has(folder.id)) {
        result.add(folder.id);
        next.push(folder.id);
      }
    }
    frontier = next;
  }
  return result;
});

const folderMoveOptions = computed(() => props.folderOptions.filter((option) => {
  if (!folderMoveSource.value) return false;
  if (option.id === folderMoveSource.value.id) return false;
  if (folderMoveDescendants.value.has(option.id)) return false;
  return true;
}));

const openFolderMove = (folder: FolderRecord) => {
  folderMoveSource.value = folder;
  folderMoveTarget.value = folder.parent_id ?? '__root__';
  folderMoveOpen.value = true;
};

const closeFolderMove = () => {
  folderMoveOpen.value = false;
  folderMoveSource.value = null;
};

const submitFolderMove = () => {
  const folder = folderMoveSource.value;
  if (!folder) return;
  const target = folderMoveTarget.value === '__root__' ? null : folderMoveTarget.value;
  emit('moveFolder', folder, target);
  closeFolderMove();
};

const handleTileClick = (img: ImageRecord) => {
  if (shouldSuppressClick()) return;
  emit('openLightbox', img);
};
</script>

<template>
  <DownloadGrantManager
    v-if="currentFolderId === VIRTUAL_DOWNLOAD_GRANTS"
    :grants="downloadGrants"
    :loading-id="grantManagingId"
    :error="grantManagerError"
    @update="(id, expiresAt) => emit('updateGrant', id, expiresAt)"
    @delete="emit('deleteGrant', $event)"
  />

  <template v-else>
    <section v-if="subfolders.length > 0" class="content-panel folders-panel" aria-label="实际文件夹">
      <header class="content-panel-heading">
        <div>
          <h2>实际文件夹</h2>
          <p>{{ subfolders.length }} 个子文件夹 · 图片数量包含所有下级文件夹</p>
        </div>
      </header>
      <div class="folder-grid">
      <article
        v-for="folder in subfolders"
        :key="folder.id"
        class="folder-card"
        tabindex="0"
        role="button"
        :aria-label="`进入 ${folder.name}`"
        @click="emit('enterFolder', folder.id)"
        @keydown.enter.prevent="emit('enterFolder', folder.id)"
        @keydown.space.prevent="emit('enterFolder', folder.id)"
      >
        <div class="folder-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          </svg>
        </div>
        <div class="folder-body">
          <div class="folder-name-row">
            <p class="folder-name">{{ folder.name }}</p>
            <button
              type="button"
              class="folder-visibility"
              :class="{ 'is-public': folder.is_public !== 0, 'is-private': folder.is_public === 0 }"
              :title="folder.is_public !== 0 ? '点击设为私有' : '点击设为公开'"
              :aria-label="folder.is_public !== 0 ? '文件夹当前公开，点击设为私有' : '文件夹当前私有，点击设为公开'"
              @click.stop="emit('toggleFolderVisibility', folder)"
            >
              <svg v-if="folder.is_public !== 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              <span>{{ folder.is_public !== 0 ? '公开' : '私有' }}</span>
            </button>
          </div>
          <p class="folder-meta">包含 {{ folder.image_count }} 张图片 · {{ folder.child_count }} 个直接子目录</p>
          <div class="folder-actions-row">
            <button type="button" class="folder-action-btn primary" @click.stop="emit('enterFolder', folder.id)">进入</button>
            <button type="button" class="folder-action-btn" @click.stop="emit('renameFolder', folder)">重命名</button>
            <button type="button" class="folder-action-btn" @click.stop="openFolderMove(folder)">移动</button>
            <button type="button" class="folder-action-btn danger" :disabled="folder.image_count > 0 || folder.child_count > 0" :title="folder.image_count > 0 || folder.child_count > 0 ? '请先清空图片和子目录' : '删除空文件夹'" @click.stop="emit('deleteFolder', folder)">删除</button>
          </div>
        </div>
      </article>
      </div>
    </section>

    <section v-if="currentImages.length > 0" class="content-panel image-section">
      <header class="content-panel-heading image-section-title">
        <div>
          <h2>照片</h2>
          <p>当前目录直接存放的图片</p>
        </div>
      </header>
      <header class="image-section-header">
        <span class="section-label">本目录图片 · {{ currentImages.length }}</span>
        <SelectPopover v-model="sortMode" :options="imageSortOptions" aria-label="排序方式">
          <template #leading-icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="leading-icon" aria-hidden="true">
              <path d="M3 6h13" />
              <path d="M3 12h9" />
              <path d="M3 18h5" />
              <path d="m17 8 4 4-4 4" />
              <path d="M21 12H10" />
            </svg>
          </template>
        </SelectPopover>
        <button
          v-if="!currentReadonly"
          type="button"
          class="library-btn small"
          :disabled="selectedKeys.size === currentImages.length"
          @click="emit('selectAllCurrent')"
        >
          全选
        </button>
        <button
          v-if="!currentReadonly"
          type="button"
          class="library-btn small"
          :disabled="selectedKeys.size === 0"
          @click="emit('clearSelection')"
        >
          取消选择
        </button>
      </header>
      <div class="image-grid" :class="{ 'is-drag-selecting': isDragSelecting }">
        <button
          v-for="img in currentImages"
          :key="img.key"
          type="button"
          class="image-tile"
          :class="{ 'is-selected': selectedKeys.has(img.key) }"
          @pointerdown="onTilePointerDown(img.key, $event)"
          @pointerenter="onTilePointerEnter(img.key)"
          @pointerup="onTilePointerUp($event)"
          @pointercancel="onTilePointerCancel($event)"
          @click.shift.prevent="emit('toggleSelection', img.key)"
          @click.ctrl.prevent="emit('toggleSelection', img.key)"
          @click.meta.prevent="emit('toggleSelection', img.key)"
          @click.exact="handleTileClick(img)"
        >
          <img :src="img.public_url" :alt="img.title" loading="lazy" draggable="false" @dragstart.prevent />
          <span class="image-caption">{{ img.title || img.original_filename }}</span>
          <button
            v-if="!currentReadonly"
            type="button"
            class="select-toggle"
            :class="{ 'is-on': selectedKeys.has(img.key) }"
            :aria-label="selectedKeys.has(img.key) ? '取消选中' : '选中'"
            @pointerdown.stop
            @click.stop="emit('toggleSelection', img.key)"
          >
            <svg v-if="selectedKeys.has(img.key)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
              <path d="m5 12 5 5L20 7" />
            </svg>
          </button>
        </button>
      </div>
    </section>

    <div v-if="folderMoveOpen" class="folder-dialog-backdrop" @click.self="closeFolderMove">
      <section class="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-move-title">
        <header class="folder-dialog-heading">
          <div>
            <span class="folder-dialog-kicker">文件夹整体操作</span>
            <h2 id="folder-move-title">移动「{{ folderMoveSource?.name }}」</h2>
            <p>移动的是整个文件夹，里面的图片和子文件夹会一起保留。</p>
          </div>
          <button type="button" class="folder-dialog-close" aria-label="关闭" @click="closeFolderMove">×</button>
        </header>
        <label class="folder-dialog-field">
          <span>目标位置</span>
          <select v-model="folderMoveTarget" class="settings-input">
            <option value="__root__">根目录</option>
            <option v-for="option in folderMoveOptions" :key="option.id" :value="option.id">
              {{ '　'.repeat(option.depth) }}{{ option.label }}
            </option>
          </select>
        </label>
        <footer class="folder-dialog-actions">
          <button type="button" class="library-btn" @click="closeFolderMove">取消</button>
          <button type="button" class="library-btn primary" @click="submitFolderMove">确认移动</button>
        </footer>
      </section>
    </div>

    <section v-if="currentFolderId === null" class="image-stats-panel" aria-label="图片统计">
      <header class="image-stats-heading">
        <div>
          <h2>图片统计</h2>
          <p>主目录统计包含所有子目录中的图片</p>
        </div>
      </header>
      <div class="image-stats-grid">
        <div class="image-stat-card primary-stat"><span>图库总图片</span><strong>{{ imageStats.rootRecursive }}</strong></div>
        <div class="image-stat-card"><span>主目录图片</span><strong>{{ imageStats.rootDirect }}</strong></div>
        <div class="image-stat-card"><span>公开图片</span><strong>{{ imageStats.publicImages }}</strong></div>
        <div class="image-stat-card"><span>未公开图片</span><strong>{{ imageStats.privateImages }}</strong></div>
        <div class="image-stat-card"><span>文件夹</span><strong>{{ imageStats.totalFolders }}</strong></div>
      </div>
    </section>

    <section v-else class="image-stats-panel compact-image-stats" aria-label="当前目录图片统计">
      <header class="image-stats-heading">
        <div><h2>图片统计</h2><p>当前目录 {{ imageStats.currentDirect }} 张，包含子目录共 {{ imageStats.currentRecursive }} 张</p></div>
      </header>
    </section>

    <p
      v-if="subfolders.length === 0 && currentImages.length === 0"
      class="state-card"
    >
      <template v-if="currentVirtual">没有符合「{{ currentVirtual.name }}」条件的图片。</template>
      <template v-else>这个文件夹是空的。可以新建子文件夹，或回到上一级把图片移进来。</template>
    </p>
  </template>
</template>

<style scoped src="./library-view.css"></style>
