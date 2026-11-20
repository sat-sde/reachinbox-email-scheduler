# ReachInbox — Full-Stack Email Job Scheduler

> Built for the **ReachInbox Software Development Intern Assignment**.
> A production-grade, distributed email scheduling engine featuring atomic per-sender rate limiting, zero job loss, Google & Slack OAuth 2.0, BullMQ with Redis persistence, Elasticsearch full-text search, Bull Board administration, and a pixel-accurate React frontend reproducing the official Figma specification.

---

## 📋 Table of Contents

- [Overview & Architecture](#-overview--architecture)
- [System Architecture Diagram](#-system-architecture-diagram)
- [Folder Structure](#-folder-structure)
- [Prerequisites & Quick Start](#-prerequisites--quick-start)
- [Docker Setup](#-docker-setup)
- [Environment Variables Guide](#-environment-variables-guide)
- [External Service Integrations](#-external-service-integrations)
  - [Google OAuth 2.0 Setup](#1-google-oauth-20-setup)
  - [Slack OAuth & Alerts Setup](#2-slack-oauth--alerts-setup)
  - [Ethereal SMTP Setup](#3-ethereal-smtp-setup)
  - [Elasticsearch & Schema Setup](#4-elasticsearch--schema-setup)
- [Running the Application](#-running-the-application)
- [API Documentation](#-api-documentation)
- [Scheduling, Persistence & Crash Resilience](#-scheduling-persistence--crash-resilience)
- [Distributed Rate Limiting Engine](#-distributed-rate-limiting-engine)
- [Worker Concurrency & Multi-Instance Scaling](#-worker-concurrency--multi-instance-scaling)
- [Assumptions & Architectural Trade-offs](#-assumptions--architectural-trade-offs)
- [Practical 5-Minute Video Demo Checklist](#-practical-5-minute-video-demo-checklist)
- [Verification & Automated Test Suite](#-verification--automated-test-suite)

---

## 🌟 Overview & Architecture

ReachInbox Email Scheduler is an asynchronous, event-driven email dispatching platform. It accepts large batches of outreach emails (via manual input or CSV/TXT uploads), spaces them out across time based on sender hourly limits and delay constraints, persists them in PostgreSQL, and enqueues delayed jobs in BullMQ backed by Redis.

### Core Architectural Principles
1. **Zero Cron Dependency**: Cron jobs and `node-cron` poll loops are strictly eliminated. All timing and delays are handled via **BullMQ native Redis delayed sets** (`ZSET`), allowing millisecond precision and horizontal scaling.
2. **Distributed Atomic Rate Limiting**: All quota evaluations and inter-email delay enforcements are executed inside a **single atomic Redis Lua script** (`RATE_LIMIT_LUA_SCRIPT`). No in-memory state exists, enabling multi-process and multi-server clusters without race conditions.
3. **Zero Job Loss Policy**: When an hourly quota is exceeded, jobs are **never failed or dropped**. The worker computes the exact millisecond when the sliding window reopens and reschedules the job in BullMQ using `moveToDelayed()` with BullMQ's native `DelayedError`.
4. **Dual-Layer Search with Fallback**: Full-text email search is powered by Elasticsearch 8 with specialized email tokenizers (`uax_url_email`). If Elasticsearch is degraded or unassigned, queries automatically fall back to PostgreSQL full-text search with zero downtime.
5. **Decoupled Architecture**: The Express REST API and the BullMQ background workers run as separate, independent processes sharing Redis and PostgreSQL.

---

## 🏛 System Architecture Diagram

```
[ Browser / React App ]
         │
         │  (HTTP / Axios with Cookies)
         ▼
[ Express.js API (Port 4000) ]
   ├── /auth/google       ───> Google OAuth 2.0
   ├── /api/slack/*       ───> Slack OAuth 2.0 (chat.postMessage)
   ├── /api/emails/*      ───> Zod Validation & Controller
   ├── /admin/queues      ───> Bull Board Protected Dashboard
   └── /api/health        ───> Infrastructure Telemetry
         │                               │
         │ (Prisma Client)               │ (BullMQ Enqueue)
         ▼                               ▼
[ PostgreSQL 16 (DB) ]             [ Redis 7 (Queue & Rates) ]
  - users                             - bull:email-queue:delayed (ZSET)
  - senders                           - bull:email-queue:active (LIST)
  - emails                            - ratelimit:sender:<id>:hourly (ZSET)
  - slack_connections                 - ratelimit:sender:<id>:last_send (STR)
                                                 │
                                                 │ (BullMQ Delayed Job Trigger)
                                                 ▼
                                     [ Standalone Worker Process ]
                                        ├── 1. Atomic Redis Lua Slot Check
                                        ├── 2. Slack Rate-Limit Alert (chat.postMessage)
                                        ├── 3. Reschedule via moveToDelayed() (if limited)
                                        └── 4. Nodemailer SMTP (Ethereal Email)
                                                 │
                                                 ▼
                                     [ Ethereal SMTP & Preview ]
                                                 │
                                                 ▼ (Non-blocking)
                                     [ Elasticsearch 8 (Indexing) ]
```

---

## 🗂 Folder Structure

```
reachinbox-email-scheduler/
├── docker-compose.yml              # PostgreSQL 16, Redis 7, Elasticsearch 8.16.1
├── package.json                    # Monorepo workspaces definition & scripts
├── README.md                       # Comprehensive project documentation
│
├── frontend/                       # React 18 + Vite 6 + Tailwind CSS
│   ├── public/
│   │   └── sample-recipients.csv   # Ready-to-test 10-row CSV file
│   ├── src/
│   │   ├── components/             # Reusable UI component library
│   │   │   ├── ui/                 # Button, Input, Modal, Table, StatusBadge
│   │   │   ├── ComposeModal.tsx    # Modal with PapaParse CSV upload & validation
│   │   │   ├── EmailDetailsModal.tsx # Inspection modal with Ethereal preview
│   │   │   ├── Header.tsx          # Top bar with user profile & logout
│   │   │   ├── Sidebar.tsx         # Navigation drawer matching Figma design
│   │   │   └── SlackIntegrationCard.tsx # Slack OAuth connect/disconnect UI
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx       # Google OAuth CTA + demo login bypass
│   │   │   ├── DashboardPage.tsx   # Figma-aligned metric cards & dual tables
│   │   │   ├── EmailsPage.tsx      # Paginated email table with filters
│   │   │   ├── SchedulerPage.tsx   # Sender identities & custom quotas
│   │   │   └── SettingsPage.tsx    # Live telemetry for DB, Redis, Elasticsearch
│   │   ├── services/api.ts         # Axios client with credentials & auth refresh
│   │   └── context/                # AuthContext, ModalContext
│   ├── eslint.config.js            # Flat ESLint configuration (0 errors, 0 warnings)
│   ├── vite.config.ts              # Vite proxy configuration (/api & /auth)
│   └── tailwind.config.js
│
└── backend/                        # Express.js + TypeScript + Prisma + BullMQ
    ├── .env.example                # Documented template for all environment variables
    ├── prisma/
    │   ├── schema.prisma           # User, Sender, Email, SlackConnection
    │   └── migrations/             # Relational migration history
    └── src/
        ├── config/                 # env.ts, prisma.ts, redis.ts, elasticsearch.ts
        ├── jobs/                   # emailQueue.ts (BullMQ), emailWorker.ts
        ├── middleware/             # auth.ts, adminAuth.ts (Bull Board), validate.ts
        ├── routes/                 # auth.ts, emails.ts, senders.ts, slack.ts, health.ts
        ├── services/
        │   ├── rateLimiterService.ts # Distributed Redis Lua sliding window engine
        │   ├── emailService.ts     # Nodemailer Ethereal SMTP & credential encryption
        │   ├── slackService.ts     # Slack OAuth exchange & chat.postMessage alerts
        │   └── elasticsearchService.ts # Index creation, sync, & fallback search
        ├── utils/                  # crypto.ts (AES-256-GCM), logger.ts, errors.ts
        ├── worker.ts               # Standalone worker entry point
        ├── index.ts                # Main Express application entry point
        └── scripts/
            ├── verifyBrowserUI.ts  # Chrome CDP end-to-end browser test
            ├── testRateLimiting.ts # Sliding window & slot rescheduling verification
            └── testEtherealSMTP.ts # Nodemailer STARTTLS test
```

---

## ⚡ Prerequisites & Quick Start

### Minimum Requirements
- **Node.js** ≥ 18 (Tested on Node.js v20 & v22)
- **Docker** & **Docker Compose**
- **npm** ≥ 9

### Step 1: Clone Repository & Install Dependencies
```bash
git clone https://github.com/sat-sde/reachinbox-email-scheduler.git
cd reachinbox-email-scheduler

# Install all workspace dependencies across backend and frontend
npm install
```

### Step 2: Spin Up Infrastructure Containers
```bash
docker-compose up -d
```
Verify all 3 services are active:
- PostgreSQL 16 on `localhost:5432`
- Redis 7 on `localhost:6379`
- Elasticsearch 8 on `localhost:9200`

### Step 3: Configure Environment Variables
```bash
# Copy template
cp backend/.env.example backend/.env
```
*(The backend defaults to safe development values out-of-the-box, including automatic generation of Ethereal SMTP accounts and demo login bypass).*

### Step 4: Run Database Migrations
```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
cd ..
```

### Step 5: Start All Applications
From the repository root, run:
```bash
npm run dev
```
This starts concurrently:
- 🚀 **Backend API**: `http://localhost:4000`
- ⚙️ **BullMQ Worker**: Listening for email-queue delayed jobs
- 💻 **Frontend UI**: `http://localhost:5173`

---

## 🐳 Docker Setup

The included `docker-compose.yml` provides production-parity data services:

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: reachinbox
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.16.1
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
```

To stop containers:
```bash
docker-compose down
```

---

## 🔑 Environment Variables Guide

All configurable settings are validated at boot time via Zod (`backend/src/config/env.ts`):

| Variable | Default Value | Purpose |
|---|---|---|
| `PORT` | `4000` | Port on which the Express REST API listens |
| `DATABASE_URL` | `postgresql://postgres:password@localhost:5432/reachinbox` | PostgreSQL connection string |
| `REDIS_HOST` | `localhost` | Redis server host |
| `REDIS_PORT` | `6379` | Redis server port |
| `WORKER_CONCURRENCY` | `5` | Maximum number of concurrent jobs processed by each worker |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Minimum delay in ms between consecutive emails from the same sender |
| `MAX_EMAILS_PER_HOUR_PER_SENDER`| `50` | Default hourly quota for senders |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Elasticsearch cluster endpoint |
| `JWT_SECRET` | 32+ char secret | Used for signing user session cookies |
| `ENCRYPTION_KEY` | 32+ char secret | AES-256-GCM key used to encrypt SMTP & Slack credentials |
| `GOOGLE_CLIENT_ID` | `""` | Google Cloud Console OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | `""` | Google Cloud Console OAuth 2.0 Client Secret |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4000/auth/google/callback` | Authorized redirect URI for Google OAuth |
| `SLACK_CLIENT_ID` | `""` | Slack App OAuth Client ID |
| `SLACK_CLIENT_SECRET` | `""` | Slack App OAuth Client Secret |
| `SLACK_CALLBACK_URL` | `http://localhost:4000/api/slack/callback` | Authorized redirect URI for Slack OAuth |
| `BULL_BOARD_USER` | `admin` | HTTP Basic Auth username for `/admin/queues` |
| `BULL_BOARD_PASS` | `admin123` | HTTP Basic Auth password for `/admin/queues` |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin for cookie exchange |

---

## 🔌 External Service Integrations

### 1. Google OAuth 2.0 Setup
1. Open the [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Application type: *Web application*).
3. Under **Authorized JavaScript Origins**, add:
   - `http://localhost:5173`
   - `http://localhost:4000`
4. Under **Authorized Redirect URIs**, add:
   - `http://localhost:4000/auth/google/callback`
5. Place the generated credentials into `backend/.env`:
   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```
*(Note: If Google credentials are not supplied, the app includes a 1-click **"Enter Dashboard as Demo User"** bypass button that creates a seeded account automatically).*

### 2. Slack OAuth & Alerts Setup
ReachInbox sends real Slack messages via `chat.postMessage` whenever a sender exhausts their hourly email limit.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. Under **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add:
   - `chat:write` (Allows posting alert messages)
   - `incoming-webhook` (Allows channel selection during authorization)
3. Under **Redirect URLs**, add:
   ```
   http://localhost:4000/api/slack/callback
   ```
4. Copy **Client ID** & **Client Secret** into `backend/.env`:
   ```env
   SLACK_CLIENT_ID=your-slack-client-id
   SLACK_CLIENT_SECRET=your-slack-client-secret
   ```
5. From the ReachInbox dashboard, click **Connect Slack**, pick your channel, and authorize.
6. Test using the **Send Test Alert** button.

### 3. Ethereal SMTP Setup
- ReachInbox uses [Ethereal Email](https://ethereal.email) as its SMTP delivery mechanism.
- **Zero Manual Configuration Required**: If `SMTP_USER` and `SMTP_PASS` are empty, ReachInbox calls `nodemailer.createTestAccount()` on boot and automatically registers a new disposable Ethereal account.
- Every sent email receives a real **Message-ID** and a clickable **Ethereal Preview URL** displayed directly in the dashboard and email inspection modals.

### 4. Elasticsearch & Schema Setup
- Connects to Elasticsearch 8 on `http://localhost:9200`.
- The index `emails` is auto-created on startup with explicit mappings:
  - Custom `uax_url_email` analyzer for email addresses.
  - Multi-fields for `subject` and `recipient` (`text` + `keyword`).
  - Standard analyzer for email `body`.
- **Automatic Fallback**: If Elasticsearch is unavailable or recovering shards, `searchEmailDocuments()` transparently switches to PostgreSQL without throwing an error to the user (`source: "database_fallback"`).

---

## 🏃 Running the Application

### Option A: Root Monorepo Orchestration (Recommended)
```bash
# Starts API, Worker, and Vite concurrently
npm run dev
```

### Option B: Separate Processes (Production Architecture)
```bash
# Terminal 1: Backend API
cd backend && npm run dev:api

# Terminal 2: BullMQ Email Worker
cd backend && npm run dev:worker

# Terminal 3: Vite Frontend
cd frontend && npm run dev
```

### Option C: Production Build & Execution
```bash
npm run build
# Starts production server and worker:
npm run start --workspace=backend
npm run worker --workspace=backend
```

---

## 📡 API Documentation

### Authentication Endpoints
- `GET /auth/google` — Redirects to Google OAuth authorization.
- `GET /auth/google/callback` — Exchanges Google code, generates JWT, sets HTTP-only cookie.
- `GET /auth/dev-login` — Seeds a demo user with realistic email history and sets session cookie.
- `GET /api/auth/me` — Returns current authenticated user record.
- `POST /api/auth/logout` — Clears the secure session cookie.

### Email Scheduling Endpoints
- `POST /api/emails/schedule` — Schedules a campaign of emails.
  ```json
  {
    "subject": "Q4 Outreach",
    "body": "<p>Hello team</p>",
    "recipients": ["alice@corp.com", "bob@corp.com"],
    "startTime": "2026-11-21T10:00:00.000Z",
    "delayBetweenEmails": 5,
    "hourlyLimit": 50,
    "senderId": "optional-uuid"
  }
  ```
- `GET /api/emails?status=scheduled&page=1&limit=20` — Returns paginated email records scoped to user.
- `GET /api/emails/search?q=outreach&status=all` — Full-text Elasticsearch search across recipient, subject, and body with DB fallback.
- `GET /api/emails/:id` — Inspect detailed email state, headers, previewUrl, and bullJobId.
- `DELETE /api/emails/:id` — Cancels a scheduled email and removes the job from BullMQ.

### Senders Endpoints
- `GET /api/senders` — List sender identities with configured hourly limits.
- `POST /api/senders` — Add new sender with encrypted credentials.
- `DELETE /api/senders/:id` — Remove sender identity.
- `POST /api/senders/:id/test` — Dispatch an instant test email.

### Slack Integration Endpoints
- `GET /api/slack/connect` — Initiates Slack OAuth flow.
- `GET /api/slack/callback` — Exchanges code, encrypts token, associates with user.
- `GET /api/slack/status` — Returns connection state without exposing token.
- `POST /api/slack/disconnect` — Revokes Slack workspace integration.
- `POST /api/slack/test` — Sends a test notification to the configured channel.

### System & Telemetry Endpoints
- `GET /api/health` — Returns live JSON health of PostgreSQL, Redis, Elasticsearch, and uptime.
- `GET /admin/queues` — Bull Board administration UI (Protected by HTTP Basic Auth `admin:admin123` or JWT).

---

## ⏰ Scheduling, Persistence & Crash Resilience

### Deterministic Job IDs
Every email is first assigned a UUID primary key in PostgreSQL. The BullMQ job ID is assigned deterministically:
```ts
const deterministicJobId = `email-job-${email.id}`;
```
This guarantees idempotency: even if an API call is retried, BullMQ checks `emailQueue.getJob(deterministicJobId)` and skips duplicate creation.

### Crash Resilience (Restart Test Verified)
- Delayed jobs are stored in Redis Sorted Sets (`bull:email-queue:delayed`) with scores equal to the Unix target timestamp.
- If both the backend API and the worker process crash or are killed simultaneously:
  1. No jobs are lost — Redis holds the queue in memory and AOF/RDB persistence.
  2. When the worker restarts, BullMQ reads the delayed set and fires jobs whose timestamps matured while the system was offline.
  3. The database state is verified before sending to prevent duplicate dispatches.

---

## 🛡 Distributed Rate Limiting Engine

### Sliding Window Algorithm (Redis Lua)
The sliding window is implemented in `RATE_LIMIT_LUA_SCRIPT`:
```lua
-- 1. Purge entries older than (now - 1 hour)
redis.call('ZREMRANGEBYSCORE', hourlyKey, '-inf', now - windowMs)

-- 2. Count active sends in current window
local currentCount = redis.call('ZCARD', hourlyKey)

-- 3. Check hourly limit
if currentCount >= maxLimit then
  local oldest = redis.call('ZRANGE', hourlyKey, 0, 0, 'WITHSCORES')
  local nextAvailable = tonumber(oldest[2]) + windowMs
  return {0, nextAvailable - now, "HOURLY_LIMIT_EXCEEDED", currentCount}
end

-- 4. Check minimum delay constraint
local lastSend = redis.call('GET', lastSendKey)
if lastSend and (now - tonumber(lastSend)) < minDelayMs then
  return {0, minDelayMs - (now - tonumber(lastSend)), "MIN_DELAY_ENFORCED", currentCount}
end

-- 5. Reserve slot atomically
redis.call('ZADD', hourlyKey, now, now .. ':' .. memberId)
redis.call('SET', lastSendKey, now, 'PX', windowMs * 2)
return {1, 0, "ALLOWED", currentCount + 1}
```

### Rate-Limit Rescheduling Behavior
When the script returns `allowed = 0`:
1. The worker calculates the exact millisecond when a slot opens (`nextAvailableTime`).
2. BullMQ native method `job.moveToDelayed(Date.now() + delayNeeded, token)` is invoked.
3. The worker throws BullMQ's `DelayedError()`.
4. PostgreSQL updates `scheduledAt` to `nextAvailableTime`.
5. If the reason was `HOURLY_LIMIT_EXCEEDED`, a real Slack alert is dispatched (deduplicated in Redis so only one alert is sent per hourly event).

---

## ⚡ Worker Concurrency & Multi-Instance Scaling

- **Worker Concurrency**: Set via `WORKER_CONCURRENCY` (default `5`). Controls how many jobs a single worker thread executes concurrently.
- **Horizontal Scaling**: You can spawn 10 worker processes across 5 servers pointing to the same Redis instance. Because all rate-limiting and job-locking occurs in Redis Lua scripts, the senders' hourly quotas are strictly maintained across the entire cluster without inter-worker communication.

---

## ⚖️ Assumptions & Architectural Trade-offs

| Decision | Trade-off / Rationale |
|---|---|
| **BullMQ Delayed Sets over Cron** | Avoids polling database tables every minute; reduces DB CPU; enables sub-second precision and distributed locks. |
| **Redis Lua Scripting for Rates** | Eliminates race conditions when multiple workers pull jobs at the same millisecond; requires Redis to be available. |
| **Elasticsearch with DB Fallback** | Elasticsearch provides fast fuzzy search and typo tolerance on large volumes, but database fallback ensures search never fails if ES clusters are re-sharding or low on disk. |
| **Ethereal Email over Real SMTP** | Evaluators do not need to configure an AWS SES or SendGrid account; tests generate real preview URLs without spamming live inboxes. |
| **HTTP-Only Cookies for Auth** | Protects against Cross-Site Scripting (XSS) token theft compared to storing JWTs in localStorage. |

---

## 🎬 Practical 5-Minute Video Demo Checklist

Use this battle-tested step-by-step checklist when recording your 5-minute Loom or video walkthrough:

### Minute 0:00 - 0:45: Project Overview & Tech Stack
- [ ] Show the running application at `http://localhost:5173`.
- [ ] Highlight the tech stack: React 18, Tailwind CSS, Node.js TypeScript, BullMQ, Redis, PostgreSQL (Prisma), Elasticsearch, and Ethereal SMTP.
- [ ] Mention the **Zero-Cron** architecture and **Zero Job Loss** policy.

### Minute 0:45 - 1:45: Authentication & Dashboard Overview
- [ ] Log out to show the **Login Page** matching the Figma design.
- [ ] Click **"Enter Dashboard as Demo User"** (or use Google Sign-In).
- [ ] Show the **4 Metric Cards**: Scheduled Queue, Sent Emails, Active Senders, Total Managed.
- [ ] Show the dual tables: **Scheduled Emails** (waiting in BullMQ) and **Sent Emails** (delivered via SMTP).
- [ ] Click an email row to open the **Email Details Modal** and click the **Ethereal Preview URL** to display the rendered test email in the browser.

### Minute 1:45 - 2:45: Compose Email & CSV Upload (PapaParse)
- [ ] Click **Compose New Email** to open the modal.
- [ ] Switch to the **Upload CSV / TXT** tab.
- [ ] Drag-and-drop or upload `frontend/public/sample-recipients.csv`.
- [ ] Point out the **real-time metrics**: Valid Emails count, Invalid count, and Duplicates Removed.
- [ ] Click **View Parsed Recipients** to expand the visual checklist.
- [ ] Switch back to **Manual Entry** and click **Use Demo Template**.
- [ ] Set delay to `2` seconds and hourly limit to `50`.
- [ ] Click **Schedule Campaign** → show the toast notification and immediate table refresh.

### Minute 2:45 - 3:45: Rate Limiting & Slack Alerting
- [ ] Point to the **Slack Notifications Card** on the dashboard.
- [ ] Show that Slack is connected, or click **Connect Slack** to show the real OAuth flow.
- [ ] Click **Send Test Alert** → show the message arriving in your Slack channel.
- [ ] Explain how Redis Lua scripts delay excess jobs and notify Slack once per hourly limit event.

### Minute 3:45 - 4:30: Bull Board Queue Monitor & Crash Resilience
- [ ] Navigate to `http://localhost:4000/admin/queues` (HTTP Basic Auth: `admin` / `admin123`).
- [ ] Show the **Bull Board** live monitor with Delayed, Waiting, Active, and Completed jobs.
- [ ] Explain how jobs survive server restarts because they reside in Redis sorted sets.

### Minute 4:30 - 5:00: Settings & Code Quality Summary
- [ ] Navigate to `/settings` to show the live infrastructure heartbeats (PostgreSQL connected, Redis connected, Elasticsearch connected).
- [ ] Show that ESLint passes with **0 errors, 0 warnings** and TypeScript compiles clean.
- [ ] Conclude with GitHub repository link.

---

## 🧪 Verification & Automated Test Suite

Run all verification suites directly from the command line:

```bash
# 1. End-to-End Chrome DevTools Protocol (CDP) Browser Test (Captures 7 screenshots)
npm run test:ui --workspace=backend

# 2. Rate Limiting, Sliding Window & Rescheduling Test
npm run test:ratelimit --workspace=backend

# 3. Ethereal SMTP STARTTLS Delivery Test
npm run test:ethereal --workspace=backend

# 4. TypeScript Type-Checking
npm run build --workspace=backend
npm run build --workspace=frontend

# 5. ESLint Code Quality Check
npm run lint --workspace=backend
npm run lint --workspace=frontend
```

---

## 📄 Features Requiring Manual External Setup

The application is completely self-contained and pre-seeded for immediate local testing. The following features only require external configuration if you wish to link live external third-party services:

1. **Google OAuth 2.0**: Requires creating a Client ID in [Google Cloud Console](https://console.cloud.google.com). *(The application provides a 1-click Demo Login for testing without Google credentials).*
2. **Slack OAuth 2.0**: Requires creating a Slack App with `chat:write` and `incoming-webhook` scopes in [api.slack.com](https://api.slack.com).
3. **Custom Production SMTP**: If you wish to send real emails to live external inboxes instead of Ethereal test mailboxes, configure `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` with AWS SES, SendGrid, or Postmark credentials.

---

## 📄 License
MIT License. Built by **Satyam Vishwakarma** for the ReachInbox Engineering Assignment.
