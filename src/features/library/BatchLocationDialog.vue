<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import LocationSearch from '@/features/images/LocationSearch.vue';
import type { GeocodeRegion, GeocodeResult } from '@/features/images/geocode.api';
import { createChinaPickAdapter, createWorldPickAdapter } from '@/features/upload/pick-map';
import { useUploadPickMap } from '@/features/upload/useUploadPickMap';
import type { MapRegion } from '@/features/upload/map-coordinate';

const props = defineProps<{
  open: boolean;
  selectedCount: number;
}>();

const emit = defineEmits<{
  close: [];
  save: [payload: {
    location_name: string | null;
    location_lat: number | null;
    location_lng: number | null;
    location_region: MapRegion | null;
  }];
}>();

interface BatchLocationEntry {
  id: string;
  meta: {
    location_lat: number | null;
    location_lng: number | null;
    location_region: MapRegion | null;
  };
}

const entry = ref<BatchLocationEntry>({
  id: 'batch-location',
  meta: {
    location_lat: null,
    location_lng: null,
    location_region: null,
  },
});
const locationName = ref('');

const {
  mapRef,
  mapLoadState,
  pickRegion,
  setEntryCoordinates,
  mountMap,
  onSearchRegionChange,
  syncCurrentEntryMap,
  destroyMap,
} = useUploadPickMap({
  currentEntry: entry,
  createChinaAdapter: createChinaPickAdapter,
  createWorldAdapter: createWorldPickAdapter,
});

const setMapElement = (element: Element | ComponentPublicInstance | null) => {
  mapRef.value = element as HTMLElement | null;
};

const resetDraft = () => {
  entry.value.meta.location_lat = null;
  entry.value.meta.location_lng = null;
  entry.value.meta.location_region = null;
  locationName.value = '';
};

const applySearchResult = (result: GeocodeResult) => {
  locationName.value = result.name;
  setEntryCoordinates(
    entry.value,
    result.lat,
    result.lng,
    true,
    pickRegion.value,
  );
};

const handleRegionChange = async (region: GeocodeRegion) => {
  await onSearchRegionChange(region);
};

const clearLocation = () => {
  locationName.value = '';
  setEntryCoordinates(entry.value, null, null, false);
};

const save = () => {
  const lat = entry.value.meta.location_lat;
  const lng = entry.value.meta.location_lng;
  emit('save', {
    location_name: locationName.value.trim() || null,
    location_lat: lat,
    location_lng: lng,
    location_region: entry.value.meta.location_region,
  });
};

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      destroyMap();
      return;
    }
    resetDraft();
    await nextTick();
    if (pickRegion.value !== 'cn') await onSearchRegionChange('cn');
    await mountMap();
    syncCurrentEntryMap();
  },
  { immediate: true },
);

watch(
  () => [entry.value.meta.location_lat, entry.value.meta.location_lng],
  () => {
    if (props.open) syncCurrentEntryMap();
  },
);

onBeforeUnmount(destroyMap);
</script>

<template>
  <Teleport to="body">
    <Transition name="batch-location">
      <div v-if="open" class="batch-location-overlay" @click.self="emit('close')">
        <section class="batch-location-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-location-title">
          <header class="batch-location-header">
            <div>
              <h2 id="batch-location-title">批量设置位置</h2>
              <p>将位置应用到已选 {{ selectedCount }} 张图片</p>
            </div>
            <button type="button" class="batch-location-close" @click="emit('close')">×</button>
          </header>

          <div class="batch-location-body">
            <label class="batch-location-field">
              <span>位置名称</span>
              <input v-model="locationName" type="text" placeholder="例如：上海 外滩" />
            </label>

            <div class="batch-location-map-section">
              <div class="batch-location-map-title">
                <span>地图坐标</span>
                <button type="button" class="batch-location-clear" @click="clearLocation">清空</button>
              </div>

              <LocationSearch
                :model-value="pickRegion"
                @select="applySearchResult"
                @region-change="handleRegionChange"
              />

              <div :ref="setMapElement" class="batch-location-map" aria-label="点击地图选择位置"></div>
              <p v-if="mapLoadState !== 'ready'" class="batch-location-map-status">正在加载地图…</p>

              <div class="batch-location-coords">
                <label>
                  <span>纬度</span>
                  <input
                    :value="entry.meta.location_lat ?? ''"
                    type="number"
                    step="0.000001"
                    placeholder="纬度"
                    @input="setEntryCoordinates(entry, Number(($event.target as HTMLInputElement).value) || null, entry.meta.location_lng, true, pickRegion)"
                  />
                </label>
                <label>
                  <span>经度</span>
                  <input
                    :value="entry.meta.location_lng ?? ''"
                    type="number"
                    step="0.000001"
                    placeholder="经度"
                    @input="setEntryCoordinates(entry, entry.meta.location_lat, Number(($event.target as HTMLInputElement).value) || null, true, pickRegion)"
                  />
                </label>
              </div>
            </div>
          </div>

          <footer class="batch-location-footer">
            <button type="button" class="library-btn ghost" @click="emit('close')">取消</button>
            <button type="button" class="library-btn primary" @click="save">应用到 {{ selectedCount }} 张</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.batch-location-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(8px);
}

.batch-location-dialog {
  width: min(760px, 100%);
  max-height: min(90vh, 820px);
  overflow: auto;
  border: 1px solid rgba(53, 243, 255, 0.3);
  border-radius: 12px;
  background: rgba(7, 7, 19, 0.97);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.58), 0 0 35px rgba(53, 243, 255, 0.08);
}

.batch-location-header,
.batch-location-footer,
.batch-location-map-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.batch-location-header {
  padding: 1rem 1.15rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.batch-location-header h2 {
  margin: 0;
  color: white;
  font-size: 1.05rem;
  font-weight: 900;
}

.batch-location-header p {
  margin: 0.25rem 0 0;
  color: rgba(203, 213, 225, 0.68);
  font-size: 0.75rem;
}

.batch-location-close {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 6px;
  background: transparent;
  color: rgba(226, 232, 240, 0.75);
  font-size: 1.4rem;
  cursor: pointer;
}

.batch-location-body {
  display: grid;
  gap: 1rem;
  padding: 1rem 1.15rem;
}

.batch-location-field,
.batch-location-coords label {
  display: grid;
  gap: 0.35rem;
}

.batch-location-field > span,
.batch-location-coords span,
.batch-location-map-title > span {
  color: rgba(165, 243, 252, 0.86);
  font-size: 0.72rem;
  font-weight: 800;
}

.batch-location-field input,
.batch-location-coords input {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  border: 1px solid rgba(53, 243, 255, 0.22);
  border-radius: 6px;
  background: rgba(9, 14, 28, 0.8);
  color: rgb(226, 232, 240);
  padding: 0 0.65rem;
  outline: none;
}

.batch-location-field input:focus,
.batch-location-coords input:focus {
  border-color: rgba(53, 243, 255, 0.62);
  box-shadow: 0 0 0 2px rgba(53, 243, 255, 0.1);
}

.batch-location-map-section {
  display: grid;
  gap: 0.55rem;
}

.batch-location-clear {
  border: 0;
  background: transparent;
  color: rgb(148, 163, 184);
  font-size: 0.7rem;
  cursor: pointer;
}

.batch-location-clear:hover {
  color: rgb(53, 243, 255);
}

.batch-location-map {
  height: 330px;
  overflow: hidden;
  border: 1px solid rgba(53, 243, 255, 0.2);
  border-radius: 7px;
  background: rgba(7, 7, 19, 0.72);
}

.batch-location-map :deep(.amap-toolbar),
.batch-location-map :deep(.amap-scalecontrol),
.batch-location-map :deep(.maplibregl-ctrl-attrib) {
  background: rgba(7, 7, 19, 0.72);
}

.batch-location-map :deep(.maplibregl-ctrl-attrib),
.batch-location-map :deep(.maplibregl-ctrl-attrib a) {
  color: rgba(148, 163, 184, 0.82);
}

.batch-location-map :deep(.map-marker) {
  --pin-color: rgb(53, 243, 255);
  --pin-glow: rgba(53, 243, 255, 0.48);
}

.batch-location-map :deep(.map-location-pin) {
  position: relative;
  display: block;
  width: 1.65rem;
  height: 2.15rem;
  filter: drop-shadow(0 0 12px var(--pin-glow));
}

.batch-location-map :deep(.map-location-pin::before) {
  position: absolute;
  inset: 0.05rem 0.08rem 0.2rem;
  content: '';
  background: linear-gradient(145deg, rgb(255, 255, 255), var(--pin-color) 28%, rgb(8, 145, 178));
  border: 2px solid rgb(255, 255, 255);
  clip-path: polygon(50% 100%, 14% 50%, 14% 20%, 30% 4%, 70% 4%, 86% 20%, 86% 50%);
}

.batch-location-map :deep(.map-location-pin-dot) {
  position: absolute;
  top: 0.48rem;
  left: 50%;
  width: 0.48rem;
  height: 0.48rem;
  border-radius: 50%;
  background: rgb(255, 255, 255);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2);
  transform: translateX(-50%);
}

.batch-location-map-status {
  margin: 0;
  color: rgb(148, 163, 184);
  font-size: 0.72rem;
}

.batch-location-coords {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}

.batch-location-footer {
  padding: 0.9rem 1.15rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.batch-location-enter-active,
.batch-location-leave-active {
  transition: opacity 180ms ease;
}

.batch-location-enter-from,
.batch-location-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .batch-location-overlay {
    padding: 0.5rem;
    align-items: flex-end;
  }

  .batch-location-dialog {
    max-height: 94vh;
    border-radius: 10px 10px 0 0;
  }

  .batch-location-map {
    height: 280px;
  }
}
</style>
