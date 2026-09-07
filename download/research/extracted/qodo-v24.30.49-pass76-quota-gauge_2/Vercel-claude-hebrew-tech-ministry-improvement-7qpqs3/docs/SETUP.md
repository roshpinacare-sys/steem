# Qodo V24 — Guided Setup

This walks through getting Qodo running from zero, using only free-tier
services. Total time: about 10-15 minutes if you create every account;
under 5 minutes if you already have GitHub + Groq (the two you need at
minimum).

---

## The fastest path (minimum required)

You only need **four things** to run Qodo at all:

| # | What | Where to get it | Cost |
|---|---|---|---|
| 1 | GitHub Token | https://github.com/settings/tokens | Free |
| 2 | One LLM key | https://console.groq.com/keys (easiest) | Free |
| 3 | Upstash Redis URL + Token | https://console.upstash.com | Free |
| 4 | A target repo | Any repo you own, `owner/name` | Free |

Once you have those four, run:

```bash
node bootstrap.mjs
```

The wizard will ask for these first, then offer every optional extra
below — press Enter to skip anything you don't want yet.

---

## Step-by-step: the four required items

### 1. GitHub Token
1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Check the scopes: `repo`, `workflow`
4. Copy the token (starts with `ghp_`) — you won't see it again, so paste it
   into the wizard right away or somewhere safe temporarily.

*Alternative:* if you have the [GitHub CLI](https://cli.github.com/)
installed, just run `gh auth login` once, and the wizard can read your
token automatically via `gh auth token` — you can paste that output in
when asked.

### 2. Groq API Key (or any other LLM provider below)
1. Go to https://console.groq.com/keys
2. Sign up (free, no credit card needed)
3. Click **Create API Key**
4. Copy the key (starts with `gsk_`)

### 3. Upstash Redis
1. Go to https://console.upstash.com and sign up (free)
2. Click **Create Database** — pick the free tier, any region
3. Open the database, go to the **REST API** tab
4. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

### 4. Target repo
Just the `owner/repo` of whatever GitHub repository you want Qodo to
open pull requests against — can be a brand-new empty repo if you're
just trying this out.

---

## Optional: more LLM providers (free-tier fallback capacity)

None of these are required — one working key from step 2 is enough to
run Qodo. Adding more just means the agent has more free-tier options to
fall back to if one is rate-limited. Skip any of these you don't want by
pressing Enter when the wizard asks.

| Provider | Get a key at | Notes |
|---|---|---|
| OpenRouter | https://openrouter.ai/keys | Has some genuinely free models |
| Google Gemini | https://aistudio.google.com/app/apikey | Free tier via AI Studio |
| Cerebras | https://cloud.cerebras.ai | Free tier, very fast |
| Mistral | https://console.mistral.ai/api-keys | Free tier via La Plateforme |
| Together.ai | https://api.together.ai/settings/api-keys | Free "Turbo Free" models |
| SambaNova | https://cloud.sambanova.ai/apis | Free tier |
| Hugging Face | https://huggingface.co/settings/tokens | Free Inference Router |

---

## Optional: extra infrastructure

Only relevant once you want the fuller feature set (semantic caching,
canary deploys). Totally fine to skip for a first run.

| Service | Get it at | Unlocks |
|---|---|---|
| Cloudflare R2 | https://dash.cloudflare.com → R2 | Semantic cache, cross-run artifact storage |
| Vercel | https://vercel.com/account/tokens | Canary traffic routing / gradual rollout |

---

## Running the wizard

```bash
node bootstrap.mjs
```

It will:
1. Ask for the 4 required items (skips anything already in your `.env`)
2. Ask for LLM provider keys — set at least one, others optional
3. Ask for optional infra keys
4. Save everything to a local `.env` (for running locally / docker-compose)
5. If you have the GitHub CLI (`gh`) installed and logged in, also push
   everything as GitHub Actions secrets and offer to trigger a first run

If you don't have `gh` installed, that's fine — the wizard tells you
your `.env` is ready and shows the exact command to run Qodo locally:

```bash
npm install && npm run build && node packages/agent/dist/cli.js
```

---

## After setup: watching it run

```bash
cd apps/mission-control
cp .env.example .env   # fill in VITE_* vars — see comments in that file
npm install && npm run dev
# open http://localhost:5173
```

---

## If something's missing

Run the wizard again any time — it reads your existing `.env` first and
only asks about what's blank, so it's safe to re-run to add one more
provider later.


## Verify your setup

At any point, check whether your configuration is runnable — without
launching a mission:

```bash
node bootstrap.mjs --verify          # grouped ✓ / ✗ / – report, exit 0/1
node bootstrap.mjs --verify --live   # also pings GitHub / Upstash / Groq
```
