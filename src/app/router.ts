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

let sitePresenceActive = false;

const sendSitePresence = (action: 'enter' | 'leave') => {
  const body = JSON.stringify({ action });

  // sendBeacon is reliable during tab close/navigation. Fall back to fetch
  // for browsers where Beacon is unavailable.
  if (action === 'leave' && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/visit',
      new Blob([body], { type: 'application/json' }),
    );
    return;
  }

  void fetch('/api/visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
};

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? 'Pixel Space')} · Pixel Space`;

  // A visitor gets one active presence record per IP. Route changes inside
  // the SPA do not create a new entry; pagehide closes the current visit.
  if (!to.meta.requiresAdmin && to.name !== 'login' && !sitePresenceActive) {
    sitePresenceActive = true;
    sendSitePresence('enter');
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!sitePresenceActive) return;
    sitePresenceActive = false;
    sendSitePresence('leave');
  });

  window.addEventListener('pageshow', () => {
    if (sitePresenceActive) return;
    const current = router.currentRoute.value;
    if (!current.meta.requiresAdmin && current.name !== 'login') {
      sitePresenceActive = true;
      sendSitePresence('enter');
    }
  });
}

export default router;
