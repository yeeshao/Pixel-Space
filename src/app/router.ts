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

// 访问统计只在当前页面文档启动一次。SPA 内部切换路由不能重新创建
// heartbeat，也不能重新发送 enter；真正离开网站时由 pagehide 发送 leave。
let visitTrackingStarted = false;
let heartbeatTimer: number | null = null;

const postVisit = (action: 'enter' | 'heartbeat' | 'leave') => {
  const body = JSON.stringify({ action });

  // sendBeacon 专门用于页面关闭/离开场景，比普通 fetch 更可靠。
  if (action === 'leave' && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon('/api/visit', blob)) return;
  }

  void fetch('/api/visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'include',
    cache: 'no-store',
  }).catch(() => undefined);
};

const startVisitTracking = () => {
  if (visitTrackingStarted) return;
  visitTrackingStarted = true;

  postVisit('enter');

  // 正常浏览期间每 30 秒续一次在线状态。
  // 如果浏览器被系统直接杀掉、没有触发 pagehide，后台会在 90 秒后
  // 根据 last_seen_at 将该 IP 视为已离开。
  heartbeatTimer = window.setInterval(() => postVisit('heartbeat'), 30_000);
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    postVisit('leave');
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }, { once: true });
}

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? 'Pixel Space')} · Pixel Space`;

  // 只统计公开页面，管理员控制台/登录页不计入网站访问次数。
  if (!to.meta.requiresAdmin && to.name !== 'login') {
    startVisitTracking();
  }
});

export default router;

