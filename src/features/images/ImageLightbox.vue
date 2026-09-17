<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ImageRecord } from './image.types';
import ImageLightboxCanvas from './ImageLightboxCanvas.vue';
import ImageLightboxDetailsDrawer from './ImageLightboxDetailsDrawer.vue';
import ImageLightboxToolbar from './ImageLightboxToolbar.vue';
import { useClipboardFeedback } from './useClipboardFeedback';
import { useImageLightboxActions } from './useImageLightboxActions';
import { useImageLightboxDetails } from './useImageLightboxDetails';
import { useImageZoom } from './useImageZoom';
import { useImageLightboxEditForm } from './useImageLightboxEditForm';

const props = defineProps<{ open: boolean; image?: ImageRecord | null }>();
const emit = defineEmits<{ close: []; prev: []; next: []; updated: [image: ImageRecord]; deleted: [key: string] }>();

const {
  copied,
  copiedText,
  copyValue,
  clearCopyTimer,
} = useClipboardFeedback();
const origin = typeof window !== 'undefined' ? window.location.origin : '';

const detailsOpen = ref(false);
const imageControlsHidden = ref(false);
const originalLoading = ref(false);
const originalLoaded = ref(false);
const originalError = ref<string | null>(null);
const originalObjectUrl = ref<string | null>(null);
let originalRequestId = 0;
let originalAbortController: AbortController | null = null;

const {
  ZOOM_STEP,
  zoomScale,
  isPanning,
  zoomTransform,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  resetZoom,
  zoomBy,
  onImageWheel,
  onImagePointerDown,
  onImagePointerMove,
  onImagePointerUp,
  onImageDoubleClick,
} = useImageZoom();
const {
  editForm,
  editSearchRegion,
  resetForm: resetEditForm,
  syncEditRegionFromSearch,
  onEditSearchRegionChange,
  updateLocationFromMap,
  applyLocationSearchResult,
} = useImageLightboxEditForm();

const imageRef = computed(() => props.image);
const {
  aiEditOpen,
  locationEditOpen,
  saving,
  deleting,
  aiPreviewing,
  actionError,
  sharePage,
  resetForm,
  openAiEditor,
  cancelAiEditor,
  saveAiMetadata,
  rerunAiAnalysis,
  openLocationEditor,
  cancelLocationEditor,
  saveLocation,
  deleteCurrentImage,
  saveVisibilityFlag,
} = useImageLightboxActions({
  image: imageRef,
  origin,
  editForm,
  resetEditForm,
  copyValue,
  emit,
});
const {
  publicPageUrl,
  originalUrl,
  linkRows,
  formatImageTimestamp,
  exifRows,
  aiTags,
  aiPalette,
  dominantColor,
  hasCoordinates,
  mapLat,
  mapLng,
  mapRegion,
} = useImageLightboxDetails({
  image: imageRef,
  origin,
  locationEditOpen,
  editSearchRegion,
  editForm,
});

const revokeOriginalObjectUrl = () => {
  if (originalObjectUrl.value) {
    URL.revokeObjectURL(originalObjectUrl.value);
    originalObjectUrl.value = null;
  }
};

const resetOriginalState = () => {
  originalRequestId += 1;
  originalAbortController?.abort();
  originalAbortController = null;
  originalLoading.value = false;
  originalLoaded.value = false;
  originalError.value = null;
  revokeOriginalObjectUrl();
};

const displayImageUrl = computed(() => originalObjectUrl.value || imageRef.value?.public_url || '');

const loadOriginal = async () => {
  if (!imageRef.value || originalLoading.value || originalLoaded.value) return;
  const requestId = ++originalRequestId;
  originalAbortController?.abort();
  const controller = new AbortController();
  originalAbortController = controller;
  originalLoading.value = true;
  originalError.value = null;

  try {
    const response = await fetch(originalUrl.value, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json() as { error?: string };
        detail = payload.error ? `：${payload.error}` : '';
      } catch {
        // Ignore non-JSON error responses.
      }
      throw new Error(`加载原图失败（${response.status}）${detail}`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('原图为空');
    if (requestId !== originalRequestId) return;

    const objectUrl = URL.createObjectURL(blob);
    revokeOriginalObjectUrl();
    originalObjectUrl.value = objectUrl;
    originalLoaded.value = true;
  } catch (error) {
    if (controller.signal.aborted || requestId !== originalRequestId) return;
    originalError.value = error instanceof Error ? error.message : '加载原图失败';
  } finally {
    if (requestId === originalRequestId) {
      originalLoading.value = false;
      originalAbortController = null;
    }
  }
};

const toggleDetails = () => {
  detailsOpen.value = !detailsOpen.value;
};

const toggleImageControls = () => {
  imageControlsHidden.value = !imageControlsHidden.value;
};

const handleViewerSurfaceClick = () => {
  if (detailsOpen.value) {
    detailsOpen.value = false;
    return;
  }
  emit('close');
};

const handleKey = (e: KeyboardEvent) => {
  if (!props.open) return;
  if (e.key === 'Escape') {
    if (detailsOpen.value) {
      detailsOpen.value = false;
      return;
    }
    emit('close');
  }
  if (e.key === 'ArrowLeft') emit('prev');
  if (e.key === 'ArrowRight') emit('next');
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', handleKey);
      document.body.style.overflow = 'hidden';
    } else {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
      copied.value = false;
      detailsOpen.value = false;
      imageControlsHidden.value = false;
      resetOriginalState();
      aiEditOpen.value = false;
      locationEditOpen.value = false;
      resetZoom();
      clearCopyTimer();
    }
  },
  { immediate: true },
);

watch(
  () => props.image,
  (image) => {
    resetForm(image);
    resetOriginalState();
    resetZoom();
    imageControlsHidden.value = false;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKey);
  document.body.style.overflow = '';
  originalAbortController?.abort();
  revokeOriginalObjectUrl();
  clearCopyTimer();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div v-if="open" class="image-viewer-wrapper">
        <div class="cyber-image-viewer">
          <div class="viewer-backdrop" @click="handleViewerSurfaceClick" aria-hidden="true" />

          <div class="viewer-container" :class="{ 'details-open': detailsOpen }">
            <ImageLightboxToolbar
              :image="image"
              :copied="copied"
              :details-open="detailsOpen"
              :original-url="originalUrl"
              :original-loading="originalLoading"
              :original-loaded="originalLoaded"
              :saving="saving"
              :deleting="deleting"
              @close="emit('close')"
              @share="sharePage"
              @toggle-details="toggleDetails"
              @load-original="loadOriginal"
              @delete="deleteCurrentImage"
            />

            <div class="viewer-content">
              <ImageLightboxCanvas
                :image="image"
                :image-src="displayImageUrl"
                :details-open="detailsOpen"
                :image-controls-hidden="imageControlsHidden"
                :is-panning="isPanning"
                :zoom-scale="zoomScale"
                :zoom-transform="zoomTransform"
                :zoom-percent="zoomPercent"
                :can-zoom-in="canZoomIn"
                :can-zoom-out="canZoomOut"
                :zoom-step="ZOOM_STEP"
                @surface="handleViewerSurfaceClick"
                @toggle-controls="toggleImageControls"
                @prev="emit('prev')"
                @next="emit('next')"
                @zoom-by="zoomBy"
                @reset-zoom="resetZoom"
                @image-wheel="onImageWheel"
                @image-pointer-down="onImagePointerDown"
                @image-pointer-move="onImagePointerMove"
                @image-pointer-up="onImagePointerUp"
                @image-double-click="onImageDoubleClick"
              />

              <div
                v-if="originalLoading || originalError"
                class="original-load-status"
                :class="{ 'is-error': originalError }"
                role="status"
              >
                <span v-if="originalLoading">正在加载原图…</span>
                <span v-else>{{ originalError }}</span>
              </div>

              <ImageLightboxDetailsDrawer
                :image="image"
                :details-open="detailsOpen"
                :ai-edit-open="aiEditOpen"
                :location-edit-open="locationEditOpen"
                :saving="saving"
                :deleting="deleting"
                :ai-previewing="aiPreviewing"
                :action-error="actionError"
                :edit-form="editForm"
                :edit-search-region="editSearchRegion"
                :exif-rows="exifRows"
                :ai-tags="aiTags"
                :ai-palette="aiPalette"
                :dominant-color="dominantColor"
                :has-coordinates="hasCoordinates"
                :map-lat="mapLat"
                :map-lng="mapLng"
                :map-region="mapRegion"
                :link-rows="linkRows"
                :format-image-timestamp="formatImageTimestamp"
                @toggle-ai-editor="aiEditOpen ? cancelAiEditor() : openAiEditor()"
                @rerun-ai-analysis="rerunAiAnalysis"
                @cancel-ai-editor="cancelAiEditor"
                @save-ai-metadata="saveAiMetadata"
                @toggle-location-editor="locationEditOpen ? cancelLocationEditor() : openLocationEditor()"
                @cancel-location-editor="cancelLocationEditor"
                @save-location="saveLocation"
                @save-visibility-flag="saveVisibilityFlag"
                @sync-edit-region-from-search="syncEditRegionFromSearch"
                @edit-search-region-change="onEditSearchRegionChange"
                @update-location-from-map="updateLocationFromMap"
                @apply-location-search-result="applyLocationSearchResult"
                @copy-value="copyValue"
              />
          </div>

          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="./image-lightbox.css"></style>
