'use client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createAuthBrowserClient } from '@/lib/supabase/supabase-auth-browser'

export function SignOutButton() {
  const router = useRouter()
  const supabase = createAuthBrowserClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className="text-sm font-medium px-4 py-2 rounded-lg bg-white/5 hover:bg-red-500/10 hover:text-red-400 border border-white/5 transition-colors flex items-center gap-2"
    >
      <LogOut className="w-4 h-4" />
      Sign Out
    </button>
  )
}