import React from 'react';
import {
  ArrowUpRight,
  Calendar,
  FileCheck2,
  Loader2,
  MessageSquareShare,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { PublicAIIdentity } from '../protocol';
import { GatewayStatusInfo } from '../services/chatbotApiClient';
import {
  getPresenceBadgeMeta,
  getThreeTierAvailability,
  resolveIdentityPresence,
} from '../utils/presence';

interface EmptyStateProps {
  activeIdentity: PublicAIIdentity;
  identities: PublicAIIdentity[];
  gatewayStatus: GatewayStatusInfo;
  onSelectPrompt: (prompt: string) => void;
  onStartGroupConversation: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  activeIdentity,
  identities,
  gatewayStatus,
  onSelectPrompt,
  onStartGroupConversation,
}) => {
  const peerIdentities = identities.filter(
    (i) => i.aiId !== activeIdentity.aiId
  );
  const onlinePeersCount = peerIdentities.filter(
    (i) => resolveIdentityPresence(i, gatewayStatus) === 'ONLINE'
  ).length;

  const availability = getThreeTierAvailability(activeIdentity, gatewayStatus);
  const presenceMeta = getPresenceBadgeMeta(availability.remoteNodeState);

  const suggestions = [
    {
      label: "Ask @bob's AI for tomorrow's availability",
      prompt:
        "Ask Bob's AI whether he is available tomorrow for an architecture sync.",
      icon: Calendar,
    },
    {
      label: 'Coordinate a meeting slot with @bob',
      prompt:
        "Ask Bob's AI whether he is available tomorrow. If necessary, ask which time works best.",
      icon: MessageSquareShare,
    },
    {
      label: 'Check Phase 8 security status with @charlie',
      prompt: "Ask Charlie's AI what the current Phase 8 security status is.",
      icon: ShieldCheck,
    },
    {
      label: 'Summarize Q4 launch readiness from memory',
      prompt:
        'Summarize our Q4 launch priorities and identify any open preparation items from my memory vault.',
      icon: FileCheck2,
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-14 sm:py-16 max-w-2xl mx-auto w-full text-center">
      {/* Distinctive AI Nexus Identity Lockup */}
      <div className="flex flex-col items-center gap-3 mb-5">
        <div className="relative w-12 h-12 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center text-base font-semibold shadow-xs">
          {activeIdentity.displayName.slice(0, 1)}
          <span
            title={presenceMeta.description}
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#FAF9F6] dark:border-[#0A0A0B] ${presenceMeta.dotClass}`}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {activeIdentity.displayName} ({activeIdentity.handle})
          </span>
          <span aria-hidden="true">·</span>
          <span>{availability.localStatusLabel}</span>
          <span aria-hidden="true">·</span>
          <span className={presenceMeta.textClass}>
            {gatewayStatus.reconnecting
              ? 'Gateway reconnecting…'
              : gatewayStatus.connected
              ? `${onlinePeersCount} peer ${
                  onlinePeersCount === 1 ? 'AI' : 'AIs'
                } online`
              : 'Remote network unavailable'}
          </span>
        </div>
      </div>

      {/* Balanced Heading & Description */}
      <h2 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 [text-wrap:balance]">
        What are we working on today?
      </h2>

      <p className="mt-3 text-sm sm:text-[15px] text-zinc-500 dark:text-zinc-400 max-w-lg leading-relaxed [text-wrap:balance]">
        Ask {activeIdentity.displayName} anything using your private workspace
        context, or communicate directly with trusted Personal AIs across your
        network.
      </p>

      {/* Domain-Authentic AI Nexus Suggestions */}
      <div className="mt-9 flex flex-wrap items-center justify-center gap-2 max-w-xl">
        {suggestions.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              data-testid={`empty-suggestion-${idx}`}
              onClick={() => onSelectPrompt(item.prompt)}
              className="group inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/75 hover:bg-zinc-100 dark:hover:bg-zinc-800/90 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors whitespace-nowrap shrink-0"
            >
              <Icon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 transition-colors shrink-0" />
              <span>{item.label}</span>
              <ArrowUpRight className="w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          );
        })}

        <button
          type="button"
          data-testid="empty-group-btn"
          onClick={onStartGroupConversation}
          className="group inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/75 hover:bg-zinc-100 dark:hover:bg-zinc-800/90 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors whitespace-nowrap shrink-0"
        >
          <Users className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 transition-colors shrink-0" />
          <span>Start a multi-AI group session</span>
        </button>
      </div>
    </div>
  );
};

interface InvocationStatusProps {
  statusText: string | null;
}

export const InvocationStatus: React.FC<InvocationStatusProps> = ({
  statusText,
}) => {
  if (!statusText) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 py-3 px-4 rounded-xl bg-zinc-100/80 dark:bg-zinc-900/70 border border-zinc-200/70 dark:border-zinc-800/80 text-xs text-zinc-600 dark:text-zinc-300 max-w-md"
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500 dark:text-zinc-400 shrink-0" />
      <span>{statusText}</span>
    </div>
  );
};

export const LoadingState: React.FC<{ label?: string }> = ({
  label = 'Thinking…',
}) => <InvocationStatus statusText={label} />;
