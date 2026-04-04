import axios from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

const BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: BASE_URL,
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
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/driver/login', { email, password }),

  register: (body: RegisterBody) =>
    apiClient.post<LoginResponse>('/auth/driver/register', body),
};

// ── Drivers ──────────────────────────────────────────────────────────────────

export interface DriverProfile {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  tlcLicense: string | null;
  isActive: boolean;
  isAvailable: boolean;
  currentLat: number | null;
  currentLng: number | null;
}

export const driverApi = {
  me: () => apiClient.get<DriverProfile>('/drivers/me'),

  setAvailability: (isAvailable: boolean) =>
    apiClient.patch('/drivers/me/availability', { isAvailable }),

  updateLocation: (lat: number, lng: number) =>
    apiClient.patch('/drivers/me/location', { lat, lng }),
};

// ── Rides ────────────────────────────────────────────────────────────────────

export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
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

  accept: (id: string) => apiClient.post<Ride>(`/rides/${id}/accept`),

  start: (id: string) => apiClient.post<Ride>(`/rides/${id}/start`),

  complete: (id: string) => apiClient.post<Ride>(`/rides/${id}/complete`),

  cancel: (id: string, reason?: string) =>
    apiClient.post<Ride>(`/rides/${id}/cancel`, { reason }),
};
