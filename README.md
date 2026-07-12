# Switchboard

A Discord slash-command bot + admin dashboard that records interactions, applies configurable rules, replies in Discord, and mirrors notifications to a second channel — all behind a login-gated, multi-tenant web UI.

**Live:** [switchboard.mohitraghuwanshi.qzz.io](https://switchboard.mohitraghuwanshi.qzz.io/)

---

## What It Does

1. **Admin signs in** via Discord OAuth and connects one or more Discord servers.
2. **Users run slash commands** (`/report <text>`, `/status`) in Discord. Each command is sent to the app's interactions endpoint.
3. **The app processes each interaction:** verifies the Ed25519 signature, deduplicates on interaction ID, records it in the database, applies a configurable rule (keyword → tag mapping), responds in Discord, and mirrors a notification to a second Discord channel.
4. **A login-gated dashboard** shows a live-updating log of every command and action (scoped to the admin's connected servers) and lets the admin configure command behavior per server.

### Key Features

- **Ed25519 signature verification** on every incoming interaction (via `discord-interactions`).
- **Deferred responses** — immediately returns Discord's "thinking…" state (type 5), then follows up with the real reply via `PATCH`, avoiding the 3-second timeout.
- **Deduplication** — unique constraint on `discord_interaction_id` + Postgres error code `23505` catch.
- **Mirror channel** — posts a notification copy to a configurable second Discord channel (per-command or guild-wide default). Server-side ownership and permission verification before any channel ID is saved.
- **Multi-tenant isolation** — Postgres RLS + `admin_guilds` ownership table. Each admin sees only their own servers' data.
- **Column-level privilege lockdown** — `mirror_channel_id` and `default_mirror_channel_id` are not writable by the `authenticated` role; only the secret-key server route can set them, preventing hijack via direct Supabase REST access.
- **Live command log** — Supabase Realtime subscription with filters, live/connecting indicator, and tag/result display.
- **Configurable rules UI** — enable/disable commands, reply templates, keyword → tag routing, mirror channel overrides — all per-server.
- **Cross-tab logout hardening** — `onAuthStateChange` + `visibilitychange` listener so a logout in one tab invalidates all others.
- **AI triage (stretch, frontend-ready)** — toggle in config UI to enable LLM-powered summarization/tagging via Groq (`llama-3.1-8b-instant`). Backend wiring is in progress.

---

## Tech Stack

| Layer             | Choice                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| Framework         | **Next.js 16** (App Router, TypeScript, `src/` directory)              |
| Styling           | **Tailwind CSS v4**                                                    |
| Database          | **Supabase** (Postgres) — queried via `supabase-js`, no ORM            |
| Auth              | **Supabase Auth** with Discord OAuth (`identify` + `guilds` scopes)    |
| Interaction verify| **`discord-interactions`** (Ed25519 `verifyKey`)                       |
| Animations        | **Motion** (Framer Motion)                                             |
| Icons             | **Lucide React**                                                       |
| Hosting           | **Vercel** (free tier)                                                 |
| AI (stretch)      | **Groq** free tier, `llama-3.1-8b-instant`                            |

---

## Project Structure

```
switchboard/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── interactions/        # Discord interactions endpoint (POST)
│   │   │   └── discord/
│   │   │       ├── callback/        # OAuth callback handler
│   │   │       ├── save-mirror-channel/  # Server-verified mirror channel write
│   │   │       └── verify-channel/  # Mirror channel pre-check
│   │   ├── auth/                    # Auth routes
│   │   ├── dashboard/
│   │   │   ├── page.tsx             # Connect-a-server flow
│   │   │   ├── config/              # Command configuration UI
│   │   │   └── logs/                # Live command log
│   │   ├── login/                   # Login page
│   │   └── page.tsx                 # Landing page
│   ├── lib/
│   │   ├── Discord/                 # Discord API helpers (send, edit, permissions)
│   │   ├── ai.ts                    # Groq AI triage helper
│   │   ├── rules.ts                 # Keyword → tag rule engine
│   │   └── supabase/
│   │       ├── supabase-auth-browser.ts  # Cookie-aware, RLS (client components)
│   │       ├── supabase-auth-server.ts   # Cookie-aware, RLS (server components)
│   │       └── supabase-server.ts        # Secret key, bypasses RLS (webhooks)
│   ├── ui/components/               # Shared UI components
│   └── actions/                     # Server actions
├── schema.sql                       # Full database schema + RLS policies
├── env.example                      # Environment variable template
└── package.json
```

---

## Getting Started (Local Development)

### Prerequisites

- **Node.js** ≥ 18
- A **Discord Application** ([Developer Portal](https://discord.com/developers/applications)) with:
  - A bot user created
  - At least two guild-scoped slash commands registered (`/report`, `/status`)
  - OAuth2 redirect URI configured
- A **Supabase** project ([supabase.com](https://supabase.com/))
- A Discord server you own (for testing)

### 1. Clone and Install

```bash
git clone https://github.com/M0HiT27/Switchboard.git
cd switchboard
npm install
```

### 2. Set Up Environment Variables

Copy `env.example` to `.env.local` and fill in your values:

```bash
cp env.example .env.local
```

| Variable                              | Description                                                     |
| ------------------------------------- | --------------------------------------------------------------- |
| `DISCORD_PUBLIC_KEY`                  | Your Discord app's public key (for Ed25519 signature verification) |
| `DISCORD_APPLICATION_ID`             | Your Discord app's application ID                                |
| `DISCORD_BOT_TOKEN`                  | Bot token (keep secret, never commit)                           |
| `NEXT_PUBLIC_SUPABASE_URL`           | Supabase project URL                                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key                                |
| `SUPABASE_SECRET_KEY`                | Supabase service role key (server-only, never `NEXT_PUBLIC_`)   |
| `SUPABASE_DB_PASSWORD`               | Supabase database password                                      |
| `NEXT_PUBLIC_SITE_URL`               | Your app's public URL (e.g. `http://localhost:3000` for dev)    |
| `GROQ_API_URL`                       | Groq API endpoint (only if using AI triage stretch goal)        |
| `GROQ_API_KEY`                       | Groq API key (only if using AI triage stretch goal)             |

> **⚠️ Never commit real secrets.** `.env*.local` is already in `.gitignore`.

### 3. Set Up the Database

Open the **Supabase SQL Editor** (in your project dashboard → SQL Editor) and run the entire contents of [`schema.sql`](schema.sql).

This single file is the complete database setup. It:
- Creates all three tables (`admin_guilds`, `interactions`, `command_configs`) with correct columns, types, defaults, and constraints
- Enables Row Level Security on every table
- Creates all 8 RLS policies (scoping reads/writes to the admin's own connected guilds)
- Applies column-level privilege lockdowns — `mirror_channel_id` and `default_mirror_channel_id` cannot be written by the `authenticated` role (only the server-side secret-key route can set them)
- Enables Supabase Realtime on the `interactions` table (for the live log dashboard)

> **⚠️ Warning:** `schema.sql` begins with `DROP TABLE IF EXISTS ... CASCADE` statements. This is safe on a fresh project but **will delete all existing data** if the tables already exist. If you're re-running it on an existing setup, remove the DROP lines first.

### 4. Configure Supabase Auth

In your Supabase dashboard under **Authentication → Providers → Discord**:
- Enable the Discord provider
- Add your Discord OAuth2 Client ID and Client Secret
- Set the redirect URL to `{your-site-url}/auth/callback`
- Request scopes: `identify`, `guilds`

### 5. Configure Discord

In the [Discord Developer Portal](https://discord.com/developers/applications):
1. Set the **Interactions Endpoint URL** to `{your-public-url}/api/interactions`
   - For local development, you'll need a tunnel (e.g., [ngrok](https://ngrok.com/), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)) since Discord can't reach `localhost`.
2. Register slash commands (guild-scoped for instant propagation):
   - `/report` — with a `text` string option
   - `/status` — no options
3. Invite the bot to your test server with the `bot` and `applications.commands` scopes, plus `Send Messages` and `View Channels` permissions.

### 6. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment

The app is deployed on **Vercel** (free tier).

1. Connect your GitHub repository to Vercel.
2. Set all environment variables from `env.example` in the Vercel project settings (Settings → Environment Variables). Make sure `NEXT_PUBLIC_SITE_URL` points to your production URL.
3. Deploy. Vercel auto-builds on push to `main`.
4. Update the Discord Developer Portal's **Interactions Endpoint URL** to `https://{your-vercel-domain}/api/interactions`.
5. Update the Supabase **Auth redirect URL** to `https://{your-vercel-domain}/auth/callback`.

---

## Testing It

1. Open the deployed URL and sign in with Discord.
2. Connect your test server via the dashboard.
3. Go to **Config** — configure reply templates, keyword rules, and a mirror channel for your commands.
4. In Discord, run `/report some test text` or `/status` in any channel the bot can see.
5. Watch the **Logs** page — the interaction should appear in real time, with its tag, result, and mirror status.
6. Check the mirror channel — a notification copy should appear there.

---

## Architecture Highlights

### Deferred Response Pattern

```
Discord ─POST─▶ /api/interactions
                 │
                 ├─ Verify Ed25519 signature
                 ├─ Return type 5 (DEFERRED) immediately
                 │
                 └─ after() ──▶ applyRule() → DB insert → mirror send
                                → PATCH /webhooks/.../messages/@original
```

All real work runs inside Next.js's `after()`, keeping the initial response well within Discord's 3-second window.

### Multi-Tenancy & Security

- **RLS** scopes all dashboard reads to the admin's connected guilds.
- **Column-level GRANTs** prevent the `authenticated` role from writing `mirror_channel_id` or `default_mirror_channel_id` directly — only the server-side route (using the Supabase secret key) can set these, after verifying guild ownership and bot permissions in the target channel.
- The Discord bot's effective permissions in the mirror channel are computed server-side using role permissions + channel overwrites via `BigInt` bitmath — never by sending a test message.

---

## License

This project was built as a take-home assessment. No license specified.
