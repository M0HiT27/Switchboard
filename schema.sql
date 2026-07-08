-- Run this in the Supabase SQL Editor.
-- Multi-tenant version: each admin only sees data for Discord servers (guilds)
-- they've explicitly connected via admin_guilds.
-- Mirror target is a second Discord channel (not Slack) -- see mirror_channel_id
-- columns below.

-- Drop old tables from the earlier single-tenant schema version before
-- recreating them below. CASCADE also drops any policies and the Realtime
-- publication entry tied to these tables, so this is safe to run even if
-- they don't have the new guild_id/admin_guilds structure yet.
-- WARNING: this deletes any existing data in these tables.
drop table if exists interactions cascade;
drop table if exists command_configs cascade;
drop table if exists admin_guilds cascade;

-- Links a Supabase Auth user to the Discord guild(s) they administer.
-- A row here is created when an admin goes through the "connect a server" flow
-- in the dashboard -- this is what scopes all their visibility.
create table if not exists admin_guilds (
  user_id uuid references auth.users(id) not null,
  guild_id text not null,
  guild_name text, -- cached display name, optional, nice for the dashboard UI
  default_mirror_channel_id text, -- fallback mirror target when a command
                                    -- config doesn't set its own override
  connected_at timestamptz not null default now(),
  primary key (user_id, guild_id)
);

-- Logs every Discord interaction received. The unique constraint on
-- discord_interaction_id is what makes dedup possible: attempting to insert
-- a duplicate will violate the constraint instead of silently double-processing.
create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  discord_interaction_id text not null unique,
  guild_id text not null,
  channel_id text,
  user_id text,
  command_name text not null,
  command_options jsonb,
  status text not null default 'received', -- received | processed | failed
  response_sent boolean not null default false,
  mirrored boolean not null default false,
  created_at timestamptz not null default now()
);

-- Lets the admin configure per-command behavior instead of hard-coding it.
-- Scoped per guild now, since different connected servers may want different
-- rules for the same command name.
create table if not exists command_configs (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  command_name text not null,
  enabled boolean not null default true,
  rule jsonb, -- flexible slot for whatever simple rule logic you define per command
  mirror_channel_id text, -- optional per-command override of the guild's
                            -- default_mirror_channel_id; a second Discord channel ID
  updated_at timestamptz not null default now(),
  unique (guild_id, command_name)
);

-- Enable Row Level Security on all tables.
alter table admin_guilds enable row level security;
alter table interactions enable row level security;
alter table command_configs enable row level security;

-- Admins can see (and eventually manage) only their own guild connections.
create policy "Users can read their own guild connections"
  on admin_guilds for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert their own guild connections"
  on admin_guilds for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can delete their own guild connections"
  on admin_guilds for delete
  to authenticated
  using (user_id = auth.uid());

-- The interactions API route uses the SECRET key, which bypasses RLS
-- entirely -- so no insert policy is needed for server-side writes there.

-- Dashboard reads (using the publishable key + a logged-in session) only see
-- interactions belonging to guilds the current user has connected.
create policy "Users can read interactions for their connected guilds"
  on interactions for select
  to authenticated
  using (
    guild_id in (
      select guild_id from admin_guilds where user_id = auth.uid()
    )
  );

-- Same ownership scoping for command configs.
create policy "Users can read command configs for their connected guilds"
  on command_configs for select
  to authenticated
  using (
    guild_id in (
      select guild_id from admin_guilds where user_id = auth.uid()
    )
  );

create policy "Users can update command configs for their connected guilds"
  on command_configs for update
  to authenticated
  using (
    guild_id in (
      select guild_id from admin_guilds where user_id = auth.uid()
    )
  );

-- Insert policy for command_configs -- not required by the current plan
-- (configs are seeded server-side via the secret key during "connect a
-- server"), but kept for future-proofing in case admins ever need to add a
-- config for a command that wasn't pre-seeded.
create policy "Users can insert command configs for their connected guilds"
  on command_configs for insert
  to authenticated
  with check (
    guild_id in (
      select guild_id from admin_guilds where user_id = auth.uid()
    )
  );

-- Enable Realtime on the interactions table so the dashboard can subscribe
-- to new rows as they're inserted. Realtime respects RLS on the subscribing
-- user's session, so the guild-scoping above applies automatically here too.
alter publication supabase_realtime add table interactions;