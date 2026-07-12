# AI_NOTES.md

## Tools and models used
Built with Claude (Anthropic), used conversationally throughout — architecture
decisions, scaffolding, debugging, and this notes file itself were all worked
through with it. Rough split: AI proposed the stack, wrote initial scaffolding
code (interactions route, command registration script) and explained Discord's
interaction model; I made the actual service decisions, ran everything locally,
deployed, and did the hands-on debugging when things didn't work as expected.

## Key decisions I made myself

1. **Project name — "Switchboard".** Asked the AI for options, picked this one
   over more generic suggestions (RelayBot, CommandBridge) because it describes
   the actual architecture (routes an incoming command to multiple outgoing
   actions) rather than being a generic bot name.

2. **Supabase over Neon for the database.** The AI's first suggestion was Neon +
   Prisma, which is a perfectly reasonable default. I pushed back because the
   spec explicitly asks for a "live log" in the dashboard, and Supabase's
   built-in Realtime (websocket subscriptions on table changes) satisfies that
   requirement directly, instead of me having to build polling or a custom
   SSE/websocket layer myself. This also let me consolidate auth onto Supabase
   Auth instead of running NextAuth as a separate system — one fewer moving
   part, and Google OAuth is supported natively.

3. **Column-level GRANT lockdown for mirror channel IDs instead of relying on
   app-layer validation alone.** The AI's initial approach had the frontend
   save `mirror_channel_id` directly via Supabase's REST API, gated only by a
   pre-flight check route that validated guild ownership and bot permissions
   before the save button was enabled. I realized this
   REST API with a valid session token could bypass the Next.js route entirely
   and write any `mirror_channel_id` value, because the RLS policy on
   `command_configs` only checks row ownership, not whether the channel ID
   itself is legitimate. The real fix had two layers: (a) at the database,
   `REVOKE UPDATE` on the whole table then `GRANT UPDATE` on only the safe
   columns — `mirror_channel_id` is deliberately excluded; (b) at the app
   layer, a new route (`/api/discord/save-mirror-channel`) using the Supabase
   secret key is now the sole write path for mirror fields, and it re-verifies
   guild ownership and bot permissions server-side before writing. This was my
   decision to push the security boundary down to Postgres rather than
   trusting app-level checks.

## Hardest bug / wrong turn

The mirror channel security gap — and the cascading fix that followed — was the
hardest problem in the project.

**What happened:** The AI's initial approach had the frontend save
`mirror_channel_id` directly via Supabase's REST API, with a separate pre-flight
check route that validated guild ownership and bot permissions before the save
button was enabled. This *looked* secure and passed
manual testing. But I traced the actual write path and realized: RLS on
`command_configs` only checks that the admin owns the *row* (via `guild_id` in
`admin_guilds`). It doesn't validate that the `mirror_channel_id` *value* inside
that row points to a channel the admin actually controls. Anyone with a valid
session token could skip the pre-flight check, hit Supabase's REST API directly,
and write a mirror channel ID pointing to a completely different server — as
long as the bot happened to be present there, it would dutifully post into a
channel outside the admin's control.

**How I noticed:** Not from a test failure — from reading the RLS policies and
asking "what actually stops a `PATCH` straight to PostgREST?" The answer was:
nothing. The pre-flight check was a frontend gate, not an enforcement layer.

**The fix, and its own cascading bug:** I revoked table-level `UPDATE` on
`command_configs` for `authenticated` and granted it only on specific safe
columns — deliberately excluding `mirror_channel_id`. The only write path for
mirror fields became a new server-side route (`/api/discord/save-mirror-channel`)
using the Supabase secret key, which re-verifies ownership and bot permissions
itself before writing. But this immediately broke
*unrelated* saves: the `enabled`/`rule` config upsert started failing with
Postgres error `42501` (permission denied). Root cause: Supabase's
`.upsert(..., { onConflict: 'guild_id,command_name' })` generates a
`DO UPDATE SET` clause that reassigns the conflict-key columns (`guild_id`,
`command_name`) even when their values don't change — and those columns weren't
in the UPDATE grant. Fixed by adding them to the grant. A non-obvious
PostgREST/Postgres interaction that no amount of app-level testing would have
caught without understanding the generated SQL.

*(Earlier, less interesting wrong turn: the AI initially placed the interactions
route at `src/api/interactions/route.ts` instead of `src/app/api/...` — a silent
404 caught by noticing the endpoint returned 404 instead of the expected 401 for
an unsigned request.)*

## What I'd improve or add with more time

1. **Interactive Discord components (buttons, modals).** The brief lists these
   as stretch goals — `/report` opening a modal form, button follow-ups that
   trigger a second verified interaction. The interaction types (`MESSAGE_COMPONENT`,
   `MODAL_SUBMIT`) are already defined in the route handler but not handled yet.

2. **Server-side paginated filtering on the logs page.** Currently the log page
   fetches the last 50 interactions per guild and filters client-side. This is
   fine for a live-tail view but won't scale to historical search. Extending it
   would mean server-side queries with cursor-based pagination instead of
   client-side `.filter()`.

3. **Structured logging and observability.** Right now errors go to
   `console.error` inside `after()`. For production: structured JSON logs,
   correlation IDs tying an interaction through deferred processing → mirror
   send, and a visible failure/retry history in the dashboard.