<script setup lang="ts">
defineProps<{
  currentFolderId: string | null;
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
}>();
</script>

<template>
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
</template>

<style scoped src="./library-view.css"></style>
