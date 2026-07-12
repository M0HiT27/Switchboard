import { Suspense } from 'react';
import CommandLogClient from '@/ui/components/Logs/command-log-client';

export default function CommandLogPage() {
  return (
    <Suspense fallback={null}>
      <CommandLogClient />
    </Suspense>
  );
}