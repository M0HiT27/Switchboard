# Discord Slash-Command Bot

## The problem
Build and deploy a web app plus a bot that reacts to slash commands in a Discord server and acts on them.
The flow you're building:
1. An admin signs in to your web app and connects it to a Discord server (adds your bot and picks a channel it can post to).
2. Users run slash commands in Discord (for example /report <text> or /status). Discord sends each command to your interactions endpoint.
3. When an interaction arrives, your app processes it and acts: it records the command, applies a simple rule, responds in Discord, and mirrors a notification to a second channel (a Slack channel or a different Discord channel).
4. A dashboard, visible only after the admin logs in, shows a live log of every command and action, and lets the admin configure command behavior.
It's a small product, but a real one. Getting it working end-to-end on a live URL requires you to set up and connect several external services correctly — that integration work is the heart of this exercise.

* * *
## Quick primer: what an "interaction" is
When a user runs a slash command (or clicks a button, submits a modal, etc.), Discord sends an HTTP POST with a JSON payload to the Interactions Endpoint URL you register — no always-on websocket bot required. Every request is signed with Ed25519 (X-Signature-Ed25519 / X-Signature-Timestamp), which you must verify, and Discord sends a PING (interaction type 1) when you set the endpoint that you must answer with a PONG. Interaction types you'll see: 1 PING, 2 APPLICATION\_COMMAND (slash commands), 3 MESSAGE\_COMPONENT (buttons/menus), 5 MODAL\_SUBMIT. You must respond within ~3 seconds, or send a deferred acknowledgment and follow up after.

* * *
## Core requirements (everyone must deliver these)
*   A deployed, publicly reachable web app (the Discord interactions endpoint cannot point at localhost).
*   A Discord application/bot (via the Developer Portal) with at least two slash commands registered.
*   A working interactions endpoint that handles those commands and records them.
*   The bot writes back: it responds in Discord for at least one command (a reply and/or a post to the configured channel).
*   The bot mirrors a notification to a second channel — a Slack Incoming Webhook or a separate Discord channel.
*   A dashboard (behind login) showing the command log, the actions taken, and command configuration.
*   A [README.md](http://README.md) that lets us run it locally and explains how you deployed it.

* * *
## Stretch goals (raise your ceiling — aim here if you have the experience)
These are how stronger candidates distinguish themselves. You don't need all of them.
*   Configurable command rules in the UI rather than hard-coded behavior.
*   Interactive components (buttons on a message) that trigger a follow-up action — a second interaction type you also have to verify.
*   A modal form (/report opens a dialog) — another interaction type to handle.
*   An AI step: run the command text through an LLM to summarize, tag, or triage, and show it in the response and dashboard. _(See "Using AI inside the app" below — keep it free.)_
*   Multi-server support (each connected server isolated, with its own config).
*   Meaningful observability: structured logs, a visible history of failures and retries.

* * *
## Quality bar — what "working" actually means
Treat this as something that will run unattended. That mindset is what we're grading. In particular:
*   It should not be foolable by forged or replayed requests — verify Discord's Ed25519 request signature on every request and answer the PING correctly. (Discord won't accept your endpoint at all unless you do this — but we'll also throw junk at it.)
*   It should not do the same thing twice if the same interaction is delivered more than once — dedup on the interaction id.
*   It should not silently lose an interaction if a downstream call (the mirror channel, the AI) or your own service is briefly unavailable.
*   It should respect Discord's ~3-second response window — defer and follow up for any slow work rather than timing out.
*   It must never expose secrets — bot token, application public key, mirror-channel URLs — not in the repo, not in client-side code, not in logs.
Note: Discord uses Ed25519 signatures rather than HMAC. It's well-documented and there are libraries for it (e.g. discord-interactions, tweetnacl) — verifying the signature is the price of admission for the endpoint, which is exactly why it's in the core.

* * *
## Constraints
*   Everything must be free. No credit card, anywhere. A Discord app/bot is free via the Developer Portal with no card. If any service asks for card details, you've picked the wrong tier — switch.
*   Use any tech stack and language you're comfortable with. Full-stack means front end, back end, data, and deployment — all yours.
*   Deploy to a real public host.
### Suggested free services (all have no-card free tiers)
*   Bot — Discord Developer Portal (free, no card). You'll also need a server you can add the bot to (a free personal server is fine).
*   Database — [Neon](https://neon.tech/) or [Supabase](https://supabase.com/) (free Postgres, no card).
*   Notifications (second channel) — a Slack Incoming Webhook URL or a separate Discord channel webhook (both are paste-a-URL, no card).
*   Hosting — Render, Vercel, Cloudflare, or Netlify (free tiers, no card).
*   AI (only if you do the AI stretch goal) — Google Gemini (via Google AI Studio) or Groq. Both give an API key on a free tier with no credit card. Do not use a paid LLM API for this exercise.

* * *
## Deliverables (your submission)
1. A GitHub repository with all your code and a clear commit history.
2. The deployed URL, working and reachable when we open it.
3. A [README.md](http://README.md) covering: what the app does, how to run it locally, the environment variables it needs (provide a .env.example with no real secrets), and how/where you deployed it.
4. A way for us to test it — brief instructions, an invite to a test server (or how to add the bot to ours), and login for a throwaway admin account.
5. Your AI context/instruction files, exactly as you used them — e.g. [CLAUDE.md](http://CLAUDE.md), [AGENTS.md](http://AGENTS.md), .cursorrules, or equivalent. If you didn't use any, say so in AI\_NOTES.md.
6. AI\_NOTES.md (about one page) — see below.

* * *
## Using AI — and what to tell us about it
You should use AI tools throughout. We want to understand _how_ you worked with them, because that's a real skill we care about. In AI\_NOTES.md, briefly cover:
*   Which AI tools and models you used, and roughly how you split work between you and the AI.
*   2–3 key decisions you made yourself (architecture, data model, a service choice) and why.
*   The single hardest bug or wrong turn the AI led you into — what it got wrong, how you noticed, and how you fixed it. _(This is the part we read most closely. Be specific and honest.)_
*   What you'd improve or add with more time.
Optional: include one short prompt or transcript excerpt for the trickiest part if you think it's illuminating. Don't dump full logs.

* * *
## How we'll evaluate
We weigh, roughly in this order:
1. Does it actually work end-to-end on the live URL — run a slash command and watch it record, respond in Discord, and mirror to the second channel — not just the happy first step.
2. Reliability and security of the integration — how it behaves under the unhappy paths in the quality bar (forged/unsigned request, duplicate interaction, downstream briefly down, slow work).
3. Code quality and clarity — structure, readability, sensible choices, a clean repo.
4. Depth — how far into the stretch goals you got, and how well.
5. Quality of your AI collaboration — what AI\_NOTES.md and your context files reveal about how you think and debug.

* * *
## Time and submission
You have up to 72 hours from when you start. We don't expect every stretch goal — we expect a working core, shipped, with honest notes. A smaller thing done well beats a large thing half-broken.
When you're done, share the repository link, the deployed URL, and confirm the required files are in the repo. Good luck — we're looking forward to seeing how you build.