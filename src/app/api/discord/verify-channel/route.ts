import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase/supabase-auth-server';
import { checkBotCanMirrorToChannel } from '@/lib/Discord/discord';

export async function POST(req: NextRequest) {
    const { guildId, channelId } = await req.json();

    if (!guildId || !channelId) {
        return NextResponse.json({ ok: false, reason: 'Missing guildId or channelId.' }, { status: 400 });
    }

    // Auth check: uses the cookie-based, RLS-respecting client -- this confirms
    // the logged-in admin actually has a row in admin_guilds for this guildId.
    // Doing this server-side (not trusting whatever guild the client claims to
    // have selected) is what actually closes the "point the mirror at someone
    // else's channel" hole -- the client-side dropdown alone isn't enforcement.
    const supabase = await createAuthServerClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ ok: false, reason: 'Not signed in.' }, { status: 401 });
    }

    const { data: ownedGuild } = await supabase
        .from('admin_guilds')
        .select('guild_id')
        .eq('user_id', user.id)
        .eq('guild_id', guildId)
        .maybeSingle();

    if (!ownedGuild) {
        return NextResponse.json(
            { ok: false, reason: "You don't administer this server." },
            { status: 403 }
        );
    }
    console.log("passed")

    // Ownership confirmed -- now check the bot can actually see and post in
    // this specific channel, and that the channel is really inside this guild
    // (not just any channel ID the bot happens to have access to elsewhere).
    const result = await checkBotCanMirrorToChannel(guildId, channelId);

    return NextResponse.json(result);
}