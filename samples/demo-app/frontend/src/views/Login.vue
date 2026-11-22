<template>
  <div class="login">
    <h3>登录</h3>
    <div class="field">
      <label>用户名</label>
      <input v-model="username" placeholder="请输入用户名" />
    </div>
    <div class="field">
      <label>密码</label>
      <input v-model="password" type="password" placeholder="请输入密码" @keyup.enter="handleLogin" />
    </div>
    <label class="remember">
      <input v-model="remember" type="checkbox" /> 记住我
    </label>
    <button :disabled="loading" @click="handleLogin">{{ loading ? '登录中…' : '登录' }}</button>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { login } from '../api/auth'

const username = ref('')
const password = ref('')
const remember = ref(false)
const loading = ref(false)
const error = ref('')

// 登录
async function handleLogin() {
  error.value = ''
  if (!username.value || !password.value) {
    error.value = '用户名和密码不能为空'
    return
  }
  loading.value = true
  try {
    const res = await login(username.value, password.value)
    localStorage.setItem('token', res.data.token)
    if (remember.value) localStorage.setItem('username', username.value)
    window.location.href = '/dashboard'
  } catch (e) {
    error.value = e.response?.data?.message || '登录失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>
