# Deploying ReachInbox Email Scheduler on Render

This guide covers how to deploy the **ReachInbox Email Scheduler** on [Render](https://render.com) with production-grade reliability.

The repository includes a ready-to-use **Render Blueprint (`render.yaml`)** that automatically provisions:
1. **Managed PostgreSQL Database** (Database storage via Prisma ORM)
2. **Managed Redis Instance** (Persistent queue storage for BullMQ & distributed rate limiting)
3. **Full-Stack Web Service** (Serves both the Express REST API and the React/Vite dashboard under a single URL with zero CORS issues)

---

## 🚀 Method 1: 1-Click Blueprint Deployment (Recommended)

Render Blueprints allow you to deploy the entire stack with zero manual infrastructure configuration.

### Steps:
1. **Log in to Render**: Go to [dashboard.render.com](https://dashboard.render.com).
2. **Navigate to Blueprints**: Click **New +** in the top navigation bar → Select **Blueprint**.
3. **Connect Your GitHub Repository**:
   - Select `https://github.com/sat-sde/reachinbox-email-scheduler`.
   - Branch: `main`.
4. **Review Resources**:
   Render will automatically detect `render.yaml` and show:
   - `reachinbox-scheduler` (Web Service)
   - `reachinbox-db` (PostgreSQL Database)
   - `reachinbox-redis` (Redis Instance)
5. **Click "Apply"**:
   Render will provision the database, configure Redis, build both frontend and backend bundles, apply database migrations, and start the application.
6. **Access Your Application**:
   Once the build completes (usually ~2 minutes), click the `.onrender.com` URL to open your live dashboard!

---

## 🛠 Method 2: Manual Dashboard Setup

If you prefer to configure services manually via the Render UI:

### Step 1: Create a PostgreSQL Database
1. Go to **Dashboard** → **New +** → **PostgreSQL**.
2. Name: `reachinbox-db`.
3. Database Name: `reachinbox`.
4. User: `postgres`.
5. Region: Pick your preferred region (e.g. *Oregon* or *Frankfurt*).
6. Plan: **Free**.
7. Click **Create Database**.
8. Copy the **Internal Database URL** once created.

### Step 2: Create a Redis Instance
1. Go to **Dashboard** → **New +** → **Redis**.
2. Name: `reachinbox-redis`.
3. Plan: **Free**.
4. Maxmemory Policy: `noeviction` (required for reliable BullMQ queues).
5. Click **Create Redis**.
6. Copy the **Internal Redis URL** once created.

### Step 3: Create the Web Service
1. Go to **Dashboard** → **New +** → **Web Service**.
2. Connect your repo: `https://github.com/sat-sde/reachinbox-email-scheduler`.
3. Configure settings:
   - **Name**: `reachinbox-scheduler`
   - **Region**: Same region as your database
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm run render-build`
   - **Start Command**: `npm run render-start`
   - **Health Check Path**: `/api/health`
4. Add **Environment Variables**:
   ```env
   NODE_ENV=production
   EMBED_WORKER=true
   DATABASE_URL=<Paste your Internal Database URL from Step 1>
   REDIS_URL=<Paste your Internal Redis URL from Step 2>
   JWT_SECRET=your-random-32-char-jwt-secret-string
   SESSION_SECRET=your-random-32-char-session-secret-string
   ENCRYPTION_KEY=your-random-32-char-encryption-key!
   WORKER_CONCURRENCY=5
   MIN_DELAY_BETWEEN_EMAILS_MS=2000
   MAX_EMAILS_PER_HOUR_PER_SENDER=50
   SMTP_HOST=smtp.ethereal.email
   SMTP_PORT=587
   BULL_BOARD_USER=admin
   BULL_BOARD_PASS=admin123
   ```
5. Click **Create Web Service**.

---

## 🧪 Post-Deployment Verification

Once your service is deployed on Render:

1. **Verify Health Telemetry**:
   Open:
   ```
   https://your-service.onrender.com/api/health
   ```
   Expected response:
   ```json
   {
     "status": "healthy",
     "service": "reachinbox-backend",
     "database": { "type": "PostgreSQL 16", "status": "connected" },
     "redis": { "status": "connected" }
   }
   ```

2. **Access the Dashboard**:
   Open:
   ```
   https://your-service.onrender.com/dashboard
   ```
   - Click **Enter Dashboard as Demo User** to enter immediately with seeded data.
   - Click **Compose New Email** to schedule your first email or test CSV upload.

3. **Monitor BullMQ Queues via Bull Board**:
   Open:
   ```
   https://your-service.onrender.com/admin/queues
   ```
   - Log in with credentials:
     - Username: `admin` (or your configured `BULL_BOARD_USER`)
     - Password: `admin123` (or your configured `BULL_BOARD_PASS`)
   - View live Waiting, Delayed, Active, Completed, and Failed email dispatch jobs.

---

## 🔐 Optional Production Add-ons

### 1. Google OAuth 2.0
In Google Cloud Console, update your authorized redirect URI to your Render URL:
```
https://your-service.onrender.com/auth/google/callback
```
Then add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to your Render environment variables.

### 2. Slack OAuth 2.0 Alerts
In your Slack App dashboard, update your authorized redirect URI:
```
https://your-service.onrender.com/api/slack/callback
```
Then add `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` to your Render environment variables.

### 3. Dedicated Background Worker (Optional Scaling)
By default, `EMBED_WORKER=true` runs the BullMQ worker inside the Web Service for cost efficiency. If you scale to high volumes, you can optionally create a separate **Background Worker** on Render:
- **Build Command**: `npm run render-build`
- **Start Command**: `npm run worker --workspace=backend`
- Set `EMBED_WORKER=false` on your Web Service.
