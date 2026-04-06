import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

// ── API URL Resolution ─────────────────────────────────────────────────────
// Priority: expoConfig.extra.apiBaseUrl (from app.config.ts) → fallback
// On Android emulator: localhost → 10.0.2.2 (only in dev mode)
// On real device: must use actual LAN IP, never localhost
const configUrl =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:3000';

function resolveBaseUrl(url: string): string {
  if (!url.includes('localhost')) return url; // Already an IP — use as-is

  if (Platform.OS === 'android') {
    // __DEV__ = true when running from Metro (dev builds)
    // __DEV__ = false in release APKs
    if (__DEV__) {
      // Emulator or dev device connected to Metro — use 10.0.2.2
      return url.replace('localhost', '10.0.2.2');
    }
    // Release build on real device — localhost won't work
    // Fall back to the Metro dev server host IP if available
    const devServerHost = Constants.expoConfig?.hostUri?.split(':')[0];
    if (devServerHost && devServerHost !== 'localhost') {
      return url.replace('localhost', devServerHost);
    }
    // Last resort: warn and keep localhost (will fail)
    console.warn(
      '[API] Release build has localhost URL — API calls will fail. Rebuild with API_BASE_URL=http://<YOUR_IP>:3000',
    );
  }
  return url;
}

const BASE_URL = resolveBaseUrl(configUrl);

export const API_BASE_URL = BASE_URL;

console.log('[API] BASE_URL resolved to:', BASE_URL);
console.log('[API] configUrl from config:', configUrl);
console.log('[API] __DEV__:', __DEV__);

export const apiClient = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// Log every outgoing request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  console.log(
    `[API] → ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`,
    config.data ? JSON.stringify(config.data) : '',
  );
  return config;
});

// Log every response / error + auto-logout on 401
apiClient.interceptors.response.use(
  (response) => {
    console.log(`[API] ← ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error(
      `[API] ✗ ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
      error.message,
      error.response?.status,
      JSON.stringify(error.response?.data),
    );
    // Auto-logout when server rejects the token
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/')) {
      console.warn('[API] 401 received — clearing session');
      useAuthStore.getState().clearAuth();
    }
    return Promise.reject(error);
  },
);

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  driverId: string;
}

export interface RegisterBody {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  licenseNumber: string;
  tlcLicense?: string;
  companyId: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/driver/login', { email, password }),

  register: (body: RegisterBody) => apiClient.post<LoginResponse>('/auth/driver/register', body),
};

// ── Drivers ──────────────────────────────────────────────────────────────────

export interface DriverProfile {
  id: string;
  companyId: string;
  fullName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  tlcLicense: string | null;
  isActive: boolean;
  isAvailable: boolean;
  status: string;
  currentLat: number | null;
  currentLng: number | null;
}

export const driverApi = {
  me: () => apiClient.get<DriverProfile>('/drivers/me'),

  goOnline: () => apiClient.post('/drivers/online'),

  goOffline: () => apiClient.post('/drivers/offline'),

  updateLocation: (lat: number, lng: number) => apiClient.post('/drivers/location', { lat, lng }),
};

// ── Trip Offers ─────────────────────────────────────────────────────────────

export const tripApi = {
  acceptOffer: (offerId: string) => apiClient.post(`/trips/offers/${offerId}/accept`),

  rejectOffer: (offerId: string) => apiClient.post(`/trips/offers/${offerId}/reject`),

  updateStatus: (rideId: string, status: string) =>
    apiClient.post(`/rides/${rideId}/status`, { status }),
};

// ── Rides ────────────────────────────────────────────────────────────────────

export type RideStatus =
  | 'requested'
  | 'searching_driver'
  | 'driver_assigned'
  | 'accepted'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'picked_up'
  | 'completed'
  | 'cancelled';

export interface Ride {
  id: string;
  riderId: string;
  driverId: string | null;
  status: RideStatus;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  distanceKm: number | null;
  durationMin: number | null;
  fareEstimate: string | null;
  fareFinal: string | null;
  requestedAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  droppedOffAt: string | null;
  cancelledAt: string | null;
}

export const rideApi = {
  list: () => apiClient.get<Ride[]>('/rides'),

  get: (id: string) => apiClient.get<Ride>(`/rides/${id}`),

  cancel: (id: string, reason?: string) => apiClient.post<Ride>(`/rides/${id}/cancel`, { reason }),
};

// ── Ratings ──────────────────────────────────────────────────────────────────

export const ratingApi = {
  rateRider: (rideId: string, score: number, comment?: string) =>
    apiClient.post(`/rides/${rideId}/rate-rider`, { score, comment }),
};

// ── SSE URL helper ──────────────────────────────────────────────────────────

export function getSSEUrl(): string {
  return `${BASE_URL}/api/v1/drivers/events`;
}
