import { createAuthServerClient } from '@/lib/supabase/supabase-auth-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AddServerButton } from '@/ui/components/Dashboard/add-server-button'
import { MotionDiv } from '@/ui/components/Dashboard/motion-div' // thin client wrapper, see note below
import { Terminal, Server, Settings } from 'lucide-react'
import { SignOutButton } from '@/ui/components/Dashboard/sign-out-button'

export default async function DashboardPage() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: guilds } = await supabase
    .from('admin_guilds')
    .select('guild_id, guild_name, connected_at')
    .order('connected_at', { ascending: false })

  // Bot install/auth URL. permissions=2048 is Send Messages -- covers replying
  // to slash commands and posting to the mirror channel. Regenerate this value
  // via Discord Developer Portal -> OAuth2 -> URL Generator if more permissions
  // are ever needed, and update the integer here to match.
  const inviteUrl = new URL('https://discord.com/oauth2/authorize')
  inviteUrl.searchParams.set('client_id', process.env.DISCORD_APPLICATION_ID!)
  inviteUrl.searchParams.set('scope', 'bot applications.commands')
  inviteUrl.searchParams.set('permissions', '2048')
  inviteUrl.searchParams.set('response_type', 'code')
  inviteUrl.searchParams.set(
    'redirect_uri',
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/discord/callback`
  )

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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Terminal className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">Switchboard Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/config"
              className="text-sm font-medium px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              Command Rules
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-400 mr-4">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {user.user_metadata?.full_name ?? user.email}
            </div>
            <SignOutButton />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-12 pb-32">
        <MotionDiv
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-12"
        >
          <header>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Dashboard</h1>
            <p className="text-gray-400">Manage your connected Discord servers and routing rules.</p>
          </header>

          <section className="grid gap-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Server className="w-5 h-5 text-indigo-400" />
                Connected Servers
              </h2>
            </div>

            {guilds && guilds.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {guilds.map((g, i) => (
                  <MotionDiv
                    key={g.guild_id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="p-6 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-lg">{g.guild_name ?? g.guild_id}</div>
                      <div className="text-sm text-gray-500 mt-1 font-mono">ID: {g.guild_id}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/dashboard/config?guild=${g.guild_id}`}
                        className="text-sm font-medium px-3 py-1.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors flex items-center gap-1.5"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Configure
                      </Link>
                      <div className="w-2 h-2 rounded-full bg-green-500/80 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                    </div>
                  </MotionDiv>
                ))}
              </div>
            ) : (
              <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 text-center border-dashed">
                <Server className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-300 mb-2">No servers connected yet</h3>
                <p className="text-gray-500 text-sm max-w-md mx-auto mb-8">
                  Get started by adding Switchboard to a Discord server. Once connected, you can configure command routing and Webhook rules.
                </p>
                <AddServerButton inviteUrl={inviteUrl.toString()} />
              </div>
            )}
          </section>

          {guilds && guilds.length > 0 && (
            <section className="grid gap-6 mt-12 border-t border-white/10 pt-12">
              <div className="flex items-center justify-between pb-4">
                <h2 className="text-xl font-semibold">Connect another server</h2>
              </div>
              <div>
                <AddServerButton inviteUrl={inviteUrl.toString()} />
              </div>
            </section>
          )}
        </MotionDiv>
      </main>
    </div>
  )
}