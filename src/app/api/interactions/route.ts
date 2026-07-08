import { NextRequest, NextResponse } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { createServerSupabaseClient } from '@/lib/supabase/supabase-server';

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY!;

const InteractionType = {
    PING: 1,
    APPLICATION_COMMAND: 2,
    MESSAGE_COMPONENT: 3,
    MODAL_SUBMIT: 5,
} as const;

const InteractionResponseType = {
    PONG: 1,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

export async function POST(req: NextRequest) {
    const rawBody = await req.text();

    const signature = req.headers.get('x-signature-ed25519');
    const timestamp = req.headers.get('x-signature-timestamp');

    if (!signature || !timestamp) {
        return new NextResponse('Missing signature headers', { status: 401 });
    }

    const isValidRequest = await verifyKey(rawBody, signature, timestamp, PUBLIC_KEY);

    if (!isValidRequest) {
        return new NextResponse('Bad request signature', { status: 401 });
    }

    const body = JSON.parse(rawBody);

    if (body.type === InteractionType.PING) {
        return NextResponse.json({ type: InteractionResponseType.PONG });
    }

    if (body.type === InteractionType.APPLICATION_COMMAND) {
        const supabase = createServerSupabaseClient();

        const discordInteractionId: string = body.id;
        const guildId: string = body.guild_id;
        const channelId: string | undefined = body.channel_id;
        const userId: string | undefined = body.member?.user?.id ?? body.user?.id;
        const commandName: string = body.data?.name;
        const commandOptions = body.data?.options ?? null;

        // Dedup: try to insert. If discord_interaction_id already exists, the
        // unique constraint causes a conflict -- we detect that and skip all
        // further processing instead of acting on the same interaction twice.
        const { data: inserted, error } = await supabase
            .from('interactions')
            .insert({
                discord_interaction_id: discordInteractionId,
                guild_id: guildId,
                channel_id: channelId,
                user_id: userId,
                command_name: commandName,
                command_options: commandOptions,
                status: 'received',
            })
            .select()
            .single();

        if (error) {
            // Postgres unique_violation error code is 23505.
            if (error.code === '23505') {
                // Already processed this exact interaction before (Discord redelivery).
                // Return a normal-looking response without re-running any side effects.
                return NextResponse.json({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: `Already handled: /${commandName}` },
                });
            }

            // Any other DB error -- log it server-side, don't leak details to Discord.
            console.error('Failed to record interaction:', error);
            return NextResponse.json({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: 'Something went wrong recording that command.' },
            });
        }

        // At this point the interaction is durably recorded and deduped.
        // Real command logic (rule application, Slack mirror, etc.) goes here next --
        // for now, just confirm receipt.
        return NextResponse.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `Recorded /${commandName} (id: ${inserted.id})` },
        });
    }

    return new NextResponse('Unhandled interaction type', { status: 400 });
}

export async function GET() {
    return new NextResponse('Method not allowed', { status: 405 });
}