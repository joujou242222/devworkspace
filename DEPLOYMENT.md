# DevWorkspace Production Deployment Guide

This project is configured for cloud deployment with automated database migrations, Redis queues, and pre-seeded demo data.

---

## 1. Quickest Setup: 1-Click Render Blueprint (Backend + Postgres + Redis)

Render supports automated Infrastructure-as-Code via the included [`render.yaml`](render.yaml).

### Steps:
1. Push this repository to your GitHub account (`joujou242222/devworkspace`).
2. Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** → **Blueprint**.
3. Connect your `devworkspace` repository.
4. Render will detect `render.yaml` and automatically provision:
   - **PostgreSQL Database** (`devworkspace-db`)
   - **Redis Instance** (`devworkspace-redis`)
   - **NestJS REST API** (`devworkspace-api`)
   - **Background Worker** (`devworkspace-worker`)
5. Click **Apply**.
6. On startup, `backend/scripts/prod-start.mjs` automatically:
   - Applies all Prisma database migrations
   - Pre-seeds the **`demo@agency.com` / `Password123!`** demo agency, clients, projects, and tasks!

---

## 2. Deploying the Frontend on Vercel

The frontend is a Vite multi-page application with 36 pages and full Arabic / English bilingual support.

### Steps:
1. Go to [vercel.com/new](https://vercel.com/new) and import `joujou242222/devworkspace`.
2. Configure the project:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Add Environment Variable:
   - `BACKEND_URL`: `https://devworkspace-api.onrender.com` (your deployed Render API URL)
4. Click **Deploy**.

> The included `frontend/vercel.json` automatically configures clean extension-less URLs (`/workspace/dashboard`, `/login`, etc.) and proxies `/api/*` to your backend without CORS issues.

---

## 3. Demo Account & Credentials

Once deployed, the login page features a 1-click **Auto-fill** button for immediate access:

- **Email**: `demo@agency.com`
- **Password**: `Password123!`
- **Organization**: `Studio Velocity`
- **Language Toggle**: Full instant swap between Arabic (RTL) and English.
