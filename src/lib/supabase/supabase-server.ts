import { createClient } from '@supabase/supabase-js';

// SERVER-SIDE ONLY. Uses the secret key, which bypasses Row Level Security.
// Never import this file into any client component or expose SUPABASE_SECRET_KEY
// to the browser.
export function createServerSupabaseClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        {
            auth: {
                // No session persistence needed -- this client is only ever used for
                // one-off server-side operations inside API routes.
                persistSession: false,
            },
        }
    );
}