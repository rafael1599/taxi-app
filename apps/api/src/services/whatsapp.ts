import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  BaileysEventMap,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { db, schema } from '@rockland-taxi/db';
import { eq, and } from 'drizzle-orm';
import { calculatePriceQuote, type PriceQuoteResult } from './pricing.js';
import { startDriverSearch } from './tripLifecycle.js';
import { getRedis, REDIS_KEYS } from './redis.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type BookingState = 'IDLE' | 'AWAITING_DROPOFF' | 'AWAITING_CONFIRMATION' | 'SEARCHING_DRIVER';

interface PendingBooking {
  companyId: string;
  senderJid: string;
  senderPhone: string;
  state: BookingState;
  pickupLat?: number;
  pickupLng?: number;
  pickupAddress?: string;
  dropoffLat?: number;
  dropoffLng?: number;
  dropoffAddress?: string;
  priceQuote?: PriceQuoteResult;
  createdAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

interface CompanySession {
  socket: WASocket | null;
  companyId: string;
  companyName: string;
  qrCode: string | null;
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
  lastError: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BOOKING_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes
const AUTH_BASE_DIR = join(process.cwd(), '.whatsapp-sessions');

// Google Maps link patterns
const MAPS_PATTERNS = [
  // https://maps.google.com/?q=41.1234,-74.5678
  /maps\.google\.com\/?\?.*?q=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/i,
  // https://www.google.com/maps/place/.../@41.1234,-74.5678,...
  /google\.com\/maps\/.*?@(-?\d+\.?\d*),(-?\d+\.?\d*)/i,
  // https://maps.app.goo.gl/ — short links (we extract from expanded text)
  // https://goo.gl/maps/...
  // Direct coordinate patterns: 41.1234, -74.5678
  /(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/,
  // plus.codes or other map links with lat,lng in query params
  /[?&](?:q|query|ll|center)=(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/i,
];

// ── State ─────────────────────────────────────────────────────────────────────

// companyId → session (stays in-memory — Baileys sockets are not serializable)
const sessions = new Map<string, CompanySession>();

// ── Redis-backed Pending Bookings ────────────────────────────────────────────

async function getBooking(senderJid: string): Promise<PendingBooking | null> {
  const redis = getRedis();
  const data = await redis.get(REDIS_KEYS.waBooking(senderJid));
  if (!data) return null;
  return JSON.parse(data) as PendingBooking;
}

async function setBooking(senderJid: string, booking: PendingBooking): Promise<void> {
  const redis = getRedis();
  // Exclude the expiryTimer from serialization (timers are per-process)
  const { expiryTimer, ...serializable } = booking;
  await redis.set(REDIS_KEYS.waBooking(senderJid), JSON.stringify(serializable), 'EX', 150); // 2.5min TTL (slightly longer than booking expiry)
}

async function deleteBooking(senderJid: string): Promise<void> {
  const redis = getRedis();
  await redis.del(REDIS_KEYS.waBooking(senderJid));
}

// ── Google Maps Coordinate Extraction ─────────────────────────────────────────

function extractCoordinates(text: string): { lat: number; lng: number } | null {
  for (const pattern of MAPS_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

function extractAddressFromMapsLink(text: string): string {
  // Try to extract place name from Google Maps URL
  const placeMatch = text.match(/google\.com\/maps\/place\/([^/@]+)/i);
  if (placeMatch) {
    return decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
  }
  return 'Location from map';
}

// ── Phone Number Helpers ──────────────────────────────────────────────────────

function jidToPhone(jid: string): string {
  // WhatsApp JID format: 1234567890@s.whatsapp.net
  return '+' + jid.split('@')[0];
}

// ── Rider Management ──────────────────────────────────────────────────────────

async function findOrCreateRider(companyId: string, phone: string, name?: string): Promise<string> {
  // Check if rider exists for this company
  const existing = await db.query.riders.findFirst({
    where: and(eq(schema.riders.companyId, companyId), eq(schema.riders.phone, phone)),
  });

  if (existing) return existing.id;

  // Auto-create rider from WhatsApp contact
  const [rider] = await db
    .insert(schema.riders)
    .values({
      companyId,
      fullName: name || `WhatsApp User ${phone.slice(-4)}`,
      phone,
      email: `wa_${phone.replace(/\+/g, '')}@placeholder.local`,
    })
    .returning();

  return rider.id;
}

// ── Message Sending ───────────────────────────────────────────────────────────

async function sendMessage(companyId: string, jid: string, text: string): Promise<void> {
  const session = sessions.get(companyId);
  if (!session?.socket) return;

  try {
    await session.socket.sendMessage(jid, { text });
  } catch (err) {
    console.error(`[WhatsApp] Failed to send message to ${jid}:`, err);
  }
}

// ── Booking State Machine ─────────────────────────────────────────────────────

async function clearBooking(senderJid: string): Promise<void> {
  await deleteBooking(senderJid);
}

async function startBookingExpiry(senderJid: string, booking: PendingBooking): Promise<void> {
  // Redis TTL handles expiry. The key has a 2.5-min TTL set in setBooking().
  // We still save the booking to refresh the TTL.
  await setBooking(senderJid, booking);
}

async function handleIncomingMessage(
  companyId: string,
  companyName: string,
  senderJid: string,
  messageText: string,
  pushName?: string,
): Promise<void> {
  // Ignore group messages and status broadcasts
  if (senderJid.includes('@g.us') || senderJid === 'status@broadcast') return;

  const text = messageText.trim();
  const textLower = text.toLowerCase();
  const senderPhone = jidToPhone(senderJid);

  // Check for active booking (from Redis)
  const booking = await getBooking(senderJid);

  // ── Cancel command ─────────────────────────────────────────────────────
  if (textLower === 'cancel' || textLower === 'cancelar') {
    if (booking) {
      await clearBooking(senderJid);
      await sendMessage(
        companyId,
        senderJid,
        '❌ Booking cancelled. Send a location to start a new one.',
      );
    } else {
      await sendMessage(
        companyId,
        senderJid,
        'No active booking to cancel. Send a pickup location to get started!',
      );
    }
    return;
  }

  // ── State: AWAITING_CONFIRMATION ───────────────────────────────────────
  if (booking?.state === 'AWAITING_CONFIRMATION') {
    if (
      textLower === 'yes' ||
      textLower === 'si' ||
      textLower === 'sí' ||
      textLower === 'confirm' ||
      textLower === 'confirmar' ||
      textLower === '1'
    ) {
      await confirmBooking(booking, senderJid, pushName);
      return;
    }
    if (textLower === 'no' || textLower === '2') {
      await clearBooking(senderJid);
      await sendMessage(companyId, senderJid, '❌ Booking cancelled. Send a new location anytime!');
      return;
    }
    await sendMessage(companyId, senderJid, 'Please reply *yes* to confirm or *no* to cancel.');
    return;
  }

  // ── Try to extract coordinates from message ────────────────────────────
  const coords = extractCoordinates(text);

  if (!coords) {
    // No location found — send help message
    if (booking?.state === 'AWAITING_DROPOFF') {
      await sendMessage(
        companyId,
        senderJid,
        `📍 Now send your *drop-off* location.\n\nShare a Google Maps link or pin from WhatsApp.`,
      );
    } else {
      await sendMessage(
        companyId,
        senderJid,
        `👋 Welcome to *${companyName}*!\n\nTo book a ride, send your *pickup location* as a Google Maps link or share your location pin.`,
      );
    }
    return;
  }

  const address = extractAddressFromMapsLink(text);

  // ── State: IDLE — first location = pickup ──────────────────────────────
  if (!booking || booking.state === 'IDLE') {
    const newBooking: PendingBooking = {
      companyId,
      senderJid,
      senderPhone,
      state: 'AWAITING_DROPOFF',
      pickupLat: coords.lat,
      pickupLng: coords.lng,
      pickupAddress: address,
      createdAt: Date.now(),
    };
    await setBooking(senderJid, newBooking);

    await sendMessage(
      companyId,
      senderJid,
      `✅ Pickup set!\n\n📍 Now send your *drop-off* location (Google Maps link or location pin).`,
    );
    return;
  }

  // ── State: AWAITING_DROPOFF — second location = dropoff ────────────────
  if (booking.state === 'AWAITING_DROPOFF') {
    booking.dropoffLat = coords.lat;
    booking.dropoffLng = coords.lng;
    booking.dropoffAddress = address;

    // Calculate price quote
    try {
      const quote = await calculatePriceQuote({
        companyId,
        pickupLat: booking.pickupLat!,
        pickupLng: booking.pickupLng!,
        dropoffLat: coords.lat,
        dropoffLng: coords.lng,
      });

      booking.priceQuote = quote;
      booking.state = 'AWAITING_CONFIRMATION';
      await setBooking(senderJid, booking);

      const distText = `${quote.distance.miles.toFixed(1)} mi`;
      const timeText = `~${quote.durationMin} min`;

      await sendMessage(
        companyId,
        senderJid,
        `🚕 *Ride Quote*\n\n` +
          `📍 From: ${booking.pickupAddress}\n` +
          `📍 To: ${booking.dropoffAddress}\n` +
          `📏 Distance: ${distText}\n` +
          `⏱️ Est. time: ${timeText}\n` +
          `💰 *Price: $${quote.price.toFixed(2)} ${quote.currency}*\n\n` +
          `Reply *yes* to confirm or *no* to cancel.`,
      );
    } catch (err) {
      console.error('[WhatsApp] Price calculation error:', err);
      await clearBooking(senderJid);
      await sendMessage(
        companyId,
        senderJid,
        '❌ Sorry, we could not calculate a price. Please try again.',
      );
    }
    return;
  }
}

// ── Confirm Booking → Create Ride → Start Driver Search ───────────────────

async function confirmBooking(
  booking: PendingBooking,
  senderJid: string,
  pushName?: string,
): Promise<void> {
  const { companyId } = booking;

  try {
    booking.state = 'SEARCHING_DRIVER';

    // Find or create rider
    const riderId = await findOrCreateRider(companyId, booking.senderPhone, pushName);

    // Create ride in DB
    const [ride] = await db
      .insert(schema.rides)
      .values({
        companyId,
        riderId,
        pickupLat: booking.pickupLat!,
        pickupLng: booking.pickupLng!,
        pickupAddress: booking.pickupAddress || 'WhatsApp location',
        dropoffLat: booking.dropoffLat!,
        dropoffLng: booking.dropoffLng!,
        dropoffAddress: booking.dropoffAddress || 'WhatsApp location',
        distanceKm: booking.priceQuote?.distance.km,
        durationMin: booking.priceQuote?.durationMin,
        fareEstimate: booking.priceQuote?.price.toFixed(2),
        status: 'requested',
      })
      .returning();

    await sendMessage(
      companyId,
      senderJid,
      `✅ Booking confirmed!\n\n🔍 Searching for a driver near you...`,
    );

    // Clear booking (ride is now in the system)
    await clearBooking(senderJid);

    // Store the WhatsApp JID on this ride for notifications
    // We'll use the rider's phone to look up their JID later
    // Start driver search
    const result = await startDriverSearch(ride.id, companyId);

    if (!result.success) {
      await sendMessage(
        companyId,
        senderJid,
        `😔 Sorry, no drivers are available right now. Please try again in a few minutes.`,
      );
    }
  } catch (err) {
    console.error('[WhatsApp] Error confirming booking:', err);
    await clearBooking(senderJid);
    await sendMessage(
      companyId,
      senderJid,
      '❌ Something went wrong creating your booking. Please try again.',
    );
  }
}

// ── Trip Status Notifications ─────────────────────────────────────────────────

export async function notifyRiderViaWhatsApp(
  rideId: string,
  event: 'driver_assigned' | 'arrived' | 'picked_up' | 'completed' | 'cancelled',
): Promise<void> {
  // Get ride with rider info
  const ride = await db.query.rides.findFirst({
    where: eq(schema.rides.id, rideId),
  });
  if (!ride) return;

  const rider = await db.query.riders.findFirst({
    where: eq(schema.riders.id, ride.riderId),
  });
  if (!rider?.phone) return;

  // Check if this company has an active WhatsApp session
  const session = sessions.get(ride.companyId);
  if (!session?.socket || session.status !== 'connected') return;

  // Convert phone to WhatsApp JID
  const phone = rider.phone.replace(/^\+/, '');
  const jid = `${phone}@s.whatsapp.net`;

  let message = '';

  switch (event) {
    case 'driver_assigned': {
      // Get driver and vehicle info
      const driver = ride.driverId
        ? await db.query.drivers.findFirst({
            where: eq(schema.drivers.id, ride.driverId),
          })
        : null;
      const vehicle = ride.driverId
        ? await db.query.vehicles.findFirst({
            where: eq(schema.vehicles.driverId, ride.driverId),
          })
        : null;

      message =
        `🚕 *Driver on the way!*\n\n` +
        `👤 ${driver?.fullName ?? 'Your driver'}\n` +
        (vehicle
          ? `🚗 ${vehicle.color} ${vehicle.make} ${vehicle.model} — ${vehicle.plate}\n`
          : '') +
        (driver?.phone ? `📞 ${driver.phone}\n` : '') +
        `\nThey'll arrive at your pickup shortly.`;
      break;
    }
    case 'arrived':
      message = `📍 *Your driver has arrived!*\n\nPlease head to your pickup location.`;
      break;
    case 'picked_up':
      message = `🚗 *Trip started!*\n\nYou're on your way. Enjoy the ride!`;
      break;
    case 'completed':
      message =
        `✅ *Trip completed!*\n\n` +
        `💰 Fare: $${ride.fareFinal ?? ride.fareEstimate ?? '—'}\n` +
        `Thank you for riding with us! 🙏`;
      break;
    case 'cancelled':
      message = `😔 *No driver found*\n\nWe're sorry, but no driver was available for your trip. Please try again shortly.`;
      break;
  }

  if (message) {
    await sendMessage(ride.companyId, jid, message);
  }
}

// ── WhatsApp Session Management ───────────────────────────────────────────────

async function createSession(companyId: string, companyName: string): Promise<CompanySession> {
  const authDir = join(AUTH_BASE_DIR, companyId);
  await mkdir(authDir, { recursive: true });

  const session: CompanySession = {
    socket: null,
    companyId,
    companyName,
    qrCode: null,
    status: 'connecting',
    lastError: null,
  };
  sessions.set(companyId, session);

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['RocklandTaxi', 'Chrome', '120.0'],
  });

  session.socket = socket;

  // ── Connection events ──────────────────────────────────────────────────

  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      session.qrCode = qr;
      session.status = 'qr_ready';
      console.log(`[WhatsApp][${companyName}] QR code ready for scanning`);
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      session.status = 'disconnected';
      session.qrCode = null;

      if (reason === DisconnectReason.loggedOut) {
        console.log(`[WhatsApp][${companyName}] Logged out — session cleared`);
        session.lastError = 'Logged out';
        sessions.delete(companyId);
      } else {
        console.log(`[WhatsApp][${companyName}] Disconnected (reason: ${reason}), reconnecting...`);
        session.lastError = `Disconnected: ${reason}`;
        // Reconnect after a short delay
        setTimeout(() => {
          if (sessions.has(companyId)) {
            createSession(companyId, companyName).catch(console.error);
          }
        }, 3000);
      }
    }

    if (connection === 'open') {
      session.status = 'connected';
      session.qrCode = null;
      session.lastError = null;
      console.log(`[WhatsApp][${companyName}] Connected successfully`);
    }
  });

  socket.ev.on('creds.update', saveCreds);

  // ── Message handler ────────────────────────────────────────────────────

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const senderJid = msg.key.remoteJid;
      if (!senderJid) continue;

      // Extract text content from various message types
      let text = '';
      const m = msg.message;

      if (m.conversation) {
        text = m.conversation;
      } else if (m.extendedTextMessage?.text) {
        text = m.extendedTextMessage.text;
      } else if (m.locationMessage) {
        // WhatsApp location pin
        const loc = m.locationMessage;
        text = `${loc.degreesLatitude},${loc.degreesLongitude}`;
      } else if (m.liveLocationMessage) {
        const loc = m.liveLocationMessage;
        text = `${loc.degreesLatitude},${loc.degreesLongitude}`;
      }

      if (!text) continue;

      try {
        await handleIncomingMessage(
          companyId,
          companyName,
          senderJid,
          text,
          msg.pushName ?? undefined,
        );
      } catch (err) {
        console.error(`[WhatsApp][${companyName}] Error handling message:`, err);
      }
    }
  });

  return session;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getSession(companyId: string): CompanySession | undefined {
  return sessions.get(companyId);
}

export function getAllSessions(): Array<{
  companyId: string;
  companyName: string;
  status: string;
  hasQr: boolean;
}> {
  return Array.from(sessions.values()).map((s) => ({
    companyId: s.companyId,
    companyName: s.companyName,
    status: s.status,
    hasQr: !!s.qrCode,
  }));
}

export async function startSession(
  companyId: string,
  companyName: string,
): Promise<CompanySession> {
  // If session already exists and is connected, return it
  const existing = sessions.get(companyId);
  if (existing && existing.status === 'connected') {
    return existing;
  }

  // Close existing socket if any
  if (existing?.socket) {
    try {
      existing.socket.end(undefined);
    } catch {
      // ignore
    }
  }

  return createSession(companyId, companyName);
}

export async function stopSession(companyId: string): Promise<void> {
  const session = sessions.get(companyId);
  if (!session) return;

  if (session.socket) {
    try {
      session.socket.end(undefined);
    } catch {
      // ignore
    }
  }
  sessions.delete(companyId);
}

export async function logoutSession(companyId: string): Promise<void> {
  const session = sessions.get(companyId);
  if (!session?.socket) return;

  try {
    await session.socket.logout();
  } catch {
    // ignore
  }
  sessions.delete(companyId);
}

/**
 * Initialize WhatsApp sessions for all active companies that have a whatsappJid configured.
 * Called once at server startup.
 */
export async function initWhatsAppSessions(): Promise<void> {
  const companiesWithWA = await db.query.companies.findMany({
    where: and(eq(schema.companies.isActive, true)),
  });

  for (const company of companiesWithWA) {
    if (!company.whatsappJid) continue;

    console.log(`[WhatsApp] Initializing session for ${company.name}`);
    try {
      await startSession(company.id, company.name);
    } catch (err) {
      console.error(`[WhatsApp] Failed to start session for ${company.name}:`, err);
    }
  }
}
