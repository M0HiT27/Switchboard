# Switchboard — Project Context

A Discord slash-command bot + web dashboard take-home project. This file exists so
work can be resumed in a fresh chat session (new Claude account/limit reset) without
losing context.

## What this project is
Build a web app + Discord bot where:
1. Admin signs in and connects a Discord server to the app.
2. Users run slash commands (`/report`, `/status`) in Discord.
3. The app verifies the interaction, records it, applies a simple rule, replies in
   Discord, and mirrors a notification to a second channel (Discord channel).
4. A login-gated dashboard shows a live log of commands/actions (scoped to the
   admin's own connected server(s)) and lets the admin configure command behavior.

Full original spec: see `Discord_Slash-Command_Bot-20260706103722.md` (the take-home
brief) if it's available in the repo — otherwise ask to have it re-shared.

Deadline: 72 hours from start (check original message timestamp for exact cutoff).

## Chosen stack
- **Framework: Next.js 16**, App Router, TypeScript, `src/` dir, Tailwind CSS.
- **DB + queries:** Supabase (Postgres), accessed entirely via Supabase's JS
  clients — **no Prisma**. See "Supabase client architecture" below.
- **Auth: Supabase Auth with Discord OAuth**, `identify + guilds` scopes.
- **Multi-tenancy:** enforced via Postgres RLS + the `admin_guilds` ownership
  table. `user_id` = Supabase's `auth.uid()`.
- **Discord interaction verification:** `discord-interactions` npm package
  (Ed25519 `verifyKey`)
- **Mirror/notification channel:** a second Discord channel, posted to via bot
  token (`src/lib/discord.ts`) — **DONE**, not Slack (decided against the Slack
  webhook option in the brief in favor of Discord-to-Discord). Now includes
  server-side ownership + live permission verification before any mirror
  channel ID is saved — see "Mirror functionality" below.
- **Response pattern:** deferred (`type 5`) + follow-up `PATCH` on
  `/webhooks/{app_id}/{token}/messages/@original` — **DONE**. See "Deferred
  response + mirror" below.
- **Hosting:** Vercel (free tier)
- **AI stretch goal (optional, not started):** Groq free tier

## Project name
**Switchboard**. Live at: `https://switchboard.mohitraghuwanshi.qzz.io/`

## Supabase client architecture (unchanged — read this carefully if resuming)
Four client files under `src/lib/supabase/`:
- **`supabase-auth-browser.ts`** — cookie-aware, publishable key, RLS-respecting.
  Use in client components needing the logged-in user or RLS-scoped queries.
- **`supabase-auth-server.ts`** — cookie-aware (async), publishable key,
  RLS-respecting. For Server Components / Server Actions / route handlers.
- **`supabase-browser.ts`** — plain `supabase-js`, localStorage session. Dead
  code, confirmed no active imports remain. Safe to delete whenever.
- **`supabase-server.ts`** — secret key, bypasses RLS. Only for the
  interactions route and other no-user-session contexts.

**Rule of thumb:** Discord-webhook-triggered code (no logged-in user) →
`supabase-server.ts`. Logged-in-admin dashboard code → an `-auth-` client.
**New addition:** the mirror-channel save route (`/api/discord/save-mirror-channel`)
also uses `supabase-server.ts` (secret key) — it's the *only* code path allowed
to write `mirror_channel_id` / `default_mirror_channel_id`, by design (see below).

## Progress so far

### Discord Developer Portal, bot, slash commands — DONE
(Unchanged: Switchboard app created, bot token/Public Key/App ID captured, bot
invited to test server, `/report` + `/status` registered as guild-scoped
commands, OAuth2 redirect + Client Secret added for Supabase's Discord provider.)

### Interactions endpoint — DONE, deferred + mirror-integrated
`src/app/api/interactions/route.ts`:
- Raw-body Ed25519 signature verification, PING/PONG handled
- On `APPLICATION_COMMAND`: **immediately returns `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`
  (type 5)** — Discord shows "Bot is thinking..." within milliseconds, well
  inside the window, regardless of downstream latency
- All real work — `command_configs` lookup, `applyRule()`, the `interactions`
  insert (with `23505` dedup), the mirror send, and the `interactions.mirrored`
  update — runs inside Next.js's `after()`, scheduled to execute after the
  deferred response is already sent
- The real reply content lands via a **follow-up `PATCH`** to
  `/webhooks/{application_id}/{interaction_token}/messages/@original`
  (`editOriginalInteractionResponse()` in `src/lib/discord.ts`)
- Wrapped in a catch-all `try/catch` inside `after()` so an unhandled error
  doesn't just vanish as a silent unhandled rejection — falls back to editing
  the original response with a generic error message
- **Known trade-off, accepted deliberately:** every command now shows a brief
  "thinking..." flash before the real reply, even fast ones. Judged worth it
  under the brief's explicit quality-bar requirement to "defer and follow up
  for any slow work rather than timing out" — this is core, not a stretch goal.
- **Known behavior change on duplicate delivery:** a redelivered interaction
  hitting the `23505` dedup conflict just returns quietly inside `after()` —
  there's no meaningful second edit to make to `@original` since the first
  delivery already got the real reply. Accepted as low-risk since acking
  within milliseconds should make Discord redeliveries rare in practice.

### Mirror functionality — DONE, now with server-verified writes
`src/lib/discord.ts`:
- `sendDiscordMessage(channelId, content)` — posts via bot token
  (`Authorization: Bot ${DISCORD_BOT_TOKEN}`, no double-prefix)
- `editOriginalInteractionResponse(interactionToken, content)` — PATCHes the
  deferred placeholder; authenticated by the interaction token itself in the
  URL, no Authorization header needed, valid 15 minutes post-interaction
- `checkBotCanMirrorToChannel(guildId, channelId)` — **NEW**. Reads the
  channel via Discord's API, confirms `channel.guild_id` matches the guild
  being configured, then computes the bot's effective permissions in that
  channel (role permissions + channel overwrites, via `BigInt` bitmath) to
  confirm `View Channel` + `Send Messages`. Pure read-and-compute — never
  sends a test message. Returns `{ ok: boolean, reason?: string }`.

Resolution order unchanged: per-command `command_configs.mirror_channel_id`
overrides the guild-level `admin_guilds.default_mirror_channel_id`; if
neither is set, mirroring is skipped. Won't mirror back into the same channel
the command was run in.

**Security hardening this session — mirror channel ID can no longer be
hijacked to point at a server the admin doesn't own:**
- Original gap: nothing stopped an admin from saving a `mirror_channel_id`
  belonging to a Discord server they don't administer (as long as the bot
  happened to be present there), causing the bot to post into a channel
  outside their control.
- First attempt — a pre-flight `/api/discord/verify-channel` route that
  checks guild ownership (via `admin_guilds`, RLS-backed) then calls
  `checkBotCanMirrorToChannel`. **Identified as insufficient**: this only
  gates the *frontend's* save button. A request straight to Supabase's REST
  API (valid session, publishable key) bypassing the Next.js route entirely
  could still write any `mirror_channel_id` value, because the RLS policy on
  `command_configs`/`admin_guilds` only checks *row ownership*
  (`guild_id in (select guild_id from admin_guilds where user_id = auth.uid())`)
  — it has no awareness that `mirror_channel_id` is itself a foreign
  reference into Discord's data that needs cross-checking.
- **Actual fix — database-level column lockdown**, so the write is
  *impossible* via the RLS/publishable-key path, not just discouraged:
  ```sql
  revoke update on command_configs from authenticated;
  grant update (guild_id, command_name, enabled, rule, updated_at) on command_configs to authenticated;

  revoke update on admin_guilds from authenticated;
  grant update (guild_name) on admin_guilds to authenticated;
  ```
  `mirror_channel_id` and `default_mirror_channel_id` are deliberately absent
  from these grants. The only code path that can write them is
  `POST /api/discord/save-mirror-channel`, which uses `supabase-server.ts`
  (secret key, bypasses RLS) and re-runs ownership + `checkBotCanMirrorToChannel`
  itself, server-side, before writing. `saveConfig()` and `saveGuildDefault()`
  in `CommandConfigClient.tsx` now call this route for the mirror field
  specifically, separate from the normal RLS-scoped upsert for the rest of
  the config.
- **Follow-up bug hit while wiring this up:** after the revoke/grant, saving
  a config's non-mirror fields (`enabled`/`rule`) started failing with
  `42501: permission denied for table command_configs`, even though
  `mirror_channel_id` was correctly omitted from that payload. Root cause:
  Supabase's `.upsert(data, { onConflict: 'guild_id,command_name' })`
  generates a `DO UPDATE SET` clause that reassigns **every column present
  in the payload**, including the conflict-key columns (`guild_id`,
  `command_name`) themselves — even though their value isn't changing.
  Postgres checks column-level UPDATE privilege against anything named in
  `SET`, regardless of whether the value differs, and the original grant
  only covered `enabled, rule, updated_at`. Fixed by including the conflict
  keys in the grant: `grant update (guild_id, command_name, enabled, rule,
  updated_at) on command_configs to authenticated;` — `mirror_channel_id`
  remains correctly excluded. **Good AI_NOTES.md entry**: column-level GRANTs
  used alongside `upsert`/`onConflict` must include the conflict-target
  columns, not just the columns that conceptually change.
- Verified the lockdown actually holds: a direct
  `supabase.from('command_configs').update({ mirror_channel_id: ... })...`
  from the browser console now returns a Postgres permission-denied error,
  not a silent success — confirms enforcement is at the DB layer, not just
  app logic.

**Known gap, accepted for now:** `admin_guilds` ownership is checked against
the `admin_guilds` table, which is written once at connect-server time and
can go stale (e.g., an admin loses Discord-side Administrator rights later
without disconnecting). This mirrors how the rest of the config page already
works (reply templates, enable/disable, keyword rules all rely on the same
`admin_guilds` row) — not tightened further under time pressure. A live
re-check against Discord's current guild-member permissions (using the human
admin's Discord user ID, not just the bot's) would close it if there's time.

**Still not built:** a "test mirror channel" UX button (the `verify-channel`
route still exists and could be reused as a standalone check separate from
the write path — currently redundant with `save-mirror-channel`'s own
verification, decision on whether to keep both or consolidate is open).

### Command config UI — DONE, includes mirror fields + verification feedback
`src/app/dashboard/config/page.tsx` (component: `CommandConfigClient.tsx`):
- Per-command: enabled toggle, reply template, default tag, keyword→tag list,
  Mirror Channel ID field (per-command override)
- "Guild Default Mirror Channel" card above the command list, own save action
  hitting `save-mirror-channel` with `scope: 'guild'`
- Both mirror save paths show inline verification errors (`ShieldAlert` icon
  + reason string returned from the server route) rather than failing
  silently; button shows a "Verifying..." state during the round trip
- Non-mirror fields save via the normal RLS-scoped upsert (`enabled`, `rule`,
  `updated_at`, plus `guild_id`/`command_name` as conflict keys); mirror
  fields save via the separate secret-key-backed route

### Database — schema + privileges updated this session
`schema.sql`: same three tables (`admin_guilds`, `interactions`,
`command_configs`), plus:
- `admin_guilds` UPDATE RLS policy (from earlier session, unchanged)
- **NEW:** column-level privilege lockdown on both `command_configs` and
  `admin_guilds` (see SQL block above) — `mirror_channel_id` and
  `default_mirror_channel_id` are not writable by the `authenticated` role
  at all; only the secret-key server route can set them.
- Grant on `command_configs` explicitly includes `guild_id, command_name`
  alongside `enabled, rule, updated_at` (the upsert/conflict-key gotcha
  above) — if `schema.sql` is reapplied from scratch, don't drop those two
  columns from the grant.

### Auth + connect-a-server flow — DONE (unchanged since last update)
Client architecture confirmed correct across login, connect-server, and config
pages. `supabase-browser.ts` confirmed dead code, safe to delete.

### Bugs hit and fixed
1. Route file initially at `src/api/...` instead of `src/app/api/...`. Fixed.
2. **Supabase client session mismatch** — RLS-scoped client components using
   the plain localStorage-based browser client instead of the cookie-based one.
   Root-caused and fixed. Strong AI_NOTES.md "hardest bug" candidate.
3. **Missing `admin_guilds` UPDATE RLS policy** — the mirror default-channel
   save action would have silently no-op'd instead of erroring. Caught by
   tracing through what RLS actually allowed rather than assuming
   insert/select/delete policies were sufficient.
4. **Mirror send blocking the interaction reply** — initially a synchronous
   `await` in the main handler path, risking pushing past Discord's
   3-second window. Fixed via the deferred-response + `after()` pattern.
5. **Mirror channel ID could be pointed at an unowned server** — RLS on
   `command_configs`/`admin_guilds` checks row ownership, not whether
   `mirror_channel_id` itself is a legitimate reference. Closed by revoking
   table-level UPDATE and granting it only on specific columns, with the
   secret-key-verified route as the sole write path for mirror fields. A
   genuinely strong AI_NOTES.md "hardest bug" candidate — the interesting
   part is that a client-side/API-level check (`verify-channel`) was
   correctly identified as insufficient on its own, and the fix had to move
   to the database layer.
6. **Column-level GRANT didn't include upsert conflict-key columns** —
   after locking down `mirror_channel_id`, unrelated saves started failing
   with a table-level `42501` because `.upsert(..., { onConflict: ... })`
   reassigns the conflict-key columns (`guild_id`, `command_name`) in its
   generated `SET` clause even when their value is unchanged, and those
   columns weren't included in the UPDATE grant. Fixed by adding them to the
   grant. Non-obvious PostgREST/Postgres interaction, worth its own
   AI_NOTES.md line even if it's not the "hardest bug."

## Not started yet
- Dashboard's live command log page (Realtime subscription on `interactions`,
  scoped by `admin_guilds` ownership) — natural next step, ties everything
  together visually
- Decide fate of `/api/discord/verify-channel` (standalone reuse as a "test
  channel" button, or remove since `save-mirror-channel` already verifies)
- README.md, .env.example
- AI_NOTES.md — needs the mirror-security-hardening entry and the
  GRANT/upsert-conflict-key entry in addition to the existing candidates
  (client mismatch, RLS update-policy gap, deferred-response redesign)
- Remaining stretch goals (buttons, modals, AI triage, observability)
- Optional: live re-check of admin's current Discord Administrator status
  (vs. relying solely on the `admin_guilds` row from connect-time)

## Key technical notes to remember
- Signature verification MUST use the raw request body string.
- Guild-scoped slash commands propagate instantly; global commands take up to
  an hour.
- Dedup: unique constraint + catching Postgres error code `23505` on insert.
- Never expose bot token, Discord public key/client secret, Supabase secret
  key, or mirror channel IDs client-side or in logs.
- Discord permission bitfields need `BigInt`, not regular numbers —
  and `BigInt(...)` calls rather than `0n`/`1n` literals if `tsconfig.json`'s
  `target` is below ES2020 (hit this directly this session).
- Cookie-based session (`@supabase/ssr`) and localStorage-based session (plain
  `supabase-js` `createClient()`) are two separate, non-syncing stores. Any
  client component needing RLS-scoped data must use `createAuthBrowserClient`.
- RLS policies must cover every operation a feature actually performs —
  insert/select/delete existing doesn't imply update is covered. Under RLS, a
  disallowed operation typically fails silently (0 rows affected) rather than
  erroring.
- **RLS row-ownership checks and column-content validity are two different
  things.** A policy like `guild_id in (select ... where user_id = auth.uid())`
  only proves the row belongs to the admin — it says nothing about whether a
  *value inside* that row (like a Discord channel ID) is itself legitimate.
  Cross-referencing external state (Discord's own permissions) requires
  either app-layer verification with the write funneled through a single
  trusted path, or is otherwise bypassable by anyone with direct REST access
  and a valid session.
- **Column-level GRANT/REVOKE + `upsert(..., { onConflict })` gotcha:**
  PostgREST's generated `ON CONFLICT DO UPDATE SET` clause reassigns every
  column present in the payload, including the conflict-target columns
  themselves, even when their value is unchanged. A column-level UPDATE
  grant must include those conflict-key columns or the entire upsert fails
  with a table-level `42501`, not a column-specific error.
- Supabase Realtime subscriptions respect RLS per-subscriber and require the
  table to be explicitly added to the `supabase_realtime` publication (already
  done for `interactions`).
- Multi-tenancy is enforced at the database layer via RLS, not just filtered
  in application code — and now partially via column-level GRANTs too, for
  fields that need cross-referencing external (Discord) state before write.
- Next.js 16: `cookies()` from `next/headers` is async — existing code already
  correctly awaits it.
- **Deferred interactions (`type 5`) + `after()`:** Discord's 3-second window
  only needs to be met by the *initial* response. Real work — DB writes,
  outbound calls to Discord's own API for the mirror — can run afterward via
  `after()`, with the real reply delivered by `PATCH`-ing
  `/webhooks/{application_id}/{interaction_token}/messages/@original`. The
  interaction token is valid for 15 minutes after the interaction fires.
- `after()` still consumes execution time against Vercel Hobby plan's function
  duration limits — it doesn't make the work free, just non-blocking for
  Discord's response window specifically.

## Env vars in play
```
# Discord
DISCORD_APPLICATION_ID=      # required for the follow-up PATCH URL
DISCORD_BOT_TOKEN=           # also required by checkBotCanMirrorToChannel
DISCORD_GUILD_ID=
DISCORD_PUBLIC_KEY=
# Discord OAuth Client Secret goes into Supabase's Discord provider config directly

# Supabase (new key naming)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=            # server-only, never NEXT_PUBLIC_, never committed
                                  # required by save-mirror-channel route now too
```
Confirm `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN` are both set on
Vercel in production. None of these should ever be committed; `.gitignore`
should include `.env*.local`.

## How to resume
Paste this file into a new chat and say something like: "Continuing the
Switchboard project — here's the context file, let's pick up from [wherever
you left off]." Also paste `schema.sql`, all four Supabase client files, the
interactions `route.ts`, `discord.ts`, `rules.ts`, `CommandConfigClient.tsx`,
`save-mirror-channel/route.ts`, `verify-channel/route.ts`, and `AI_NOTES.md`
if starting completely fresh, since they carry detail this file only
summarizes.