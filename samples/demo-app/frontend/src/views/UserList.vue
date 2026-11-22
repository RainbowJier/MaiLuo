<template>
  <div class="user-list">
    <div class="toolbar">
      <input v-model="keyword" placeholder="用户名/邮箱" />
      <button @click="handleSearch">查询</button>
      <button @click="handleCreate">新建用户</button>
    </div>
    <table>
      <tr v-for="row in rows" :key="row.id">
        <td>{{ row.id }}</td>
        <td>{{ row.username }}</td>
        <td>{{ row.email }}</td>
        <td>{{ row.enabled ? '启用' : '禁用' }}</td>
        <td>
          <button @click="handleToggle(row)">{{ row.enabled ? '禁用' : '启用' }}</button>
          <button @click="handleDelete(row)">删除</button>
        </td>
      </tr>
    </table>
    <div class="pager">
      <button :disabled="page <= 1" @click="handlePrev">上一页</button>
      <span>{{ page }} / {{ totalPages }}</span>
      <button :disabled="page >= totalPages" @click="handleNext">下一页</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getUsers, deleteUser, toggleUserStatus } from '../api/user'

const keyword = ref('')
const rows = ref([])
const page = ref(1)
const totalPages = ref(1)

// 加载用户列表
async function load() {
  const res = await getUsers(page.value, 10, keyword.value)
  rows.value = res.data.list
  totalPages.value = res.data.totalPages
}

// 查询
async function handleSearch() {
  page.value = 1
  await load()
}

// 新建用户（跳转表单页）
function handleCreate() {
  window.location.href = '/user/create'
}

// 启用 / 禁用
async function handleToggle(row) {
  if (row.enabled && !window.confirm(`确定禁用用户「${row.username}」？`)) return
  await toggleUserStatus(row.id, !row.enabled)
  await load()
}

// 删除用户
async function handleDelete(row) {
  if (!window.confirm(`删除用户「${row.username}」？`)) return
  await deleteUser(row.id)
  await load()
}

async function handlePrev() {
  if (page.value <= 1) return
  page.value -= 1
  await load()
}

async function handleNext() {
  if (page.value >= totalPages.value) return
  page.value += 1
  await load()
}

onMounted(load)
</script>
