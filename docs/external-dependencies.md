# External Dependencies

All third-party services required by the Rockland Taxi platform.

## Maps & Geolocation

| Service | Usage | SDK / API |
|---|---|---|
| **Google Maps Platform** | Turn-by-turn directions, ETA calculation, geocoding pickup/dropoff addresses, Places autocomplete in apps | `@googlemaps/google-maps-services-js` (backend), `react-native-maps` (mobile) |
| **Google Routes API** | Fare estimation distance/duration | REST — Directions API v2 |
| **Google Places API** | Address autocomplete for rider pickup/dropoff input | REST |

**Required Google Cloud APIs to enable:**
- Maps JavaScript API
- Maps SDK for Android
- Maps SDK for iOS
- Directions API
- Geocoding API
- Places API (New)

**Estimated cost:** ~$0.005/request for directions; ~$0.017/request for places. For a 100-ride/day operation, well within $200/month free credit.

---

## Payments

| Service | Usage | SDK |
|---|---|---|
| **Stripe** | Rider payment method storage, ride payment authorization + capture, driver payouts via Stripe Connect | `stripe` (Node.js) |

**Stripe products needed:**
- Stripe Payments (PaymentIntents for riders)
- Stripe Connect (Express accounts for driver payouts)
- Stripe Webhooks (capture confirmations, payout events)

**Flow:**
1. Rider saves card → Stripe SetupIntent → `stripe_customer_id` stored on rider
2. At ride start → PaymentIntent created with `capture_method: manual` (hold on card)
3. At ride end → PaymentIntent captured for final fare
4. Nightly → driver payouts via Connect Transfer

---

## Push Notifications

| Service | Usage | SDK |
|---|---|---|
| **Expo Push Notification Service** | Delivers push to both iOS (APNs) and Android (FCM) via unified API | `expo-server-sdk` (backend), `expo-notifications` (mobile) |
| **APNs (Apple Push Notification Service)** | Underlying iOS delivery — managed via Expo EAS | handled by Expo |
| **FCM (Firebase Cloud Messaging)** | Underlying Android delivery — managed via Expo EAS | handled by Expo |

**Notification events:**
- Rider: "Driver accepted your ride", "Driver arrived", "Ride started", "Ride completed + receipt"
- Driver: "New ride request", "Rider cancelled"

---

## Communication (SMS)

| Service | Usage | SDK |
|---|---|---|
| **Twilio Verify** | OTP-based phone number verification at signup | `twilio` (Node.js) |

---

## Infrastructure & Hosting

| Service | Usage |
|---|---|
| **Railway** | Managed PostgreSQL (PostGIS-enabled), Redis, and Node.js API hosting with auto-deploy from Git |
| **Vercel** | Admin dashboard hosting (Next.js / React + Vite) |
| **Expo EAS** | Mobile app builds, OTA updates, App Store + Google Play submissions |

---

## Observability

| Service | Usage |
|---|---|
| **Sentry** | Error tracking for API + mobile apps |
| **Railway Metrics** | CPU/memory/request monitoring for the API |

---

## Development Tools (No Runtime Dependency)

| Tool | Purpose |
|---|---|
| `drizzle-orm` + `drizzle-kit` | Type-safe ORM + migration runner |
| `vitest` | Unit + integration testing |
| `detox` | React Native end-to-end testing |
| `eslint` + `prettier` | Code style |
| `husky` + `lint-staged` | Pre-commit hooks |

---

## Environment Variables Required

```env
# Google Maps
GOOGLE_MAPS_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=

# Expo Push
EXPO_ACCESS_TOKEN=

# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# App
JWT_SECRET=
API_BASE_URL=
```
