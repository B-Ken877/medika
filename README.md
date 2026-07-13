# Medika Haiti — Telemedicine Platform

> **PROJECT MEMORY FILE** — This README serves as the complete project state reference.
> Read this file first at the start of every new chat session to get the full picture.

---

## 🖥️ Server Infrastructure

| Resource | Value |
|----------|-------|
| **VPS Provider** | Contabo / Hetzner (Ubuntu) |
| **VPS IP** | `167.86.124.101` |
| **SSH** | `root` / `algebrain` |
| **Domain** | `medikahaiti.site` |
| **SSL** | Let's Encrypt via Certbot, auto-renew |
| **Reverse Proxy** | Nginx (`/etc/nginx/sites-enabled/medikahaiti.site`) |

### Nginx Proxy Routes

| Route | Proxies To | Purpose |
|-------|-----------|---------|
| `/api/*` | `localhost:3000` | Backend REST API |
| `/ws` | `localhost:3000` | WebSocket (chat, notifications) |
| `/admin` | `localhost:4000` | Admin panel (Next.js) |
| `/payment/*` | `localhost:9998/` | MonCash payment server |
| `/uploads/*` | `localhost:3000` | Uploaded files (consultation docs, avatars) |
| `/gig/*` | Static files | Gig Solutions Academy landing page |
| `/Medika.apk` | Static file | Android APK download |

### Running Services

| Service | Technology | Port | Management |
|---------|-----------|------|-----------|
| **medika-backend** | Node.js/Express (Docker) | 3000 | Docker Compose |
| **medika-admin** | Next.js 16 standalone | 4000 | PM2 |
| **moncash-payment** | Node.js | 9998 | PM2 |
| **medika-livekit** | LiveKit Server | 7880 | Docker |
| **TURN Server** | coturn | 3478 | systemd |
| **Nginx** | | 80/443 | systemd |

---

## 📱 Android App (`/root/medika-android/`)

- **Language**: Kotlin
- **UI Framework**: Jetpack Compose
- **Networking**: Retrofit + Moshi JSON (`GeminiApi.kt` in `data/api/`)
- **Image Loading**: Coil `AsyncImage`
- **Video Calls**: LiveKit SDK
- **Payments**: MonCash WebView
- **Min SDK**: 26, **Target SDK**: 35
- **BASE_URL**: `"https://medikahaiti.site/"` (defined in `GeminiApi.kt` companion object)
- **APK**: Deployed at `/var/www/medikahaiti/Medika.apk` (280MB, universal ABI)
- **Git**: `git@github.com:B-Ken877/medika.git`

### Key Screens

| Screen | File | Purpose |
|--------|------|---------|
| Auth | `AuthScreen.kt` | Login/Register with phone + PIN |
| Patient Dashboard | `PatientDashboardScreen.kt` | Main patient home |
| Doctor Dashboard | `DoctorDashboardScreen.kt` | Main doctor home |
| Doctor Profile Card | `DoctorProfileCard.kt` | Premium card with photo, specialty, hospital, MSPP license |
| Consultation History | `ConsultationHistoryScreen.kt` | Past consultations list |
| Chat | `ChatScreen.kt` | Real-time consultation messaging |
| Video Call | `CallActivity.kt` / `IncomingCallActivity.kt` | LiveKit video calls |
| Ticket List | `TicketListScreen.kt` | Customer service tickets |
| Ticket Chat | `TicketChatScreen.kt` | Ticket messaging thread |
| Payment | `PaymentActivity.kt` | MonCash payment flow |
| Profile | `ProfileScreen.kt` | User profile + avatar upload |
| Notifications | `NotificationsScreen.kt` | Push/notification center |

### Android Known Behaviors

- Avatar URLs: `MedikaNetwork.BASE_URL.removeSuffix("/") + doctor.avatarUrl` (relative paths need BASE_URL prefix)
- Payment: `PAYMENT_SERVER = "https://medikahaiti.site/payment"`, `API_BASE = "https://medikahaiti.site/api"`
- Ticket `last_message` field is a `String` (not `Map<*,*>`) — was fixed from incorrect type cast

---

## 🖧 Backend (`/root/medika-backend/`)

- **Runtime**: Node.js 20 (Docker container `medika-backend`)
- **Framework**: Express.js
- **Database**: JSON file-based (`/app/data/` inside Docker volume)
- **WebSocket**: `ws` library for real-time chat + notifications
- **Video**: LiveKit SDK for token generation (`LIVEKIT_URL = http://host.docker.internal:7880`)
- **File Uploads**: `multer` → `/app/uploads/` (Docker volume)
- **Container**: `medika-backend` built from `/root/medika-backend/Dockerfile`
- **Compose**: `/root/medika-backend/docker-compose.yml`

### LiveKit Credentials (in server.js)

```
LIVEKIT_API_KEY = "medikakey"
LIVEKIT_API_SECRET = "7GD6FdL2cP9KTmTLkJVUKNj7XfJjWAMS"
LIVEKIT_URL = "http://host.docker.internal:7880"
```

### Backend Data Files (Docker volumes)

| File | Content |
|------|---------|
| `users.json` | All users (patients + doctors), ~50KB, 64 total users |
| `specialties.json` | 20 medical specialties with pricing |
| `consultations.json` | Consultation records |
| `messages.json` | Chat messages |
| `tickets.json` | Customer service tickets |
| `ticket_messages.json` | Ticket message threads |

**⚠️ No `doctors.json`** — Doctor data is embedded inside `users.json` (role: "doctor").

### Backend Key API Route Groups

| Route Prefix | Purpose |
|-------------|---------|
| `/api/auth/*` | Login, register, PIN management |
| `/api/doctors/*` | Doctor listing, profiles, search |
| `/api/consultations/*` | Create/view/end consultations |
| `/api/messages/*` | Chat messaging (WebSocket) |
| `/api/tickets/*` | Customer service ticket CRUD |
| `/api/upload` | File upload (multer) |
| `/api/admin/*` | Admin operations (tarification, patient management) |

### Backend Bugs Fixed

1. **monthNames]** → **monthNames[m]**: Lines 892 and 1108 in `server.js` had `monthNames]` (missing `[m]`). This was extremely tricky because `[m]` is interpreted as an ANSI terminal escape sequence when viewing via SSH, making verification appear broken even when fixed. **Solution**: Used Python inside Docker container to do string replacement.
2. **Duplicate `broadcastToRole`**: Commented out first definition (lines 337-342).
3. **Ticket system**: Completely rebuilt to production-ready state.

---

## 🛡️ Admin Panel (`/root/medika-android/medika-admin/`)

- **Framework**: Next.js 16 (standalone output)
- **Styling**: Tailwind CSS 4
- **Port**: 4000
- **Base Path**: `/admin`
- **Login**: username=`admin`, password=`algebrain`
- **Git**: Same repo `git@github.com:B-Ken877/medika.git` (subdirectory)

### Admin Pages

| Route | File | Purpose |
|-------|------|---------|
| `/admin/login` | `app/login/page.js` | Admin login page |
| `/admin/dashboard` | `app/(admin)/dashboard/page.js` | Main dashboard with stats |
| `/admin/doctors` | `app/(admin)/doctors/page.js` | Doctor management |
| `/admin/patients` | `app/(admin)/patients/page.js` | Patient management with avatars |
| `/admin/consultations` | `app/(admin)/consultations/page.js` | Consultation records |
| `/admin/customer-care` | `app/(admin)/customer-care/page.js` | Ticket list |
| `/admin/customer-care/[id]` | `app/(admin)/customer-care/[id]/page.js` | Ticket chat view |
| `/admin/tarification` | `app/(admin)/tarification/page.js` | Specialty pricing |
| `/admin/finance` | `app/(admin)/finance/page.js` | Financial overview |

### ⚠️ CRITICAL Admin Build Rule

After EVERY `npm run build`, you MUST run:

```bash
cp -r .next/static .next/standalone/.next/static/
```

The standalone build does NOT automatically include static assets. Without this copy, CSS/JS/images will be missing on the deployed site.

### Admin Bugs Fixed

1. **Ticket chat page crash**: `const essages, setMessages]` → `const [messages, setMessages]` (missing `[`)
2. **Customer care layout**: Chat view needs to use full viewport (pending redesign)

---

## 👨‍⚕️ Doctors & Specialties

### 20 Specialties (with pricing in Gourdes)

1. Medecine Generale (750), 2. Cardiologie (1500), 3. Dermatologie (1000), 4. Endocrinologie (1500), 5. Gastro-enterologie (1500), 6. Gynecologie (1200), 7. Neurologie (2000), 8. Ophtalmologie (1000), 9. ORL (1000), 10. Pediatrie (1000), 11. Psychiatrie (1500), 12. Pneumologie (1200), 13. Radiologie (1500), 14. Rhumatologie (1200), 15. Urologie (1500), 16. Chirurgie Generale (2000), 17. Orthopedie (1500), 18. Odontologie (800), 19. Nutrition (800), 20. Medecine Interne (1500)

### 60 Seed Doctors

- **3 doctors per specialty** (60 total) added via seed script
- Professional black doctor images (sourced from Unsplash/Pexels)
- Full profiles: Haitian names, French biographies, hospital affiliations, MSPP license numbers
- Stored in `users.json` with `role: "doctor"`
- **Pending**: Make doctor cards shorter + add search by name/username in Android app

---

## 💳 MonCash Payment Integration

- **Payment Server**: Node.js on port 9998, managed by PM2
- **Android**: `PaymentActivity.kt` uses WebView to load MonCash checkout
- **Flow**: Patient selects specialty → price fetched from backend → MonCash WebView → callback to backend
- **Nginx**: `/payment/*` proxies to `localhost:9998/`

---

## 📞 Video Calls (LiveKit)

- **Server**: LiveKit Docker container on port 7880
- **TURN**: coturn on port 3478 for NAT traversal
- **Backend**: Generates LiveKit access tokens via `AccessToken` SDK
- **Android**: `CallActivity.kt` (outgoing), `IncomingCallActivity.kt` (incoming with Accept/Reject)

---

## 🔧 Development & Deployment Workflow

### Backend Changes
```bash
cd /root/medika-backend
# Edit server.js or other files
docker compose down
docker compose up -d --build
# Verify: docker logs medika-backend --tail 20
```

### Admin Panel Changes
```bash
cd /root/medika-android/medika-admin
# Edit source files in app/
npm run build
# ⚠️ CRITICAL: copy static assets
cp -r .next/static .next/standalone/.next/static/
# Restart PM2
pm2 restart medika-admin   # or whatever PM2 name
```

### Android Changes
```bash
cd /root/medika-android
# Edit Kotlin files
# Build APK (needs Android SDK - typically built locally then uploaded)
# Copy APK to: /var/www/medikahaiti/Medika.apk
```

### Git
```bash
cd /root/medika-android
git add .
git commit -m "description"
git push origin main
```
Remote: `git@github.com:B-Ken877/medika.git`

---

## 🐛 Known Issues & Pending Tasks

1. **Admin customer care chat layout**: Chat view shows in a "chunk of the screen" — needs full-viewport professional redesign
2. **Doctor cards in Android**: Need to be shorter/more compact + add search by name/username
3. **MonCash PM2 stability**: `moncash-payment` shows 166+ restarts — investigate crashes

---

## 📋 Change Log (Session History)

### Session: 2026-07-12/13
- **60 seed doctors** added (3/specialty) with professional images and full French profiles
- **Customer service system** completely fixed (backend ticket API, admin chat view, Android ticket screens)
- **Backend bugs fixed**: monthNames[m] syntax, duplicate broadcastToRole
- **uqa-university.world migrated** to new VPS (169.58.3.174, root/4470Loud) — Next.js + Caddy + SQLite
- **This README** created as project memory file

### Session: 2026-07-11
- Doctor profile cards redesigned (premium look, no ratings, no personal contact)
- Patient avatars in admin panel
- Compact doctor cards + search bar in Android
- APK rebuilt and deployed

### Earlier Sessions
- Full telemedicine platform built: auth, consultations, chat, video calls, payments
- MonCash payment integration
- LiveKit video calling with TURN server
- Admin panel with dashboard, doctor/patient management, finance
- Per-specialty pricing
- Profile picture upload
- Customer care ticket system (initial build)
- Domain setup: medikahaiti.site with SSL
---

## 📋 Medical History & Consultation Notes (Added 2026-07-13)

### Feature Overview
Patients have a medical dossier that auto-builds from doctor consultation notes.

### Backend API Endpoints (added to server.js)

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/consultations/:id/notes` | Get doctor notes for a consultation |
| `PUT` | `/api/consultations/:id/notes` | Save/update notes (doctor only) |
| `GET` | `/api/medical-history/:patientId` | Full patient medical history |
| `GET` | `/api/medical-history/:patientId/snapshot` | Lightweight snapshot for doctor view |
| `PUT` | `/api/medical-history/:patientId` | Patient updates own history |

### Auto-Update Logic
When a doctor saves consultation notes:
1. **Prescriptions** → auto-added to patient current_medications (deduplicated)
2. **Diagnosis keywords** (hypertension, diabete, asthme, etc.) → auto-added as chronic conditions
3. **Consultation summary** → appended to consultation_timeline

### Data Files (JSON in container /app/data/)
- `consultation-notes.json` — Doctor notes per consultation
- `medical-histories.json` — Patient medical histories

### Android Screens
- **MedicalHistoryScreen** — Patient views full dossier (allergies, conditions, meds, timeline)
- **DoctorNoteScreen** — Doctor fills diagnosis, symptoms, notes, prescriptions
- **Dashboard card** — "Mon Dossier Medical" card on patient home screen with allergy alert banner
- **Chat note button** — Doctor sees a notes icon in ChatScreen top bar

### Navigation
- `"medical_history"` → MedicalHistoryScreen (back to "home")
- `"doctor_notes"` → DoctorNoteScreen (back to "chat")
