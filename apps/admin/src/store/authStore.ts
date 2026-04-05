import { create } from 'zustand';

interface AdminUser {
  adminId: string;
  fullName: string;
  adminRole: string;
  companyId?: string;
  token: string;
}

interface Company {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  isActive: boolean;
}

interface AuthState {
  user: AdminUser | null;
  companies: Company[];
  selectedCompanyId: string | null;
  setUser: (u: AdminUser) => void;
  setCompanies: (c: Company[]) => void;
  setSelectedCompanyId: (id: string) => void;
  logout: () => void;
  isPlatformAdmin: () => boolean;
  getEffectiveCompanyId: () => string | null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: (() => {
    const token = localStorage.getItem('admin_token');
    const info = localStorage.getItem('admin_info');
    if (token && info) {
      try {
        return { ...JSON.parse(info), token };
      } catch {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_info');
        return null;
      }
    }
    return null;
  })(),
  companies: [],
  selectedCompanyId: localStorage.getItem('selected_company_id'),
  setUser: (u) => {
    localStorage.setItem('admin_token', u.token);
    localStorage.setItem(
      'admin_info',
      JSON.stringify({
        adminId: u.adminId,
        fullName: u.fullName,
        adminRole: u.adminRole,
        companyId: u.companyId,
      }),
    );
    set({ user: u });
    // Auto-set company for company-scoped admins
    if (u.companyId) {
      localStorage.setItem('selected_company_id', u.companyId);
      set({ selectedCompanyId: u.companyId });
    }
  },
  setCompanies: (c) => set({ companies: c }),
  setSelectedCompanyId: (id) => {
    localStorage.setItem('selected_company_id', id);
    set({ selectedCompanyId: id });
  },
  logout: () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_info');
    localStorage.removeItem('selected_company_id');
    set({ user: null, companies: [], selectedCompanyId: null });
  },
  isPlatformAdmin: () => get().user?.adminRole === 'platform_admin',
  getEffectiveCompanyId: () => {
    const { user, selectedCompanyId } = get();
    return user?.companyId ?? selectedCompanyId;
  },
}));
