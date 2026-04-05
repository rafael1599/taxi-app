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
  riderId: string;
}

export interface RegisterBody {
  fullName: string;
  phone: string;
  email: string;
  password: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/rider/login', { email, password }),

  register: (body: RegisterBody) => apiClient.post<LoginResponse>('/auth/rider/register', body),
};

// ── Riders ───────────────────────────────────────────────────────────────────

export interface RiderProfile {
  id: string;
  fullName: string;
  phone: string;
  email: string;
}

export const riderApi = {
  me: () => apiClient.get<RiderProfile>('/riders/me'),
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

export interface FareEstimate {
  distanceKm: number;
  durationMin: number;
  fareEstimate: string;
}

export interface RequestRideBody {
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
}

export const rideApi = {
  estimate: (body: RequestRideBody) => apiClient.post<FareEstimate>('/rides/estimate', body),

  request: (body: RequestRideBody) => apiClient.post<Ride>('/rides', body),

  get: (id: string) => apiClient.get<Ride>(`/rides/${id}`),

  myActive: () => apiClient.get<Ride | null>('/rides/me/active'),

  history: () => apiClient.get<Ride[]>('/rides/me/history'),

  cancel: (id: string, reason?: string) => apiClient.post<Ride>(`/rides/${id}/cancel`, { reason }),
};

// ── Ratings ──────────────────────────────────────────────────────────────────

export interface Rating {
  id: string;
  rideId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

export const ratingApi = {
  submit: (rideId: string, score: number, comment?: string) =>
    apiClient.post<Rating>(`/rides/${rideId}/rate`, { score, comment }),

  hasRated: (rideId: string) => apiClient.get<{ rated: boolean }>(`/rides/${rideId}/rated`),
};

// ── Payment methods ───────────────────────────────────────────────────────────

export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export interface SetupIntentResponse {
  clientSecret: string;
}

export const paymentApi = {
  listMethods: () => apiClient.get<PaymentMethod[]>('/payments/methods'),

  createSetupIntent: () => apiClient.post<SetupIntentResponse>('/payments/setup-intent'),

  setDefault: (paymentMethodId: string) =>
    apiClient.patch('/payments/methods/default', { paymentMethodId }),

  remove: (paymentMethodId: string) => apiClient.delete(`/payments/methods/${paymentMethodId}`),
};
