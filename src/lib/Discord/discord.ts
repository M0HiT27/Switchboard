const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID!;

// Discord permission bit flags (only the ones we need). These are documented
// as part of the permissions bitfield -- see Discord's "Permissions" docs.
const PERMISSION = {
    VIEW_CHANNEL: BigInt(1) << BigInt(10), // 0x400
    SEND_MESSAGES: BigInt(1) << BigInt(11), // 0x800
    ADMINISTRATOR: BigInt(1) << BigInt(3), // 0x8 -- bypasses all channel overwrites entirely
} as const;

export async function sendDiscordMessage(channelId: string, content: string) {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Discord mirror send failed (${res.status}): ${errText}`);
    }

    return res.json();
}

// Edits the original deferred reply once real content is ready. Authenticated
// by the interaction token itself in the URL -- no bot token needed here.
export async function editOriginalInteractionResponse(interactionToken: string, content: string) {
    const res = await fetch(
        `${DISCORD_API}/webhooks/${APPLICATION_ID}/${interactionToken}/messages/@original`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        }
    );

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Discord follow-up edit failed (${res.status}): ${errText}`);
    }

    return res.json();
}

interface DiscordChannel {
    id: string;
    guild_id?: string;
    permission_overwrites?: { id: string; type: 0 | 1; allow: string; deny: string }[];
}

interface DiscordRole {
    id: string;
    permissions: string; // stringified bitfield, e.g. "8" -- needs BigInt, not Number
}

interface DiscordGuildMember {
    roles: string[];
}

async function discordGet<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
    const res = await fetch(`${DISCORD_API}${path}`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
}

/**
 * Verifies a proposed mirror channel is both (a) inside the guild it's
 * claimed to belong to, and (b) actually writable by the bot, by computing
 * effective permissions from the guild's @everyone + role permissions plus
 * the channel's own permission overwrites -- the same resolution order
 * Discord itself uses. Does NOT send any message, so there's no visible
 * side effect from just checking.
 */
export async function checkBotCanMirrorToChannel(
    expectedGuildId: string,
    channelId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const channelRes = await discordGet<DiscordChannel>(`/channels/${channelId}`);
    if (!channelRes.ok) {
        return {
            ok: false,
            reason:
                channelRes.status === 404
                    ? 'Channel not found (check the ID, or the bot may not have access).'
                    : `Could not read that channel (Discord returned ${channelRes.status}).`,
        };
    }
    const channel = channelRes.data;

    if (channel.guild_id !== expectedGuildId) {
        return { ok: false, reason: "That channel isn't in this server -- pick a channel from the same server you connected." };
    }

    const memberRes = await discordGet<DiscordGuildMember>(`/guilds/${expectedGuildId}/members/${APPLICATION_ID}`);
    if (!memberRes.ok) {
        return { ok: false, reason: 'Bot is not a member of this server.' };
    }

    const rolesRes = await discordGet<DiscordRole[]>(`/guilds/${expectedGuildId}/roles`);
    if (!rolesRes.ok) {
        return { ok: false, reason: 'Could not read this server\'s roles to check permissions.' };
    }

    const everyoneRole = rolesRes.data.find((r) => r.id === expectedGuildId);
    const memberRoleIds = new Set(memberRes.data.roles);
    const memberRoles = rolesRes.data.filter((r) => memberRoleIds.has(r.id));

    // Base permissions: OR of @everyone + every role the bot has.
    let base = everyoneRole ? BigInt(everyoneRole.permissions) : BigInt(0);
    for (const role of memberRoles) {
        base |= BigInt(role.permissions);
    }

    if (base & PERMISSION.ADMINISTRATOR) {
        return { ok: true }; // administrator bypasses all channel-level overwrites
    }

    const overwrites = channel.permission_overwrites ?? [];

    // Resolution order per Discord's docs: @everyone overwrite, then role
    // overwrites (combined), then the member-specific overwrite (type 1).
    const everyoneOverwrite = overwrites.find((o) => o.id === expectedGuildId && o.type === 0);
    if (everyoneOverwrite) {
        base &= ~BigInt(everyoneOverwrite.deny);
        base |= BigInt(everyoneOverwrite.allow);
    }

    let roleAllow = BigInt(0);
    let roleDeny = BigInt(0);
    for (const role of memberRoles) {
        const ow = overwrites.find((o) => o.id === role.id && o.type === 0);
        if (ow) {
            roleAllow |= BigInt(ow.allow);
            roleDeny |= BigInt(ow.deny);
        }
    }
    base &= ~roleDeny;
    base |= roleAllow;

    const memberOverwrite = overwrites.find((o) => o.id === APPLICATION_ID && o.type === 1);
    if (memberOverwrite) {
        base &= ~BigInt(memberOverwrite.deny);
        base |= BigInt(memberOverwrite.allow);
    }

    const canView = (base & PERMISSION.VIEW_CHANNEL) !== BigInt(0);
    const canSend = (base & PERMISSION.SEND_MESSAGES) !== BigInt(0);

    if (!canView || !canSend) {
        return {
            ok: false,
            reason: `Bot lacks ${!canView ? 'View Channel' : 'Send Messages'} permission in that channel.`,
        };
    }

    return { ok: true };
}