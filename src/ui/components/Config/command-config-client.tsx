'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createAuthBrowserClient } from '@/lib/supabase/supabase-auth-browser';
import type { KeywordTag } from '@/lib/rules';
import { motion } from 'motion/react';
import { Terminal, Save, Settings, Plus, X, Server, ArrowLeft, LogOut, Radio, ShieldCheck, ShieldAlert, Sparkles } from 'lucide-react';
import type { User } from '@supabase/supabase-js';

interface AdminGuild {
  guild_id: string;
  guild_name: string | null;
  default_mirror_channel_id: string | null;
}

interface CommandConfigRow {
  command_name: string;
  enabled: boolean;
  mirror_channel_id: string | null;
  rule: {
    keywordTags?: KeywordTag[];
    defaultTag?: string;
    replyTemplate?: string;
    aiTriage?: boolean;
  } | null;
}
const KNOWN_COMMANDS = ['report', 'status'];

export default function CommandConfigClient() {
  const supabase = createAuthBrowserClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const guildParam = searchParams.get('guild');

  const [user, setUser] = useState<User | null>(null);
  const [guilds, setGuilds] = useState<AdminGuild[]>([]);
  const [selectedGuild, setSelectedGuild] = useState<string>('');
  const [configs, setConfigs] = useState<Record<string, CommandConfigRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [mirrorErrors, setMirrorErrors] = useState<Record<string, string>>({}); // keyed by command name

  const [guildDefaultMirror, setGuildDefaultMirror] = useState<string>('');
  const [savingGuildDefault, setSavingGuildDefault] = useState(false);
  const [guildDefaultError, setGuildDefaultError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setUser(user);

      const { data } = await supabase
        .from('admin_guilds')
        .select('guild_id, guild_name, default_mirror_channel_id');

      if (data && data.length > 0) {
        setGuilds(data);
        if (guildParam && data.find((g) => g.guild_id === guildParam)) {
          setSelectedGuild(guildParam);
        } else {
          setSelectedGuild(data[0].guild_id);
        }
      }
      setLoading(false);
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildParam]);

  useEffect(() => {
    if (!selectedGuild) return;
    const guild = guilds.find((g) => g.guild_id === selectedGuild);
    setGuildDefaultMirror(guild?.default_mirror_channel_id ?? '');
    setGuildDefaultError(null);
    setMirrorErrors({});
  }, [selectedGuild, guilds]);

  useEffect(() => {
    if (!selectedGuild) return;

    async function loadConfigs() {
      const { data } = await supabase
        .from('command_configs')
        .select('command_name, enabled, rule, mirror_channel_id')
        .eq('guild_id', selectedGuild);

      const byCommand: Record<string, CommandConfigRow> = {};
      for (const name of KNOWN_COMMANDS) {
        const existing = data?.find((c: { command_name: string }) => c.command_name === name);
        byCommand[name] = existing ?? {
          command_name: name,
          enabled: true,
          mirror_channel_id: null,
          rule: { keywordTags: [], defaultTag: 'general', replyTemplate: 'Got it! Tagged as: {tag}' },
        };
      }
      setConfigs(byCommand);
    }
    loadConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGuild]);

  function updateConfig(commandName: string, updates: Partial<CommandConfigRow>) {
    setConfigs((prev) => ({
      ...prev,
      [commandName]: { ...prev[commandName], ...updates },
    }));
    // Clear any stale verification error as soon as the user edits the value again.
    if ('mirror_channel_id' in updates) {
      setMirrorErrors((prev) => {
        const next = { ...prev };
        delete next[commandName];
        return next;
      });
    }
  }

  function updateRule(commandName: string, ruleUpdates: Partial<NonNullable<CommandConfigRow['rule']>>) {
    setConfigs((prev) => ({
      ...prev,
      [commandName]: {
        ...prev[commandName],
        rule: { ...prev[commandName].rule, ...ruleUpdates },
      },
    }));
  }

  function addKeywordTag(commandName: string) {
    const current = configs[commandName].rule?.keywordTags ?? [];
    updateRule(commandName, { keywordTags: [...current, { keyword: '', tag: '' }] });
  }

  function updateKeywordTag(commandName: string, index: number, field: keyof KeywordTag, value: string) {
    const current = [...(configs[commandName].rule?.keywordTags ?? [])];
    current[index] = { ...current[index], [field]: value };
    updateRule(commandName, { keywordTags: current });
  }

  function removeKeywordTag(commandName: string, index: number) {
    const current = (configs[commandName].rule?.keywordTags ?? []).filter((_, i) => i !== index);
    updateRule(commandName, { keywordTags: current });
  }

  async function saveConfig(commandName: string) {
    const config = configs[commandName];
    setSaving(commandName);

    // Non-mirror fields still go through the normal RLS-scoped client path --
    // no cross-entity risk there, RLS already scopes it correctly by guild_id.
    const { error } = await supabase.from('command_configs').upsert(
      {
        guild_id: selectedGuild,
        command_name: commandName,
        enabled: config.enabled,
        rule: config.rule,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id,command_name' }
    );

    if (error) {
      console.error('Failed to save config:', error);
      setSaving(null);
      return;
    }

    // mirror_channel_id is no longer writable via the RLS client at all --
    // the DB column privileges were revoked for the authenticated role, so
    // this server route is the only path that can set it. It re-verifies
    // ownership + bot permission itself, server-side, using the secret key
    // only after both checks pass -- bypassing this fetch call gets you
    // nowhere, since the direct-to-Supabase write it used to allow no longer
    // has permission on this column at all.
    const mirrorRes = await fetch('/api/discord/save-mirror-channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'command',
        guildId: selectedGuild,
        commandName,
        channelId: config.mirror_channel_id || null,
      }),
    });
    const mirrorResult = await mirrorRes.json();

    if (!mirrorResult.ok) {
      setMirrorErrors((prev) => ({ ...prev, [commandName]: mirrorResult.reason ?? 'Save failed.' }));
    } else {
      setMirrorErrors((prev) => {
        const next = { ...prev };
        delete next[commandName];
        return next;
      });
    }

    setSaving(null);
  }

  async function saveGuildDefault() {
    if (!user || !selectedGuild) return;
    setSavingGuildDefault(true);

    // Same reasoning as saveConfig: the RLS client can no longer write
    // default_mirror_channel_id directly (column privilege revoked), so this
    // route is the only path -- and it re-checks ownership + bot permission
    // itself, server-side, before writing with the secret key.
    const res = await fetch('/api/discord/save-mirror-channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'guild',
        guildId: selectedGuild,
        channelId: guildDefaultMirror || null,
      }),
    });
    const result = await res.json();

    setSavingGuildDefault(false);

    if (!result.ok) {
      setGuildDefaultError(result.reason ?? 'Save failed.');
      return;
    }

    setGuildDefaultError(null);
    setGuilds((prev) =>
      prev.map((g) =>
        g.guild_id === selectedGuild ? { ...g, default_mirror_channel_id: guildDefaultMirror || null } : g
      )
    );
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white selection:bg-indigo-500/30 overflow-hidden relative">
      {/* Background gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/50 to-transparent blur-3xl rounded-full" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/5 bg-black/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center hover:opacity-90 transition-opacity"
            >
              <Terminal className="w-4 h-4 text-white" />
            </Link>
            <span className="font-bold text-lg tracking-tight ml-2">Switchboard Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-400 mr-4">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {user?.user_metadata?.full_name || user?.email}
            </div>
            <button
              onClick={handleLogout}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-white/5 hover:bg-red-500/10 hover:text-red-400 border border-white/5 transition-colors flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-12 pb-32">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-8"
        >
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-4"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Dashboard
              </Link>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2 flex items-center gap-3">
                <Settings className="w-8 h-8 text-indigo-400" />
                Command Rules
              </h1>
              <p className="text-gray-400">Configure how Switchboard responds and routes commands.</p>
            </div>

            {guilds.length > 0 && (
              <div className="flex items-center gap-3 bg-white/[0.02] border border-white/10 rounded-xl p-2">
                <Server className="w-5 h-5 text-gray-400 ml-2" />
                <select
                  value={selectedGuild}
                  onChange={(e) => setSelectedGuild(e.target.value)}
                  className="bg-transparent border-none text-sm font-medium text-white focus:ring-0 outline-none pr-4 py-1 appearance-none cursor-pointer"
                >
                  {guilds.map((g) => (
                    <option key={g.guild_id} value={g.guild_id} className="bg-gray-900">
                      {g.guild_name ?? g.guild_id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </header>

          {guilds.length === 0 ? (
            <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 text-center border-dashed mt-8">
              <Server className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-300 mb-2">No servers connected</h3>
              <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
                Connect a Discord server in the dashboard first to configure commands.
              </p>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-indigo-500 hover:bg-indigo-600 font-medium transition-colors"
              >
                Go to Dashboard
              </Link>
            </div>
          ) : (
            <>
              {/* Guild-level default mirror channel */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 mt-8">
                <div className="flex items-center gap-2 mb-1">
                  <Radio className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-gray-200">Guild Default Mirror Channel</h2>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Used for any command that doesn&apos;t set its own Mirror Channel ID below. Verified against this
                  server before saving.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={guildDefaultMirror}
                    onChange={(e) => {
                      setGuildDefaultMirror(e.target.value);
                      setGuildDefaultError(null);
                    }}
                    placeholder="Discord channel ID"
                    className={`flex-1 bg-black/40 border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 transition-all text-white ${
                      guildDefaultError
                        ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500'
                        : 'border-white/10 focus:border-indigo-500 focus:ring-indigo-500'
                    }`}
                  />
                  <button
                    onClick={saveGuildDefault}
                    disabled={savingGuildDefault}
                    className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all whitespace-nowrap ${
                      savingGuildDefault
                        ? 'bg-indigo-500/50 text-white cursor-not-allowed'
                        : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                    }`}
                  >
                    {savingGuildDefault ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Save Default
                      </>
                    )}
                  </button>
                </div>
                {guildDefaultError && (
                  <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    {guildDefaultError}
                  </p>
                )}
              </div>

              <div className="grid gap-6 mt-6">
                {KNOWN_COMMANDS.map((name, i) => {
                  const config = configs[name];
                  if (!config) return null;

                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      key={name}
                      className={`rounded-2xl border transition-all duration-300 ${
                        config.enabled ? 'bg-white/[0.02] border-white/10 shadow-lg' : 'bg-transparent border-white/5 opacity-60'
                      }`}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between p-6 border-b border-white/5">
                        <div className="flex items-center gap-3">
                          <div
                            className={`px-3 py-1 rounded-md font-mono text-sm border ${
                              config.enabled
                                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                : 'bg-white/5 text-gray-400 border-white/10'
                            }`}
                          >
                            /{name}
                          </div>
                        </div>
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <span className="text-sm font-medium text-gray-400 group-hover:text-white transition-colors">
                            {config.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          <div className="relative">
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={config.enabled}
                              onChange={(e) => updateConfig(name, { enabled: e.target.checked })}
                            />
                            <div className={`block w-12 h-6 rounded-full transition-colors ${config.enabled ? 'bg-indigo-500' : 'bg-gray-700'}`}></div>
                            <div
                              className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${
                                config.enabled ? 'translate-x-6' : 'translate-x-0'
                              }`}
                            ></div>
                          </div>
                        </label>
                      </div>

                      {/* Body */}
                      {config.enabled && (
                        <div className="p-6 space-y-6">
                          <div className="grid sm:grid-cols-3 gap-6">
                            <div>
                              <label className="block text-sm font-medium text-gray-300 mb-2">Reply Template</label>
                              <input
                                type="text"
                                value={config.rule?.replyTemplate ?? ''}
                                onChange={(e) => updateRule(name, { replyTemplate: e.target.value })}
                                placeholder="Got it! Tagged as: {tag}"
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-white"
                              />
                              <p className="text-xs text-gray-500 mt-2">Use {'{tag}'} to insert the matched tag.</p>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-300 mb-2">Default Tag</label>
                              <input
                                type="text"
                                value={config.rule?.defaultTag ?? ''}
                                onChange={(e) => updateRule(name, { defaultTag: e.target.value })}
                                placeholder="general"
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-white"
                              />
                              <p className="text-xs text-gray-500 mt-2">Applied if no keywords match.</p>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-300 mb-2">Mirror Channel ID</label>
                              <input
                                type="text"
                                value={config.mirror_channel_id ?? ''}
                                onChange={(e) => updateConfig(name, { mirror_channel_id: e.target.value || null })}
                                placeholder="Uses guild default"
                                className={`w-full bg-black/40 border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 transition-all text-white ${
                                  mirrorErrors[name]
                                    ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500'
                                    : 'border-white/10 focus:border-indigo-500 focus:ring-indigo-500'
                                }`}
                              />
                              {mirrorErrors[name] ? (
                                <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
                                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                                  {mirrorErrors[name]}
                                </p>
                              ) : (
                                <p className="text-xs text-gray-500 mt-2 flex items-center gap-1.5">
                                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-gray-600" />
                                  Overrides the guild default. Checked on save.
                                </p>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <label className="block text-sm font-medium text-gray-300">Keyword Routing Rules</label>
                              <button
                                onClick={() => addKeywordTag(name)}
                                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-500/10 px-2 py-1 rounded"
                              >
                                <Plus className="w-3 h-3" /> Add Rule
                              </button>
                            </div>

                            <div className="space-y-3">
                              {(config.rule?.keywordTags ?? []).length === 0 ? (
                                <div className="text-sm text-gray-500 p-4 border border-white/5 rounded-lg border-dashed text-center">
                                  No keyword routing rules set. All requests will use the default tag.
                                </div>
                              ) : (
                                (config.rule?.keywordTags ?? []).map((kt, i) => (
                                  <div key={i} className="flex gap-3 items-start relative group">
                                    <div className="flex-1 grid grid-cols-2 gap-3 p-3 rounded-lg bg-black/20 border border-white/5 group-hover:border-white/10 transition-colors">
                                      <div>
                                        <div className="text-xs text-gray-500 mb-1">If message contains</div>
                                        <input
                                          type="text"
                                          value={kt.keyword}
                                          onChange={(e) => updateKeywordTag(name, i, 'keyword', e.target.value)}
                                          placeholder="e.g. bug"
                                          className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 text-white"
                                        />
                                      </div>
                                      <div>
                                        <div className="text-xs text-gray-500 mb-1">Route to tag</div>
                                        <input
                                          type="text"
                                          value={kt.tag}
                                          onChange={(e) => updateKeywordTag(name, i, 'tag', e.target.value)}
                                          placeholder="e.g. technical"
                                          className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 text-white"
                                        />
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => removeKeywordTag(name, i)}
                                      className="p-3 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors mt-2"
                                      aria-label="Remove"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          {/* AI Triage (Groq) toggle */}
                          <div className="pt-4 border-t border-white/5">
                            <label className="flex items-center justify-between cursor-pointer group">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-indigo-400" />
                                <div>
                                  <div className="text-sm font-medium text-gray-200">AI Triage (Groq)</div>
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    Summarizes and re-tags the report text using an LLM. Falls back to
                                    the rule above if the AI call fails or times out. Requires
                                    GROQ_API_KEY to be set on the server.
                                  </p>
                                </div>
                              </div>
                              <div className="relative shrink-0 ml-4">
                                <input
                                  type="checkbox"
                                  className="sr-only"
                                  checked={config.rule?.aiTriage ?? false}
                                  onChange={(e) => updateRule(name, { aiTriage: e.target.checked })}
                                />
                                <div
                                  className={`block w-12 h-6 rounded-full transition-colors ${
                                    config.rule?.aiTriage ? 'bg-indigo-500' : 'bg-gray-700'
                                  }`}
                                />
                                <div
                                  className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${
                                    config.rule?.aiTriage ? 'translate-x-6' : 'translate-x-0'
                                  }`}
                                />
                              </div>
                            </label>
                          </div>

                          <div className="pt-4 border-t border-white/5 flex justify-end">
                            <button
                              onClick={() => saveConfig(name)}
                              disabled={saving === name}
                              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all ${
                                saving === name
                                  ? 'bg-indigo-500/50 text-white cursor-not-allowed'
                                  : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                              }`}
                            >
                              {saving === name ? (
                                <>
                                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                  Verifying...
                                </>
                              ) : (
                                <>
                                  <Save className="w-4 h-4" />
                                  Save Configuration
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}