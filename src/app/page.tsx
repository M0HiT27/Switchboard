/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Terminal, ExternalLink } from "lucide-react";
import { Hero } from "@/ui/components/Homepage/hero";
import { FeaturesGrid } from "@/ui/components/Homepage/features-grid";
import { DashboardPreview } from "@/ui/components/Homepage/dashboard-preview";
import Link from "next/link";

export default function Page() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white selection:bg-indigo-500/30 overflow-hidden relative">
      {/* Background gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] opacity-20 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/50 to-transparent blur-3xl rounded-full" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/5 bg-black/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Terminal className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">Switchboard</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="text-gray-400 hover:text-white transition-colors">
              <ExternalLink className="w-5 h-5" />
            </a>
            <Link href={"/dashboard"} className="text-sm font-medium px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 transition-colors">
              Admin Login
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-24 pb-32">
        <Hero />
        <FeaturesGrid />
        <DashboardPreview />
      </main>
    </div>
  );
}
