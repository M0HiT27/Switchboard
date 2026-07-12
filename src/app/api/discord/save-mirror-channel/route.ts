import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase/supabase-auth-server';
import { createServerSupabaseClient } from '@/lib/supabase/supabase-server';
import { checkBotCanMirrorToChannel } from '@/lib/Discord/discord';

interface Body {
    scope: 'guild' | 'command';
    guildId: string;
    commandName?: string; // required when scope === 'command'
    channelId: string | null; // null clears the field, skips the Discord check
}

export async function POST(req: NextRequest) {
    const { scope, guildId, commandName, channelId }: Body = await req.json();

    if (!guildId || (scope === 'command' && !commandName)) {
        return NextResponse.json({ ok: false, reason: 'Missing required fields.' }, { status: 400 });
    }

    // Ownership check -- cookie-based, RLS-respecting client. This is the part
    // that can't be skipped by calling Supabase directly, because the actual
    // write below happens with the secret key ONLY after this passes here.
    const authClient = await createAuthServerClient();
    const {
        data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
        return NextResponse.json({ ok: false, reason: 'Not signed in.' }, { status: 401 });
    }

    const { data: ownedGuild } = await authClient
        .from('admin_guilds')
        .select('guild_id')
        .eq('user_id', user.id)
        .eq('guild_id', guildId)
        .maybeSingle();

    if (!ownedGuild) {
        return NextResponse.json({ ok: false, reason: "You don't administer this server." }, { status: 403 });
    }

    // Only run the Discord permission check when actually setting a channel --
    // clearing the field (channelId === null) never needs it.
    if (channelId) {
        const result = await checkBotCanMirrorToChannel(guildId, channelId);
        if (!result.ok) {
            return NextResponse.json(result);
        }
    }

    // Ownership + (if applicable) permission both confirmed -- this is the
    // ONLY code path allowed to write mirror_channel_id / default_mirror_channel_id.
    // Client-side RLS grants no longer permit updating these columns directly
    // (see the revoke/grant column privileges applied in Supabase), so this
    // secret-key write is the sole way the column can change.
    const supabase = createServerSupabaseClient();

    if (scope === 'guild') {
        const { error } = await supabase
            .from('admin_guilds')
            .update({ default_mirror_channel_id: channelId })
            .eq('user_id', user.id)
            .eq('guild_id', guildId);

        if (error) {
            console.error('Failed to save guild default mirror channel:', error);
            return NextResponse.json({ ok: false, reason: 'Save failed.' }, { status: 500 });
        }
    } else {
        const { error } = await supabase
            .from('command_configs')
            .update({ mirror_channel_id: channelId, updated_at: new Date().toISOString() })
            .eq('guild_id', guildId)
            .eq('command_name', commandName);

        if (error) {
            console.error('Failed to save command mirror channel:', error);
            return NextResponse.json({ ok: false, reason: 'Save failed.' }, { status: 500 });
        }
    }

    return NextResponse.json({ ok: true });
}