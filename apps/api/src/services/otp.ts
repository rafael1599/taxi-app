const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? '';

const TWILIO_API_BASE = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}`;

function isConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID);
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`;
}

/** Send OTP verification code to a phone number */
export async function sendVerificationCode(
  phone: string,
  channel: 'sms' | 'whatsapp' = 'sms',
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured()) {
    // In development without Twilio, auto-pass
    console.warn('[OTP] Twilio not configured — skipping verification');
    return { success: true };
  }

  try {
    const res = await fetch(`${TWILIO_API_BASE}/Verifications`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, Channel: channel }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('[OTP] Send failed:', res.status, body);
      return { success: false, error: (body as any).message ?? 'Failed to send code' };
    }

    return { success: true };
  } catch (err) {
    console.error('[OTP] Send error:', (err as Error).message);
    return { success: false, error: 'Failed to send verification code' };
  }
}

/** Check an OTP code against the verification */
export async function checkVerificationCode(
  phone: string,
  code: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!isConfigured()) {
    // In development, accept any 6-digit code
    console.warn('[OTP] Twilio not configured — accepting any code');
    return { valid: code.length === 6 && /^\d+$/.test(code) };
  }

  try {
    const res = await fetch(`${TWILIO_API_BASE}/VerificationCheck`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, Code: code }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { valid: false, error: (body as any).message ?? 'Verification failed' };
    }

    const data = (await res.json()) as { status: string };
    return { valid: data.status === 'approved' };
  } catch (err) {
    console.error('[OTP] Check error:', (err as Error).message);
    return { valid: false, error: 'Verification check failed' };
  }
}
