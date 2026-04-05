import axios from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

const BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:3000';

export const API_BASE_URL = BASE_URL;

export const apiClient = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT on every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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

// ── SSE URL helper ──────────────────────────────────────────────────────────

export function getSSEUrl(): string {
  return `${BASE_URL}/api/v1/drivers/events`;
}
