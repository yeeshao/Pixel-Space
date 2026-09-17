<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { logoutAdmin } from '@/shared/auth/useAdmin';

const currentPassword = ref('');
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const saving = ref(false);
const message = ref('');
const error = ref('');


onMounted(async () => {
  const response = await fetch('/api/admin/me', { credentials: 'same-origin' });
  if (response.ok) {
    const data = await response.json() as { email?: string };
    username.value = data.email ?? '';
  }
});

const save = async () => {
  message.value = '';
  error.value = '';
  if (!currentPassword.value || !username.value.trim() || !password.value) {
    error.value = '请填写当前密码、新账号和新密码';
    return;
  }
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }

  saving.value = true;
  try {
    const response = await fetch('/api/admin/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        username: username.value.trim(),
        password: password.value,
        confirmPassword: confirmPassword.value,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      error.value = data.error === 'current_credentials_invalid' ? '当前密码错误' : '保存失败，请稍后重试';
      return;
    }

    message.value = '账号密码已修改，旧登录会话已失效。';
    currentPassword.value = '';
    password.value = '';
    confirmPassword.value = '';
    setTimeout(() => logoutAdmin(), 900);
  } catch {
    error.value = '网络错误，请稍后重试';
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <section class="account-panel">
    <div class="account-heading">
      <div>
        <h2>管理员账户</h2>
        <p>可直接在后台修改登录账号和密码。</p>
      </div>
    </div>

    <form class="account-form" @submit.prevent="save">
      <label>
        <span>当前密码</span>
        <input v-model="currentPassword" type="password" autocomplete="current-password" placeholder="验证当前密码" :disabled="saving" />
      </label>
      <label>
        <span>新账号</span>
        <input v-model="username" type="text" autocomplete="username" placeholder="管理员账号" :disabled="saving" />
      </label>
      <label>
        <span>新密码</span>
        <input v-model="password" type="password" autocomplete="new-password" placeholder="新的登录密码" :disabled="saving" />
      </label>
      <label>
        <span>确认新密码</span>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" :disabled="saving" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="message" class="message">{{ message }}</p>
      <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存管理员账户' }}</button>
    </form>
  </section>
</template>

<style scoped>
.account-panel { margin-top: 1rem; padding: 1.25rem; border: 1px solid rgba(255,255,255,.08); border-radius: .75rem; background: rgba(255,255,255,.025); }
.account-heading h2 { margin: 0; font-size: 1rem; color: white; }
.account-heading p { margin: .35rem 0 0; color: rgb(148,163,184); font-size: .8rem; }
.account-form { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: .75rem; margin-top: 1rem; align-items: end; }
.account-form label { display: flex; flex-direction: column; gap: .35rem; }
.account-form span { font-size: .7rem; color: rgb(148,163,184); }
.account-form input { width: 100%; box-sizing: border-box; padding: .65rem .7rem; border: 1px solid rgba(53,243,255,.2); border-radius: .4rem; background: rgba(0,0,0,.2); color: white; outline: none; }
.account-form button { padding: .65rem .8rem; border: 1px solid rgba(53,243,255,.4); border-radius: .4rem; background: rgba(53,243,255,.08); color: rgb(53,243,255); cursor: pointer; }
.error { grid-column: 1 / -1; margin: 0; color: rgb(255,120,150); font-size: .8rem; }
.message { grid-column: 1 / -1; margin: 0; color: rgb(132,247,153); font-size: .8rem; }
@media (max-width: 900px) { .account-form { grid-template-columns: 1fr 1fr; } }
@media (max-width: 560px) { .account-form { grid-template-columns: 1fr; } }
</style>
