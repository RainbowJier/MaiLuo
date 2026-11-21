<template>
  <div class="order-list">
    <div class="toolbar">
      <input v-model="keyword" placeholder="订单号/商品名" />
      <button @click="handleSearch">查询</button>
      <button @click="handleSubmit">提交订单</button>
    </div>
    <table>
      <tr v-for="row in rows" :key="row.id">
        <td>{{ row.id }}</td>
        <td>{{ row.amount }}</td>
        <td><button @click="handleEdit(row)">修改地址</button></td>
        <td><button @click="handleDelete(row)">取消订单</button></td>
      </tr>
    </table>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { getOrders, createOrder, updateOrder, deleteOrder } from '../api/order'

const keyword = ref('')
const rows = ref([])

// 查询订单列表
async function handleSearch() {
  const res = await getOrders(1, 20, keyword.value)
  rows.value = res.data.list
}

// 提交（新增）订单
async function handleSubmit() {
  await createOrder({ skuId: 1001, quantity: 2, address: '北京市朝阳区', remark: '尽快发货' })
  await handleSearch()
}

// 修改订单收货地址
async function handleEdit(row) {
  await updateOrder(row.id, { address: '上海市浦东新区', remark: '', version: row.version })
}

// 取消（删除）订单
async function handleDelete(row) {
  await deleteOrder(row.id)
  await handleSearch()
}
</script>
