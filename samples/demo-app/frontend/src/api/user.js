import request from './request'

// 分页查询用户
export function getUsers(page, size, keyword) {
  return request.get('/api/user/list', { params: { page, size, keyword } })
}

// 新增用户
export function createUser(data) {
  return request.post('/api/user/create', data)
}

// 修改用户
export function updateUser(id, data) {
  return request.put(`/api/user/${id}`, data)
}

// 删除用户
export function deleteUser(id) {
  return request.delete(`/api/user/${id}`)
}

// 启用 / 禁用用户
export function toggleUserStatus(id, enabled) {
  return request.put(`/api/user/${id}/status`, { enabled })
}
