import { db, schema } from '@rockland-taxi/db';
import { eq } from 'drizzle-orm';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN ?? '';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  channelId?: string;
}

interface PushTicket {
  id?: string;
  status: 'ok' | 'error';
  message?: string;
}

async function sendPushMessages(messages: PushMessage[]): Promise<PushTicket[]> {
  if (messages.length === 0) return [];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (EXPO_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`;
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error('[Push] Expo API error:', res.status, await res.text());
      return [];
    }

    const { data } = (await res.json()) as { data: PushTicket[] };
    return data;
  } catch (err) {
    console.error('[Push] Failed to send:', (err as Error).message);
    return [];
  }
}

// ── Token management ─────────────────────────────────────────────────────────

export async function saveDriverPushToken(driverId: string, pushToken: string): Promise<void> {
  await db.update(schema.drivers).set({ pushToken }).where(eq(schema.drivers.id, driverId));
}

export async function saveRiderPushToken(riderId: string, pushToken: string): Promise<void> {
  await db.update(schema.riders).set({ pushToken }).where(eq(schema.riders.id, riderId));
}

// ── Notification helpers ─────────────────────────────────────────────────────

export async function notifyDriverTripOffer(
  driverId: string,
  rideData: { rideId: string; pickupAddress: string; dropoffAddress: string; fareEstimate: string },
): Promise<void> {
  const driver = await db.query.drivers.findFirst({
    where: eq(schema.drivers.id, driverId),
    columns: { pushToken: true },
  });
  if (!driver?.pushToken) return;

  await sendPushMessages([
    {
      to: driver.pushToken,
      title: 'New Trip Request',
      body: `${rideData.pickupAddress} → ${rideData.dropoffAddress} ($${rideData.fareEstimate})`,
      data: { type: 'trip_offer', rideId: rideData.rideId },
      sound: 'default',
      channelId: 'trip-offers',
    },
  ]);
}

export async function notifyRiderDriverAssigned(
  riderId: string,
  driverData: { driverName: string; vehiclePlate: string; rideId: string },
): Promise<void> {
  const rider = await db.query.riders.findFirst({
    where: eq(schema.riders.id, riderId),
    columns: { pushToken: true },
  });
  if (!rider?.pushToken) return;

  await sendPushMessages([
    {
      to: rider.pushToken,
      title: 'Driver Assigned',
      body: `${driverData.driverName} is on the way! Vehicle: ${driverData.vehiclePlate}`,
      data: { type: 'driver_assigned', rideId: driverData.rideId },
      sound: 'default',
      channelId: 'ride-updates',
    },
  ]);
}

export async function notifyRiderDriverArrived(riderId: string, rideId: string): Promise<void> {
  const rider = await db.query.riders.findFirst({
    where: eq(schema.riders.id, riderId),
    columns: { pushToken: true },
  });
  if (!rider?.pushToken) return;

  await sendPushMessages([
    {
      to: rider.pushToken,
      title: 'Driver Has Arrived',
      body: 'Your driver is here! Head to the pickup point.',
      data: { type: 'driver_arrived', rideId },
      sound: 'default',
      channelId: 'ride-updates',
    },
  ]);
}

export async function notifyRiderTripCompleted(
  riderId: string,
  rideData: { rideId: string; fareFinal: string },
): Promise<void> {
  const rider = await db.query.riders.findFirst({
    where: eq(schema.riders.id, riderId),
    columns: { pushToken: true },
  });
  if (!rider?.pushToken) return;

  await sendPushMessages([
    {
      to: rider.pushToken,
      title: 'Trip Completed',
      body: `Your ride is complete. Total: $${rideData.fareFinal}`,
      data: { type: 'trip_completed', rideId: rideData.rideId },
      sound: 'default',
      channelId: 'ride-updates',
    },
  ]);
}

export async function notifyRiderNoDriverFound(riderId: string, rideId: string): Promise<void> {
  const rider = await db.query.riders.findFirst({
    where: eq(schema.riders.id, riderId),
    columns: { pushToken: true },
  });
  if (!rider?.pushToken) return;

  await sendPushMessages([
    {
      to: rider.pushToken,
      title: 'No Driver Available',
      body: 'Sorry, no drivers are available right now. Please try again shortly.',
      data: { type: 'no_driver', rideId },
      sound: 'default',
      channelId: 'ride-updates',
    },
  ]);
}
