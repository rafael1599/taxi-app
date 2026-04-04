export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'refunded'
  | 'failed';

export interface Rider {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  avatarUrl: string | null;
  stripeCustomerId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Driver {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  tlcLicense: string | null;
  stripeAccountId: string | null;
  isActive: boolean;
  isAvailable: boolean;
  currentLat: number | null;
  currentLng: number | null;
  locationAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Vehicle {
  id: string;
  driverId: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  isActive: boolean;
  createdAt: Date;
}

export interface Ride {
  id: string;
  riderId: string;
  driverId: string | null;
  vehicleId: string | null;
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
  requestedAt: Date;
  acceptedAt: Date | null;
  pickedUpAt: Date | null;
  droppedOffAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Payment {
  id: string;
  rideId: string;
  riderId: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  stripePiId: string | null;
  stripePmId: string | null;
  capturedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
}

export interface DriverLocation {
  driverId: string;
  lat: number;
  lng: number;
  updatedAt: string;
}

export interface JwtPayload {
  sub: string;
  role: 'driver' | 'rider';
  iat: number;
  exp: number;
}
