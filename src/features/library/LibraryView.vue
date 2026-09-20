<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import TelegramInboxPanel from './TelegramInboxPanel.vue';
import AppShell from '@/shared/ui/AppShell.vue';
import LoadingState from '@/shared/ui/LoadingState.vue';
import type { ImageRecord } from '@/features/images/image.types';
import DownloadGrantDialog from './DownloadGrantDialog.vue';
import type { DownloadGrantRecord, FolderRecord } from './library.api';
import LibraryContent from './LibraryContent.vue';
import BatchLocationDialog from './BatchLocationDialog.vue';
import LibraryHeader from './LibraryHeader.vue';
import LibraryMoveBar from './LibraryMoveBar.vue';
import { useLibraryActions } from './useLibraryActions';
import { useLibraryDirectory } from './useLibraryDirectory';

const ImageLightbox = defineAsyncComponent(() => import('@/features/images/ImageLightbox.vue'));

const folders = ref<FolderRecord[]>([]);
const images = ref<ImageRecord[]>([]);
const downloadGrants = ref<DownloadGrantRecord[]>([]);

const lightboxOpen = ref(false);
const lightboxImage = ref<ImageRecord | null>(null);
const batchLocationOpen = ref(false);

const {
  currentFolderId,
  sortMode,
  subfolders,
  virtualCounts,
  imageStats,
  currentImages,
  currentFolder,
  currentVirtual,
  currentReadonly,
  breadcrumb,
  folderOptions,
} = useLibraryDirectory({ folders, images, downloadGrants });

const {
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
  handleRenameCurrent,
  handleDeleteCurrent,
  handleToggleFolderVisibility,
  handleBatchRenameFolder,
  handleBatchMoveFolders,
  handleBatchDeleteFolders,
  handleBatchToggleFolderVisibility,
  handleMove,
  handleBatchDelete,
  handleBatchLocation,
  handleBatchVisibility,
  handleBatchAi,
  saveAiSettings,
} = useLibraryActions({
  folders,
  images,
  downloadGrants,
  currentFolderId,
  currentFolder,
  currentReadonly,
  currentImages,
  folderOptions,
});

const openLightbox = (img: ImageRecord) => {
  lightboxImage.value = img;
  lightboxOpen.value = true;
};

const showAdjacentImage = (offset: -1 | 1) => {
  const items = currentImages.value;
  if (!lightboxImage.value || items.length === 0) return;
  const currentIndex = items.findIndex((item) => item.key === lightboxImage.value?.key);
  if (currentIndex === -1) return;
  const nextIndex = (currentIndex + offset + items.length) % items.length;
  lightboxImage.value = items[nextIndex];
};

const showPreviousImage = () => showAdjacentImage(-1);
const showNextImage = () => showAdjacentImage(1);

const replaceImage = (img: ImageRecord) => {
  images.value = images.value.map((item) => (item.key === img.key ? img : item));
  lightboxImage.value = img;
};

const removeImage = (key: string) => {
  images.value = images.value.filter((item) => item.key !== key);
  lightboxOpen.value = false;
  lightboxImage.value = null;
};

onMounted(refreshAll);

let syncingFolderHistory = false;

const folderHistoryState = (folderId: string | null) => ({
  pixelSpaceLibraryFolder: folderId,
});

const navigateFolder = (folderId: string | null) => {
  if (folderId === currentFolderId.value) return;
  enterFolder(folderId);
  window.history.pushState(folderHistoryState(folderId), '', window.location.href);
};

const onFolderHistoryPop = (event: PopStateEvent) => {
  const state = event.state as { pixelSpaceLibraryFolder?: string | null } | null;
  if (!state || !Object.prototype.hasOwnProperty.call(state, 'pixelSpaceLibraryFolder')) return;
  enterFolder(state.pixelSpaceLibraryFolder ?? null);
};

onMounted(() => {
  window.history.replaceState(folderHistoryState(currentFolderId.value), '', window.location.href);
  window.addEventListener('popstate', onFolderHistoryPop);
});

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onFolderHistoryPop);
});

</script>

<template>
  <AppShell fluid>
    <section class="library-page">
      <LibraryHeader
        :ai-settings-form="aiSettingsForm"
        :ai-settings-saving="aiSettingsSaving"
        :breadcrumb="breadcrumb"
        :current-folder="currentFolder"
        :current-folder-id="currentFolderId"
        :current-virtual="currentVirtual"
        :virtual-counts="virtualCounts"
        @enter-folder="navigateFolder"
        @create-folder="handleCreateFolder"
        @rename-current="handleRenameCurrent"
        @delete-current="handleDeleteCurrent"
        @refresh="refreshAll"
        @save-ai-settings="saveAiSettings"
      >
        <template #telegram>
          <TelegramInboxPanel @processed="refreshAll" />
        </template>
      </LibraryHeader>

      <p v-if="actionMessage" class="action-toast">{{ actionMessage }}</p>

      <LoadingState v-if="loading" title="正在加载控制台" message="同步文件夹、图片和授权信息" />
      <LoadingState v-else-if="loadError" title="控制台加载失败" :error="loadError" />

      <LibraryContent
        v-else
        v-model:sort-mode="sortMode"
        :current-folder-id="currentFolderId"
        :current-images="currentImages"
        :image-stats="imageStats"
        :current-readonly="currentReadonly"
        :current-virtual="currentVirtual"
        :download-grants="downloadGrants"
        :grant-manager-error="grantManagerError"
        :grant-managing-id="grantManagingId"
        :selected-keys="selectedKeys"
        :subfolders="subfolders"
        :folders="folders"
        :folder-options="folderOptions"
        @update-grant="handleUpdateDownloadGrant"
        @delete-grant="handleDeleteDownloadGrant"
        @enter-folder="navigateFolder"
        @select-all-current="selectAllCurrent"
        @clear-selection="clearSelection"
        @toggle-selection="toggleSelection"
        @drag-select="selectKey"
        @open-lightbox="openLightbox"
        @toggle-folder-visibility="handleToggleFolderVisibility"
        @rename-folder="handleRenameFolder"
        @move-folder="handleMoveFolder"
        @delete-folder="handleDeleteFolder"
        @batch-rename-folder="handleBatchRenameFolder"
        @batch-move-folders="handleBatchMoveFolders"
        @batch-delete-folders="handleBatchDeleteFolders"
        @batch-toggle-folder-visibility="handleBatchToggleFolderVisibility"
      />



      <LibraryMoveBar
        v-model:move-target="moveTarget"
        :current-folder-id="currentFolderId"
        :folder-options="folderOptions"
        :selected-count="selectedKeys.size"
        @open-grant="grantDialogOpen = true"
        @move="handleMove"
        @batch-location="batchLocationOpen = true"
        @batch-ai="handleBatchAi"
        @batch-visibility="handleBatchVisibility"
        @delete="handleBatchDelete"
        @cancel="clearSelection"
      />
    </section>

    <BatchLocationDialog
      :open="batchLocationOpen"
      :selected-count="selectedKeys.size"
      @close="batchLocationOpen = false"
      @save="async (payload) => { await handleBatchLocation(payload); batchLocationOpen = false; }"
    />
    <ImageLightbox
      :open="lightboxOpen"
      :image="lightboxImage"
      @close="lightboxOpen = false"
      @prev="showPreviousImage"
      @next="showNextImage"
      @updated="replaceImage"
      @deleted="removeImage"
    />
    <DownloadGrantDialog
      :open="grantDialogOpen"
      :selected-count="selectedKeys.size"
      :loading="grantCreating"
      :result="grantResult"
      :error="grantError"
      @close="grantDialogOpen = false"
      @create="handleCreateDownloadGrant"
      @clear="clearGrantResult"
    />
  </AppShell>
</template>

<style scoped src="./library-view.css"></style>

