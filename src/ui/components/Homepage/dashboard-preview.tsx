/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";

function LogLine({ time, user, command, status, target }: { time: string; user: string; command: string; status: string; target: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg bg-white/[0.02] border border-white/5 font-mono text-sm gap-4">
      <div className="flex items-center gap-4">
        <span className="text-gray-500">{time}</span>
        <span className="text-blue-400">{user}</span>
        <span className="text-gray-300 bg-white/10 px-2 py-0.5 rounded">{command}</span>
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-gray-400 flex items-center gap-1">
          <ArrowRight className="w-3 h-3" /> {target}
        </span>
        <span className={`px-2 py-1 rounded-full ${status === 'Success' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
          {status}
        </span>
      </div>
    </div>
  );
}

export function DashboardPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, delay: 0.2 }}
      className="mt-32 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl overflow-hidden shadow-2xl relative"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10" />
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
        <div className="w-3 h-3 rounded-full bg-red-500/80" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
        <div className="w-3 h-3 rounded-full bg-green-500/80" />
        <div className="ml-4 text-xs text-gray-500 font-mono">dashboard / live-logs</div>
      </div>
      <div className="p-6 md:p-8 grid gap-4 opacity-70">
        <LogLine time="10:37:22 AM" user="@admin" command="/report" status="Success" target="#slack-alerts" />
        <LogLine time="10:38:05 AM" user="@developer" command="/status" status="Success" target="Discord Reply" />
        <LogLine time="10:41:12 AM" user="@user" command="/report" status="Deferred" target="Processing..." />
      </div>
    </motion.div>
  );
}
