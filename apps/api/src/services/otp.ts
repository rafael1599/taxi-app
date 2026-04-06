/**
 * OTP Service — pluggable verification code delivery
 *
 * Architecture:
 *   - In-memory OTP store with TTL, cooldown, and max attempts
 *   - Delivery via WhatsApp bot (baileys) running as separate service
 *   - Falls back to dev mode (auto-accept) when bot is unreachable
 *   - Ready for WhatsApp Business API swap (May 2026)
 *
 * Provider priority:
 *   1. WhatsApp bot (WHATSAPP_BOT_URL) — current production method
 *   2. Twilio Verify (TWILIO_*) — future paid option
 *   3. Dev mode — no external service, accepts any 6-digit code
 */

import { randomInt } from 'node:crypto';

// ── Configuration ──────────────────────────────────────────────────────────

const WHATSAPP_BOT_URL = process.env.WHATSAPP_BOT_URL ?? '';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? '';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? '';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_COOLDOWN_MS = 60 * 1000; // 60s between requests per phone
const OTP_MAX_ATTEMPTS = 3;

// ── In-memory OTP store ────────────────────────────────────────────────────

interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
}

const otpStore = new Map<string, OtpEntry>();

// Periodic cleanup of expired entries (every 10 minutes)
setInterval(
  () => {
    const now = Date.now();
    for (const [phone, entry] of otpStore) {
      if (now > entry.expiresAt) otpStore.delete(phone);
    }
  },
  10 * 60 * 1000,
);

// ── Provider detection ─────────────────────────────────────────────────────

type OtpProvider = 'whatsapp-bot' | 'twilio' | 'dev';

function getProvider(): OtpProvider {
  if (WHATSAPP_BOT_URL) return 'whatsapp-bot';
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID) return 'twilio';
  return 'dev';
}

// ── Phone utilities ────────────────────────────────────────────────────────

function phoneToJid(phone: string): string {
  return phone.replace('+', '') + '@s.whatsapp.net';
}

/** Normalize US phone to +1XXXXXXXXXX */
export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+1') && cleaned.length === 12) return cleaned;
  if (cleaned.startsWith('1') && cleaned.length === 11) return '+' + cleaned;
  if (cleaned.length === 10) return '+1' + cleaned;
  return cleaned;
}

// ── WhatsApp Bot delivery ──────────────────────────────────────────────────

async function sendViaWhatsAppBot(
  phone: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const jid = phoneToJid(normalizePhone(phone));
  const text = `Your login code is: *${code}*\n\nThis code expires in 5 minutes. Do not share it with anyone.`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${WHATSAPP_BOT_URL}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(INTERNAL_API_SECRET ? { Authorization: `Bearer ${INTERNAL_API_SECRET}` } : {}),
        },
        body: JSON.stringify({ jid, text }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        console.log(`[OTP:WhatsApp] Sent to ${phone}`);
        return { success: true };
      }

      console.warn(`[OTP:WhatsApp] Send failed (${res.status}), attempt ${attempt + 1}/3`);
    } catch (err) {
      console.warn(`[OTP:WhatsApp] Send error, attempt ${attempt + 1}/3:`, (err as Error).message);
    }

    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  return { success: false, error: 'Failed to send via WhatsApp. Is the bot connected?' };
}

// ── Twilio Verify delivery (fallback/future) ───────────────────────────────

async function sendViaTwilio(
  phone: string,
  channel: 'sms' | 'whatsapp',
): Promise<{ success: boolean; error?: string }> {
  const twilioBase = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}`;
  const auth = `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;

  try {
    const res = await fetch(`${twilioBase}/Verifications`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, Channel: channel }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { success: false, error: (body as any).message ?? 'Twilio send failed' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function verifyViaTwilio(
  phone: string,
  code: string,
): Promise<{ valid: boolean; error?: string }> {
  const twilioBase = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}`;
  const auth = `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;

  try {
    const res = await fetch(`${twilioBase}/VerificationCheck`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, Code: code }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { valid: false, error: (body as any).message ?? 'Twilio verify failed' };
    }

    const data = (await res.json()) as { status: string };
    return { valid: data.status === 'approved' };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Send OTP verification code to a phone number */
export async function sendVerificationCode(
  phone: string,
  channel: 'sms' | 'whatsapp' = 'whatsapp',
): Promise<{ success: boolean; error?: string }> {
  const provider = getProvider();
  const normalized = normalizePhone(phone);

  // Rate limit: 1 request per phone per cooldown period
  const existing = otpStore.get(normalized);
  if (existing && Date.now() - existing.createdAt < OTP_COOLDOWN_MS) {
    const waitSecs = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - existing.createdAt)) / 1000);
    return { success: false, error: `Please wait ${waitSecs}s before requesting another code` };
  }

  // For Twilio, it manages its own codes — just forward
  if (provider === 'twilio') {
    return sendViaTwilio(normalized, channel);
  }

  // For WhatsApp bot and dev mode, we manage our own codes
  const code = String(randomInt(100000, 999999));

  if (provider === 'whatsapp-bot') {
    const result = await sendViaWhatsAppBot(normalized, code);
    if (!result.success) return result;
  } else {
    // Dev mode — log code to console
    console.warn(`[OTP:Dev] Code for ${normalized}: ${code} (no delivery, dev mode)`);
  }

  // Store code
  otpStore.set(normalized, {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    createdAt: Date.now(),
  });

  return { success: true };
}

/** Check an OTP code against stored/provider verification */
export async function checkVerificationCode(
  phone: string,
  code: string,
): Promise<{ valid: boolean; error?: string }> {
  const provider = getProvider();
  const normalized = normalizePhone(phone);

  // For Twilio, it manages its own codes
  if (provider === 'twilio') {
    return verifyViaTwilio(normalized, code);
  }

  // For WhatsApp bot and dev mode, check our in-memory store
  const entry = otpStore.get(normalized);

  if (!entry) {
    // Dev mode: accept any 6-digit code even without a send step
    if (provider === 'dev') {
      console.warn(`[OTP:Dev] No stored code for ${normalized}, accepting any 6-digit code`);
      return { valid: code.length === 6 && /^\d+$/.test(code) };
    }
    return { valid: false, error: 'No verification code found. Please request a new one.' };
  }

  // Check expiry
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(normalized);
    return { valid: false, error: 'Code expired. Please request a new one.' };
  }

  // Check attempts
  entry.attempts++;
  if (entry.attempts > OTP_MAX_ATTEMPTS) {
    otpStore.delete(normalized);
    return { valid: false, error: 'Too many attempts. Please request a new code.' };
  }

  // Validate
  if (entry.code !== code.trim()) {
    const remaining = OTP_MAX_ATTEMPTS - entry.attempts;
    return { valid: false, error: `Invalid code. ${remaining} attempt(s) remaining.` };
  }

  // Success — clean up
  otpStore.delete(normalized);
  return { valid: true };
}

/** Check WhatsApp bot health */
export async function getWhatsAppBotHealth(): Promise<{
  provider: OtpProvider;
  connected: boolean;
}> {
  const provider = getProvider();

  if (provider !== 'whatsapp-bot') {
    return { provider, connected: provider === 'twilio' };
  }

  try {
    const res = await fetch(`${WHATSAPP_BOT_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return { provider, connected: res.ok };
  } catch {
    return { provider, connected: false };
  }
}
