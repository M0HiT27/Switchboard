import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { createServerSupabaseClient } from '@/lib/supabase/supabase-server';
import { applyRule, type CommandRule } from '@/lib/rules';
import { sendDiscordMessage, editOriginalInteractionResponse } from '@/lib/Discord/discord';

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
        const discordInteractionId: string = body.id;
        const interactionToken: string = body.token;
        const guildId: string = body.guild_id;
        const channelId: string | undefined = body.channel_id;
        const userId: string | undefined = body.member?.user?.id ?? body.user?.id;
        const commandName: string = body.data?.name;
        const commandOptions = body.data?.options ?? null;

        const textOption = commandOptions?.find(
            (opt: { name: string; value: string }) => opt.name === 'text'
        )?.value as string | undefined;

        // All real work -- config lookup, rule application, the insert, and the
        // mirror -- now happens AFTER we've already told Discord "I'm thinking".
        // This is what respects the 3-second window regardless of how slow
        // Supabase, the mirror send, or (later) an AI call turns out to be.
        after(async () => {
            const supabase = createServerSupabaseClient();

            try {
                const { data: config } = await supabase
                    .from('command_configs')
                    .select('enabled, rule, mirror_channel_id')
                    .eq('guild_id', guildId)
                    .eq('command_name', commandName)
                    .maybeSingle();

                const isEnabled = config?.enabled ?? true;

                let status: string;
                let replyContent: string;

                if (!isEnabled) {
                    status = 'skipped';
                    replyContent = 'This command is currently disabled by the server admin.';
                } else {
                    const { tag, reply } = applyRule(config?.rule as CommandRule | null, textOption);
                    status = tag;
                    replyContent = reply;
                }

                const { data: inserted, error } = await supabase
                    .from('interactions')
                    .insert({
                        discord_interaction_id: discordInteractionId,
                        guild_id: guildId,
                        channel_id: channelId,
                        user_id: userId,
                        command_name: commandName,
                        command_options: commandOptions,
                        status,
                        response_sent: true,
                    })
                    .select()
                    .single();

                if (error) {
                    if (error.code === '23505') {
                        // Duplicate delivery of an interaction we already fully
                        // processed (including its original edit). Nothing left to do --
                        // editing @original again would just be redundant, and we don't
                        // have the tag/reply from the first pass to redo it meaningfully.
                        return;
                    }

                    console.error('Failed to record interaction:', error);
                    await editOriginalInteractionResponse(
                        interactionToken,
                        'Something went wrong recording that command.'
                    );
                    return;
                }

                // Edit the deferred "thinking..." placeholder with the real reply.
                await editOriginalInteractionResponse(interactionToken, replyContent);

                // Resolve mirror target: per-command override wins, else guild default.
                let mirrorChannelId: string | null = config?.mirror_channel_id ?? null;

                if (!mirrorChannelId) {
                    const { data: guildRow } = await supabase
                        .from('admin_guilds')
                        .select('default_mirror_channel_id')
                        .eq('guild_id', guildId)
                        .limit(1)
                        .maybeSingle();
                    mirrorChannelId = guildRow?.default_mirror_channel_id ?? null;
                }

                if (mirrorChannelId && mirrorChannelId !== channelId) {
                    try {
                        const mirrorText = [
                            `**/${commandName}** used in <#${channelId}> by <@${userId}>`,
                            textOption ? `> ${textOption}` : null,
                            `Tag: \`${status}\``,
                        ]
                            .filter(Boolean)
                            .join('\n');

                        await sendDiscordMessage(mirrorChannelId, mirrorText);
                        await supabase.from('interactions').update({ mirrored: true }).eq('id', inserted.id);
                    } catch (err) {
                        // Mirror failing shouldn't affect the reply the user already got.
                        console.error('Mirror send failed:', err);
                    }
                }
            } catch (err) {
                // Catch-all so a thrown error inside after() doesn't just vanish into
                // an unhandled rejection with no trace of what happened to this interaction.
                console.error('Unhandled error processing interaction:', err);
                try {
                    await editOriginalInteractionResponse(
                        interactionToken,
                        'Something went wrong processing that command.'
                    );
                } catch {
                    // Original response edit also failed -- nothing more we can do here.
                }
            }
        });

        // Sent within milliseconds, well inside the 3-second window, regardless
        // of how long the after() block above ends up taking.
        return NextResponse.json({
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        });
    }

    return new NextResponse('Unhandled interaction type', { status: 400 });
}

export async function GET() {
    return new NextResponse('Method not allowed', { status: 405 });
}