// ============================================================================
// AI Nexus Chatbot — Presence & Availability Resolution (`src/utils/presence.ts`)
// Strictly distinguishes:
// 1. Local AI runtime availability (active Personal AI on this host)
// 2. Remote node availability (verified peer AI connected to Gateway)
// 3. Gateway availability (AI Nexus Gateway on port 4000)
// ============================================================================

import { PresenceState, PublicAIIdentity } from '../protocol/index.ts';

export interface GatewayConnectionContext {
  connected: boolean;
  reconnecting?: boolean;
  httpUrl?: string;
  wsUrl?: string;
  error?: string | null;
}

export interface PresenceBadgeDescriptor {
  state: PresenceState;
  label: string;
  shortLabel: string;
  dotClass: string;
  textClass: string;
  badgeClass: string;
  description: string;
}

/**
 * Computes the accurate, non-contradictory presence state for an AI identity.
 * Never returns ONLINE based on seeded data when the Gateway is offline/unreachable.
 */
export function resolveIdentityPresence(
  identity: Pick<
    PublicAIIdentity,
    'online' | 'presenceState' | 'verificationState' | 'registrationState'
  >,
  gateway: GatewayConnectionContext
): PresenceState {
  if (gateway.reconnecting) {
    return 'CONNECTING';
  }

  if (!gateway.connected) {
    return 'UNAVAILABLE';
  }

  if (identity.presenceState) {
    return identity.presenceState;
  }

  if (identity.registrationState === 'REVOKED' || identity.verificationState === 'REVOKED') {
    return 'OFFLINE';
  }

  if (identity.verificationState === 'UNVERIFIED') {
    return 'UNKNOWN';
  }

  return identity.online ? 'ONLINE' : 'OFFLINE';
}

export function getPresenceBadgeMeta(state: PresenceState): PresenceBadgeDescriptor {
  switch (state) {
    case 'ONLINE':
      return {
        state: 'ONLINE',
        label: 'Online',
        shortLabel: 'Online',
        dotClass: 'bg-emerald-500',
        textClass: 'text-emerald-600 dark:text-emerald-400',
        badgeClass:
          'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
        description: 'Verified active connection to AI Nexus Gateway',
      };
    case 'CONNECTING':
      return {
        state: 'CONNECTING',
        label: 'Connecting…',
        shortLabel: 'Connecting',
        dotClass: 'bg-amber-500 animate-pulse',
        textClass: 'text-amber-600 dark:text-amber-400',
        badgeClass:
          'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
        description: 'Establishing authenticated WebSocket connection to Gateway',
      };
    case 'OFFLINE':
      return {
        state: 'OFFLINE',
        label: 'Offline',
        shortLabel: 'Offline',
        dotClass: 'bg-zinc-400 dark:bg-zinc-500',
        textClass: 'text-zinc-500 dark:text-zinc-400',
        badgeClass:
          'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700',
        description: 'Gateway confirms node is disconnected (requests queue)',
      };
    case 'UNAVAILABLE':
      return {
        state: 'UNAVAILABLE',
        label: 'Unavailable',
        shortLabel: 'Unavailable',
        dotClass: 'bg-amber-600/80 dark:bg-amber-500/80',
        textClass: 'text-amber-700 dark:text-amber-400',
        badgeClass:
          'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25',
        description: 'Network Gateway cannot be reached; remote AI communication unavailable',
      };
    case 'UNKNOWN':
    default:
      return {
        state: 'UNKNOWN',
        label: 'Unknown',
        shortLabel: 'Unknown',
        dotClass: 'bg-zinc-300 dark:bg-zinc-600',
        textClass: 'text-zinc-400 dark:text-zinc-500',
        badgeClass:
          'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800',
        description: 'Presence cannot currently be verified',
      };
  }
}

export interface ThreeTierAvailabilitySummary {
  localAiAvailable: boolean;
  localStatusLabel: string;
  remoteNodeState: PresenceState;
  remoteStatusLabel: string;
  gatewayState: 'ONLINE' | 'CONNECTING' | 'UNAVAILABLE';
  gatewayStatusLabel: string;
  compactSummary: string;
}

/**
 * Distinguishes:
 * - Local AI availability (always available on local Chatbot runtime)
 * - Remote node availability (whether this node is reachable by other AIs on the Gateway)
 * - Gateway availability (whether the Gateway service on port 4000 is reachable)
 */
export function getThreeTierAvailability(
  identity: PublicAIIdentity,
  gateway: GatewayConnectionContext
): ThreeTierAvailabilitySummary {
  const localAiAvailable = identity.localRuntimeAvailable ?? true;
  const localStatusLabel = localAiAvailable ? 'Local AI ready' : 'Local runtime offline';

  const remoteNodeState = resolveIdentityPresence(identity, gateway);
  const badge = getPresenceBadgeMeta(remoteNodeState);

  const gatewayState: 'ONLINE' | 'CONNECTING' | 'UNAVAILABLE' = gateway.reconnecting
    ? 'CONNECTING'
    : gateway.connected
    ? 'ONLINE'
    : 'UNAVAILABLE';

  const gatewayStatusLabel =
    gatewayState === 'ONLINE'
      ? 'Gateway online'
      : gatewayState === 'CONNECTING'
      ? 'Gateway reconnecting…'
      : 'Gateway unavailable';

  const remoteStatusLabel =
    remoteNodeState === 'ONLINE'
      ? 'Network online'
      : remoteNodeState === 'CONNECTING'
      ? 'Reconnecting…'
      : remoteNodeState === 'OFFLINE'
      ? 'Remote node offline'
      : remoteNodeState === 'UNAVAILABLE'
      ? 'Network unavailable'
      : badge.label;

  return {
    localAiAvailable,
    localStatusLabel,
    remoteNodeState,
    remoteStatusLabel,
    gatewayState,
    gatewayStatusLabel,
    compactSummary: `${localStatusLabel} · ${remoteStatusLabel}`,
  };
}
