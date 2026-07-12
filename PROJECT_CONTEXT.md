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
  token (`src/lib/Discord/discord.ts`) — **DONE**, not Slack (decided against
  the Slack webhook option in the brief in favor of Discord-to-Discord). Now
  includes server-side ownership + live permission verification before any
  mirror channel ID is saved — see "Mirror functionality" below.
- **Response pattern:** deferred (`type 5`) + follow-up `PATCH` on
  `/webhooks/{app_id}/{token}/messages/@original` — **DONE**. See "Deferred
  response + mirror" below.
- **Hosting:** Vercel (free tier)
- **AI stretch goal (optional, in progress):** Groq free tier, `llama-3.1-8b-instant`.
  Config-UI toggle (`rule.aiTriage`) is wired; backend (`src/lib/ai.ts`, route
  wiring, `ai_summary` schema column) not yet applied — see "Not started yet".

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
- **`supabase-server.ts`** (exports `createServerSupabaseClient()`) — secret
  key, bypasses RLS. Only for the interactions route and other
  no-user-session contexts.

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
  (`editOriginalInteractionResponse()` in `src/lib/Discord/discord.ts`)
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
`src/lib/Discord/discord.ts` (**note the path**: this file lives under a
capitalized `Discord/` subfolder — `src/lib/Discord/discord.ts`, not
`src/lib/discord.ts`. Any fresh-session snippet or import statement should
match the capitalized folder):
- `sendDiscordMessage(channelId, content)` — posts via bot token
  (`Authorization: Bot ${DISCORD_BOT_TOKEN}`, no double-prefix)
- `editOriginalInteractionResponse(interactionToken, content)` — PATCHes the
  deferred placeholder; authenticated by the interaction token itself in the
  URL, no Authorization header needed, valid 15 minutes post-interaction
- `checkBotCanMirrorToChannel(guildId, channelId)` — reads the channel via
  Discord's API, confirms `channel.guild_id` matches the guild being
  configured, then computes the bot's effective permissions in that channel
  (role permissions + channel overwrites, via `BigInt` bitmath) to confirm
  `View Channel` + `Send Messages`. Pure read-and-compute — never sends a
  test message. Returns `{ ok: boolean, reason?: string }`. This is the sole
  remaining verification path now that `verify-channel` is gone (see below) —
  it's called directly from `save-mirror-channel/route.ts`.

Resolution order unchanged: per-command `command_configs.mirror_channel_id`
overrides the guild-level `admin_guilds.default_mirror_channel_id`; if
neither is set, mirroring is skipped. Won't mirror back into the same channel
the command was run in.

**Security hardening — mirror channel ID can no longer be hijacked to point
at a server the admin doesn't own:**
- Original gap: nothing stopped an admin from saving a `mirror_channel_id`
  belonging to a Discord server they don't administer (as long as the bot
  happened to be present there), causing the bot to post into a channel
  outside their control.
- First attempt — a pre-flight `/api/discord/verify-channel` route that
  checked guild ownership (via `admin_guilds`, RLS-backed) then called
  `checkBotCanMirrorToChannel`. **Identified as insufficient**: this only
  gated the *frontend's* save button. A request straight to Supabase's REST
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
- **`/api/discord/save-mirror-channel/route.ts` — confirmed final shape:**
  - Auth: `createAuthServerClient()` (cookie-based) to get the logged-in
    user; 401 if none.
  - Ownership: `admin_guilds` lookup scoped to `user_id` *and* `guild_id`
    via `.maybeSingle()`; 403 with `"You don't administer this server."` if
    no row comes back.
  - Permission check: `checkBotCanMirrorToChannel(guildId, channelId)` is
    only called when `channelId` is truthy — clearing the field
    (`channelId: null`) skips the Discord round trip entirely, since there's
    nothing to verify.
  - Write: only after both checks pass, using `createServerSupabaseClient()`
    (secret key) to `update()` either `admin_guilds.default_mirror_channel_id`
    (scope `'guild'`) or `command_configs.mirror_channel_id` (scope
    `'command'`, also bumps `updated_at`).
  - Returns `{ ok: false, reason }` on any failure (missing fields, no
    session, no ownership, failed permission check, or a Supabase error) and
    `{ ok: true }` on success — matches what `CommandConfigClient.tsx`
    already expects for its inline error display.
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

**`/api/discord/verify-channel` — REMOVED.** This route is deleted from the
codebase. It was the original pre-flight check described above, and became
fully redundant once `save-mirror-channel` started running the identical
`checkBotCanMirrorToChannel` verification itself, server-side, on every
write. There is currently no standalone "test this channel without saving"
UX — verification only happens as part of an actual save. If a "test
channel" button is wanted later, it would need to be rebuilt (or
`save-mirror-channel` extended with a dry-run mode) rather than resurrecting
the old route, since the old route's ownership check alone was already
established as insufficient on its own.

### Command config UI — DONE, includes mirror fields + verification feedback + AI triage toggle
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
- **AI Triage toggle:** `rule.aiTriage` (boolean) added to
  `CommandConfigRow['rule']`. Rides along inside the existing `rule` jsonb
  column, so no schema change and no `saveConfig()` change were needed — it's
  just another key in the same object already being upserted. UI is a
  `Sparkles`-icon toggle switch placed after the keyword routing rules and
  before the save button, styled to match the existing enabled/disabled
  switch. **Frontend-only so far** — this toggle has no effect yet until the
  backend pieces below (`src/lib/ai.ts`, `interactions` route wiring,
  `ai_summary` column) are actually applied.

### Database — schema + privileges updated this session
`schema.sql`: same three tables (`admin_guilds`, `interactions`,
`command_configs`), plus:
- `admin_guilds` UPDATE RLS policy (from earlier session, unchanged)
- Column-level privilege lockdown on both `command_configs` and
  `admin_guilds` (see SQL block above) — `mirror_channel_id` and
  `default_mirror_channel_id` are not writable by the `authenticated` role
  at all; only the secret-key server route can set them.
- Grant on `command_configs` explicitly includes `guild_id, command_name`
  alongside `enabled, rule, updated_at` (the upsert/conflict-key gotcha
  above) — if `schema.sql` is reapplied from scratch, don't drop those two
  columns from the grant.

### Live command log page — DONE
`src/app/dashboard/logs/page.tsx` (wrapped in `Suspense`, needed because the
component reads `useSearchParams()`) + `CommandLogClient.tsx`:
- Same guild-selector pattern as the config page for UX consistency
- Initial fetch of the most recent 50 `interactions` rows for the selected
  guild (RLS-scoped, no new server route needed — this is exactly the read
  path the existing `select` policy already covers), plus a Supabase Realtime
  subscription (`postgres_changes`, `event: '*'`, filtered to the guild) for
  live updates. Subscribes to both `INSERT` (new interaction arrives) and
  `UPDATE` (catches the `mirrored: true` flip that lands a moment later once
  the `after()` block's mirror send finishes) — so a row visibly updates
  twice per command in practice.
- Small "Live"/"Connecting..." indicator driven off the subscription's own
  status callback, so it's visually obvious the feed is actually live.
- **Column relabeling for honesty:** the `interactions.status` column is
  really the rule *tag* `applyRule()` computed (`skipped` if the command was
  disabled, otherwise the matched/default keyword tag) — not a success/
  failure signal. UI now labels it "Tag," and a separate "Result" column uses
  `response_sent` (already existed in the schema) to show real reply
  success/failure. This was a real point of confusion caught before it
  shipped confusingly.
- **Filter bar** — command name, tag, and result (replied/failed/any), all
  computed client-side over the currently-loaded/streaming window (no extra
  queries, no RLS changes). Filters auto-reset on guild switch so a filter
  value from one server's rules doesn't silently hide everything after
  switching to another. "Showing X of Y loaded" counter + a clear-filters
  button.
- **`ai_summary` display, ready ahead of the backend:** the `InteractionRow`
  type and Tag column already account for a future `ai_summary` column — a
  small `Sparkles` icon renders next to the tag badge whenever
  `row.ai_summary` is present, with the full summary shown on hover.
  Currently inert in practice since no row has `ai_summary` populated yet
  (backend not wired — see "Not started yet").
- **TS fix hit while wiring the above:** lucide-react's icon prop types don't
  include `title`, so `<Sparkles title={row.ai_summary} />` failed to
  compile (`Property 'title' does not exist on type ... LucideProps`). Fixed
  by moving the `title` attribute onto a wrapping `<span>` (a plain DOM
  element, which accepts `title` natively) and rendering `Sparkles` inside
  it — same hover behavior, no type error. Worth remembering for any other
  icon-with-tooltip pattern: put `title`/native HTML attributes on a
  wrapping element, not on the icon component itself.
- **Known limitation, acceptable for this project's scope:** filtering only
  operates over the last 50 loaded rows per guild — it's a live-tail view,
  not a paginated/server-side-filtered historical search. Extending to full
  history would need a server-side query instead of client-side `.filter()`.

### Cross-tab logout hardening — DONE (found while building the log page)
**Bug:** if the log page (or, by the same logic, the config page) is open in
one tab and the admin logs out from a different tab, the original page kept
working — the Realtime subscription just kept streaming live rows to a
"logged out" screen until its JWT happened to expire on its own (up to an
hour). The one-time `getUser()` check in the initial load effect never fires
again after mount, so nothing in the component learns about a sign-out that
happened elsewhere.
**Fix, two layers, both added to `CommandLogClient.tsx`:**
1. `supabase.auth.onAuthStateChange()` listener reacting to `SIGNED_OUT` —
   Supabase's `GoTrueClient` broadcasts auth events across same-origin tabs
   via `BroadcastChannel`, so a logout in Tab A fires this almost immediately
   in Tab B, redirecting to `/login`.
2. A `visibilitychange` listener that re-validates the session directly
   against Supabase whenever the tab regains visibility — belt-and-suspenders
   in case the tab was backgrounded/suspended and missed the broadcast.
**Not yet applied elsewhere:** `CommandConfigClient.tsx` has the identical
one-time `getUser()` pattern and the same exposure — flagged to receive the
same two effects, not yet done.

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
   secret-key-verified route as the sole write path for mirror fields. The
   interesting part is that a client-side/API-level check (`verify-channel`,
   since deleted) was correctly identified as insufficient on its own, and
   the fix had to move to the database layer.
6. **Column-level GRANT didn't include upsert conflict-key columns** —
   after locking down `mirror_channel_id`, unrelated saves started failing
   with a table-level `42501` because `.upsert(..., { onConflict: ... })`
   reassigns the conflict-key columns (`guild_id`, `command_name`) in its
   generated `SET` clause even when their value is unchanged, and those
   columns weren't included in the UPDATE grant. Fixed by adding them to the
   grant. Non-obvious PostgREST/Postgres interaction, worth its own
   AI_NOTES.md line even if it's not the "hardest bug."

## Not started yet
- Apply the same two cross-tab-logout effects (`onAuthStateChange` +
  `visibilitychange` revalidation) to `CommandConfigClient.tsx` — same
  one-time `getUser()` exposure as the log page had before the fix
- ~~Decide fate of `/api/discord/verify-channel`~~ — **DONE**, deleted as
  redundant (`save-mirror-channel` already verifies)
- ~~README.md, .env.example~~ — **DONE**
- ~~AI_NOTES.md~~ — **DONE** (mirror-security-hardening entry,
  GRANT/upsert-conflict-key entry, improvements section filled in)
- **AI triage stretch goal — backend still to apply** (frontend toggle and
  log-page display are done, see above):
  - `schema.sql`: `alter table interactions add column if not exists ai_summary text;`
  - `src/lib/ai.ts` — new file, Groq-based `triageReportText()` helper
  - Wire into the interactions route's `after()` block, replacing/augmenting
    the existing `applyRule()` tag block; add `ai_summary: aiSummary` to the
    `interactions` insert
  - `GROQ_API_KEY` env var — add to `.env.local` and Vercel
  - Open design question carried over from planning: AI tag currently meant
    to override the rule-based tag when triage succeeds — confirm that's
    still the wanted behavior vs. keeping the rule tag and only adding the
    summary
- Remaining stretch goals beyond AI triage (buttons, modals, observability)
- Optional: live re-check of admin's current Discord Administrator status
  (vs. relying solely on the `admin_guilds` row from connect-time)
- Optional: server-side/paginated filtering on the log page if full-history
  search ever matters more than the live-tail view

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
- **A column's name isn't its meaning.** `interactions.status` holds the rule
  tag `applyRule()` computed, not a success/failure signal — `response_sent`
  is the real one. Worth double-checking any schema column whose name
  implies more than what it actually stores before building UI around it.
- **Supabase auth state doesn't self-propagate across tabs without a
  listener.** `getUser()` called once on mount only reflects the session at
  that moment — a logout in another tab won't affect an already-mounted
  component unless it explicitly subscribes to
  `supabase.auth.onAuthStateChange()` (which Supabase broadcasts across
  same-origin tabs via `BroadcastChannel`) and/or re-validates on
  `visibilitychange`. Any page holding a live subscription (Realtime,
  polling, etc.) is especially exposed, since it'll keep working silently
  post-logout until its JWT naturally expires otherwise.
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
- **lucide-react icon components don't accept `title` in their prop types**,
  even though the underlying `<svg>` would render it fine. For an
  icon-with-native-tooltip pattern, wrap the icon in a plain element (e.g.
  `<span title="...">`) instead of passing `title` to the icon component
  directly.
- **File path note:** the Discord helper module lives at
  `src/lib/Discord/discord.ts` (capitalized `Discord/` folder) — confirmed
  from the current `save-mirror-channel/route.ts`, which imports
  `checkBotCanMirrorToChannel` from `@/lib/Discord/discord`. Earlier entries
  in this file referencing plain `src/lib/discord.ts` have been corrected;
  use the capitalized path in any new code or imports.

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
interactions `route.ts`, `Discord/discord.ts`, `rules.ts`,
`CommandConfigClient.tsx`, `save-mirror-channel/route.ts`,
`CommandLogClient.tsx`, `dashboard/logs/page.tsx`, and `AI_NOTES.md` if
starting completely fresh, since they carry detail this file only
summarizes. (`verify-channel/route.ts` no longer exists — don't include it.)