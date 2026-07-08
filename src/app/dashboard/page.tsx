import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/supabase-auth-server'
export default async function DashboardPage() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return <div>Dashboard for {user.user_metadata.full_name ?? user.email}</div>
}