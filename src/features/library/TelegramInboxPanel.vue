<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import imageCompression from 'browser-image-compression';
import exifr from 'exifr';
import type { ImageRecord } from '@/features/images/image.types';
import { previewAiAnnotation } from '@/features/images/ai-preview.api';
import { reverseGeocodeLocation } from '@/features/images/geocode.api';
import { normalizeExif } from '@/features/upload/exif';
import { geocodeRegionForCoordinate } from '@/features/upload/useUploadPickMap';
import { discardTelegramImage, listTelegramInbox, processTelegramImage } from './telegram-inbox.api';

const MAX_EDGE = 2048;
const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[index]}`;
};
const items = ref<ImageRecord[]>([]);
const loading = ref(false);
const processingKey = ref<string | null>(null);
const error = ref<string | null>(null);
const emit = defineEmits<{ processed: [image: ImageRecord] }>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const load = async () => {
  loading.value = true;
  error.value = null;
  try { items.value = await listTelegramInbox(); }
  catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
};

const readExif = async (file: File) => {
  const raw = await exifr.parse(file, [
    'Make', 'Model', 'DateTimeOriginal', 'CreateDate', 'ModifyDate', 'ISO',
    'FNumber', 'ExposureTime', 'FocalLength', 'GPSLatitude', 'GPSLongitude',
  ]).catch(() => null);
  const gps = await exifr.gps(file).catch(() => null);
  return normalizeExif({ ...(raw ?? {}), ...(gps ?? {}) });
};

const sha256HexFromFile = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readDimensions = (file: File): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    if (!image.naturalWidth || !image.naturalHeight) reject(new Error('无法读取图片尺寸'));
    else resolve({ width: image.naturalWidth, height: image.naturalHeight });
  };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取图片尺寸')); };
  image.src = url;
});

const inferImageMime = (name: string, blobType: string): string => {
  if (blobType.startsWith('image/')) return blobType;
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
  };
  return byExt[ext] ?? 'image/jpeg';
};

const discardOne = async (item: ImageRecord) => {
  if (processingKey.value) return;
  if (!window.confirm(`确定不入库「${item.title || item.original_filename}」？仅从 Pixel Space 暂存区移除，不删除 Telegram 频道原图。`)) return;
  processingKey.value = item.key;
  error.value = null;
  try {
    await discardTelegramImage(item.key);
    items.value = items.value.filter((entry) => entry.key !== item.key);
  } catch (e) {
    error.value = (e as Error).message || '移除失败';
  } finally {
    processingKey.value = null;
  }
};

const processOne = async (item: ImageRecord) => {
  if (processingKey.value) return;
  processingKey.value = item.key;
  error.value = null;
  try {
    // 这里从 Telegram 代理读取原图；直到此处都没有把原图保存到 R2。
    const response = await fetch(item.public_url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取 Telegram 原图失败：HTTP ${response.status}`);
    const blob = await response.blob();
    const originalName = item.original_filename || `${item.key}.jpg`;
    const original = new File([blob], originalName, { type: inferImageMime(originalName, blob.type) });
    const originalDimensions = await readDimensions(original);
    const hash = await sha256HexFromFile(original);
    const exif = await readExif(original);
    const compressedBlob = await imageCompression(original, {
      maxWidthOrHeight: MAX_EDGE,
      useWebWorker: true,
      fileType: 'image/webp',
      initialQuality: 0.86,
      preserveExif: false,
    });
    const compressedName = original.name.replace(/\.[^.]+$/, '.webp');
    const compressed = new File([compressedBlob], compressedName, { type: 'image/webp', lastModified: Date.now() });
    const dimensions = await readDimensions(compressed);

    const meta = {
      title: item.title || original.name.replace(/\.[^.]+$/, ''),
      caption: item.caption || '',
      original_filename: original.name,
      location_name: item.location_name || '',
      location_lat: exif.location_lat,
      location_lng: exif.location_lng,
      location_region: exif.location_lat !== null && exif.location_lng !== null
        ? geocodeRegionForCoordinate(exif.location_lat, exif.location_lng) === 'cn' ? 'china' : 'global'
        : null,
      tags: item.tags_json ? parseTags(item.tags_json).join(', ') : '',
      search_content: item.search_content || '',
      dominant_color: item.dominant_color || '',
      palette: item.color_palette_json ? parseTags(item.color_palette_json).join(', ') : '',
      composition: item.composition || '',
      is_public: (item.is_public === 0 ? 0 : 1) as 0 | 1,
      location_public: (item.location_public === 0 ? 0 : 1) as 0 | 1,
      folder_id: item.folder_id ?? null,
    };

    if (meta.location_lat !== null && meta.location_lng !== null && !meta.location_name) {
      meta.location_name = await reverseGeocodeLocation(
        meta.location_lat,
        meta.location_lng,
        meta.location_region === 'global' ? 'global' : 'cn',
      ).catch(() => null) || '';
    }

    let ai: NonNullable<Parameters<typeof processTelegramImage>[1]['ai']> | undefined;
    try {
      const result = await previewAiAnnotation(compressed);
      ai = { failed: false, ...result };
    } catch {
      ai = {
        failed: true,
        title: '', caption: '', tags: [], search_content: '', dominant_color: '', palette: [], composition: '',
      };
    }

    const processed = await processTelegramImage(item.key, {
      compressed,
      hash,
      dimensions,
      original_dimensions: originalDimensions,
      original_bytes: original.size,
      exif,
      meta,
      ai,
    });
    items.value = items.value.filter((entry) => entry.key !== item.key);
    emit('processed', processed);
  } catch (e) {
    error.value = (e as Error).message || '处理失败';
  } finally {
    processingKey.value = null;
  }
};

const processAll = async () => {
  const snapshot = [...items.value];
  for (const item of snapshot) await processOne(item);
};

const parseTags = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
};

onMounted(() => {
  void load();
  refreshTimer = setInterval(() => { if (!processingKey.value) void load(); }, 5000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
});
</script>
<template>
  <section class="telegram-inbox">
    <header class="telegram-inbox-header">
      <div>
        <h2>Telegram 暂存 · {{ items.length }}</h2>
        <p>原图只保留在 Telegram；网页预览时按需读取。点击处理后，浏览器按网页上传流程提取 EXIF、压缩 WebP 并进行 AI 识别，最后才写入 R2。</p>
      </div>
      <div class="telegram-inbox-actions">
        <button type="button" class="library-btn small" :disabled="loading || !!processingKey" @click="load">刷新</button>
        <button type="button" class="library-btn small primary" :disabled="items.length === 0 || !!processingKey" @click="processAll">
          {{ processingKey ? '处理中…' : '全部处理并入库' }}
        </button>
      </div>
    </header>
    <p v-if="error" class="telegram-inbox-error">{{ error }}</p>
    <div v-if="items.length" class="telegram-inbox-grid">
      <article v-for="item in items" :key="item.key" class="telegram-inbox-card">
        <img :src="item.public_url" :alt="item.title || item.original_filename" loading="lazy" />
        <div class="telegram-inbox-info">
          <strong>{{ item.title || item.original_filename }}</strong>
          <span>原图 {{ item.original_width && item.original_height ? `${item.original_width} × ${item.original_height}` : (item.width && item.height ? `${item.width} × ${item.height}` : '未识别') }}</span>
          <span>原图 {{ item.original_bytes ? formatBytes(item.original_bytes) : '未记录' }} · 预览 {{ item.width || '—' }} × {{ item.height || '—' }}</span>
          <div class="telegram-inbox-card-actions">
            <button type="button" class="library-btn small primary" :disabled="!!processingKey" @click="processOne(item)">
              {{ processingKey === item.key ? '处理中…' : '处理并入库' }}
            </button>
            <button type="button" class="library-btn small danger" :disabled="!!processingKey" @click="discardOne(item)">不入库</button>
          </div>
        </div>
      </article>
    </div>
    <p v-else-if="!loading" class="telegram-inbox-empty">暂无 Telegram 暂存图片。向频道发送照片后，这里会自动刷新。</p>
    <p v-else class="telegram-inbox-empty">正在加载 Telegram 暂存…</p>
  </section>
</template>
<style scoped>
.telegram-inbox { display:flex; flex-direction:column; gap:.7rem; padding:1rem 1.1rem; border:1px solid rgba(53,243,255,.18); border-radius:8px; background:rgba(7,7,19,.58); }
.telegram-inbox-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
.telegram-inbox-header h2 { margin:0; color:white; font-size:1rem; font-weight:900; }
.telegram-inbox-header p { margin:.25rem 0 0; color:rgba(203,213,225,.72); font-size:.72rem; }
.telegram-inbox-actions { display:flex; gap:.45rem; flex-shrink:0; }
.telegram-inbox-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:.65rem; }
.telegram-inbox-card { overflow:hidden; border:1px solid rgba(148,163,184,.16); border-radius:7px; background:rgba(9,14,28,.72); }
.telegram-inbox-card > img { display:block; width:100%; aspect-ratio:1; object-fit:cover; background:rgba(0,0,0,.2); }
.telegram-inbox-info { display:flex; flex-direction:column; gap:.28rem; padding:.6rem; }
.telegram-inbox-info strong { overflow:hidden; color:rgb(226,232,240); font-size:.76rem; text-overflow:ellipsis; white-space:nowrap; }
.telegram-inbox-info span { color:rgba(148,163,184,.85); font-size:.68rem; }
.telegram-inbox-error { margin:0; color:rgb(251,113,133); font-size:.75rem; }
.telegram-inbox-empty { margin:0; padding:.8rem; color:rgba(148,163,184,.78); font-size:.75rem; text-align:center; }
@media (max-width:640px) { .telegram-inbox-header { align-items:flex-start; flex-direction:column; } }
.telegram-inbox-card-actions { display:grid; grid-template-columns:minmax(0,1fr) minmax(5.2rem,.55fr); gap:.45rem; margin-top:.2rem; }
.telegram-inbox-card-actions .library-btn { width:100%; min-width:0; }
@media (max-width:720px) {
  .telegram-inbox { padding:.8rem; }
  .telegram-inbox-header { align-items:stretch; flex-direction:column; gap:.65rem; }
  .telegram-inbox-actions { width:100%; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.35fr); gap:.45rem; }
  .telegram-inbox-actions .library-btn { width:100%; }
  .telegram-inbox-grid { grid-template-columns:1fr; gap:.6rem; }
  .telegram-inbox-card { display:grid; grid-template-columns:5.6rem minmax(0,1fr); align-items:stretch; }
  .telegram-inbox-card > img { width:5.6rem; height:100%; min-height:7rem; aspect-ratio:auto; }
  .telegram-inbox-info { min-width:0; padding:.55rem .6rem; justify-content:center; }
  .telegram-inbox-info strong { white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .telegram-inbox-card-actions { grid-template-columns:minmax(0,1fr) minmax(4.4rem,.6fr); }
}
</style>
