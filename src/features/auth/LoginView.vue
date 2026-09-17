<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppShell from '@/shared/ui/AppShell.vue';
import { isAdmin, refreshAdmin } from '@/shared/auth/useAdmin';

const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

const consumeRedirectIfAdmin = () => {
  if (!isAdmin.value) return;
  const raw = route.query.redirect;
  const target = typeof raw === 'string' && raw.startsWith('/') ? raw : '/library';
  void router.replace(target);
};

const submit = async () => {
  if (loading.value) return;
  error.value = '';

  if (!username.value.trim() || !password.value) {
    error.value = '请输入账号和密码';
    return;
  }

  loading.value = true;
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value,
      }),
    });

    if (!response.ok) {
      error.value = response.status === 401 ? '账号或密码错误' : '登录服务暂时不可用，请稍后重试';
      return;
    }

    password.value = '';
    await refreshAdmin();
    consumeRedirectIfAdmin();
  } catch {
    error.value = '网络错误，请稍后重试';
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  void refreshAdmin().then(consumeRedirectIfAdmin);
});

watch(isAdmin, (next) => {
  if (next) consumeRedirectIfAdmin();
});
</script>

<template>
  <AppShell fluid>
    <div class="-mx-3 -mt-16 sm:-mx-4">
      <section class="access-stage">
        <div aria-hidden="true" class="grid-bg" />
        <div aria-hidden="true" class="orbs">
          <div class="orb orb-cyan" />
          <div class="orb orb-pink" />
        </div>

        <div class="access-frame">
          <article class="access-card">
            <span class="corner corner-tl" aria-hidden="true" />
            <span class="corner corner-tr" aria-hidden="true" />
            <span class="corner corner-bl" aria-hidden="true" />
            <span class="corner corner-br" aria-hidden="true" />
            <span class="scan" aria-hidden="true" />

            <div class="shield-wrap" aria-hidden="true">
              <svg viewBox="0 0 512 512" fill="currentColor" class="shield">
                <path d="M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8c22 9.3 38.4 31 38.3 57.2c-.5 99.2-41.3 280.7-213.6 363.2c-16.7 8-36.1 8-52.8 0C57.3 420.7 16.5 239.2 16 140c-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.8 1 251.4 0 256 0z" />
              </svg>
            </div>

            <header class="text-center">
              <RouterLink to="/" class="brand">
                <span class="brand-cyan">Pixel</span>
                <span class="brand-pink">Space</span>
              </RouterLink>
              <p class="kicker">Admin Terminal</p>
              <h1 class="title">管理员登录</h1>
              <p class="desc">使用管理员账号和密码进入 Pixel Space 控制台。</p>
            </header>

            <form class="actions" @submit.prevent="submit">
              <label class="field">
                <span>账号</span>
                <input
                  v-model="username"
                  type="text"
                  name="username"
                  autocomplete="username"
                  placeholder="管理员账号"
                  :disabled="loading"
                  autofocus
                />
              </label>

              <label class="field">
                <span>密码</span>
                <input
                  v-model="password"
                  type="password"
                  name="password"
                  autocomplete="current-password"
                  placeholder="管理员密码"
                  :disabled="loading"
                />
              </label>

              <p v-if="error" class="error" role="alert">{{ error }}</p>

              <button class="primary" type="submit" :disabled="loading">
                <span>{{ loading ? '正在验证…' : '账号密码登录' }}</span>
              </button>
            </form>

            <div class="divider"><span>SECURE SESSION</span></div>

            <RouterLink to="/images" class="secondary">
              <span>浏览公开图库</span>
              <span aria-hidden="true">→</span>
            </RouterLink>

            <footer class="status">
              <span class="status-dot" aria-hidden="true" />
              <span>EDGE :: PASSWORD · HTTPONLY SESSION</span>
            </footer>
          </article>
        </div>
      </section>
    </div>
  </AppShell>
</template>

<style scoped>

.field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  text-align: left;
}
.field span {
  color: rgb(148, 163, 184);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.field input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.8rem 0.9rem;
  border: 1px solid rgba(53, 243, 255, 0.22);
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.25);
  color: white;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.field input::placeholder { color: rgba(148, 163, 184, 0.45); }
.field input:focus {
  border-color: rgb(53, 243, 255);
  box-shadow: 0 0 0 3px rgba(53, 243, 255, 0.08);
}
.primary:disabled {
  opacity: 0.55;
  cursor: wait;
  transform: none;
}
.error {
  margin: 0;
  color: rgb(255, 120, 150);
  font-size: 0.8rem;
  text-align: center;
}

.access-stage {
  position: relative;
  min-height: 100vh;
  background: linear-gradient(135deg, #04040c 0%, #070713 50%, #0a0a1a 100%);
  overflow: hidden;
}

.grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(53, 243, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(53, 243, 255, 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at center, black 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

.orbs {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.orb {
  position: absolute;
  width: 28rem;
  height: 28rem;
  border-radius: 9999px;
  filter: blur(90px);
  opacity: 0.22;
}

.orb-cyan {
  top: -6rem;
  left: 12%;
  background: rgb(53, 243, 255);
  animation: orb-cyan 12s ease-in-out infinite;
}

.orb-pink {
  bottom: -8rem;
  right: 12%;
  background: rgb(255, 79, 216);
  animation: orb-pink 14s ease-in-out infinite;
}

@keyframes orb-cyan {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(2rem, 1rem); }
}

@keyframes orb-pink {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-2rem, -1rem); }
}

.access-frame {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 5rem 1.5rem 4rem;
}

.access-card {
  position: relative;
  width: 100%;
  max-width: 28rem;
  padding: 3rem 2rem 1.5rem;
  background: rgba(7, 7, 19, 0.72);
  border: 1px solid rgba(53, 243, 255, 0.28);
  border-radius: 1rem;
  backdrop-filter: blur(20px);
  box-shadow:
    0 4px 30px rgba(0, 0, 0, 0.45),
    inset 0 0 60px rgba(53, 243, 255, 0.04);
  overflow: hidden;
}

@media (min-width: 640px) {
  .access-card {
    padding: 3.25rem 2.75rem 2rem;
  }
}

.corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border-color: rgb(53, 243, 255);
  border-style: solid;
  border-width: 0;
  filter: drop-shadow(0 0 4px rgba(53, 243, 255, 0.55));
}

.corner-tl { top: 8px; left: 8px; border-top-width: 1px; border-left-width: 1px; }
.corner-tr { top: 8px; right: 8px; border-top-width: 1px; border-right-width: 1px; }
.corner-bl { bottom: 8px; left: 8px; border-bottom-width: 1px; border-left-width: 1px; }
.corner-br { bottom: 8px; right: 8px; border-bottom-width: 1px; border-right-width: 1px; }

.scan {
  position: absolute;
  top: 0;
  left: -25%;
  height: 1px;
  width: 25%;
  background: linear-gradient(90deg, transparent, rgb(53, 243, 255), transparent);
  animation: scan-card 4s infinite;
  pointer-events: none;
}

@keyframes scan-card {
  0% { left: -25%; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { left: 100%; opacity: 0; }
}

.shield-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 1.25rem;
}

.shield {
  width: 40px;
  height: 40px;
  color: rgb(53, 243, 255);
  filter: drop-shadow(0 0 12px rgba(53, 243, 255, 0.6));
  animation: shield-pulse 3s ease-in-out infinite;
}

@keyframes shield-pulse {
  0%, 100% { filter: drop-shadow(0 0 12px rgba(53, 243, 255, 0.6)); }
  50% { filter: drop-shadow(0 0 20px rgba(53, 243, 255, 0.9)); }
}

.brand {
  display: inline-flex;
  gap: 0.375rem;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: 0.075em;
  line-height: 1;
}

.brand-cyan {
  color: rgb(53, 243, 255);
  text-shadow: 0 0 10px rgba(53, 243, 255, 0.8), 0 0 20px rgba(53, 243, 255, 0.4);
}

.brand-pink {
  color: rgb(255, 79, 216);
  text-shadow: 0 0 10px rgba(255, 79, 216, 0.8), 0 0 20px rgba(255, 79, 216, 0.4);
}

.kicker {
  margin-top: 0.875rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: rgb(53, 243, 255);
  opacity: 0.85;
}

.title {
  margin-top: 0.375rem;
  font-size: 1.75rem;
  font-weight: 900;
  color: white;
  letter-spacing: 0.05em;
}

.desc {
  margin: 0.875rem auto 0;
  max-width: 22rem;
  font-size: 0.85rem;
  line-height: 1.65;
  color: rgb(148, 163, 184);
}

.hl {
  color: rgb(53, 243, 255);
  font-weight: 600;
}

.actions {
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.primary {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 0.875rem 1.5rem;
  background: rgba(53, 243, 255, 0.08);
  border: 1px solid rgba(53, 243, 255, 0.45);
  border-radius: 0.5rem;
  color: rgb(53, 243, 255);
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  transition: transform 0.25s ease, background 0.25s ease, border-color 0.25s ease, color 0.25s ease, box-shadow 0.25s ease;
  overflow: hidden;
}

.primary::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(53, 243, 255, 0.18), transparent);
  transform: translateX(-100%);
  transition: transform 0.6s ease;
}

.primary:hover {
  background: rgba(53, 243, 255, 0.16);
  border-color: rgb(53, 243, 255);
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 4px 24px rgba(53, 243, 255, 0.32);
}

.primary:hover::before {
  transform: translateX(100%);
}

.primary-icon {
  width: 18px;
  height: 18px;
}

.divider {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 0.65rem;
  color: rgba(148, 163, 184, 0.5);
  letter-spacing: 0.3em;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}

.secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.625rem 1rem;
  color: rgb(148, 163, 184);
  font-size: 0.8rem;
  font-weight: 600;
  transition: color 0.25s ease, gap 0.25s ease;
}

.secondary:hover {
  color: white;
  gap: 0.625rem;
}

.secondary-icon {
  width: 12px;
  height: 12px;
}

.status {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  color: rgba(148, 163, 184, 0.6);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgb(132, 247, 153);
  box-shadow: 0 0 8px rgba(132, 247, 153, 0.6);
  animation: status-pulse 2s ease-in-out infinite;
}

@keyframes status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
