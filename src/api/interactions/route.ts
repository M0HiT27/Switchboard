import { NextRequest, NextResponse } from 'next/server';
import { verifyKey } from 'discord-interactions';

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY!;

// Discord interaction type constants
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
    // 1. Read the RAW body — signature verification fails if you parse JSON first.
    const rawBody = await req.text();

    const signature = req.headers.get('x-signature-ed25519');
    const timestamp = req.headers.get('x-signature-timestamp');

    if (!signature || !timestamp) {
        return new NextResponse('Missing signature headers', { status: 401 });
    }

    // 2. Verify the Ed25519 signature against the raw body.
    const isValidRequest = await verifyKey(rawBody, signature, timestamp, PUBLIC_KEY);

    if (!isValidRequest) {
        return new NextResponse('Bad request signature', { status: 401 });
    }

    // 3. Only parse the JSON *after* verification succeeds.
    const body = JSON.parse(rawBody);

    // 4. Discord sends a PING when you save the endpoint URL — must reply with PONG.
    if (body.type === InteractionType.PING) {
        return NextResponse.json({ type: InteractionResponseType.PONG });
    }

    // 5. Slash command handling goes here (next step).
    if (body.type === InteractionType.APPLICATION_COMMAND) {
        // Placeholder for now — just echo back that we received it.
        return NextResponse.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: `Received command: /${body.data?.name}`,
            },
        });
    }

    // Fallback for interaction types we don't handle yet (buttons, modals).
    return new NextResponse('Unhandled interaction type', { status: 400 });
}

// Discord only ever POSTs to this endpoint — reject other methods explicitly.
export async function GET() {
    return new NextResponse('Method not allowed', { status: 405 });
}