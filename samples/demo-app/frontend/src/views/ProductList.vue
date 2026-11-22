<template>
  <div class="product-list">
    <div class="toolbar">
      <input v-model="keyword" placeholder="商品名称" />
      <select v-model="categoryId">
        <option :value="null">全部分类</option>
        <option :value="1">数码</option>
        <option :value="2">家居</option>
      </select>
      <button @click="handleSearch">查询</button>
    </div>
    <table>
      <tr v-for="row in rows" :key="row.id">
        <td>{{ row.name }}</td>
        <td>{{ row.price }}</td>
        <td>{{ row.onSale ? '在售' : '下架' }}</td>
        <td><button @click="handleDetail(row)">详情</button></td>
        <td><button @click="handleToggleSale(row)">{{ row.onSale ? '下架' : '上架' }}</button></td>
        <td><button @click="handleDelete(row)">删除</button></td>
      </tr>
    </table>

    <div v-if="detail" class="detail-modal">
      <h4>{{ detail.name }}</h4>
      <p>价格：{{ detail.price }}</p>
      <p>库存：{{ detail.stock }}</p>
      <p>描述：{{ detail.description }}</p>
      <button @click="detail = null">关闭</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getProducts, getProductDetail, updateProductStatus, deleteProduct } from '../api/product'

const keyword = ref('')
const categoryId = ref(null)
const rows = ref([])
const detail = ref(null)

// 加载商品列表
async function load() {
  const res = await getProducts(1, 20, keyword.value, categoryId.value)
  rows.value = res.data.list
}

async function handleSearch() {
  await load()
}

// 查看详情
async function handleDetail(row) {
  detail.value = await getProductDetail(row.id)
}

// 上架 / 下架
async function handleToggleSale(row) {
  if (row.onSale && !window.confirm('下架后用户将无法购买，确定？')) return
  await updateProductStatus(row.id, !row.onSale)
  await load()
}

// 删除商品
async function handleDelete(row) {
  if (!window.confirm(`删除商品「${row.name}」？`)) return
  await deleteProduct(row.id)
  await load()
}

onMounted(load)
</script>
