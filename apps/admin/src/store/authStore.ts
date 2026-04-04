import { create } from 'zustand';

interface AdminUser {
  adminId: string;
  fullName: string;
  adminRole: string;
  token: string;
}

interface AuthState {
  user: AdminUser | null;
  setUser: (u: AdminUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: (() => {
    const token = localStorage.getItem('admin_token');
    const info = localStorage.getItem('admin_info');
    if (token && info) return { ...JSON.parse(info), token };
    return null;
  })(),
  setUser: (u) => {
    localStorage.setItem('admin_token', u.token);
    localStorage.setItem('admin_info', JSON.stringify({ adminId: u.adminId, fullName: u.fullName, adminRole: u.adminRole }));
    set({ user: u });
  },
  logout: () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_info');
    set({ user: null });
  },
}));
