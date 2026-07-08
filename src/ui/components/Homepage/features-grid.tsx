/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import { motion } from "motion/react";
import { Shield, Workflow, Zap } from "lucide-react";
import type { ReactNode } from "react";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <motion.div variants={cardVariants} className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
      <div className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center mb-6">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-3">{title}</h3>
      <p className="text-gray-400 leading-relaxed text-sm">{description}</p>
    </motion.div>
  );
}

export function FeaturesGrid() {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-100px" }}
      className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-32"
    >
      <FeatureCard
        icon={<Shield className="w-6 h-6 text-indigo-400" />}
        title="Ed25519 Verified"
        description="Bulletproof security. Every interaction is cryptographically verified using Discord's Ed25519 signatures before processing."
      />
      <FeatureCard
        icon={<Workflow className="w-6 h-6 text-purple-400" />}
        title="Smart Routing"
        description="Define rules to route slash commands to Slack webhooks, external APIs, or other Discord channels automatically."
      />
      <FeatureCard
        icon={<Zap className="w-6 h-6 text-blue-400" />}
        title="Under 3 Seconds"
        description="Built on Edge-ready architecture with deferred response patterns to easily beat Discord's strict 3-second interaction window."
      />
    </motion.div>
  );
}
