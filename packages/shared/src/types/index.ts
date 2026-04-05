export type RideStatus =
  | 'requested'
  | 'searching_driver'
  | 'driver_assigned'
  | 'accepted'
  | 'arrived'
  | 'en_route'
  | 'in_progress'
  | 'picked_up'
  | 'completed'
  | 'cancelled';

export type DriverStatus =
  | 'offline'
  | 'idle'
  | 'incoming'
  | 'accepted'
  | 'en_route'
  | 'arrived'
  | 'picked_up'
  | 'completed';

export type TripOfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export type PaymentStatus = 'pending' | 'authorized' | 'captured' | 'refunded' | 'failed';

export type AdminRole = 'super_admin' | 'dispatcher' | 'viewer' | 'platform_admin';

export interface Company {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  whatsappJid: string | null;
  isActive: boolean;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Rider {
  id: string;
  companyId: string;
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
  companyId: string;
  fullName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  tlcLicense: string | null;
  stripeAccountId: string | null;
  isActive: boolean;
  isAvailable: boolean;
  status: DriverStatus;
  currentLat: number | null;
  currentLng: number | null;
  locationAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Vehicle {
  id: string;
  companyId: string;
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
  companyId: string;
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

export interface TripOffer {
  id: string;
  rideId: string;
  driverId: string;
  companyId: string;
  status: TripOfferStatus;
  offeredAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  createdAt: Date;
}

export interface Payment {
  id: string;
  companyId: string;
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

export interface Admin {
  id: string;
  companyId: string | null;
  fullName: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface JwtPayload {
  sub: string;
  role: 'driver' | 'rider' | 'admin';
  companyId?: string;
  adminRole?: AdminRole;
  iat: number;
  exp: number;
}
