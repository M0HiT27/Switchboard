// scripts/register-global-commands.ts
//
// Run this ONCE (not per-guild, not on every deploy) to register /report and
// /status as global commands: `npm run register-commands`
//
// Global commands are available in every guild the bot is added to,
// automatically -- no per-guild registration step needed on connect.
// Trade-off: changes take up to ~1 hour to propagate (vs. instant for
// guild-scoped commands), so don't expect to see updates immediately after
// running this if you tweak the definitions later.
//
// Requires DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN. Unlike `next dev`/
// `build`/`start`, a standalone script run via tsx does NOT automatically
// load .env.local -- that's Next.js's own behavior, not Node's or tsx's.
// Loading it explicitly here so `npm run register-commands` just works
// without needing --env-file or any other flag remembered at the call site.
import { config } from 'dotenv'
config({ path: '.env' })


const SLASH_COMMANDS = [
    {
        name: 'report',
        description: 'Submit a report',
        type: 1, // CHAT_INPUT
        options: [
            {
                name: 'text', // MUST match `opt.name === 'text'` in the interactions route
                description: 'Describe the issue',
                type: 3, // STRING
                required: true,
            },
        ],
    },
    {
        name: 'status',
        description: 'Check status',
        type: 1, // CHAT_INPUT
    },
]

async function registerGlobalCommands() {
    const appId = process.env.DISCORD_APPLICATION_ID
    const botToken = process.env.DISCORD_BOT_TOKEN

    if (!appId || !botToken) {
        console.error('Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN in environment.')
        process.exit(1)
    }

    const res = await fetch(
        `https://discord.com/api/v10/applications/${appId}/commands`,
        {
            method: 'PUT',
            headers: {
                Authorization: `Bot ${botToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(SLASH_COMMANDS),
        }
    )

    if (!res.ok) {
        console.error(`Failed to register global commands. Status: ${res.status}`)
        console.error(await res.text())
        process.exit(1)
    }

    const registered = await res.json()
    console.log(`Registered ${registered.length} global command(s):`)
    for (const cmd of registered) {
        console.log(`  /${cmd.name} — id: ${cmd.id}`)
    }
    console.log('\nNote: propagation to all guilds can take up to ~1 hour.')
}

registerGlobalCommands()