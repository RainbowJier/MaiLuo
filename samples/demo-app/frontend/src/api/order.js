import request from './request'

// 查询订单列表
export function getOrders(page, size, keyword) {
  return request.get('/api/order/list', { params: { page, size, keyword } })
}

// 新增订单
export function createOrder(data) {
  return request.post('/api/order/create', data)
}

// 修改订单
export function updateOrder(id, data) {
  return request.put(`/api/order/${id}`, data)
}

// 删除订单
export function deleteOrder(id) {
  return request.delete(`/api/order/${id}`)
}
