
# PR Review Assistant

Paste a GitHub PR link and get an AI-generated code review — a summary plus per-file comments — with every review saved so it's browsable later.

Full-stack build: GitHub OAuth login, a FastAPI backend that talks to GitHub and Gemini, and Postgres-backed review history.

For the reasoning behind the design decisions (why calls are split the way they are, DB schema choices, trade-offs), see [ARCHITECTURE.md](https://github.com/shilu-123/pr-review-assistant/blob/main/ARCHITECTURE.md).

## Features

* Sign in with GitHub, paste a PR link, see the real diff
* Generate an AI code review (overall summary + per-file comments)
* Every review is saved automatically — browse past reviews in `/history`, open any one for the full detail view

## Project structure

```text
pr-review-assistant/
  backend/    FastAPI service — GitHub API, Gemini review, Postgres storage
  frontend/   Next.js app — GitHub sign-in, PR form, diff/review display, history
```

## Tech stack

* **Frontend**: Next.js (App Router), NextAuth (GitHub OAuth)
* **Backend**: FastAPI, httpx (GitHub API), google-generativeai (Gemini)
* **Database**: Postgres via async SQLAlchemy + asyncpg

## Setup

### 1. Create a GitHub OAuth App

1. Go to https://github.com/settings/developers → "New OAuth App"
2. Homepage URL: `http://localhost:3000`
3. Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
4. Save the Client ID and generate a Client Secret — you'll need both below.

### 2. Get a free Gemini API key

Sign in with a Google account at https://aistudio.google.com/apikey — no card needed, generous free-tier limits.

### 3. Get a free Postgres database

Create a project at [Neon](https://neon.tech/) or [Supabase](https://supabase.com/) — no card required. Copy the connection string they give you, then:

* Change `postgresql://` to `postgresql+asyncpg://`
* Drop any `?sslmode=require` suffix (SSL is handled separately, see below)
* **If using Supabase**: use the connection **pooler** host (found under Settings → Database → Connection pooling), not the direct host — the direct host is IPv6-only and fails to resolve on many networks.

### 4. Backend

```text
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `backend/.env`:

* `FRONTEND_URL` — leave as `http://localhost:3000`
* `GEMINI_API_KEY` / `GEMINI_MODEL` — from step 2
* `DATABASE_URL` — from step 3, reformatted as above
* `DB_SSL` — leave as `true` unless you're on a local Postgres without SSL

Run it:

```text
uvicorn main:app --reload --port 8000
```

Confirm it's up: http://localhost:8000/health should return `{"status":"ok"}`. On first run it automatically creates the `reviews` table.

### 5. Frontend

```text
cd frontend
npm install
cp .env.local.example .env.local
```

Fill in `frontend/.env.local`:

* `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — from step 1
* `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32` (PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`)
* `NEXTAUTH_URL` — leave as `http://localhost:3000`
* `NEXT_PUBLIC_BACKEND_URL` — leave as `http://localhost:8000`

Run it:

```text
npm run dev
```

Open http://localhost:3000.

## Using it

1. Click "Sign in with GitHub" (optional for public repos, required for private ones and to avoid low unauthenticated rate limits).
2. Paste a PR URL, e.g. `https://github.com/vercel/next.js/pull/1`.
3. Review the diff, then click **Generate AI Review** for the AI summary and per-file comments.
4. Visit `/history` to browse every review generated so far.

## API endpoints

| Method | Path                | Description                           |
| ------ | ------------------- | ------------------------------------- |
| GET    | `/health`           | Health check                          |
| POST   | `/api/fetch-diff`   | Fetch a PR's diff from GitHub         |
| POST   | `/api/review`       | Generate an AI review and save it     |
| GET    | `/api/reviews`      | List all saved reviews (newest first) |
| GET    | `/api/reviews/{id}` | Get one saved review in full          |

## Roadmap

* Deploy: frontend → Vercel, backend → Railway/Render
* Test against 5-10 real PRs and note what the model catches/misses (this is where a resume metric comes from)
* Rate limiting on `/api/review`
* Stream the AI review instead of waiting for the full response
