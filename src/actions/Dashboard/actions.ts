'use server'

import { createAuthServerClient } from '@/lib/supabase/supabase-auth-server'
import { createServerSupabaseClient } from '@/lib/supabase/supabase-server'
import { revalidatePath } from 'next/cache'

type ConnectServerResult = {
    success: boolean
    error?: string
}

export async function connectServer(
    _prevState: ConnectServerResult | null,
    formData: FormData
): Promise<ConnectServerResult> {
    const guildId = (formData.get('guildId') as string)?.trim()

    if (!guildId || !/^\d{15,25}$/.test(guildId)) {
        return { success: false, error: 'Enter a valid Discord Guild ID (numbers only).' }
    }

    // Confirm who's making this request -- uses the user's own session, RLS-safe.
    const authSupabase = await createAuthServerClient()
    const {
        data: { user },
    } = await authSupabase.auth.getUser()

    if (!user) {
        return { success: false, error: 'You must be signed in to connect a server.' }
    }

    // Verify the bot is actually present in this guild before trusting the claim.
    // A 404 here means the bot was never added -- without this check, any admin
    // could claim ownership of a guild they have no real connection to.
    const discordRes = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}`,
        {
            headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            },
            cache: 'no-store',
        }
    )

    if (discordRes.status === 404) {
        return {
            success: false,
            error: "The bot isn't in that server. Add it first, then try again.",
        }
    }

    if (!discordRes.ok) {
        return {
            success: false,
            error: `Discord API error (${discordRes.status}). Try again in a moment.`,
        }
    }

    const guild = (await discordRes.json()) as { id: string; name: string }

    // Secret-key client: bypasses RLS. Needed here because the insert policy on
    // admin_guilds only lets a user insert user_id = auth.uid() rows via their own
    // session -- which would actually work for this table -- but seeding
    // command_configs below has no insert-for-self path without this same client,
    // so both writes happen together, server-side, for consistency.
    const adminSupabase = createServerSupabaseClient()

    const { error: guildInsertError } = await adminSupabase
        .from('admin_guilds')
        .upsert(
            {
                user_id: user.id,
                guild_id: guild.id,
                guild_name: guild.name,
            },
            { onConflict: 'user_id,guild_id' }
        )

    if (guildInsertError) {
        return { success: false, error: 'Could not save the connection. Try again.' }
    }

    // Seed default command_configs for this guild -- /report and /status enabled
    // by default, no rule, no mirror override (falls back to
    // admin_guilds.default_mirror_channel_id once that's set). on conflict do
    // nothing so re-connecting an already-connected guild doesn't clobber any
    // configuration the admin has since customized.
    const { error: configError } = await adminSupabase
        .from('command_configs')
        .upsert(
            [
                { guild_id: guild.id, command_name: 'report', enabled: true },
                { guild_id: guild.id, command_name: 'status', enabled: true },
            ],
            { onConflict: 'guild_id,command_name', ignoreDuplicates: true }
        )

    if (configError) {
        // Guild connection succeeded even if config seeding had an issue -- don't
        // block on this, but surface it.
        return {
            success: true,
            error: 'Server connected, but default command settings may not have seeded correctly.',
        }
    }

    revalidatePath('/dashboard')
    return { success: true }
}