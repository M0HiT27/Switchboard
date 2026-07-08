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

3. [To be filled in as more decisions get made — e.g. deferred-response strategy,
   dedup approach, Slack vs second-Discord-channel for the mirror.]

## Hardest bug / wrong turn
The AI initially scaffolded the interactions route file at
`src/api/interactions/route.ts`. Next.js App Router requires API routes to live
under `src/app/api/...`, not `src/api/...` — the missing `app` segment meant the
route silently 404'd both locally and (before I caught it) would have 404'd in
production too. I noticed because a curl/dev-server test returned 404 instead of
the expected 401 (which is what an unsigned request to a working, signature-
checking endpoint should return). Fixed by moving the file to the correct path.
This was a good reminder to always verify a new endpoint responds with the
*expected* error, not just "some" response, before assuming it's wired up right.

## What I'd improve or add with more time
[To be filled in near the end — stretch goals attempted vs skipped, anything
left rough, what I'd harden for real production use.]