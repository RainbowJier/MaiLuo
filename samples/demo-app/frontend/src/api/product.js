import request from './request'

// 分页查询商品
export function getProducts(page, size, keyword, categoryId) {
  return request.get('/api/product/list', { params: { page, size, keyword, categoryId } })
}

// 商品详情
export function getProductDetail(id) {
  return request.get(`/api/product/detail/${id}`)
}

// 上架 / 下架
export function updateProductStatus(id, onSale) {
  return request.put(`/api/product/${id}/status`, { onSale })
}

// 删除商品
export function deleteProduct(id) {
  return request.delete(`/api/product/${id}`)
}
