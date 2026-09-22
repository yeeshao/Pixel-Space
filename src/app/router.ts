import { createRouter, createWebHistory } from 'vue-router';

import { isAdmin, refreshAdmin } from '@/shared/auth/useAdmin';
import GalleryView from '@/features/images/GalleryView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/features/home/HomeView.vue'),
      meta: {
        title: '首页',
      },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/features/auth/LoginView.vue'),
      meta: {
        title: '接入',
      },
    },
    {
      path: '/upload',
      name: 'upload',
      component: () => import('@/features/upload/UploadView.vue'),
      meta: {
        title: '上传',
        requiresAdmin: true,
      },
    },
    {
      path: '/images',
      name: 'gallery',
      component: GalleryView,
      meta: {
        title: '探索',
      },
    },
    {
      path: '/p/:key',
      name: 'public-image',
      component: () => import('@/features/images/PublicImageView.vue'),
      props: true,
      meta: {
        title: '公开图片',
      },
    },
    {
      path: '/random',
      name: 'random',
      component: () => import('@/features/random/RandomView.vue'),
      meta: {
        title: '随机',
      },
    },
    {
      path: '/footprints',
      name: 'footprints',
      component: () => import('@/features/footprints/FootprintsView.vue'),
      meta: {
        title: '足迹',
      },
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('@/features/library/LibraryView.vue'),
      meta: {
        title: '控制台',
        requiresAdmin: true,
      },
    },
    {
      path: '/access',
      name: 'access',
      component: () => import('@/features/access/AccessView.vue'),
      meta: {
        title: '原图通行',
      },
    },
  ],
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAdmin) return true;
  if (!isAdmin.value) await refreshAdmin();
  if (isAdmin.value) return true;
  return { name: 'login', query: { redirect: to.fullPath } };
});

// 防止 Vue Router 在同一次页面初始化/同一次导航过程中重复触发 afterEach，
// 从而导致一次刷新被统计为 2 次访问。
// 页面真正刷新后模块会重新加载，所以刷新一次仍会正常 +1。
let lastVisitPath = '';
let lastVisitAt = 0;

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? 'Pixel Space')} · Pixel Space`;

  // 统计网页访问次数，而不是照片访问次数。
  // 只统计公开页面，管理员控制台/上传页不会进入网站公开访问数。
  if (!to.meta.requiresAdmin && to.name !== 'login') {
    const now = Date.now();
    const path = to.fullPath;

    // 同一路径在 1500ms 内重复完成导航时只记 1 次。
    // 这能过滤初始化阶段的重复 afterEach，但不会影响真正刷新页面：
    // 刷新后 JS 上下文重建，lastVisitPath / lastVisitAt 会重新初始化。
    if (path === lastVisitPath && now - lastVisitAt < 1500) return;

    lastVisitPath = path;
    lastVisitAt = now;

    void fetch('/api/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => undefined);
  }
});

export default router;

