# SeeWater — Admin Dashboard

Administration console for **SeeWater: IoT-Powered App for Smart Water Usage and Leak Detection**.
Implements the admin modules described in the SeeWater manuscript (Figs. 23–37, data dictionary Tables 4–25).

```
website/
├── server/   Node.js + Express API (admin API, homeowner mobile API, ESP32 device API), Firebase Firestore
└── admin/    Next.js 15 (App Router) + Tailwind CSS 4 + Recharts admin dashboard
../application/   Homeowner mobile app (Expo) — uses /api/mobile on this server
```

## Firebase (project `seewater`)

| Service | Used for |
|---|---|
| **Authentication** | Admin sign-in, password reset/change. Admin rights come only from the `role: "admin"` custom claim set by `npm run create-admin` (Admin SDK). The API swaps the Firebase ID token for an httpOnly session cookie and re-verifies it (with revocation) on every request. |
| **Cloud Firestore** | System of record: profiles, households, devices, activation codes, readings history, alerts, valve commands, logs, calibration, announcements, interruptions, rates, notifications, feedback, settings. |
| **Realtime Database** | Live state only — `/live/devices/{deviceId}` (status, latest flow & vibration, valve) and `/live/alerts/{alertId}` (open alerts). Written by the API after validating the device; read by the admin website in real time. |
| **Storage** *(optional — Blaze plan)* | Admin profile pictures, announcement attachments. Disabled with `FIREBASE_STORAGE_ENABLED=false` / `NEXT_PUBLIC_FIREBASE_STORAGE_ENABLED=false`; the UI then hides uploads and uses links. |

Homeowner (mobile app) accounts still use the API's own sign-up/verification and tokens (stored as
bcrypt hashes server-side, never in the databases' readable paths). Moving them to Firebase Auth is a
separate step; the security rules already contain the `role: "homeowner"` access paths.

There is no InfluxDB in this project: raw readings are kept in Firestore `sensorReadings` with an
`expireAt` (TTL policy, default 90 days) and daily totals in `waterUsage` are kept for history.

### Connect the `seewater` project

1. **Firebase console** (https://console.firebase.google.com/project/seewater):
   - *Authentication → Get started → Sign-in method*: enable **Email/Password**.
   - *Firestore Database → Create database* (e.g. `asia-southeast1`, production mode).
   - *Realtime Database*: already created (`seewater-default-rtdb`).
   - *Storage* (optional, Blaze plan) → then set both `*STORAGE_ENABLED` flags to `true`.
2. *Project settings → Service accounts → Generate new private key* → save as
   `website/server/serviceAccountKey.json` (git-ignored; never commit or share it).
3. Check the connection: `cd website/server && npm run check-firebase`.
4. Deploy security rules + TTL policy (from `website/`):
   ```bash
   npx firebase login                        # once, with the Google account that owns the project
   npm run deploy:rules                      # Firestore rules, TTL index, Realtime Database rules
   npm run deploy:storage-rules              # only after Storage is enabled
   ```
5. Create the first administrator (prompts for a password — choose it yourself):
   ```bash
   cd website/server && npm run create-admin -- --email admin@seewater.ph --name "MCWD Administrator"
   ```
6. Run: `npm run dev` in `website/server` and `website/admin`. The database starts empty; every
   module shows zero totals and empty states until real homeowners and devices are added.
   Do **not** run `npm run seed` against the real project (it is sample data).

### Environment variables

| File | Variables |
|---|---|
| `server/.env` | `FIREBASE_PROJECT_ID=seewater`, `FIREBASE_DATABASE_URL=https://seewater-default-rtdb.firebaseio.com`, `FIREBASE_STORAGE_BUCKET=seewater.firebasestorage.app`, `FIREBASE_STORAGE_ENABLED`, `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json`, `JWT_SECRET`, optional `SMTP_*`, `SESSION_HOURS`, `ACTIVATION_CODE_DAYS`, `READING_RETENTION_DAYS`, `DEVICE_ONLINE_WINDOW_MINUTES` |
| `admin/.env.local` | `NEXT_PUBLIC_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_DATABASE_URL`, `…_PROJECT_ID`, `…_STORAGE_BUCKET`, `…_MESSAGING_SENDER_ID`, `…_APP_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_ENABLED`, `API_URL` |
| `*.env.emulator` | Same, pointing at the local Emulator Suite (`npm run dev:emulator`) |

### Local development and tests (Emulator Suite)

Requires **Java 17+** and Node.js 20.12+.

```bash
cd website && npm install
cd server && npm install && npm run emulators          # Auth 9099, Firestore 8080, RTDB 9000, Storage 9199, UI 4001
node --env-file=.env.emulator scripts/createAdmin.js --email admin@seewater.ph --name "Dev Admin"
npm run dev:emulator                                   # API on :4000 against the emulators
cd ../admin && npm run dev:emulator                    # http://localhost:3000
cd ../server && npm test                               # 39 API tests (Auth, Firestore, RTDB emulators)
cd .. && npm run test:rules                            # 13 Firestore / RTDB / Storage rules tests
```

### Database structure

**Firestore collections** (document id → key fields)

| Collection | Fields / relationships |
|---|---|
| `admins/{firebaseUid}` | email, fullName, role (mirror of claim), department, phone, photoURL, preferences, status |
| `users/{id}` | homeowner: fullName, email, phone, address, accountNumber, status, emailVerified, passwordHash (server-only), registeredVia |
| `houses/{id}` | userId → users, houseName, address, installationDate, houseStatus |
| `devices/{id}` | houseId → houses, linkedUserId, deviceName, deviceType, macAddress, firmwareVersion, activationStatus, connectionStatus, lastOnline, signalStrength, deviceKeyHash (server-only) |
| `activationCodes/{code}` | deviceId → devices, status (active/used/expired/revoked), expiresAt, hardwareActivatedAt, homeownerLinkedAt, activatedBy |
| `sensors/{id}` | deviceId, houseId, sensorType (flow/vibration), sensorLocation, calibrationStatus, lastFlowRate / lastVibrationLevel (null until reported) |
| `sensorReadings/{id}` | sensorId, deviceId, houseId, flowRate (L/min), vibrationLevel, waterUsage (L), recordedAt, source, expireAt (TTL) |
| `waterUsage/{houseId_date_source}` | daily totals: litersUsed, peakFlowRate, flowRateSum, readingsCount |
| `alerts/{id}` | deviceId, houseId, sensorId, alertType, severityLevel, alertStatus, metrics, possibleLeakArea (sensor location) |
| `valves/{id}` / `valveCommands/{id}` | current valve (status, commandStatus, positionConfirmed) / every command with requester, status, timestamps |
| `thresholdProfiles/{sensorId}`, `calibrations`, `vibrationBaselines/{sensorId}`, `vibrationBaselineHistory` | calibration & leak-detection configuration and history |
| `announcements`, `waterInterruptions`, `waterRates`, `notifications`, `feedback` | communication & billing references (`notifications.userId`, `feedback.userId`, interruptions ↔ linked advisory) |
| `systemLogs`, `deviceLogs`, `deviceStatusHistory`, `userManagement` | audit trails with timestamps and related ids |
| `settings/system` | alert toggles and thresholds (defaults apply when missing) |

**Realtime Database**

```
/live/devices/{deviceId}: { deviceName, houseId, ownerId, connectionStatus, lastOnline, signalStrength,
                            flowRate|null, flowReadingAt, vibrationLevel|null, vibrationReadingAt,
                            isSimulated, valve: { id, status, commandStatus, requestedState, positionConfirmed }, updatedAt }
/live/alerts/{alertId}:   { alertType, severityLevel, alertStatus, deviceId, houseId, ownerId, createdAt, source }
```
Rebuild from Firestore any time with `npm run sync-live`.

**Security rules**: `firebase/firestore.rules`, `firebase/database.rules.json`, `firebase/storage.rules` —
clients may only read (admins: operational data; homeowners: their own records); all writes go through the API.

## Architecture

| Layer | Location | Notes |
|---|---|---|
| Data access | `server/src/db/` | Driver interface (`get/list/create/set/update/remove/count`) — **Firestore** (Admin SDK); a local JSON driver remains for offline experiments |
| Firebase Admin | `server/src/lib/firebaseAdmin.js` | One initialisation for Auth, Firestore and Storage (service account or emulators) |
| Security rules | `firebase/*.rules` | Client read access by role; all client writes denied; tested in `firebase/tests/` |
| Live updates | `admin/src/components/layout/LiveProvider.js` | Four small Firestore listeners signal pages to refresh (falls back to polling) |
| Domain services | `server/src/services/` | Ingestion + alert rules, valve commands, usage aggregation, device status, activity logs |
| Admin API | `server/src/routes/*.js` | Session cookie (httpOnly JWT), zod validation, role checks (`viewer` is read-only) |
| Device API | `server/src/routes/deviceApi.js` | Per-device key issued at activation (stored hashed) |
| UI kit | `admin/src/components/ui/` | Button, Card, Badge/DataSourceBadge, Field, Modal/ConfirmDialog, Toast, DataTable, Tabs, states |
| Domain UI | `admin/src/components/domain/` | ValveStatus (read-only), CalibrationCard, user/device forms |
| Pages | `admin/src/app/(admin)/` | One folder per module; route protection in `src/middleware.js` + API 401 handling |

Collections follow the manuscript data dictionary: `admins`, `users`, `houses`, `devices`, `sensors`,
`sensorReadings`, `waterUsage`, `alerts`, `notifications`, `valves`, `deviceLogs`, `deviceStatusHistory`,
`calibrations`, `thresholdProfiles`, `vibrationBaselines`, `vibrationBaselineHistory`, `announcements`,
`feedback`, `userManagement`, `systemLogs`, `settings`, `activationCodes` (one document per code:
device, status, expiry, hardware/homeowner use — never readable by clients), `valveCommands`.
Admin profiles live in `admins/{firebaseUid}`.

Sensor data: there is no InfluxDB in this project, so raw readings are stored in `sensorReadings`
with an `expireAt` (default 90 days, `READING_RETENTION_DAYS`) for a Firestore TTL policy, and daily
totals in `waterUsage` are kept for history. Swapping raw readings to InfluxDB later only affects
`server/src/services/ingest.js` and the readings queries.

**Units:** volume is always liters (L); flow is always liters per minute (L/min). Vibration uses the raw
piezo/ADC scale (0–1023).

## Data provenance

Every reading, alert and log carries `source`:

- `device` — sent by an activated real device. Shown as **Live** (within 5 min) or **Stored**.
- `simulated` — seed data or the simulator (devices flagged `isSimulated`). Always badged **Simulated**.

The server decides the source from the device record; a payload cannot claim to be real.

## Leak detection and valve rules

- **High flow:** flow ≥ the sensor's warning/critical threshold (calibrated profile or system default).
- **Possible leak:** vibration above the sensor's baseline limit (`baseline + acceptable range`, or an
  explicit detection threshold) **and** water flowing (≥ minimum leak flow). Vibration with no flow is
  logged as environmental noise, not alerted (manuscript ch. 2: multi-sensor verification).
- Alerts are de-duplicated per sensor within the cooldown window; offline alerts auto-resolve on reconnect.
- **Valve commands** (homeowner from the app, or automatic shutoff — administrators can view valves but not operate them) are recorded in `valveCommands` and start as
  *pending*. The valve state changes only when the ESP32 responds via `/valve-ack` (*acknowledged*).
  `positionConfirmed` is true only if the hardware reports a verified valve position — the
  manuscript's relay design cannot, so the UIs say physical confirmation is unavailable. Commands can
  be cancelled while pending. Sample devices offer a clearly labelled simulate button; real devices never do.

## Homeowner mobile API (`/api/mobile`)

Bearer-token auth (`Authorization: Bearer …`, audience `seewater-homeowner`). Homeowner tokens are
rejected by admin routes and admin cookies are rejected here. Every data endpoint derives the
homeowner's households and devices on the server (`ownedScope`) — IDs from the app are never trusted.

| Area | Endpoints |
|---|---|
| Auth | `POST auth/signup`, `auth/verify-email`, `auth/resend-verification`, `auth/login`, `auth/password`, `auth/push-token`, `auth/logout`; `GET auth/me`; `PATCH auth/profile` |
| Devices | `GET devices`, `POST devices/link { activationCode, address? }` |
| Data | `GET home`, `GET monitoring?minutes`, `GET insights?period&from&to`, `GET announcements` |
| Alerts | `GET alerts`, `GET alerts/:id`, `POST alerts/:id/acknowledge` |
| Notifications | `GET notifications`, `GET notifications/:id` (marks read), `POST notifications/read-all`, `DELETE notifications/:id`, `DELETE notifications` |
| Valves | `GET valves`, `POST valves/:id/command { action, emergency }`, `POST valves/:id/cancel` |
| Feedback | `GET feedback`, `POST feedback` |

Sign-up with an email MCWD already registered attaches the app account to that record after email
verification. Verification codes are emailed via SMTP (`SMTP_*` env vars) or printed to the console in
development. Push notifications go through the Expo push service to registered tokens.

Demo homeowner after `npm run seed`: `maria.santos@example.com` / `SeeWater2026!`.

## Admin sidebar

Grouped by the admin Functional Decomposition Diagram (manuscript Fig. 7.1):

| Branch | Pages |
|---|---|
| IoT Device Management | Register Device, Activation Codes, Monitor Status, System Alerts, Device Logs, Firmware Update |
| User Management | Registered Users (add user), Households, User Water Usage, User Feedback |
| Announcement Management | Announcements · Water Interruptions (tabs), Sent Notifications |
| Sensor Calibration Management | Sensor Calibration: one card per household with piezo and main-line flow sensors, alert levels and speedometer gauges (Vibration Baseline measuring tool linked from the cards) |
| Account Management | Login / logout, System Preferences, System Logs |

## Device API (for ESP32 firmware)

All endpoints are under `/api/device-api`. After activation, send `X-Device-Id` and `X-Device-Key` headers.

| Method | Path | Body |
|---|---|---|
| POST | `/activate` | `{ activationCode, macAddress?, firmwareVersion? }` → `{ deviceId, deviceKey, sensors[], valveId }` (key returned once) |
| POST | `/heartbeat` | `{ firmwareVersion?, signalStrength? (dBm), batteryLevel?, configVersion? }` — `configVersion` is the `config.version` the device last applied |
| POST | `/readings` | `{ readings: [{ sensorId, flowRate? (L/min), waterUsage? (L since last), vibrationLevel?, recordedAt? }] }` |
| POST | `/logs` | `{ eventType, description, status }` |
| GET | `/commands` | → `{ commands: [{ type: "valve", valveId, commandId, state } \| { type: "firmware", updateId, version, url, sha256 }], config: { version, sensors: [{ id, sensorType, sensorLocation, status, sensitivity, calibrationFactor }] } }` — apply `config` when its version changes (new sensors, sensitivity, pulses per L/min), then send that version in the next heartbeat so Sensor Calibration shows "Applied on device" |
| POST | `/valve-ack` | `{ valveId, commandId, state: "open"\|"closed", success, message?, positionConfirmed? }` |
| POST | `/firmware-status` | `{ updateId, status: "downloading"\|"installing"\|"installed"\|"failed", message? }` — a heartbeat reporting the target `firmwareVersion` also completes the update |

## Testing

```bash
cd server && npm test        # 29 API tests: admin + homeowner auth, roles, data isolation, activation, ingestion, leak rule, valve states
cd admin && npm run build    # compiles all routes
```

### Health check (running stack)

With the API (`:4000`) and admin site (`:3000`) running:

```bash
cd server && npm run healthcheck            # read-only: ~85 checks across API, admin pages, device API, mobile API
cd server && npm run healthcheck -- --write # also registers → activates → deactivates → removes a throwaway
                                            # device (HC-…) and a draft announcement, then cleans up
```

Set `HEALTHCHECK_ADMIN_EMAIL` / `HEALTHCHECK_ADMIN_PASSWORD` (and optionally `HEALTHCHECK_HOMEOWNER_EMAIL` / `HEALTHCHECK_HOMEOWNER_PASSWORD`) in `server/.env` — see `.env.example`. Without them only the unauthenticated checks run. Exit code is 1 when any check fails.

## Feature status

| Module | Status |
|---|---|
| Admin auth (login, validation, password toggle, protected routes, logout, profile, password change, preferences) | Implemented |
| Dashboard overview (users, devices, alerts, interruptions, system status, consumption, announcements, reports, activity) | Implemented |
| Live monitoring (flow, daily usage, vibration, normal/high/critical, leak events, device status, valve state — read-only) | Implemented — live data requires installed hardware or the simulator |
| Water usage analytics (daily / weekly / monthly, date range, household filter, comparisons, CSV) | Implemented |
| User management (homeowners, households, devices, usage, audit history) | Implemented |
| Device management (registration, activation codes, status, history, sensors, assignment) | Implemented |
| Sensor calibration: per-household cards (piezo sensitivity and leak level, flow pulses per L/min and warning/critical levels) | Implemented |
| Threshold profiles (per-sensor operating range, warning/critical levels, reset to system default) | Implemented |
| Firmware update (OTA jobs per device: queue, deliver via `/commands`, progress, confirm by heartbeat, cancel) | Implemented — the ESP32 firmware must implement the HTTPS OTA download |
| Vibration baseline (measure from stored no-flow readings, ranges, thresholds, history) | Implemented |
| System alerts, system logs, device logs | Implemented |
| Announcements (draft, publish, schedule, categories, audience, priority, interruptions) | Implemented — attachments are links; file upload needs Firebase Storage |
| Feedback (review, status, response → homeowner notification) | Implemented — submission comes from the mobile app |
| Settings (profile, preferences, alert toggles, thresholds, auto-shutoff) | Implemented |
| Homeowner mobile app | Implemented in `../application` (Expo) |
| Physical valve actuation, ESP32 firmware | **Not in this repository** — integrate via the device API |
| Water rates / billing updates | Removed from the admin website. The rates API (`/api/rates`, `/api/mobile/rates`) remains for existing schedules. **No official billing or payment processing.** |
| Water interruptions | Planned/emergency interruptions with derived status, linked advisories and homeowner notifications |
| Activation codes, notifications | Dedicated admin pages (revoke, send) |
| InfluxDB time-series storage | Not used — readings are stored in Firestore (TTL) with Realtime Database for live state |
