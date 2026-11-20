import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // Crucial: send/receive HTTP-only cookies
  headers: {
    'Content-Type': 'application/json',
  },
})

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only redirect to login if 401 is NOT from /auth/me
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/me')) {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
