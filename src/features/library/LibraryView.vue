<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue';
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
  handleRenameCurrent,
  handleToggleFolderVisibility,
  handleDeleteCurrent,
  handleMove,
  handleBatchDelete,
  handleBatchLocation,
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
</script>

<template>
  <AppShell fluid>
    <section class="library-page">
      <LibraryHeader
        :breadcrumb="breadcrumb"
        :current-folder="currentFolder"
        :current-folder-id="currentFolderId"
        :virtual-counts="virtualCounts"
        @enter-folder="enterFolder"
        @create-folder="handleCreateFolder"
        @rename-current="handleRenameCurrent"
        @delete-current="handleDeleteCurrent"
        @refresh="refreshAll"
      />

      <p v-if="actionMessage" class="action-toast">{{ actionMessage }}</p>

      <LoadingState v-if="loading" title="正在加载控制台" message="同步文件夹、图片和授权信息" />
      <LoadingState v-else-if="loadError" title="控制台加载失败" :error="loadError" />

      <LibraryContent
        v-else
        v-model:sort-mode="sortMode"
        :current-folder-id="currentFolderId"
        :current-images="currentImages"
        :current-readonly="currentReadonly"
        :current-virtual="currentVirtual"
        :download-grants="downloadGrants"
        :grant-manager-error="grantManagerError"
        :grant-managing-id="grantManagingId"
        :selected-keys="selectedKeys"
        :subfolders="subfolders"
        @update-grant="handleUpdateDownloadGrant"
        @delete-grant="handleDeleteDownloadGrant"
        @enter-folder="enterFolder"
        @select-all-current="selectAllCurrent"
        @clear-selection="clearSelection"
        @toggle-selection="toggleSelection"
        @drag-select="selectKey"
        @open-lightbox="openLightbox"
        @toggle-folder-visibility="handleToggleFolderVisibility"
      />

      <TelegramInboxPanel @processed="refreshAll" />

      <section class="ai-settings-panel library-ai-panel" aria-labelledby="ai-settings-title">
        <form class="ai-settings-form" @submit.prevent="saveAiSettings">
          <div class="ai-settings-heading">
            <h2 id="ai-settings-title">AI 配置</h2>
            <button type="submit" class="library-btn primary" :disabled="aiSettingsSaving">
              {{ aiSettingsSaving ? '保存中…' : '保存' }}
            </button>
          </div>
          <div class="settings-grid">
            <label class="settings-field"><span>Proxy URL</span><input v-model="aiSettingsForm.proxy_url" class="settings-input" type="url" autocomplete="off" placeholder="https://example.test/v1/chat/completions" /></label>
            <label class="settings-field"><span>Model</span><input v-model="aiSettingsForm.model" class="settings-input" type="text" autocomplete="off" placeholder="gpt-4.1-mini" /></label>
          </div>
          <label class="settings-field settings-prompt-field"><span>Prompt</span><textarea v-model="aiSettingsForm.prompt" class="settings-input settings-textarea" autocomplete="off" spellcheck="false" placeholder="编辑图片分析系统提示词" /></label>
        </form>
      </section>

      <LibraryMoveBar
        v-model:move-target="moveTarget"
        :current-folder-id="currentFolderId"
        :folder-options="folderOptions"
        :selected-count="selectedKeys.size"
        @open-grant="grantDialogOpen = true"
        @move="handleMove"
        @batch-location="batchLocationOpen = true"
        @batch-ai="handleBatchAi"
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
