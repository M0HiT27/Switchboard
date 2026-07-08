import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// SERVER-SIDE. Cookie-aware client for use inside Server Components, Server
// Actions, and Route Handlers that need to know who's logged in. Reads/writes
// the session via next/headers cookies(). Still uses the publishable key + the
// user's own session, so RLS applies -- this is NOT a secret-key client.
export async function createAuthServerClient() {
    const cookieStore = await cookies()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // Called from a Server Component -- ignore, proxy.ts handles
                        // session refresh instead.
                    }
                },
            },
        }
    )
}