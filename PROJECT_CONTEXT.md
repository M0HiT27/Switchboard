# Switchboard — Project Context

A Discord slash-command bot + web dashboard take-home project. This file exists so
work can be resumed in a fresh chat session (new Claude account/limit reset) without
losing context.

## What this project is
Build a web app + Discord bot where:
1. Admin signs in and connects a Discord server to the app.
2. Users run slash commands (`/report`, `/status`) in Discord.
3. The app verifies the interaction, records it, applies a simple rule, replies in
   Discord, and mirrors a notification to a second Discord channel.
4. A login-gated dashboard shows a live log of commands/actions (scoped to the
   admin's own connected server(s)) and lets the admin configure command behavior.

Full original spec: see `Discord_Slash-Command_Bot-20260706103722.md` (the take-home
brief) if it's available in the repo — otherwise ask to have it re-shared.

Deadline: 72 hours from start (check original message timestamp for exact cutoff).

## Chosen stack
- **Framework:** Next.js 16, App Router, TypeScript, `src/` dir, Tailwind CSS
- **DB + queries:** Supabase (Postgres), accessed entirely via `@supabase/supabase-js`
  — **no Prisma**. Dropped Prisma in favor of the Supabase client for everything
  (writes, dedup, config reads, Realtime, RLS-scoped reads). Dedup is handled via a
  unique DB constraint + `insert ... on conflict do nothing` semantics.
- **Auth:** Supabase Auth (not NextAuth) — avoids running a second service. Discord
  OAuth is the provider for admin login. **CONFIRMED WORKING LIVE end-to-end**
  (cookie-aware auth clients split across `supabase-auth-browser.ts` /
  `supabase-auth-server.ts`, `proxy.ts`, `/login`, `/auth/callback`, dashboard
  auth guard) — see "Progress so far" below.
- **Multi-tenancy: pursuing the "multi-server support" stretch goal.** Each admin
  only sees data for Discord servers (guilds) they've explicitly connected —
  enforced via Postgres Row Level Security (RLS), not just app-level filtering. See
  schema section below for the `admin_guilds` ownership table this depends on.
- **Discord verification:** `discord-interactions` npm package (Ed25519 `verifyKey`)
- **Mirror/notification channel:** a second Discord channel — **not Slack**. The bot
  posts to it via the Discord REST API (`POST /channels/{channel_id}/messages`)
  using `DISCORD_BOT_TOKEN` in the Authorization header. Requires the bot to
  actually be a member of/have access to that second channel. Not yet wired up.
  (Earlier sessions considered a Slack Incoming Webhook for this — that plan was
  dropped; no `SLACK_WEBHOOK_URL` env var needed.)
- **Hosting:** Vercel (free tier)
- **AI stretch goal (optional, not started):** Groq free tier, for latency reasons
  within Discord's 3s response window

## Project name
**Switchboard** — chosen for the "routes incoming commands to outgoing actions"
metaphor. Repo/bot display name. Live at:
`https://switchboard.mohitraghuwanshi.qzz.io/`

A landing page already exists at the root route (built prior to this session's
auth work, not otherwise detailed here). Not yet linked to `/login`.

## Progress so far (as of last session)

### Discord Developer Portal — DONE
- Application created, named "Switchboard"
- Bot created, token generated and saved (NOT committed anywhere)
- Public Key and Application ID captured
- OAuth2 URL generated with `bot` + `applications.commands` scopes, permissions:
  Send Messages, Use Slash Commands
- Bot invited to a personal test server successfully

### Slash commands — DONE
- Registered as **guild-scoped commands** (instant propagation) via a one-off script
  `register-commands.mjs` (run locally with Node, not part of the deployed app)
- Two commands registered:
  - `/report` — takes a required `text` string option
  - `/status` — no options
- Confirmed both appear in the test server's `/` autocomplete

### Next.js project — interactions endpoint DONE and verified end-to-end
- Scaffolded with:
  ```
  npx create-next-app@latest switchboard --typescript --app --tailwind --eslint --src-dir --import-alias "@/*"
  ```
  (Next.js 16 — worth remembering for anything touching dynamic/uncached data:
  Next 16's `dynamicIO`/`connection()` requirements can affect routes doing
  request-time work, e.g. reading cookies for auth in Server Components.)
- Installed `discord-interactions` package
- Created `src/app/api/interactions/route.ts`:
  - Reads raw request body via `req.text()` (required — signature check needs raw
    bytes, not parsed JSON)
  - Verifies Ed25519 signature via `verifyKey()` using `DISCORD_PUBLIC_KEY` env var
  - Handles `PING` (type 1) → responds with `PONG` (type 1)
  - Handles `APPLICATION_COMMAND` (type 2) → currently just echoes back
    `Received command: /<name>` as a placeholder response (not yet doing real
    logic, DB writes, or dedup — that's the next coding step)
  - Rejects non-POST methods
- **Deployed to Vercel**, live at `https://switchboard.mohitraghuwanshi.qzz.io/`
- **Env vars confirmed set on Vercel** (`DISCORD_PUBLIC_KEY` at minimum)
- **Interactions Endpoint URL saved successfully in Discord portal** — Discord's
  live PING handshake passed
- **Full pipeline confirmed working live**: ran `/status` in the test Discord
  server and got back the placeholder reply — confirms signature verification,
  routing, and the Discord reply path all work end-to-end in production

### Bugs hit and fixed
- Route file was initially placed at `src/api/interactions/route.ts` (missing the
  `app` directory), which caused a 404 locally. App Router requires routes under
  `src/app/`. Fixed by moving the file to `src/app/api/interactions/route.ts`.

### Database — schema written AND CONFIRMED RUN against the Supabase project
- Supabase project created.
- Decided against Prisma entirely — using `@supabase/supabase-js` for all
  reads/writes plus Realtime.
- **Supabase's key system has changed** (rolling out through 2026): legacy
  `anon`/`service_role` JWT keys are being replaced by new **publishable**
  (`sb_publishable_...`) and **secret** (`sb_secret_...`) keys. Same permissions
  and RLS behavior as the old keys, just newer format. Project uses:
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (client-side, respects RLS)
  - `SUPABASE_SECRET_KEY` (server-side only, bypasses RLS)
  - Both obtained from Project Settings → API Keys tab
- **Multi-tenant schema, confirmed run in Supabase SQL Editor** (original version):
  - **`admin_guilds`** table: `(user_id, guild_id, guild_name, connected_at)`,
    primary key `(user_id, guild_id)`. Ownership link, created when an admin goes
    through the "connect a server" flow (not yet built — see below).
  - `interactions.guild_id` is `not null` — every logged interaction must belong
    to a guild.
  - `command_configs` scoped per guild: `guild_id` column, unique constraint
    `(guild_id, command_name)` — different connected servers can have different
    rules for the same command name.
  - RLS policies ownership-scoped via subqueries against `admin_guilds`, e.g.:
    ```sql
    using (
      guild_id in (
        select guild_id from admin_guilds where user_id = auth.uid()
      )
    )
    ```
    Enforced by Postgres itself; Realtime subscriptions respect RLS per-subscriber.
  - `admin_guilds` itself has RLS so a user can only read/insert/delete their own
    rows (`user_id = auth.uid()`).
  - `schema.sql` includes `drop table if exists ... cascade` at the top for all
    three tables (safe to re-run during dev iteration; **deletes existing data**
    — remove those drop lines once real data needs to be preserved).
- **Follow-up schema changes made this session, after switching the mirror target
  from Slack to a second Discord channel:**
  - Added `admin_guilds.default_mirror_channel_id` (text, nullable) — a per-guild
    fallback mirror target, so `command_configs.mirror_channel_id` can be left
    null and fall back to this instead of requiring every command to set its own
    override.
  - Added an `insert` policy on `command_configs` scoped the same way as the
    existing select/update policies (ownership via `admin_guilds`). Not required
    by the current plan since configs are meant to be seeded server-side (secret
    key, bypasses RLS) during "connect a server" — kept for future-proofing in
    case admins ever need to add a config for an unseeded command.
  - Both changes are additive (`alter table add column if not exists`,
    `create policy`) — run without touching the drop-table block, no data loss.
  - **Mirror target resolution logic (not yet implemented in app code):** per
    interaction, use `command_configs.mirror_channel_id` if set, else
    `admin_guilds.default_mirror_channel_id` for that guild, else no mirror.
  - **Confirmed run against the Supabase project** (both the incremental
    `alter table` and `create policy` statements).
- Full SQL is in `schema.sql` — canonical, up-to-date version reflects all of the
  above (see full file, shared this session; re-request if not present in the
  repo/session).

### Supabase Auth (Discord OAuth) — app code written this session; NOT yet verified live
- Discord OAuth credentials configured on the Supabase side (provider enabled).
- Installed `@supabase/supabase-js` and `@supabase/ssr` (the modern App Router
  session-handling package — replaces the old `auth-helpers-nextjs`).
- **Two pre-existing Supabase client files, from an earlier step, kept as-is:**
  - `src/lib/supabase/supabase-browser.ts` — plain `supabase-js` client via
    `createBrowserSupabaseClient()`, publishable key. Session lives in
    `localStorage`, NOT cookies — fine for general client-side RLS-scoped reads,
    but NOT usable for anything the server needs to authenticate (a server can't
    read `localStorage`).
  - `src/lib/supabase/supabase-server.ts` — `createServerSupabaseClient()`,
    secret key, `persistSession: false`. Privileged, session-less, for one-off
    server-side ops (e.g. `/api/interactions`). Bypasses RLS entirely.
  - Neither of these two syncs a session into cookies, so neither works for
    login/proxy/dashboard auth checks on its own — that's what the new file
    below is for.
- **New file added this session:** `src/lib/supabase/supabase-auth.ts` — cookie-aware
  clients from `@supabase/ssr`, used specifically for the login/session path:
  - `createAuthBrowserClient()` — `createBrowserClient`, publishable key, syncs
    session into cookies (unlike `supabase-browser.ts`'s localStorage-based
    client).
  - `createAuthServerClient()` — `createServerClient`, publishable key + the
    user's own session (read via `next/headers` `cookies()`), NOT the secret
    key — RLS still applies. Used in Server Components/Route Handlers that need
    to know who's logged in.
- Created `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`; exported
  function is now `proxy`, not `middleware` — functionally identical, just the new
  convention. Runs on the Node.js runtime now, not Edge, per the Next.js 16
  change.) Refreshes the Supabase session on each request via
  `supabase.auth.getUser()`, required for Server Components to see a valid
  session. Matcher excludes `/api/interactions` (no reason for Discord's webhook
  traffic to go through this). Note: per Next.js's own guidance, `proxy.ts`
  shouldn't be relied on as the sole auth boundary — the real enforcement is the
  `redirect('/login')` check in `dashboard/page.tsx` itself; `proxy.ts` here is
  just for session refresh, an optimistic layer on top.
- Created `src/app/login/page.tsx` — client component, "Sign in with Discord"
  button calling `supabase.auth.signInWithOAuth({ provider: 'discord', options: {
  redirectTo: `${origin}/auth/callback` } })`, using `createAuthBrowserClient()`.
- Created `src/app/auth/callback/route.ts` — exchanges the `code` query param for
  a session via `exchangeCodeForSession` (using `createAuthServerClient()`),
  redirects to `/dashboard` on success or `/login?error=auth_failed` on failure.
- Created `src/app/dashboard/page.tsx` — placeholder page, server-side auth guard
  only (`redirect('/login')` if no user, via `createAuthServerClient()`); no real
  dashboard content yet since `admin_guilds` isn't populated until the "connect a
  server" flow exists.
- **A landing page already existed prior to this** (separate from `/login` and
  `/dashboard`) — not touched this session; worth linking a "Sign in" CTA from it
  to `/login` at some point, not done yet.
- **Still needs verification / not yet done:**
  - Confirm Supabase Authentication → URL Configuration → Redirect URLs includes
    both `https://switchboard.mohitraghuwanshi.qzz.io/auth/callback` and
    `http://localhost:3000/auth/callback`.
  - Confirm the Discord Developer Portal OAuth2 redirect URI is set to Supabase's
    own callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`), not
    the app's `/auth/callback` — these are two different URLs in the flow and
    it's easy to put the app URL in the wrong place.
  - **CONFIRMED WORKING LIVE**: full login flow clicked through end-to-end
    (Discord → Supabase → app callback → dashboard redirect). Also fixed a
    Next.js 16 `middleware.ts` → `proxy.ts` rename issue along the way (function
    export renamed `middleware` → `proxy`, now runs on Node.js runtime not
    Edge), and moved the auth redirect for `/dashboard` into `proxy.ts` itself
    (not just the page-level guard) to eliminate a flash of dashboard content
    before redirecting unauthenticated users — `proxy.ts` now returns a clean
    `307` straight to `/login` with no dashboard HTML ever sent. Page-level
    `redirect('/login')` guard kept as defense-in-depth per Next's own guidance
    not to rely on proxy/middleware as the sole auth boundary. Residual brief
    white flash during the redirect hop itself is normal browser redirect
    behavior, not a bug — not chasing further.
  - **Bug fix note:** `supabase-auth.ts` originally combined both the browser
    and server auth clients in one file. This broke because the server client
    imports `next/headers`, and bundling both into one module meant any Client
    Component importing from it (e.g. `/login`) pulled in `next/headers`
    client-side, which doesn't exist there. **Fixed by splitting into two
    files**, matching the discipline already used for `supabase-browser.ts` /
    `supabase-server.ts`:
    - `src/lib/supabase/supabase-auth-browser.ts` → `createAuthBrowserClient()`
    - `src/lib/supabase/supabase-auth-server.ts` → `createAuthServerClient()`
    (The earlier combined `supabase-auth.ts` file no longer exists — any
    reference to it elsewhere in this doc from an earlier session is stale.)

### "Connect a server" flow — DONE, confirmed working live
- **Design decision made this session:** rejected the originally-planned manual
  form (admin pastes a Discord Guild ID, backend verifies the bot is present) in
  favor of Discord's own OAuth2 bot-install flow with a server picker. This is
  strictly better UX — the admin picks their server from Discord's native UI,
  which invites the bot in the same step, instead of two separate manual steps
  (invite bot elsewhere, then correctly copy-paste its guild ID here). It also
  removes a class of user error (typos, or claiming a guild the bot was never
  added to and getting a confusing rejection).
- **Files (actual locations — note these are NOT under `src/app/dashboard/`,
  a different layout convention than originally sketched):**
  - `src/ui/components/Dashboard/add-server-button.tsx` — plain anchor tag
    linking to Discord's OAuth2 authorize URL. No client component needed;
    Discord handles the picker/invite flow entirely on its own domain.
  - `src/app/dashboard/page.tsx` — builds the invite URL server-side:
    `https://discord.com/oauth2/authorize` with `client_id`
    (`DISCORD_APPLICATION_ID`), `scope=bot applications.commands`,
    `permissions=2048` (Send Messages — sufficient for replying to slash
    commands and posting to the mirror channel; regenerate via Discord
    Developer Portal → OAuth2 → URL Generator and update this integer if more
    permissions are ever needed), `response_type=code`, and `redirect_uri`
    pointing at the new callback below. Also queries and displays the current
    user's connected guilds from `admin_guilds` (RLS-scoped, so only their own
    rows).
  - **New route:** `src/app/api/discord/callback/route.ts` — Discord redirects
    here after the admin picks a server and approves. Reads `guild_id` from the
    query string (no manual entry needed — Discord provides it directly since
    the bot-install scope was requested). Confirms the current Supabase user via
    `createAuthServerClient()`, re-verifies the bot is actually in that guild as
    cheap insurance against a stale/replayed redirect (`GET /guilds/{guild_id}`
    with the bot token), then writes to `admin_guilds` AND seeds default
    `command_configs` rows for `/report` and `/status` (both `enabled: true`, no
    rule, no mirror override — falls back to
    `admin_guilds.default_mirror_channel_id` once that's set), all via the
    secret-key client (`createServerSupabaseClient()` from
    `supabase-server.ts`), since seeding `command_configs` has no RLS-safe
    insert-for-self path for a logged-in user. Uses `upsert` with
    `onConflict`/`ignoreDuplicates` on both writes, so re-adding an
    already-connected guild is safe and won't clobber configuration the admin
    has since customized.
  - **This is a THIRD distinct redirect URI in the Discord Developer Portal**,
    separate from Supabase's own OAuth callback (admin login) and the
    Interactions Endpoint URL (slash commands). Added to OAuth2 → General →
    Redirects: `http://localhost:3000/api/discord/callback` and
    `https://switchboard.mohitraghuwanshi.qzz.io/api/discord/callback`.
  - **New env var:** `NEXT_PUBLIC_SITE_URL` (e.g. `http://localhost:3000`
    locally, the production URL on Vercel) — used to build the callback
    `redirect_uri` dynamically. `DISCORD_APPLICATION_ID` also newly load-bearing
    here (was captured earlier but not previously used by app code).
- **An earlier version of this flow was built as a manual form** before the
  design pivot above — `src/actions/Dashboard/actions.ts` (`connectServer`
  Server Action) and the original `connect-server-form.tsx` (superseded by
  `add-server-button.tsx`). These still exist in the repo but are **no longer
  wired into the dashboard page** — left in place as an unused manual fallback
  (e.g. useful if a guild's cached name ever needs a manual re-sync), not
  currently linked from any UI. Safe to delete if unwanted; not required by the
  current flow.
- **Bugs hit and fixed during this flow, in order:**
  1. `client_id=undefined` / `redirect_uri=undefined...` in the Discord
     authorize URL → `DISCORD_APPLICATION_ID` and `NEXT_PUBLIC_SITE_URL` were
     either missing from `.env.local` or added after the dev server was already
     running (Next.js only reads `.env.local` at server startup — fixed by
     confirming both vars and doing a full dev server restart, not just a hot
     reload).
  2. `Invalid OAuth2 redirect_uri` from Discord → env vars were fixed, but the
     resulting `redirect_uri` value wasn't yet registered in the Discord
     Developer Portal's OAuth2 Redirects list → fixed by adding both the
     localhost and production `/api/discord/callback` URLs there.
  3. **"Bot not found" on every attempt, bot re-addable repeatedly to the same
     guild** → added logging to the callback route (status + body on guild
     verification failure) to diagnose. Initially suspected Discord's
     `integration_require_code_grant` setting (bot doesn't actually join until
     the backend exchanges the OAuth `code` for a token) — checked, was already
     off, so ruled out. Logged status turned out to be **`401 Unauthorized`**
     from Discord's `/guilds/{guild_id}` endpoint — **root cause: the value in
     `DISCORD_BOT_TOKEN` in `.env.local` already had a `Bot ` prefix baked in**,
     and the fetch call also prepends `Bot ${token}` when building the
     `Authorization` header, so the actual header sent was `Bot Bot
     <token>...` — malformed, rejected by Discord regardless of whether the
     bot was genuinely in the guild or not. Fixed by correcting the env var to
     contain only the raw token (no `Bot ` prefix) and restarting the dev
     server.
  4. **CONFIRMED WORKING LIVE** after the token fix — full flow clicked
     through: dashboard → "Add to Discord server" → Discord picker → bot
     invited → redirected back → verified `admin_guilds` row created in
     Supabase with correct `user_id`, `guild_id`, and `guild_name` ("JuicyBot").
     `command_configs` seed rows for `/report` and `/status` expected alongside
     this (upserted in the same request) — worth a quick manual check in
     Supabase to confirm both landed, not yet explicitly re-verified.

## Not started yet
- Linking the existing landing page's "Sign in" CTA to `/login`
- Setting `default_mirror_channel_id` on `admin_guilds` — no UI for this yet;
  currently every connected guild has `null` here, so mirror posting has no
  fallback target until either this gets a dashboard control or
  `command_configs.mirror_channel_id` is set per-command
- Wiring the actual dedup + write logic into `/api/interactions` (replacing the
  current echo placeholder) — writes must include `guild_id` from the interaction
  payload now that it's `not null`
- Deferred response pattern (type 5) + follow-up PATCH for anything slow
- Real command logic/rules (currently just an echo placeholder)
- Second-Discord-channel mirror integration — bot posts via
  `POST /channels/{channel_id}/messages` using `DISCORD_BOT_TOKEN`; needs the
  mirror-target resolution logic described above (per-command override → guild
  default → no mirror) and confirmation the bot has access to the target channel
- Dashboard UI (live command log via Supabase Realtime subscription, config UI,
  connect-a-server form)
- README.md, AI_NOTES.md (started — see separate file), .env.example
- Remaining stretch goals (buttons, modals, AI triage, observability) — multi-server
  is the one now actively being built, not just planned

## Key technical notes to remember
- Signature verification MUST use the raw request body string — parsing JSON first
  breaks it. This is the most common mistake with Discord interactions in Next.js.
- Guild-scoped slash commands propagate instantly; global commands can take up to
  an hour — stick with guild commands for dev/testing.
- Discord's ~3 second response window means any slow work (DB write + a second
  Discord API call for the mirror together might be borderline) should use the
  deferred response type (5) followed by a PATCH to the followup message webhook
  URL.
- Must dedup on `interaction.id` since Discord can redeliver the same interaction —
  handled via a unique constraint + `on conflict do nothing` insert, not app-level
  logic alone.
- Never expose bot token, Discord public key, or Supabase secret key client-side
  or in logs.
- `DISCORD_BOT_TOKEN` in `.env.local` must be the RAW token only — no `Bot `
  prefix baked into the env var itself. Any code building the Authorization
  header does `` `Bot ${token}` `` at call time; a pre-prefixed env var produces
  `Bot Bot <token>` and a silent `401` from Discord that looks like a
  guild-membership problem, not a token-format problem. Hit this once already
  in the "connect a server" flow — will bite again in the mirror-channel
  posting logic (also not yet built) if not remembered.
- Supabase's publishable key is safe client-side (respects RLS); the secret key is
  server-only and bypasses RLS — treat it like the old service_role key. The
  dashboard-facing server client (`src/lib/supabase/server.ts`) uses the
  publishable key + user session, NOT the secret key — only `/api/interactions`
  uses the secret key.
- Supabase Realtime subscriptions need RLS policies on any exposed table (now
  ownership-scoped, not `using (true)`), and the table must be explicitly added to
  the `supabase_realtime` publication.
- Multi-tenancy is enforced at the database layer via RLS + the `admin_guilds`
  link, not just filtered in application code — this is deliberate so a bug in
  dashboard query logic can't leak cross-tenant data.
- Mirror target is a second Discord channel, not Slack — no webhook URL, just the
  bot token posting via the REST API to a channel it must have access to.

## Env vars in play so far
```
# Discord
DISCORD_APPLICATION_ID=       # now load-bearing: used to build the bot-install
                               # OAuth2 URL on the dashboard, not just captured
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_PUBLIC_KEY=

# Supabase (new key naming — see notes above)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=            # server-only, never NEXT_PUBLIC_, never committed

# App
NEXT_PUBLIC_SITE_URL=           # e.g. http://localhost:3000 locally,
                                 # https://switchboard.mohitraghuwanshi.qzz.io in
                                 # prod -- used to build the Discord bot-install
                                 # callback redirect_uri dynamically
```
No `SLACK_WEBHOOK_URL` — mirror target is a second Discord channel, uses the
existing `DISCORD_BOT_TOKEN`. None of these should ever be committed. `.gitignore`
should include `.env*.local`. No `DATABASE_URL`/`DIRECT_URL`/connection-string env
vars needed since Prisma was dropped.

**Reminder:** Next.js only reads `.env.local` at server startup — adding or
changing a var requires a full dev server restart (`Ctrl+C` then `npm run dev`
again), not just a save-triggered hot reload. This caused a debugging detour
during the "connect a server" work above.

## How to resume
Paste this file into a new chat and say something like: "Continuing the Switchboard
project — here's the context file, let's pick up from [wherever you left off]."
Also paste `schema.sql` and `AI_NOTES.md` if starting completely fresh, since they
carry detail this file only summarizes.