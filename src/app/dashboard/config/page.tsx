import { Suspense } from 'react';
import CommandConfigClient from '@/ui/components/Config/command-config-client';

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
    </div>
  );
}

// This page reads live, user-specific data (guilds, config) via useSearchParams
// and an authenticated Supabase session -- there's nothing useful to statically
// prerender here, so force-dynamic avoids Next.js attempting (and failing) a
// build-time static export of this route.
export const dynamic = 'force-dynamic';

export default function CommandConfigPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <CommandConfigClient />
    </Suspense>
  );
}