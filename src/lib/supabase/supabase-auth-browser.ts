import { createBrowserClient } from '@supabase/ssr'

// CLIENT-SIDE. Cookie-aware version of the publishable-key client, specifically
// for auth/session use (login, signInWithOAuth). Unlike supabase-browser.ts
// (plain supabase-js, session in localStorage), this syncs the session into
// cookies so server-rendered pages and proxy.ts can see it too.
export function createAuthBrowserClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
}