<script setup lang="ts">
import type { AiSettings, FolderRecord } from './library.api';
import {
  VIRTUAL_DOWNLOAD_GRANTS,
  VIRTUAL_HIDDEN_IMAGES,
  VIRTUAL_HIDDEN_LOCATIONS,
  type VirtualFolder,
  virtualFolders,
} from './useLibraryDirectory';

const props = defineProps<{
  aiSettingsForm: AiSettings;
  aiSettingsSaving: boolean;
  breadcrumb: Array<{ id: string | null; name: string }>;
  currentFolder: FolderRecord | null;
  currentFolderId: string | null;
  currentVirtual: VirtualFolder | null;
  virtualCounts: Record<VirtualFolder['id'], number>;
}>();

const emit = defineEmits<{
  createFolder: [];
  deleteCurrent: [];
  enterFolder: [id: string | null];
  refresh: [];
  renameCurrent: [];
  saveAiSettings: [];
}>();
</script>

<template>
  <header class="library-header">
    <!-- ① 控制台 -->
    <div class="library-title dashboard-section-title">
      <h1>控制台</h1>
      <span>文件库管理</span>
    </div>

    <!-- ② AI 配置 -->
    <section class="ai-settings-panel dashboard-ai-panel" aria-labelledby="ai-settings-title">
      <form class="ai-settings-form" @submit.prevent="emit('saveAiSettings')">
        <div class="ai-settings-heading">
          <div>
            <h2 id="ai-settings-title">AI 配置</h2>
            <p>图片分析与自动入库</p>
          </div>
          <button type="submit" class="library-btn primary" :disabled="props.aiSettingsSaving">
            {{ props.aiSettingsSaving ? '保存中…' : '保存' }}
          </button>
        </div>
        <div class="settings-grid">
          <label class="settings-field">
            <span>Proxy URL</span>
            <input v-model="props.aiSettingsForm.proxy_url" class="settings-input" type="url" autocomplete="off" placeholder="https://example.test/v1/chat/completions" />
          </label>
          <label class="settings-field">
            <span>Model</span>
            <input v-model="props.aiSettingsForm.model" class="settings-input" type="text" autocomplete="off" placeholder="gpt-4.1-mini" />
          </label>
        </div>
        <label class="settings-field settings-prompt-field">
          <span>Prompt</span>
          <textarea v-model="props.aiSettingsForm.prompt" class="settings-input settings-textarea" autocomplete="off" spellcheck="false" placeholder="编辑图片分析系统提示词" />
        </label>
      </form>
    </section>

    <!-- ③ Telegram 暂存插槽：放在 AI 后面 -->
    <div class="telegram-slot dashboard-telegram-slot">
      <slot name="telegram" />
    </div>

    <!-- ④ 智能目录：未公开图片 / 未公开位置 / 验证码管理 -->
    <section class="dashboard-panel smart-directory-panel" aria-label="智能目录">
      <div class="dashboard-panel-heading">
        <div>
          <h2>智能目录</h2>
          <p>快速查看需要处理的内容</p>
        </div>
      </div>
      <section class="folder-grid shortcut-grid">
        <button
          v-for="vf in virtualFolders"
          :key="vf.id"
          type="button"
          class="folder-card shortcut-card"
          :class="{ 'is-active': props.currentFolderId === vf.id }"
          :title="vf.description"
          @click="emit('enterFolder', vf.id)"
        >
          <div class="folder-icon shortcut-icon" aria-hidden="true">
            <svg v-if="vf.id === VIRTUAL_HIDDEN_IMAGES" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" />
            </svg>
            <svg v-else-if="vf.id === VIRTUAL_HIDDEN_LOCATIONS" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /><line x1="3" y1="3" x2="21" y2="21" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 2 2" /><path d="m18.5 4.5 2 2" />
            </svg>
          </div>
          <div class="folder-body">
            <p class="folder-name shortcut-name">{{ vf.name }}</p>
            <p class="folder-meta shortcut-meta">
              <template v-if="vf.id === VIRTUAL_DOWNLOAD_GRANTS">{{ props.virtualCounts[vf.id] }} 个验证码</template>
              <template v-else>{{ props.virtualCounts[vf.id] }} 张图片</template>
            </p>
          </div>
        </button>
      </section>
    </section>

    <!-- ⑤ 当前文件路径 -->
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

    <!-- ⑥ 文件夹管理按钮 -->
    <section class="dashboard-panel folder-actions-panel">
      <div class="dashboard-panel-heading compact"><h2>文件夹管理</h2></div>
      <div class="library-actions">
        <button type="button" class="library-btn" :disabled="!!props.currentVirtual" @click="emit('createFolder')">新建文件夹</button>
        <button type="button" class="library-btn" :disabled="!props.currentFolder" @click="emit('renameCurrent')">重命名当前</button>
        <button type="button" class="library-btn danger" :disabled="!props.currentFolder" @click="emit('deleteCurrent')">删除当前</button>
      </div>
    </section>
  </header>
</template>

<style scoped src="./library-view.css"></style>
