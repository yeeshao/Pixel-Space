<script setup lang="ts">
import type { FolderRecord } from './library.api';

const props = defineProps<{
  breadcrumb: Array<{ id: string | null; name: string }>;
  currentFolder: FolderRecord | null;
  currentFolderId: string | null;
}>();

const emit = defineEmits<{
  createFolder: [];
  deleteCurrent: [];
  enterFolder: [id: string | null];
  refresh: [];
  renameCurrent: [];
}>();
</script>

<template>
  <header class="library-header">
    <section class="dashboard-panel path-panel">
      <div class="dashboard-panel-heading compact">
        <div>
          <h2>当前文件路径</h2>
        </div>
        <button type="button" class="library-btn small" @click="emit('refresh')">刷新</button>
      </div>
      <nav class="breadcrumb" aria-label="当前路径">
        <button
          v-for="(crumb, index) in props.breadcrumb"
          :key="crumb.id ?? '__root__'"
          type="button"
          class="crumb"
          :class="{ 'is-current': index === props.breadcrumb.length - 1 }"
          :disabled="index === props.breadcrumb.length - 1"
          @click="emit('enterFolder', crumb.id)"
        >
          {{ crumb.name }}
        </button>
      </nav>
    </section>

    <section class="dashboard-panel folder-actions-panel">
      <div class="dashboard-panel-heading compact"><h2>文件夹管理</h2></div>
      <div class="library-actions">
        <button type="button" class="library-btn" @click="emit('createFolder')">新建文件夹</button>
        <button type="button" class="library-btn" :disabled="!props.currentFolder" @click="emit('renameCurrent')">重命名当前</button>
        <button type="button" class="library-btn danger" :disabled="!props.currentFolder" @click="emit('deleteCurrent')">删除当前</button>
      </div>
    </section>
  </header>
</template>

<style scoped src="./library-view.css"></style>

