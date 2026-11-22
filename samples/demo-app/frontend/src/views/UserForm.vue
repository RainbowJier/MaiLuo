<template>
  <div class="user-form">
    <h3>新建用户</h3>
    <div class="field">
      <label>用户名</label>
      <input v-model="form.username" placeholder="4-20 位字母或数字" />
    </div>
    <div class="field">
      <label>邮箱</label>
      <input v-model="form.email" placeholder="name@example.com" />
    </div>
    <div class="field">
      <label>角色</label>
      <select v-model="form.role">
        <option value="admin">管理员</option>
        <option value="operator">运营</option>
        <option value="viewer">只读</option>
      </select>
    </div>
    <div class="actions">
      <button @click="handleSubmit">提交</button>
      <button @click="handleReset">重置</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { createUser } from '../api/user'

const form = reactive({ username: '', email: '', role: 'viewer' })
const error = ref('')

// 提交前本地校验
function validate() {
  if (!form.username || form.username.length < 4) return '用户名至少 4 位'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return '邮箱格式不正确'
  return ''
}

// 提交用户
async function handleSubmit() {
  error.value = validate()
  if (error.value) return
  await createUser({ username: form.username, email: form.email, role: form.role })
  window.location.href = '/user/list'
}

// 重置表单
function handleReset() {
  form.username = ''
  form.email = ''
  form.role = 'viewer'
  error.value = ''
}
</script>
