# Switchboard — Project Context

A Discord slash-command bot + web dashboard take-home project. This file exists so
work can be resumed in a fresh chat session (new Claude account/limit reset) without
losing context.

## What this project is
Build a web app + Discord bot where:
1. Admin signs in and connects a Discord server to the app.
2. Users run slash commands (`/report`, `/status`) in Discord.
3. The app verifies the interaction, records it, applies a simple rule, replies in
   Discord, and mirrors a notification to a second channel (Slack webhook or another
   Discord channel).
4. A login-gated dashboard shows a live log of commands/actions (scoped to the
   admin's own connected server(s)) and lets the admin configure command behavior.

Full original spec: see `Discord_Slash-Command_Bot-20260706103722.md` (the take-home
brief) if it's available in the repo — otherwise ask to have it re-shared.

Deadline: 72 hours from start (check original message timestamp for exact cutoff).

## Chosen stack
- **Framework: Next.js 16**, App Router, TypeScript, `src/` dir, Tailwind CSS.
  (Correction: earlier notes said "Next.js 14+" — the actual project is on
  Next.js 16. Worth double-checking any App Router / middleware / route handler
  behavior against Next.js 16's docs specifically if something seems off, rather
  than assuming 14/15 behavior — API surface has shifted in places, e.g.
  `cookies()` being async, which the existing code already accounts for.)
- **DB + queries:** Supabase (Postgres), accessed entirely via Supabase's JS
  clients — **no Prisma**. See "Supabase client architecture" below for the
  current (corrected) file structure.
- **Auth: Supabase Auth with Discord OAuth**, `identify + guilds` scopes.
  Reuses the same Discord Application already created for the bot.
- **Multi-tenancy:** enforced via Postgres RLS + the `admin_guilds` ownership
  table. `user_id` = Supabase's `auth.uid()`.
- **Discord interaction verification:** `discord-interactions` npm package
  (Ed25519 `verifyKey`)
- **Mirror/notification channel:** Slack Incoming Webhook (decided, not yet wired up)
- **Hosting:** Vercel (free tier)
- **AI stretch goal (optional, not started):** Groq free tier

## Project name
**Switchboard**. Live at: `https://switchboard.mohitraghuwanshi.qzz.io/`

## Supabase client architecture (corrected — read this carefully if resuming)
There are **four** client files now, each with a distinct purpose. Earlier in the
project there were only two (a plain browser client + a secret-key server
client), which caused a real bug: RLS-scoped client components were using a
plain `supabase-js` client with localStorage-based sessions, while login/auth
used a cookie-based `@supabase/ssr` client — two disconnected sessions, meaning
`auth.uid()` was null in RLS-scoped queries from client components. **This was
found and fixed.** Current structure, all under `src/lib/supabase/`:

- **`supabase-auth-browser.ts`** — `createAuthBrowserClient()`. Cookie-aware
  (`@supabase/ssr`'s `createBrowserClient`), publishable key, respects RLS.
  **Use this in any client component that needs to know the logged-in user or
  query RLS-scoped tables** (login page, connect-server page, command config
  page, future dashboard log page).
- **`supabase-auth-server.ts`** — `createAuthServerClient()` (async). Cookie-aware
  (`@supabase/ssr`'s `createServerClient`, reads `next/headers` `cookies()`),
  publishable key, respects RLS. For Server Components / Server Actions / route
  handlers that need to know who's logged in.
- **`supabase-browser.ts`** — plain `supabase-js` `createClient()`, publishable
  key, localStorage session. **Should probably be deleted** — its job is now
  fully covered by `supabase-auth-browser.ts`, and keeping both around risks the
  same bug recurring if something imports the wrong one. Not yet confirmed
  deleted.
- **`supabase-server.ts`** — `createServerSupabaseClient()`. Secret key,
  `persistSession: false`, bypasses RLS entirely. **Only for the interactions
  route and anything else with no real user session** (machine-to-machine with
  Discord). This one was never wrong — it's correct as originally written.

**Rule of thumb going forward:** if code runs because a Discord webhook fired
(no logged-in user), use `supabase-server.ts`. If code runs because a logged-in
admin is looking at the dashboard, use the `-auth-` prefixed clients (browser or
server variant depending on where the code runs).

## Progress so far

### Discord Developer Portal, bot, slash commands — DONE
(Unchanged from before: Switchboard app created, bot token/Public Key/App ID
captured, bot invited to test server, `/report` + `/status` registered as
guild-scoped commands, OAuth2 redirect + Client Secret added to the same app for
Supabase's Discord provider.)

### Interactions endpoint — DONE, now with real rule application
`src/app/api/interactions/route.ts`:
- Raw-body Ed25519 signature verification, PING/PONG handled
- On `APPLICATION_COMMAND`:
  - Extracts `discord_interaction_id`, `guild_id`, `channel_id`, `user_id`,
    `command_name`, `command_options`, and pulls out the `text` option value
    specifically (used for rule matching)
  - **NEW: looks up `command_configs` for `(guild_id, command_name)`** via
    `supabase-server.ts` (secret key — this route has no user session, so it
    must use the secret-key client, not the auth clients)
  - If `enabled === false`: status `'skipped'`, generic disabled-message reply
  - Otherwise: runs `applyRule()` (see `src/lib/rules.ts`) against the admin's
    configured keyword tags, producing a `tag` (stored as `status`) and a
    templated `reply`
  - Inserts into `interactions` with the computed `status`; dedup via catching
    Postgres `23505` on the unique `discord_interaction_id` constraint
  - Replies to Discord with the rule-generated content, not a generic
    "Recorded" placeholder anymore
- Slack mirror call **not yet added** — noted inline in the file as the next
  piece to slot in, after the insert succeeds

### Rule logic — DONE
`src/lib/rules.ts` — `applyRule(rule, text)`:
- `CommandRule` shape: `{ keywordTags: [{keyword, tag}], defaultTag, replyTemplate }`
- First matching keyword (case-insensitive substring match) wins; falls back to
  `defaultTag` (or `'general'`) if nothing matches
- `replyTemplate` supports `{tag}` and `{text}` placeholders
- Sensible defaults apply even with zero config, so commands work before any
  admin has configured anything

### Command config UI — DONE, confirmed working live
`src/app/dashboard/config/page.tsx`:
- Guild selector (populated from `admin_guilds`, RLS-scoped to the logged-in
  admin automatically)
- Per-command (`/report`, `/status`) editor: enabled toggle, reply template
  input, default tag input, dynamic add/remove list of keyword→tag pairs
- Saves via `upsert` on `command_configs` with `onConflict: 'guild_id,command_name'`
- **Was initially broken** due to the client architecture bug described above
  (imported the plain `supabase-browser.ts`, got no session, guild dropdown
  came back empty). **Fixed by switching to `createAuthBrowserClient` from
  `supabase-auth-browser.ts`. Confirmed working: guild dropdown now populates
  correctly and config saves persist.**

### Auth + connect-a-server flow — DONE, client architecture confirmed correct
- Login page, `/auth/callback` route, `/dashboard/*`-protecting middleware, and
  the connect-a-server page (fetches user's Discord guilds via `provider_token`,
  cross-references bot's guild list + Administrator permission bitfield, inserts
  into `admin_guilds`) were all built and confirmed working.
- **Client architecture confirmed correct across the board:** login page uses
  `createAuthBrowserClient`; the dashboard/connect-server page uses
  `createAuthServerClient` (server-side, cookie-based); the config page uses
  `createAuthBrowserClient` (fixed earlier this session). Searched the project
  for any remaining imports of the plain `supabase-browser.ts` — none found in
  active use. That file still exists but is now dead code, safe to delete
  whenever, no functional risk either way.

### Database — schema live, unchanged since last update
`schema.sql` run successfully: `admin_guilds`, `interactions`
(`guild_id not null`, unique `discord_interaction_id`), `command_configs`
(scoped per guild, unique `(guild_id, command_name)`), RLS on all three scoped
via `admin_guilds` ownership, `interactions` added to `supabase_realtime`
publication, `drop table cascade` statements at top for dev resets (deletes
data if re-run).

### Bugs hit and fixed
1. Route file initially at `src/api/...` instead of `src/app/api/...` (404s).
   Fixed.
2. **Supabase client session mismatch** (this session): RLS-scoped client
   components using the plain localStorage-based browser client instead of the
   cookie-based `@supabase/ssr` client, causing `auth.uid()` to be null and RLS
   queries to silently return nothing. Root-caused and fixed for the config
   page; needs the same check applied/confirmed for connect-server and login
   pages. **This is a strong AI_NOTES.md candidate** — a real, non-obvious bug
   with a clear root cause and fix, exactly the kind of thing that section asks
   for.

## Not started yet
- Slack webhook mirror integration
- Deferred response pattern (type 5) + follow-up PATCH for slow work — current
  writes are fast enough in testing so far, but this is a known gap
- Dashboard's live command log page (Realtime subscription on `interactions`,
  scoped by `admin_guilds` ownership) — natural next step, ties everything
  together visually
- README.md, AI_NOTES.md (started — see separate file, needs the client-mismatch
  bug added to the "hardest bug" section), .env.example
- Remaining stretch goals (buttons, modals, AI triage, observability)

## Key technical notes to remember
- Signature verification MUST use the raw request body string.
- Guild-scoped slash commands propagate instantly; global commands take up to an
  hour.
- Dedup: unique constraint + catching Postgres error code `23505` on insert.
- Never expose bot token, Discord public key/client secret, Supabase secret key,
  or mirror webhook URLs client-side or in logs.
- Discord permission bitfields need `BigInt`, not regular numbers.
- **Cookie-based session (`@supabase/ssr`) and localStorage-based session
  (plain `supabase-js` `createClient`) are two separate, non-syncing stores.**
  Any client component that needs to read the logged-in user or query
  RLS-scoped tables must use the `@supabase/ssr`-based browser client
  (`createAuthBrowserClient`), not plain `createClient`. This was a real bug in
  this project, not just a theoretical concern.
- RLS insert policies (`with check (user_id = auth.uid())`) let the browser
  client safely insert directly into tables like `admin_guilds` without a
  server-side route — but only if that browser client actually carries a valid
  session (see point above).
- Supabase Realtime subscriptions respect RLS per-subscriber and require the
  table to be explicitly added to the `supabase_realtime` publication (already
  done for `interactions`).
- Multi-tenancy is enforced at the database layer via RLS, not just filtered in
  application code.
- Next.js 16: `cookies()` from `next/headers` is async — existing code already
  correctly awaits it.

## Env vars in play
```
# Discord
DISCORD_APPLICATION_ID=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_PUBLIC_KEY=
# Discord OAuth Client Secret goes into Supabase's Discord provider config directly

# Supabase (new key naming)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=            # server-only, never NEXT_PUBLIC_, never committed
```
Confirm `DISCORD_BOT_TOKEN` is also set on Vercel (needed by
`/api/discord/guilds` in production). None of these should ever be committed;
`.gitignore` should include `.env*.local`.

## How to resume
Paste this file into a new chat and say something like: "Continuing the
Switchboard project — here's the context file, let's pick up from [wherever you
left off]." Also paste `schema.sql`, all four Supabase client files, the
interactions `route.ts`, `rules.ts`, and `AI_NOTES.md` if starting completely
fresh, since they carry detail this file only summarizes.