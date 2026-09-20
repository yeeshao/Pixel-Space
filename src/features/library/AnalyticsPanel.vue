<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchJson } from '@/shared/api/http';

interface AnalyticsResponse {
  views: number;
  downloads: number;
  recent: Array<{
    id: number;
    image_key: string;
    original_filename: string | null;
    event: 'view' | 'download';
    ip: string;
    user_agent: string | null;
    cf_ray: string | null;
    created_at: string;
  }>;
  top: Array<{
    key: string;
    original_filename: string;
    view_count: number;
    download_count: number;
  }>;
}

const stats = ref<AnalyticsResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const load = async () => {
  loading.value = true;
  error.value = null;
  try {
    stats.value = await fetchJson<AnalyticsResponse>('/api/admin/analytics');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '统计加载失败';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
</script>

<template>
  <section class="mb-5 rounded-xl border border-white/10 bg-black/20 p-4 backdrop-blur">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-sm font-semibold text-white">访问与下载统计</div>
        <div class="mt-1 text-xs text-slate-500">公开图片详情访问计入访问数，明确下载原图才计入下载数</div>
      </div>
      <button
        type="button"
        class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-neon-cyan/40 hover:text-white disabled:opacity-50"
        :disabled="loading"
        @click="load"
      >
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-300">
      {{ error }}
    </div>

    <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-lg border border-white/5 bg-white/[0.03] p-3">
        <div class="text-xs text-slate-500">总访问</div>
        <div class="mt-1 font-mono text-xl font-bold text-neon-cyan">{{ (stats?.views ?? 0).toLocaleString() }}</div>
      </div>
      <div class="rounded-lg border border-white/5 bg-white/[0.03] p-3">
        <div class="text-xs text-slate-500">总下载</div>
        <div class="mt-1 font-mono text-xl font-bold text-neon-pink">{{ (stats?.downloads ?? 0).toLocaleString() }}</div>
      </div>
    </div>



    <div v-if="stats?.recent.length" class="mt-5">
      <div class="mb-2 text-xs font-semibold text-slate-300">最近访问 / 下载（仅控制台可见）</div>
      <div class="max-h-72 overflow-auto rounded-lg border border-white/5">
        <table class="w-full min-w-[760px] text-left text-xs">
          <thead class="sticky top-0 bg-[#090916] text-slate-500">
            <tr class="border-b border-white/5">
              <th class="px-2 py-2 font-medium">时间</th>
              <th class="px-2 py-2 font-medium">类型</th>
              <th class="px-2 py-2 font-medium">照片</th>
              <th class="px-2 py-2 font-medium">IP</th>
              <th class="px-2 py-2 font-medium">User-Agent</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in stats.recent" :key="event.id" class="border-b border-white/[0.03] text-slate-300">
              <td class="whitespace-nowrap px-2 py-2 font-mono text-slate-500">{{ event.created_at }}</td>
              <td class="px-2 py-2">{{ event.event === 'view' ? '访问' : '下载' }}</td>
              <td class="max-w-[240px] truncate px-2 py-2">{{ event.original_filename || event.image_key }}</td>
              <td class="whitespace-nowrap px-2 py-2 font-mono text-neon-cyan">{{ event.ip }}</td>
              <td class="max-w-[360px] truncate px-2 py-2 text-slate-500">{{ event.user_agent || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-if="stats?.top.length" class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[560px] text-left text-xs">
        <thead class="text-slate-500">
          <tr class="border-b border-white/5">
            <th class="px-2 py-2 font-medium">照片</th>
            <th class="px-2 py-2 text-right font-medium">访问</th>
            <th class="px-2 py-2 text-right font-medium">下载</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in stats.top" :key="item.key" class="border-b border-white/[0.03] text-slate-300">
            <td class="max-w-[360px] truncate px-2 py-2">{{ item.original_filename || item.key }}</td>
            <td class="px-2 py-2 text-right font-mono">{{ item.view_count.toLocaleString() }}</td>
            <td class="px-2 py-2 text-right font-mono">{{ item.download_count.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
