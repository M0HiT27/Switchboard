'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createAuthBrowserClient } from '@/lib/supabase/supabase-auth-browser';
import { motion, AnimatePresence } from 'motion/react';
import {
  Terminal,
  Server,
  ArrowLeft,
  LogOut,
  Radio,
  Circle,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  X,
  Sparkles,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';

interface AdminGuild {
  guild_id: string;
  guild_name: string | null;
}

interface InteractionRow {
  id: string;
  discord_interaction_id: string;
  guild_id: string;
  channel_id: string | null;
  user_id: string | null;
  command_name: string;
  command_options: unknown;
  // NOTE: this column is really the rule *tag* applyRule() computed
  // ("skipped" if disabled, otherwise the matched/default keyword tag, or
  // the AI-triage tag if that ran and succeeded) -- it is not a
  // success/failure indicator. response_sent is the real one.
  status: string;
  response_sent: boolean;
  mirrored: boolean;
  ai_summary: string | null;
  created_at: string;
}

const MAX_ROWS = 50;
const ALL = '__all__';

export default function CommandLogClient() {
  const supabase = createAuthBrowserClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const guildParam = searchParams.get('guild');

  const [user, setUser] = useState<User | null>(null);
  const [guilds, setGuilds] = useState<AdminGuild[]>([]);
  const [selectedGuild, setSelectedGuild] = useState<string>('');
  const [logs, setLogs] = useState<InteractionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [realtimeStatus, setRealtimeStatus] = useState<
    'SUBSCRIBED' | 'CONNECTING' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT'
  >('CONNECTING');

  // Filters -- all client-side over the currently-loaded window of rows for
  // the selected guild. Realtime keeps that window populated regardless of
  // which filters are active, so switching a filter never needs a re-fetch.
  const [commandFilter, setCommandFilter] = useState<string>(ALL);
  const [tagFilter, setTagFilter] = useState<string>(ALL);
  const [resultFilter, setResultFilter] = useState<string>(ALL); // ALL | 'ok' | 'failed'

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

      const { data } = await supabase.from('admin_guilds').select('guild_id, guild_name');

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

  // Cross-tab logout handling, layer 1: Supabase's GoTrueClient broadcasts
  // auth events (including SIGNED_OUT) across same-origin tabs via
  // BroadcastChannel. Without this listener, a logout in another tab has no
  // effect here -- the Realtime subscription below keeps running and this
  // page keeps populating live rows until its JWT eventually expires on its
  // own (up to an hour), even though the user believes they've signed out.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-tab logout handling, layer 2: belt-and-suspenders re-check on tab
  // focus/visibility. BroadcastChannel sync assumes this tab was alive and
  // listening at the exact moment the other tab signed out -- if it was
  // backgrounded/suspended by the browser, that event could be missed. This
  // re-validates the session directly against Supabase as soon as the tab
  // becomes visible again, independent of whether the broadcast landed.
  useEffect(() => {
    async function revalidateOnFocus() {
      if (document.visibilityState !== 'visible') return;
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/login');
      }
    }

    document.addEventListener('visibilitychange', revalidateOnFocus);
    return () => document.removeEventListener('visibilitychange', revalidateOnFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInitialLogs = useCallback(
    async (guildId: string) => {
      const { data } = await supabase
        .from('interactions')
        .select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS);
      setLogs(data ?? []);
    },
    [supabase]
  );

  // Reset filters whenever the selected server changes -- a filter chosen
  // for one guild's commands/tags shouldn't silently carry over and hide
  // everything in another guild that doesn't share those values.
  useEffect(() => {
    setCommandFilter(ALL);
    setTagFilter(ALL);
    setResultFilter(ALL);
  }, [selectedGuild]);

  useEffect(() => {
    if (!selectedGuild) return;

    setRealtimeStatus('CONNECTING');
    loadInitialLogs(selectedGuild);

    // Subscribes to both INSERT (a new command just came in) and UPDATE
    // (catches the `mirrored: true` flip that lands a moment later, once the
    // after() block finishes the mirror send) -- RLS applies to this
    // subscription too, so this only ever streams rows for guilds this admin
    // actually owns.
    const channel = supabase
      .channel(`interactions-${selectedGuild}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'interactions',
          filter: `guild_id=eq.${selectedGuild}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as InteractionRow;
            setLogs((prev) => [row, ...prev].slice(0, MAX_ROWS));
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as InteractionRow;
            setLogs((prev) => prev.map((r) => (r.id === row.id ? row : r)));
          }
        }
      )
      .subscribe((status) => {
        setRealtimeStatus(status as typeof realtimeStatus);
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGuild]);

  // Distinct command names / tags seen in the currently-loaded window, used
  // to populate the filter dropdowns without hard-coding command names here.
  const availableCommands = useMemo(
    () => Array.from(new Set(logs.map((r) => r.command_name))).sort(),
    [logs]
  );
  const availableTags = useMemo(
    () => Array.from(new Set(logs.map((r) => r.status))).sort(),
    [logs]
  );

  const filteredLogs = useMemo(() => {
    return logs.filter((row) => {
      if (commandFilter !== ALL && row.command_name !== commandFilter) return false;
      if (tagFilter !== ALL && row.status !== tagFilter) return false;
      if (resultFilter === 'ok' && !row.response_sent) return false;
      if (resultFilter === 'failed' && row.response_sent) return false;
      return true;
    });
  }, [logs, commandFilter, tagFilter, resultFilter]);

  const filtersActive = commandFilter !== ALL || tagFilter !== ALL || resultFilter !== ALL;

  function clearFilters() {
    setCommandFilter(ALL);
    setTagFilter(ALL);
    setResultFilter(ALL);
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
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/50 to-transparent blur-3xl rounded-full" />
      </div>

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

      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-12 pb-32">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-6">
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-4">
                <ArrowLeft className="w-4 h-4" /> Back to Dashboard
              </Link>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2 flex items-center gap-3">
                <Radio className="w-8 h-8 text-indigo-400" />
                Command Log
              </h1>
              <div className="flex items-center gap-2 text-gray-400">
                <Circle
                  className={`w-2.5 h-2.5 ${
                    realtimeStatus === 'SUBSCRIBED' ? 'text-green-500 fill-green-500' : 'text-yellow-500 fill-yellow-500'
                  } animate-pulse`}
                />
                {realtimeStatus === 'SUBSCRIBED' ? 'Live' : 'Connecting...'}
              </div>
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
              <p className="text-gray-500 text-sm max-w-md mx-auto">Connect a Discord server first to see its command log.</p>
            </div>
          ) : (
            <>
              {/* Filter bar */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-400 mr-1">
                  <Filter className="w-4 h-4" />
                  Filter
                </div>

                <select
                  value={commandFilter}
                  onChange={(e) => setCommandFilter(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value={ALL} className="bg-gray-900">All commands</option>
                  {availableCommands.map((c) => (
                    <option key={c} value={c} className="bg-gray-900">/{c}</option>
                  ))}
                </select>

                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value={ALL} className="bg-gray-900">All tags</option>
                  {availableTags.map((t) => (
                    <option key={t} value={t} className="bg-gray-900">{t}</option>
                  ))}
                </select>

                <select
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value={ALL} className="bg-gray-900">Any result</option>
                  <option value="ok" className="bg-gray-900">Replied successfully</option>
                  <option value="failed" className="bg-gray-900">Failed to reply</option>
                </select>

                {filtersActive && (
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors ml-auto"
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear filters
                  </button>
                )}

                <div className="text-xs text-gray-500 w-full sm:w-auto sm:ml-2">
                  Showing {filteredLogs.length} of {logs.length} loaded
                </div>
              </div>

              {filteredLogs.length === 0 ? (
                <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 text-center border-dashed">
                  <Clock className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-300 mb-2">
                    {logs.length === 0 ? 'No commands yet' : 'No commands match these filters'}
                  </h3>
                  <p className="text-gray-500 text-sm max-w-md mx-auto">
                    {logs.length === 0 ? (
                      <>
                        Run <code className="text-indigo-400">/report</code> or <code className="text-indigo-400">/status</code> in
                        your connected server — it&apos;ll show up here instantly.
                      </>
                    ) : (
                      'Try clearing a filter above.'
                    )}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-left text-gray-400">
                        <th className="px-5 py-3 font-medium">Command</th>
                        <th className="px-5 py-3 font-medium">User</th>
                        <th className="px-5 py-3 font-medium">Channel</th>
                        <th className="px-5 py-3 font-medium">Tag</th>
                        <th className="px-5 py-3 font-medium">Result</th>
                        <th className="px-5 py-3 font-medium">Mirrored</th>
                        <th className="px-5 py-3 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence initial={false}>
                        {filteredLogs.map((row) => (
                          <motion.tr
                            key={row.id}
                            initial={{ opacity: 0, backgroundColor: 'rgba(99,102,241,0.15)' }}
                            animate={{ opacity: 1, backgroundColor: 'rgba(99,102,241,0)' }}
                            transition={{ duration: 1.2 }}
                            className="border-b border-white/5 last:border-0"
                          >
                            <td className="px-5 py-3">
                              <span className="font-mono text-indigo-400">/{row.command_name}</span>
                            </td>
                            <td className="px-5 py-3 text-gray-400 font-mono text-xs">
                              {row.user_id ? `${row.user_id.slice(0, 6)}…` : '—'}
                            </td>
                            <td className="px-5 py-3 text-gray-400 font-mono text-xs">
                              {row.channel_id ? `${row.channel_id.slice(0, 6)}…` : '—'}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-xs">{row.status}</span>
                                {row.ai_summary && (
                                  // Full summary on hover -- kept out of the table
                                  // layout itself so the row height stays consistent
                                  // regardless of summary length. Note: the `title`
                                  // attribute has to live on a plain DOM element
                                  // (span), not on the Sparkles icon component
                                  // itself -- lucide-react's icon prop types don't
                                  // include `title`, even though the underlying
                                  // <svg> would render it fine.
                                  <span title={row.ai_summary} className="inline-flex cursor-help shrink-0">
                                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              {row.response_sent ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
                                  <CheckCircle2 className="w-4 h-4" /> Replied
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
                                  <XCircle className="w-4 h-4" /> Failed
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              {row.mirrored ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              ) : (
                                <XCircle className="w-4 h-4 text-gray-600" />
                              )}
                            </td>
                            <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(row.created_at).toLocaleTimeString()}
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}