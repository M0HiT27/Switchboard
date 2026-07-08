import { createClient } from '@supabase/supabase-js';

// CLIENT-SIDE SAFE. Uses the publishable key, which respects Row Level Security.
// This is the client the dashboard uses for login, reads, and Realtime
// subscriptions -- RLS ensures each admin only ever sees their own guilds' data.
export function createBrowserSupabaseClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );
}