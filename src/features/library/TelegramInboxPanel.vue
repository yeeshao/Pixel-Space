<script setup lang="ts">
import { onMounted, ref } from 'vue';
import imageCompression from 'browser-image-compression';
import exifr from 'exifr';
import { previewAiAnnotation } from '@/features/upload/ai-preview.api';
import { buildUploadFormData } from '@/features/upload/upload-form';
import { uploadImage } from '@/features/upload/upload.api';
import { fetchTelegramInboxOriginal, listTelegramInbox, type TelegramInboxItem } from './telegram-inbox.api';
import type { UploadExif, UploadMeta } from '@/features/upload/upload.types';

const MAX_EDGE = 2048;
const items = ref<TelegramInboxItem[]>([]);
const loading = ref(false);
const processingId = ref<string | null>(null);
const error = ref<string | null>(null);
const autoAi = ref(true);
const emit = defineEmits<{ imported: [] }>();

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const readExif = async (file: File): Promise<UploadExif> => {
  const tags = ['Make', 'Model', 'DateTimeOriginal', 'CreateDate', 'ModifyDate', 'ISO', 'FNumber', 'ExposureTime', 'FocalLength'];
  const raw = await exifr.parse(file, tags).catch(() => null) as Record<string, unknown> | null;
  return {
    taken_at: typeof raw?.DateTimeOriginal === 'string' ? raw.DateTimeOriginal : typeof raw?.CreateDate === 'string' ? raw.CreateDate : null,
    camera: [raw?.Make, raw?.Model].filter((v): v is string => typeof v === 'string' && v.trim()).join(' ') || null,
    iso: typeof raw?.ISO === 'number' ? raw.ISO : null,
    aperture: typeof raw?.FNumber === 'number' ? raw.FNumber : null,
    shutter: typeof raw?.ExposureTime === 'number' ? String(raw.ExposureTime) : null,
    focal_length: typeof raw?.FocalLength === 'number' ? raw.FocalLength : null,
    location_lat: null,
    location_lng: null,
  };
};

const dimensionsOf = (file: File): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取 Telegram 图片尺寸')); };
  image.src = url;
});

const sha256 = async (file: File) => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const refresh = async () => {
  loading.value = true;
  error.value = null;
  try { items.value = await listTelegramInbox(); }
  catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
};

const parseCaptionLocation = (caption: string | null) => {
  const match = caption?.match(/@geo\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return { lat: null as number | null, lng: null as number | null, region: null as 'china' | 'global' | null };
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { lat: null, lng: null, region: null };
  }
  const region = lng >= 73.5 && lng <= 135.1 && lat >= 3.5 && lat <= 53.6 ? 'china' : 'global';
  return { lat, lng, region };
};

const processItem = async (item: TelegramInboxItem) => {
  if (processingId.value) return;
  processingId.value = item.id;
  error.value = null;
  try {
    const original = await fetchTelegramInboxOriginal(item.id);
    const hash = await sha256(original);
    const compressedBlob = await imageCompression(original, {
      maxWidthOrHeight: MAX_EDGE,
      useWebWorker: true,
      fileType: 'image/webp',
      initialQuality: 0.86,
      preserveExif: false,
    });
    const compressed = new File([compressedBlob], original.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp', lastModified: Date.now() });
    const dimensions = await dimensionsOf(compressed);
    const exif = await readExif(original);
    const captionLocation = parseCaptionLocation(item.caption);
    const meta: UploadMeta = {
      title: item.caption?.replace(/#[^\s#]+/g, '').trim() || '',
      caption: item.caption ?? '',
      location_name: '',
      location_lat: captionLocation.lat,
      location_lng: captionLocation.lng,
      location_region: captionLocation.region,
      tags: item.caption ? [...item.caption.matchAll(/#([^\s#]+)/g)].map((m) => m[1]).join(', ') : '',
      search_content: '',
      dominant_color: '',
      palette: '',
      composition: '',
      ai_status: 'pending',
      is_public: 1,
      location_public: 1,
      folder_id: null,
    };

    if (autoAi.value) {
      try {
        const result = await previewAiAnnotation(compressed);
        meta.title = result.title || meta.title;
        meta.caption = result.caption || meta.caption;
        meta.tags = result.tags.join(', ');
        meta.search_content = result.search_content;
        meta.dominant_color = result.dominant_color;
        meta.palette = result.palette.join(', ');
        meta.composition = result.composition;
        meta.ai_status = 'done';
      } catch {
        // AI 与图片导入解耦：AI 失败时仍然按网页上传流程完成压缩与入库。
        meta.ai_status = 'failed';
      }
    }

    const formData = buildUploadFormData({ original, compressed, hash, exif, meta, dimensions });
    formData.set('telegram_inbox_id', item.id);
    const uploaded = await uploadImage(formData);
    items.value = items.value.filter((entry) => entry.id !== item.id);
    void uploaded;
    emit('imported');
  } catch (e) {
    error.value = `${item.original_filename}：${(e as Error).message}`;
  } finally {
    processingId.value = null;
  }
};

onMounted(refresh);
defineExpose({ refresh });
</script>

<template>
  <section class="telegram-inbox">
    <header class="telegram-inbox-header">
      <div>
        <h2>Telegram 待处理</h2>
        <p>Telegram 原图会先安全保存到 R2；在这里处理压缩后，按网页上传流程写入图片库。</p>
      </div>
      <div class="telegram-inbox-actions">
        <label class="telegram-ai-toggle"><input v-model="autoAi" type="checkbox" /> 处理时自动 AI 分析</label>
        <button type="button" class="library-btn small" :disabled="loading || !!processingId" @click="refresh">{{ loading ? '刷新中…' : '刷新' }}</button>
      </div>
    </header>

    <p v-if="error" class="telegram-inbox-error">{{ error }}</p>
    <p v-if="!loading && items.length === 0" class="telegram-inbox-empty">暂无待处理 Telegram 图片。</p>

    <div v-else class="telegram-inbox-grid">
      <article v-for="item in items" :key="item.id" class="telegram-inbox-card">
        <img :src="`/api/admin/telegram/inbox/${encodeURIComponent(item.id)}/original`" :alt="item.original_filename" loading="lazy" />
        <div class="telegram-inbox-body">
          <strong :title="item.original_filename">{{ item.original_filename }}</strong>
          <span>{{ item.width }}×{{ item.height }} · {{ formatBytes(item.bytes) }}</span>
          <span v-if="item.caption" class="telegram-inbox-caption">{{ item.caption }}</span>
          <button type="button" class="library-btn primary" :disabled="!!processingId" @click="processItem(item)">
            {{ processingId === item.id ? '压缩 / AI / 导入中…' : '处理并导入' }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.telegram-inbox { margin: 0 0 1rem; padding: 1rem; border: 1px solid rgba(53,243,255,.18); border-radius: 8px; background: rgba(7,7,19,.55); }
.telegram-inbox-header { display:flex; justify-content:space-between; gap:1rem; align-items:flex-start; margin-bottom:.8rem; }
.telegram-inbox-header h2 { margin:0; font-size:1rem; color:rgb(226,232,240); }
.telegram-inbox-header p { margin:.25rem 0 0; color:rgba(148,163,184,.85); font-size:.75rem; }
.telegram-inbox-actions { display:flex; align-items:center; gap:.7rem; }
.telegram-ai-toggle { color:rgba(203,213,225,.9); font-size:.75rem; white-space:nowrap; }
.telegram-inbox-error { margin:.5rem 0; color:rgb(251,113,133); font-size:.78rem; }
.telegram-inbox-empty { margin:0; padding:.8rem; color:rgba(148,163,184,.8); font-size:.8rem; }
.telegram-inbox-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:.8rem; }
.telegram-inbox-card { overflow:hidden; border:1px solid rgba(148,163,184,.14); border-radius:6px; background:rgba(15,23,42,.5); }
.telegram-inbox-card > img { display:block; width:100%; aspect-ratio:4/3; object-fit:cover; background:#050712; }
.telegram-inbox-body { display:grid; gap:.35rem; padding:.65rem; }
.telegram-inbox-body strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:rgb(226,232,240); font-size:.78rem; }
.telegram-inbox-body span { color:rgba(148,163,184,.82); font-size:.7rem; }
.telegram-inbox-caption { overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
@media (max-width:700px) { .telegram-inbox-header { flex-direction:column; } .telegram-inbox-actions { width:100%; justify-content:space-between; } }
</style>
