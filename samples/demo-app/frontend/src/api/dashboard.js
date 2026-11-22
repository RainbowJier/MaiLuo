import request from './request'

// 经营概览（用户数 / 订单数 / 销售额）
export function getOverview() {
  return request.get('/api/dashboard/overview')
}

// 待办事项（待发货订单、库存预警）
export function getTodoList() {
  return request.get('/api/dashboard/todo')
}

// 最近订单
export function getRecentOrders(limit) {
  return request.get('/api/dashboard/recent-orders', { params: { limit } })
}
