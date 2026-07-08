# Switchboard — Project Context

A Discord slash-command bot + web dashboard take-home project. This file exists so
work can be resumed in a fresh chat session (new Claude account/limit reset) without
losing context.

## What this project is
Build a web app + Discord bot where:
1. Admin logs into a dashboard and connects a Discord server.
2. Users run slash commands (`/report`, `/status`) in Discord.
3. The app verifies the interaction, records it, applies a simple rule, replies in
   Discord, and mirrors a notification to a second channel (Slack webhook or another
   Discord channel).
4. A login-gated dashboard shows a live log of commands/actions and lets the admin
   configure command behavior.

Full original spec: see `Discord_Slash-Command_Bot-20260706103722.md` (the take-home
brief) if it's available in the repo — otherwise ask to have it re-shared.

Deadline: 72 hours from start (check original message timestamp for exact cutoff).

## Chosen stack
- **Framework:** Next.js 14+, App Router, TypeScript, `src/` dir, Tailwind CSS
- **DB:** Neon (Postgres, free) + Prisma ORM
- **Auth:** NextAuth (not yet implemented)
- **Discord verification:** `discord-interactions` npm package (Ed25519 `verifyKey`)
- **Mirror/notification channel:** Slack Incoming Webhook (decided, not yet wired up)
- **Hosting:** Vercel (free tier)
- **AI stretch goal (optional, not started):** Groq free tier, for latency reasons
  within Discord's 3s response window

## Project name
**Switchboard** — chosen for the "routes incoming commands to outgoing actions"
metaphor. Repo/bot display name.

## Progress so far (as of last session)

### Discord Developer Portal — DONE
- Application created, named "Switchboard" (or update if named differently)
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

### Next.js project — IN PROGRESS
- Scaffolded with:
  ```
  npx create-next-app@latest switchboard --typescript --app --tailwind --eslint --src-dir --import-alias "@/*"
  ```
  (Note: Tailwind was initially left out, then added back in — make sure the actual
  project has `--tailwind` or Tailwind installed manually.)
- Installed `discord-interactions` package
- Created `src/app/api/interactions/route.ts`:
  - Reads raw request body via `req.text()` (required — signature check needs raw
    bytes, not parsed JSON)
  - Verifies Ed25519 signature via `verifyKey()` using `DISCORD_PUBLIC_KEY` env var
  - Handles `PING` (type 1) → responds with `PONG` (type 1)
  - Handles `APPLICATION_COMMAND` (type 2) → currently just echoes back
    `Received command: /<name>` as a placeholder response (not yet doing real
    logic, DB writes, or dedup)
  - Rejects non-POST methods
- **Not yet done:** confirmed `npm run dev` builds cleanly with no errors (pending)
- **Not yet done:** deployed to Vercel
- **Not yet done:** pasted the deployed URL into Discord's "Interactions Endpoint
  URL" field in the General Information tab (this step requires the endpoint to
  already be live and correctly verifying signatures, since Discord immediately
  sends a PING to validate the URL on save)

### Env vars needed (local `.env.local`, later Vercel env vars)
```
DISCORD_APPLICATION_ID=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_PUBLIC_KEY=
```
None of these should ever be committed. `.gitignore` should include `.env*.local`.

## Not started yet
- Deploying to Vercel
- Setting the Interactions Endpoint URL in Discord portal (blocked on deploy)
- Prisma schema + Neon DB setup
- Dedup logic on `interaction.id`
- Deferred response pattern (type 5) + follow-up PATCH for anything slow
- Real command logic/rules
- Slack webhook mirror integration
- NextAuth login for dashboard
- Dashboard UI (command log, config UI)
- README.md, AI_NOTES.md, .env.example
- Any stretch goals (buttons, modals, AI triage, multi-server, observability)

## Key technical notes to remember
- Signature verification MUST use the raw request body string — parsing JSON first
  breaks it. This is the most common mistake with Discord interactions in Next.js.
- Guild-scoped slash commands propagate instantly; global commands can take up to
  an hour — stick with guild commands for dev/testing.
- Discord's ~3 second response window means any slow work (DB write + Slack call
  together might be borderline) should use the deferred response type (5) followed
  by a PATCH to the followup message webhook URL.
- Must dedup on `interaction.id` since Discord can redeliver the same interaction.
- Never expose bot token / public key / mirror webhook URLs client-side or in logs.

## How to resume
Paste this file into a new chat and say something like: "Continuing the Switchboard
project — here's the context file, let's pick up from [wherever you left off]."
