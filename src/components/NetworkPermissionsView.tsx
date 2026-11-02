import React, { useState } from 'react';
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  KeyRound,
  MessageSquare,
  Search,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  UserX,
} from 'lucide-react';
import {
  ExecutionMode,
  InvocationRecord,
  PermissionMode,
  PermissionRule,
  PublicAIIdentity,
} from '../protocol';
import { GatewayStatusInfo } from '../services/chatbotApiClient';
import {
  getPresenceBadgeMeta,
  getThreeTierAvailability,
  resolveIdentityPresence,
} from '../utils/presence';

const AI_BIOS: Record<string, string> = {
  ai_alice:
    'Personal AI for Alice Vance · Coordinates product architecture, schedule windows, and Q4 launch reviews.',
  ai_bob:
    'Personal AI for Bob Chen · Shares authorized calendar availability and engineering milestone summaries.',
  ai_charlie:
    'Personal AI for Charlie Patel · Collaborates on security threat modeling, zero-trust reviews, and group sessions.',
};

interface PermissionSummaryProps {
  rule: PermissionRule;
  onUpdateMode: (ownerAiId: string, ruleId: string, mode: PermissionMode) => void;
}

export const PermissionSummary: React.FC<PermissionSummaryProps> = ({
  rule,
  onUpdateMode,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b border-zinc-100 dark:border-zinc-800/70 last:border-b-0">
      <div className="space-y-0.5">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {rule.dataCategory}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {rule.allowedFields.length > 0
            ? `Shares only: ${rule.allowedFields.join(', ')}`
            : 'No private fields shared'}
        </div>
      </div>

      <div className="inline-flex items-center rounded-lg p-0.5 bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-200/70 dark:border-zinc-700/60 shrink-0 self-start sm:self-center">
        {(
          [
            { mode: PermissionMode.ALLOW_AUTOMATICALLY, label: 'Allow' },
            { mode: PermissionMode.REQUIRE_APPROVAL, label: 'Ask me' },
            { mode: PermissionMode.DENY, label: 'Block' },
          ] as const
        ).map((opt) => {
          const active = rule.mode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => onUpdateMode(rule.ownerAiId, rule.ruleId, opt.mode)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                active
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface NetworkIdentityRowProps {
  identity: PublicAIIdentity;
  gatewayStatus: GatewayStatusInfo;
  isSelected: boolean;
  isBlocked: boolean;
  isConnected: boolean;
  onSelect: () => void;
  onQuickAsk: (handle: string, ownerFirstName: string) => void;
}

export const NetworkIdentityRow: React.FC<NetworkIdentityRowProps> = ({
  identity,
  gatewayStatus,
  isSelected,
  isBlocked,
  isConnected,
  onSelect,
  onQuickAsk,
}) => {
  const ownerFirst = identity.ownerDisplayName.split(' ')[0];
  const presenceState = resolveIdentityPresence(identity, gatewayStatus);
  const presenceMeta = getPresenceBadgeMeta(presenceState);

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group flex items-center justify-between gap-4 p-4 rounded-2xl border transition-colors cursor-pointer ${
        isSelected
          ? 'border-zinc-400 dark:border-zinc-600 bg-white dark:bg-zinc-900 shadow-xs'
          : 'border-zinc-200/80 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-zinc-900'
      }`}
    >
      <div className="flex items-start gap-3.5 min-w-0">
        <div className="relative w-10 h-10 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center text-sm font-semibold shrink-0 mt-0.5">
          {identity.displayName.slice(0, 1)}
          <span
            title={presenceMeta.description}
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${
              isBlocked ? 'bg-rose-500' : presenceMeta.dotClass
            }`}
          />
        </div>

        <div className="min-w-0 space-y-1">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {identity.displayName}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {identity.handle}
            </span>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">·</span>
            <span
              className={`text-xs font-medium ${
                isBlocked
                  ? 'text-rose-600 dark:text-rose-400'
                  : !isConnected
                  ? 'text-zinc-500'
                  : presenceMeta.textClass
              }`}
            >
              {isBlocked
                ? 'Blocked'
                : !isConnected
                ? 'Disconnected'
                : presenceMeta.label}
            </span>
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">
            {AI_BIOS[identity.aiId] ??
              `Personal AI owned by ${identity.ownerDisplayName}.`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!isBlocked && isConnected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickAsk(identity.handle, ownerFirst);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 transition-colors whitespace-nowrap shrink-0"
          >
            Ask AI
          </button>
        )}
        <ChevronRight className="w-4 h-4 text-zinc-400" />
      </div>
    </div>
  );
};

interface NetworkPermissionsViewProps {
  identities: PublicAIIdentity[];
  activeAiId: string;
  gatewayStatus: GatewayStatusInfo;
  permissionsByOwner: Record<string, PermissionRule[]>;
  pendingApprovals: InvocationRecord[];
  invocations: InvocationRecord[];
  onToggleNodeOnline: (
    aiId: string,
    online: boolean,
    executionMode?: ExecutionMode
  ) => void;
  onToggleKillSwitch: (aiId: string, active: boolean) => void;
  onRotateKey: (aiId: string) => void;
  onVerifyPairing: (aiId: string, nodeId: string) => Promise<string>;
  onUpdatePermissionMode: (
    ownerAiId: string,
    ruleId: string,
    mode: PermissionMode
  ) => void;
  onResolveApproval: (requestId: string, approve: boolean) => void;
  onAskAiInChat: (prompt: string) => void;
}

export const NetworkPermissionsView: React.FC<NetworkPermissionsViewProps> = ({
  identities,
  activeAiId,
  gatewayStatus,
  permissionsByOwner,
  pendingApprovals,
  invocations,
  onToggleNodeOnline,
  onRotateKey,
  onVerifyPairing,
  onUpdatePermissionMode,
  onResolveApproval,
  onAskAiInChat,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<
    'connected' | 'requests' | 'permissions' | 'blocked'
  >('connected');
  const [selectedAiId, setSelectedAiId] = useState<string>('ai_bob');
  const [blockedAiIds, setBlockedAiIds] = useState<string[]>([]);
  const [disconnectedAiIds, setDisconnectedAiIds] = useState<string[]>([]);
  const [showAdvancedSecurity, setShowAdvancedSecurity] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(
    null
  );

  const peerIdentities = identities.filter((i) => i.aiId !== activeAiId);
  const filteredPeers = peerIdentities.filter((id) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      id.displayName.toLowerCase().includes(q) ||
      id.handle.toLowerCase().includes(q) ||
      id.ownerDisplayName.toLowerCase().includes(q);

    if (!matchesSearch) return false;
    if (activeTab === 'blocked') return blockedAiIds.includes(id.aiId);
    if (activeTab === 'connected') return !blockedAiIds.includes(id.aiId);
    return true;
  });

  const selectedIdentity =
    identities.find((i) => i.aiId === selectedAiId) ??
    peerIdentities[0] ??
    identities[0];

  const isSelectedBlocked = blockedAiIds.includes(selectedIdentity?.aiId);
  const isSelectedConnected = !disconnectedAiIds.includes(selectedIdentity?.aiId);

  // Permissions granted by the active owner to the selected AI, and vice versa
  const grantedByMe = (permissionsByOwner[activeAiId] ?? []).filter(
    (r) => r.granteeAiId === selectedIdentity?.aiId || r.granteeAiId === '*'
  );
  const grantedToMe = (
    permissionsByOwner[selectedIdentity?.aiId ?? ''] ?? []
  ).filter((r) => r.granteeAiId === activeAiId || r.granteeAiId === '*');

  // Recent interactions between active AI and selected AI
  const recentInteractions = invocations
    .filter(
      (inv) =>
        (inv.envelope.senderAiId === activeAiId &&
          inv.envelope.recipientAiId === selectedIdentity?.aiId) ||
        (inv.envelope.senderAiId === selectedIdentity?.aiId &&
          inv.envelope.recipientAiId === activeAiId)
    )
    .slice(0, 5);

  const handleToggleBlock = (aiId: string) => {
    setBlockedAiIds((prev) =>
      prev.includes(aiId) ? prev.filter((x) => x !== aiId) : [...prev, aiId]
    );
  };

  const handleToggleConnect = (aiId: string) => {
    setDisconnectedAiIds((prev) =>
      prev.includes(aiId) ? prev.filter((x) => x !== aiId) : [...prev, aiId]
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Network
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage trusted Personal AIs, connection permissions, and information sharing boundaries.
          </p>
        </div>

        {/* Search / Discover Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find an AI by name or @handle…"
            aria-label="Search or discover AI identities"
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('connected')}
          className={`px-3.5 py-2.5 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'connected'
              ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          Connected AIs ({peerIdentities.length - blockedAiIds.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`px-3.5 py-2.5 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'requests'
              ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <span>Pending requests</span>
          {pendingApprovals.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px]">
              {pendingApprovals.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('permissions')}
          className={`px-3.5 py-2.5 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'permissions'
              ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          Connection permissions
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('blocked')}
          className={`px-3.5 py-2.5 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'blocked'
              ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          Blocked ({blockedAiIds.length})
        </button>
      </div>

      {/* Pending Requests Banner / View */}
      {activeTab === 'requests' && (
        <div className="space-y-3">
          {pendingApprovals.length === 0 ? (
            <div className="p-8 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white/60 dark:bg-zinc-900/40 text-center space-y-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                No pending permission requests
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                When another Personal AI asks for information marked "Ask me", it will appear here for your approval.
              </p>
            </div>
          ) : (
            pendingApprovals.map((req, idx) => (
              <div
                key={`${req.requestId || req.correlationId || 'req'}-${idx}`}
                className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Request from {req.envelope.senderAiId} for{' '}
                    {req.envelope.payload.capability}
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">
                    "{req.envelope.payload.question}"
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onResolveApproval(req.requestId, true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  >
                    Approve once
                  </button>
                  <button
                    type="button"
                    onClick={() => onResolveApproval(req.requestId, false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Main Master-Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Compact Identity List */}
        <div className="lg:col-span-5 space-y-2.5">
          {filteredPeers.length === 0 ? (
            <div className="p-6 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 text-center text-xs text-zinc-500">
              No Personal AIs match this view.
            </div>
          ) : (
            filteredPeers.map((id) => (
              <NetworkIdentityRow
                key={id.aiId}
                identity={id}
                gatewayStatus={gatewayStatus}
                isSelected={selectedIdentity?.aiId === id.aiId}
                isBlocked={blockedAiIds.includes(id.aiId)}
                isConnected={!disconnectedAiIds.includes(id.aiId)}
                onSelect={() => {
                  setSelectedAiId(id.aiId);
                  setVerificationFeedback(null);
                }}
                onQuickAsk={(_handle, ownerFirst) =>
                  onAskAiInChat(
                    `Ask ${ownerFirst}'s AI whether he is available tomorrow for a meeting.`
                  )
                }
              />
            ))
          )}
        </div>

        {/* Right Column: Selected AI Detail View */}
        {selectedIdentity && (() => {
          const selPresence = resolveIdentityPresence(selectedIdentity, gatewayStatus);
          const selMeta = getPresenceBadgeMeta(selPresence);
          const selAvail = getThreeTierAvailability(selectedIdentity, gatewayStatus);
          return (
          <div className="lg:col-span-7 rounded-2xl border border-zinc-200/90 dark:border-zinc-800/90 bg-white dark:bg-zinc-900 p-6 space-y-6">
            {/* Identity Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-start gap-3.5">
                <div className="relative w-12 h-12 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center text-base font-semibold shrink-0">
                  {selectedIdentity.displayName.slice(0, 1)}
                  <span
                    title={selMeta.description}
                    className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-zinc-900 ${selMeta.dotClass}`}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      {selectedIdentity.displayName}
                    </h2>
                    <span className="text-sm text-zinc-500">
                      {selectedIdentity.handle}
                    </span>
                    <span className="text-xs text-zinc-400">·</span>
                    <span className={`text-xs font-medium ${selMeta.textClass}`}>
                      {selMeta.label}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Owned by <strong>{selectedIdentity.ownerDisplayName}</strong> ·{' '}
                    {selAvail.localStatusLabel} · {selAvail.gatewayStatusLabel}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onAskAiInChat(
                      `Ask ${
                        selectedIdentity.ownerDisplayName.split(' ')[0]
                      }'s AI whether he is available tomorrow for a meeting.`
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Ask in Chat</span>
                </button>
              </div>
            </div>

            {/* Permissions Section */}
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
                  What {selectedIdentity.displayName} shares with your AI
                </h3>
                <div className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/80 px-4 divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {grantedToMe.length === 0 ? (
                    <p className="py-3 text-xs text-zinc-500">
                      No sharing rules configured.
                    </p>
                  ) : (
                    grantedToMe.map((rule, idx) => (
                      <PermissionSummary
                        key={`to-me-${rule.ruleId}-${idx}`}
                        rule={rule}
                        onUpdateMode={onUpdatePermissionMode}
                      />
                    ))
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
                  What your AI shares with {selectedIdentity.displayName}
                </h3>
                <div className="rounded-xl border border-zinc-200/70 dark:border-zinc-800/80 px-4 divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {grantedByMe.length === 0 ? (
                    <p className="py-3 text-xs text-zinc-500">
                      Default policy: Ask before sharing any private context.
                    </p>
                  ) : (
                    grantedByMe.map((rule, idx) => (
                      <PermissionSummary
                        key={`by-me-${rule.ruleId}-${idx}`}
                        rule={rule}
                        onUpdateMode={onUpdatePermissionMode}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Recent Communication */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Recent interactions
              </h3>
              {recentInteractions.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">
                  No recent queries recorded in this session yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {recentInteractions.map((inv, idx) => (
                    <div
                      key={`${inv.requestId || inv.correlationId || 'inv'}-${idx}`}
                      className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 text-xs"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="font-medium text-zinc-800 dark:text-zinc-200 truncate">
                          {inv.envelope.payload.question}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {inv.envelope.payload.capability} · {inv.state}
                        </div>
                      </div>
                      <span className="text-[11px] text-zinc-400 shrink-0">
                        {new Date(inv.updatedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Connection Controls: Availability Simulation, Remove, Block */}
            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onToggleNodeOnline(
                      selectedIdentity.aiId,
                      !selectedIdentity.online
                    )
                  }
                  className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  {selectedIdentity.online
                    ? 'Set AI Offline (Test Queue)'
                    : 'Reconnect AI Online'}
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleConnect(selectedIdentity.aiId)}
                  className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  {isSelectedConnected
                    ? 'Remove connection'
                    : 'Reconnect identity'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleToggleBlock(selectedIdentity.aiId)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isSelectedBlocked
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                    : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                }`}
              >
                <Ban className="w-3.5 h-3.5" />
                <span>
                  {isSelectedBlocked ? 'Unblock identity' : 'Block identity'}
                </span>
              </button>
            </div>

            {/* Collapsed Advanced Security Details */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAdvancedSecurity((prev) => !prev)}
                className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                {showAdvancedSecurity ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <span>Advanced security details</span>
              </button>

              {showAdvancedSecurity && (
                <div className="mt-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 text-xs space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                    <div>Node ID: {selectedIdentity.nodeId}</div>
                    <div>Execution: {selectedIdentity.executionMode}</div>
                    <div className="sm:col-span-2">
                      Key Fingerprint: {selectedIdentity.keyFingerprint}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        const msg = await onVerifyPairing(
                          selectedIdentity.aiId,
                          selectedIdentity.nodeId
                        );
                        setVerificationFeedback(msg);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Verify identity signature</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRotateKey(selectedIdentity.aiId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Rotate key</span>
                    </button>
                  </div>
                  {verificationFeedback && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      {verificationFeedback}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
};
