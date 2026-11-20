# ReachInbox — Email Job Scheduler

> Full-stack Email Job Scheduler built for the **ReachInbox Software Development Intern Assignment**.

---

## 🗂 Project Structure

```
reachinbox-email-scheduler/
├── frontend/                   # React + Vite + TypeScript + Tailwind CSS
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Route-level page components
│   │   ├── services/           # Axios API client
│   │   ├── hooks/              # Custom React hooks
│   │   ├── types/              # Shared TypeScript types
│   │   ├── context/            # React context providers
│   │   └── utils/              # Helper utilities
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
│
├── backend/                    # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── config/             # env, prisma, redis, elasticsearch
│   │   ├── controllers/        # Request handler logic (future)
│   │   ├── jobs/               # BullMQ queue + worker definitions
│   │   ├── middleware/         # Auth guard, rate limiter
│   │   ├── routes/             # Express routers
│   │   ├── services/           # Business logic layer (future)
│   │   ├── types/              # TypeScript type declarations
│   │   └── utils/              # logger, mailer
│   ├── prisma/
│   │   └── schema.prisma       # Database schema (User, Email models)
│   └── tsconfig.json
│
├── docker-compose.yml          # PostgreSQL + Redis + Elasticsearch
└── package.json                # Root monorepo workspace
```

---

## ⚙️ Tech Stack

| Layer         | Technology                                    |
|---------------|-----------------------------------------------|
| Frontend      | React 18, Vite 6, TypeScript, Tailwind CSS 3  |
| Routing       | React Router v6                               |
| HTTP Client   | Axios                                         |
| State/Cache   | TanStack React Query                          |
| Backend       | Node.js, Express.js, TypeScript               |
| ORM           | Prisma 6 (PostgreSQL)                         |
| Queue         | BullMQ + Redis                                |
| Search        | Elasticsearch 8                               |
| Email         | Nodemailer + Ethereal Email (test)            |
| Auth          | Google OAuth 2.0, Slack OAuth                 |
| Job Monitor   | Bull Board                                    |
| Logging       | Winston                                       |

---

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 18
- Docker & Docker Compose
- npm ≥ 9

---

### 1. Clone & Install

```bash
git clone <repo-url>
cd reachinbox-email-scheduler

# Install all workspace dependencies (frontend + backend + root)
npm install
```

---

### 2. Start Infrastructure (Docker)

```bash
# Start PostgreSQL, Redis, and Elasticsearch
docker-compose up -d

# Optional: also start Kibana
docker-compose --profile kibana up -d
```

---

### 3. Configure Environment

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env — fill in OAuth credentials and Ethereal SMTP

# Frontend
cp frontend/.env.example frontend/.env
```

**Key values in `backend/.env`:**

| Variable             | Description                                          |
|----------------------|------------------------------------------------------|
| `DATABASE_URL`       | PostgreSQL connection string (`postgresql://postgres:password@localhost:5432/reachinbox_db`) |
| `REDIS_HOST/PORT`    | Redis host (`localhost`) and port (`6379`)           |
| `JWT_SECRET`         | Random 32+ char secret string                        |
| `ENCRYPTION_KEY`     | 32-byte string for encrypting sensitive credentials  |
| `GOOGLE_CLIENT_ID`   | From [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CLIENT_SECRET`| From Google Cloud Console                           |
| `GOOGLE_CALLBACK_URL`| `http://localhost:4000/auth/google/callback`         |
| `SMTP_USER/PASS`     | From [Ethereal Email](https://ethereal.email)        |

---

### 🔑 Google OAuth 2.0 Setup

To enable real Google Sign-In:
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web Application).
3. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173`
   - `http://localhost:4000`
4. Under **Authorized redirect URIs**, add:
   - `http://localhost:4000/auth/google/callback`
   - `http://localhost:4000/api/auth/google/callback`
5. Copy your **Client ID** and **Client Secret** into `backend/.env`.

---

### 💬 Slack App Setup & OAuth Integration

ReachInbox integrates with Slack via OAuth 2.0 and the Slack Web API (`chat.postMessage`) to send real-time alerts whenever a sender reaches their hourly sending quota.

#### Step 1: Create a Slack App
1. Go to the [Slack API App Dashboard](https://api.slack.com/apps).
2. Click **Create New App** → select **From scratch**.
3. Name your app (e.g. `ReachInbox Notifications`) and select your development workspace.

#### Step 2: Configure Permissions (Bot Token Scopes)
1. In your Slack app dashboard, navigate to **OAuth & Permissions** in the sidebar.
2. Scroll to **Scopes** → **Bot Token Scopes** and add the minimum required permissions:
   - `chat:write` — Allows the bot to post messages via Slack Web API `chat.postMessage`.
   - `incoming-webhook` — Prompts the installing user to select their desired channel during OAuth authorization.

#### Step 3: Configure Redirect URL
1. Under **OAuth & Permissions** → **Redirect URLs**, click **Add New Redirect URL**.
2. Add:
   ```
   http://localhost:4000/api/slack/callback
   ```
3. Click **Save URLs**.

#### Step 4: Add Credentials to Environment
1. Navigate to **Basic Information** in the sidebar.
2. Under **App Credentials**, copy:
   - **Client ID**
   - **Client Secret**
3. Open `backend/.env` and configure:
   ```env
   SLACK_CLIENT_ID=your_client_id_here
   SLACK_CLIENT_SECRET=your_client_secret_here
   SLACK_CALLBACK_URL=http://localhost:4000/api/slack/callback
   ```

#### Step 5: Test the OAuth Flow & Notifications
1. Start the app (`npm run dev`) and sign in at `http://localhost:5173/dashboard`.
2. Locate the **Slack Notifications** card on the Dashboard or Settings page.
3. Click **Connect Slack** → you will be redirected to Slack's authorization screen.
4. Select the target channel (e.g., `#alerts` or `#general`) and click **Allow**.
5. You will be redirected back to the Dashboard displaying a green **Connected** badge with your workspace team and destination channel.
6. Click **Send Test Alert** to verify end-to-end delivery of messages to your Slack channel.
7. To test rate limit alerts: when any sender reaches their hourly quota, a real formatted Block Kit alert is immediately delivered to Slack!
8. Click **Disconnect Slack** to safely revoke the integration at any time.


---

### 4. Database Setup

```bash
cd backend

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# (Optional) Open Prisma Studio
npm run prisma:studio
```

---

### 5. Run Development Servers

```bash
# From the root — starts API server, BullMQ worker, and Vite frontend concurrently
npm run dev

# Or run processes individually:
npm run dev:api --workspace=backend      # Express API (http://localhost:4000)
npm run dev:worker --workspace=backend   # Standalone BullMQ Worker process
npm run dev --workspace=frontend         # React/Vite (http://localhost:5173)
```

---

## 🌐 Service URLs

| Service         | URL                                   |
|-----------------|---------------------------------------|
| Frontend        | http://localhost:5173                 |
| Backend API     | http://localhost:4000/api             |
| Health Check    | http://localhost:4000/api/health      |
| Bull Board      | http://localhost:4000/admin/queues    |
| Kibana (opt.)   | http://localhost:5601                 |
| Prisma Studio   | http://localhost:5555                 |

---

## 📡 API Endpoints

| Method | Path                     | Description                      |
|--------|--------------------------|----------------------------------|
| GET    | `/api/health`            | Health check                     |
| GET    | `/auth/google`           | Google OAuth login               |
| GET    | `/auth/google/callback`  | Google OAuth callback            |
| GET    | `/api/auth/me`           | Get authenticated user           |
| POST   | `/api/auth/logout`       | Logout & clear HTTP-only cookie  |
| POST   | `/api/senders`           | Register new SMTP sender         |
| GET    | `/api/senders`           | List configured senders          |
| GET    | `/api/senders/:id`       | Get single sender details        |
| DELETE | `/api/senders/:id`       | Delete sender                    |
| POST   | `/api/senders/:id/test`  | Send test email via sender       |
| POST   | `/api/emails/schedule`   | Schedule batch emails via BullMQ |
| GET    | `/api/emails`            | List emails (paginated)          |
| POST   | `/api/emails`            | Create & schedule email          |
| GET    | `/api/emails/search?q=`  | Full-text search (Elasticsearch) |
| GET    | `/api/emails/:id`        | Get single email                 |
| DELETE | `/api/emails/:id`        | Cancel scheduled email           |
| GET    | `/api/scheduler/jobs`    | List BullMQ jobs                 |
| GET    | `/api/scheduler/stats`   | Queue statistics                 |
| GET    | `/api/slack/connect`     | Initiate Slack OAuth 2.0 flow    |
| GET    | `/api/slack/callback`    | Slack OAuth redirect callback    |
| GET    | `/api/slack/status`      | Get Slack connection status      |
| POST   | `/api/slack/disconnect`  | Disconnect Slack workspace       |
| POST   | `/api/slack/test`        | Send test alert to Slack         |

---

## ⏱ Production Rate Limiting & Concurrency Architecture

The ReachInbox email scheduler implements a distributed, atomic, sliding-window rate limiting engine designed for multi-worker and multi-instance environments.

### 1. Configuration Parameters

All rate limiting and concurrency parameters are configurable via environment variables in `backend/.env`:

| Parameter | Environment Variable | Default | Description |
|-----------|----------------------|---------|-------------|
| **Worker Concurrency** | `WORKER_CONCURRENCY` | `5` | Maximum concurrent jobs processed in parallel by each worker instance. |
| **Minimum Inter-Email Delay** | `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Minimum milliseconds enforced between consecutive dispatches from the same sender to prevent SMTP burst-rate blocking. |
| **Hourly Limit per Sender** | `MAX_EMAILS_PER_HOUR_PER_SENDER` | `50` | Default hourly quota per sender. Individual senders can override this with their custom `hourlyLimit` in PostgreSQL. |

---

### 2. Distributed Sliding Window Algorithm & Atomic Redis Lua Script

To guarantee consistency across multiple concurrent worker processes and clustered API servers, **no in-memory counters or timers are used**.

All quota checks and slot reservations execute in a **single atomic Redis Lua script** (`RATE_LIMIT_LUA_SCRIPT`):

```
Redis Keys per Sender:
- ratelimit:sender:<senderId>:hourly    -> ZSET (Score: timestamp_ms, Member: timestamp_ms:emailId)
- ratelimit:sender:<senderId>:last_send  -> STRING (Unix timestamp_ms of last dispatch)
```

#### Execution Logic in the Lua Script:
1. **Prune Expired Entries**: Cleans out timestamps older than `now - 1_hour` using `ZREMRANGEBYSCORE`.
2. **Evaluate Hourly Quota**: Reads `ZCARD(hourlyKey)`. If `currentCount >= maxHourlyLimit`:
   - Queries the oldest dispatch in the current window using `ZRANGE 0 0 WITHSCORES`.
   - Calculates the exact millisecond when the earliest slot expires: `delayNeeded = (oldestTimestamp + 3600000) - now + 100ms_jitter`.
   - Returns `{allowed = 0, delayNeeded, "HOURLY_LIMIT_EXCEEDED", currentCount}`.
3. **Enforce Minimum Delay**: Reads `lastSendKey`. If `(now - lastSendTime) < minDelayMs`:
   - Calculates spacing delay: `delayNeeded = minDelayMs - elapsed`.
   - Returns `{allowed = 0, delayNeeded, "MIN_DELAY_ENFORCED", currentCount}`.
4. **Atomic Reservation**: When both constraints pass:
   - Atomically adds the email entry to the sorted set: `ZADD hourlyKey now (now:emailId)`.
   - Sets sliding TTL: `PEXPIRE hourlyKey 7200000` (2 hours).
   - Updates `SET lastSendKey now PX 7200000`.
   - Returns `{allowed = 1, 0, "ALLOWED", currentCount + 1}`.

---

### 3. Graceful Rescheduling & Zero Job Loss Policy

When a sender exhausts their hourly quota or triggers the minimum delay spacing:

1. **Job is NEVER Dropped**: The job is preserved in the queue.
2. **Job is NEVER Marked as Failed**: Rate-limiting is a normal scheduling state, not an unrecoverable failure.
3. **BullMQ Native Delayed Set**:
   - The worker invokes `await job.moveToDelayed(Date.now() + delayNeeded, token)`.
   - Immediately throws BullMQ's built-in `DelayedError()`.
   - BullMQ moves the job back into the Redis delayed zset (`bull:email-queue:delayed`) without increasing attempt counts or firing error alerts.
4. **PostgreSQL Database Transparency**:
   - The database record maintains `status: 'scheduled'`.
   - The `scheduledAt` field is updated to the calculated next window opening time (`nextAvailableTime`).
5. **FIFO Ordering Preserved**: Jobs scheduled earlier hold earlier positions in the delayed zset when their release timestamps mature.
6. **Pre-SMTP Rollback**: If an unrecoverable network or internal error occurs before SMTP transmission, `releaseSenderSlot()` removes the entry via `ZREM` so quota is not consumed.
7. **Zero Cron Dependency**: Absolutely no cron jobs, `node-cron`, or timer poll loops are used. BullMQ Redis delayed sets manage all time-based executions.

---

### 4. Verification & Automated Test Suite

Run the full rate-limiting and concurrency verification suite:

```bash
# From the backend directory
npm run test:ratelimit
```

**What the test verifies:**
1. Configures a sender with `hourlyLimit = 3` in PostgreSQL.
2. Submits 5 emails simultaneously to `POST /api/emails/schedule`.
3. Validates that the first **3 emails** are successfully dispatched through Ethereal SMTP in the current window with valid message IDs and preview URLs.
4. Validates that the **remaining 2 emails** are delayed into the next window, their `scheduledAt` timestamps are shifted forward, and their jobs reside in BullMQ's Redis delayed set.
5. Confirms **0 emails failed** and **0 jobs lost** (100% data fidelity).

---

## 🏗 Build for Production

```bash
# Build both apps
npm run build

# Backend output: backend/dist/
# Frontend output: frontend/dist/
```

---

## 🐳 Docker Infrastructure Details

```
postgres:        PostgreSQL 16  → port 5432
redis:           Redis 7        → port 6379
elasticsearch:   ES 8.16.1      → port 9200
kibana (opt.):   Kibana 8.16.1  → port 5601
```

---

## 📝 Notes

- **Ethereal Email** is used for testing — emails are captured at `https://ethereal.email/messages` and never actually sent.
- **Bull Board** provides a UI to monitor, retry, and manage BullMQ jobs.
- The monorepo uses **npm workspaces** — always run `npm install` from the root.

---

## 📄 License

MIT

