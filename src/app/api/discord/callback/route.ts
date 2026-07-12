import { createAuthServerClient } from '@/lib/supabase/supabase-auth-server'
import { createServerSupabaseClient } from '@/lib/supabase/supabase-server'
import { NextResponse } from 'next/server'

// Slash command definitions, defined directly here rather than fetched from
// anywhere -- there's no "template guild" to copy from once every guild
// (including the first one) goes through this same auto-registration path.
// IMPORTANT: these option definitions must stay in sync with whatever the
// interactions route reads off `command_options` (e.g. options[0].value for
// /report's free-text field). If /report or /status currently have
// different options than what's below (check your Discord Developer Portal
// or a GET on the applications/{id}/commands endpoint for your existing
// test guild), update this array to match exactly before relying on it --
// mismatched options here would silently register a different command
// shape than what your route code expects.
const SLASH_COMMANDS = [
    {
        name: 'report',
        description: 'Submit a report',
        type: 1, // CHAT_INPUT
        options: [
            {
                name: 'text',
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

// Registers /report and /status on a newly-connected guild using the fixed
// definitions above.
async function registerGuildCommands(guildId: string): Promise<boolean> {
    const appId = process.env.DISCORD_APPLICATION_ID

    if (!appId) {
        console.error('[discord/callback] DISCORD_APPLICATION_ID not set, cannot register commands.')
        return false
    }

    const putRes = await fetch(
        `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`,
        {
            method: 'PUT',
            headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(SLASH_COMMANDS),
        }
    )

    if (!putRes.ok) {
        console.error(
            `[discord/callback] Failed to register commands on guild ${guildId}. Status: ${putRes.status}, Body: ${await putRes.text()}`
        )
        return false
    }

    return true
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const guildId = searchParams.get('guild_id')
    const error = searchParams.get('error')

    if (error) {
        console.error('[discord/callback] Discord returned an error:', error)
        return NextResponse.redirect(`${origin}/dashboard?error=cancelled`)
    }

    if (!guildId) {
        console.error('[discord/callback] No guild_id in query params. Full URL:', request.url)
        return NextResponse.redirect(`${origin}/dashboard?error=missing_guild`)
    }

    const authSupabase = await createAuthServerClient()
    const {
        data: { user },
    } = await authSupabase.auth.getUser()

    if (!user) {
        console.error('[discord/callback] No authenticated Supabase user found.')
        return NextResponse.redirect(`${origin}/login`)
    }

    const discordRes = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}`,
        {
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
            cache: 'no-store',
        }
    )

    if (!discordRes.ok) {
        const body = await discordRes.text()
        console.error(
            `[discord/callback] Guild verification failed. Status: ${discordRes.status}, Body: ${body}`
        )
        return NextResponse.redirect(`${origin}/dashboard?error=bot_not_found`)
    }

    const guild = (await discordRes.json()) as { id: string; name: string }

    const adminSupabase = createServerSupabaseClient()

    const { error: guildInsertError } = await adminSupabase
        .from('admin_guilds')
        .upsert(
            { user_id: user.id, guild_id: guild.id, guild_name: guild.name },
            { onConflict: 'user_id,guild_id' }
        )

    if (guildInsertError) {
        console.error('[discord/callback] admin_guilds upsert failed:', guildInsertError)
        return NextResponse.redirect(`${origin}/dashboard?error=db_write_failed`)
    }

    const { error: configInsertError } = await adminSupabase
        .from('command_configs')
        .upsert(
            [
                { guild_id: guild.id, command_name: 'report', enabled: true },
                { guild_id: guild.id, command_name: 'status', enabled: true },
            ],
            { onConflict: 'guild_id,command_name', ignoreDuplicates: true }
        )

    if (configInsertError) {
        console.error('[discord/callback] command_configs upsert failed:', configInsertError)
        // Guild connection still succeeded -- don't block on this, but log it.
    }

    // Register the slash commands on this specific guild so they show up
    // instantly without any manual step. Guild-scoped, so this propagates
    // immediately (unlike global commands, which can take up to an hour).
    // Non-blocking by design, same reasoning as command_configs above: a
    // registration failure shouldn't prevent the server from being marked
    // connected -- worst case the admin sees "server connected" but the
    // commands don't appear yet, which is at least visible/debuggable via
    // these logs, vs. failing the whole connect flow over it.
    const commandsRegistered = await registerGuildCommands(guild.id)
    if (!commandsRegistered) {
        console.error(`[discord/callback] Command registration failed for guild ${guild.id} -- may need manual registration.`)
    }

    console.log(`[discord/callback] Success: connected guild ${guild.id} (${guild.name}) to user ${user.id}`)

    return NextResponse.redirect(`${origin}/dashboard`)
}