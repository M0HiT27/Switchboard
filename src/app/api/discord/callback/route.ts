import { createAuthServerClient } from '@/lib/supabase/supabase-auth-server'
import { createServerSupabaseClient } from '@/lib/supabase/supabase-server'
import { NextResponse } from 'next/server'

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

    console.log(`[discord/callback] Success: connected guild ${guild.id} (${guild.name}) to user ${user.id}`)

    return NextResponse.redirect(`${origin}/dashboard`)
}