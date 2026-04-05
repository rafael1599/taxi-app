import axios from 'axios';

export const api = axios.create({ baseURL: '/api/v1' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Platform admins send selected company via header
  const info = localStorage.getItem('admin_info');
  if (info) {
    try {
      const parsed = JSON.parse(info);
      if (parsed.adminRole === 'platform_admin') {
        const companyId = localStorage.getItem('selected_company_id');
        if (companyId) config.headers['X-Company-Id'] = companyId;
      }
    } catch {
      /* ignore */
    }
  }

  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
