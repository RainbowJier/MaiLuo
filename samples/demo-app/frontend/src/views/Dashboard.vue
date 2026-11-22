<template>
  <div class="dashboard">
    <div class="stats">
      <div class="stat-card">
        <p class="stat-label">用户数</p>
        <p class="stat-value">{{ overview.userCount }}</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">订单数</p>
        <p class="stat-value">{{ overview.orderCount }}</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">销售额</p>
        <p class="stat-value">{{ overview.salesAmount }}</p>
      </div>
    </div>

    <div class="todo">
      <h4>待办事项</h4>
      <ul>
        <li v-for="item in todos" :key="item.id">
          {{ item.title }}（{{ item.count }}）
        </li>
      </ul>
    </div>

    <div class="recent">
      <h4>最近订单</h4>
      <table>
        <tr v-for="o in recentOrders" :key="o.id">
          <td>{{ o.id }}</td>
          <td>{{ o.amount }}</td>
          <td>{{ o.status }}</td>
        </tr>
      </table>
    </div>

    <button @click="handleRefresh">刷新</button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getOverview, getTodoList, getRecentOrders } from '../api/dashboard'

const overview = ref({ userCount: 0, orderCount: 0, salesAmount: 0 })
const todos = ref([])
const recentOrders = ref([])

// 并行加载首页数据
async function load() {
  const [ov, td, ro] = await Promise.all([getOverview(), getTodoList(), getRecentOrders(5)])
  overview.value = ov.data
  todos.value = td.data
  recentOrders.value = ro.data
}

// 手动刷新
async function handleRefresh() {
  await load()
}

onMounted(load)
</script>
