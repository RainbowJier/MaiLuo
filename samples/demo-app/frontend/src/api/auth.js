import request from './request'

// 登录
export function login(username, password) {
  return request.post('/api/auth/login', { username, password })
}

// 退出登录
export function logout() {
  return request.post('/api/auth/logout')
}

// 当前登录用户信息
export function getProfile() {
  return request.get('/api/auth/profile')
}
