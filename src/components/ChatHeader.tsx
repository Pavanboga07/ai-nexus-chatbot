import React, { useState } from 'react';
import {
  Moon,
  PanelLeftOpen,
  Plus,
  Settings,
  Sun,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  GroupParticipant as GroupParticipantType,
  GroupSession,
  PresenceState,
  PublicAIIdentity,
} from '../protocol';
import { ConversationThread } from '../chatbot/engine';
import { GatewayStatusInfo } from '../services/chatbotApiClient';
import {
  getPresenceBadgeMeta,
  resolveIdentityPresence,
} from '../utils/presence';

interface GroupParticipantProps {
  participant: GroupParticipantType;
  presenceState: PresenceState;
  canRemove: boolean;
  onRemove: (aiId: string) => void;
}

export const GroupParticipant: React.FC<GroupParticipantProps> = ({
  participant,
  presenceState,
  canRemove,
  onRemove,
}) => {
  const meta = getPresenceBadgeMeta(presenceState);
  return (
    <div className="flex items-center justify-between py-2 px-2.5 rounded-lg hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 transition-colors">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="relative w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-center text-xs font-semibold shrink-0">
          {participant.displayName.slice(0, 1)}
          <span
            title={meta.description}
            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white dark:border-zinc-900 ${meta.dotClass}`}
          />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {participant.displayName}{' '}
            <span className="text-zinc-400 dark:text-zinc-500 font-normal">
              {participant.handle}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
            Owner: {participant.ownerName} ·{' '}
            <span className={meta.textClass}>{meta.shortLabel}</span>
          </div>
        </div>
      </div>

      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(participant.aiId)}
          aria-label={`Remove ${participant.displayName} from group`}
          className="p-1 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-md transition-colors"
        >
          <UserMinus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

interface ChatHeaderProps {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  activeIdentity: PublicAIIdentity;
  activeConversation: ConversationThread | null;
  activeGroup: GroupSession | null;
  allIdentities: PublicAIIdentity[];
  gatewayStatus: GatewayStatusInfo;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
  onInviteGroupParticipant: (groupId: string, aiId: string) => void;
  onRemoveGroupParticipant: (groupId: string, aiId: string) => void;
  onEndGroup: (groupId: string) => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  sidebarOpen,
  onOpenSidebar,
  activeIdentity,
  activeConversation,
  activeGroup,
  allIdentities,
  gatewayStatus,
  darkMode,
  onToggleDarkMode,
  onOpenSettings,
  onNewChat,
  onInviteGroupParticipant,
  onRemoveGroupParticipant,
  onEndGroup,
}) => {
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);

  const activeParticipants =
    activeGroup?.participants.filter((p) => p.status === 'ACTIVE') ?? [];
  const invitableIdentities = allIdentities.filter(
    (id) => !activeParticipants.some((p) => p.aiId === id.aiId)
  );

  const activePresenceState = resolveIdentityPresence(
    activeIdentity,
    gatewayStatus
  );
  const activePresenceMeta = getPresenceBadgeMeta(activePresenceState);

  return (
    <header className="relative h-14 px-4 sm:px-6 flex items-center justify-between border-b border-zinc-200/70 dark:border-zinc-800/70 bg-[#FAF9F6]/90 dark:bg-[#0A0A0B]/90 backdrop-blur-md shrink-0 z-20">
      {/* Left: Sidebar trigger + Current Context */}
      <div className="flex items-center gap-3 min-w-0">
        {!sidebarOpen && (
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-2.5 min-w-0">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {activeConversation
              ? activeConversation.title.replace(/^\[Group\]\s*/i, '')
              : activeIdentity.displayName}
          </h1>

          {!activeConversation && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap shrink-0">
              <span aria-hidden="true">·</span>
              <span>Local AI ready</span>
              <span aria-hidden="true">·</span>
              <span className={activePresenceMeta.textClass}>
                {gatewayStatus.reconnecting
                  ? 'Gateway reconnecting…'
                  : gatewayStatus.connected
                  ? 'Network online'
                  : 'Remote network unavailable'}
              </span>
            </span>
          )}

          {activeConversation?.isGroup && activeGroup && (
            <button
              type="button"
              onClick={() => setGroupPanelOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-zinc-200/70 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Users className="w-3.5 h-3.5" />
              <span>{activeParticipants.length} AIs</span>
              {activeGroup.status === 'ENDED' && (
                <span className="text-rose-500">· Ended</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Right: Subtle utility controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        {!sidebarOpen && (
          <button
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onToggleDarkMode}
          aria-label={
            darkMode ? 'Switch to light theme' : 'Switch to dark theme'
          }
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors"
        >
          {darkMode ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Group Conversation Details & Participant Management Popover */}
      {groupPanelOpen && activeGroup && (
        <div className="absolute top-14 right-4 sm:right-6 w-80 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl p-4 space-y-4 z-40">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {activeGroup.title}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Shared multi-AI conversation · {activeParticipants.length}{' '}
                active participants
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGroupPanelOpen(false)}
              className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Close group panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 px-1">
              Participants
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {activeParticipants.map((part) => {
                const fullId = allIdentities.find((i) => i.aiId === part.aiId);
                const state = fullId
                  ? resolveIdentityPresence(fullId, gatewayStatus)
                  : gatewayStatus.connected
                  ? 'UNKNOWN'
                  : 'UNAVAILABLE';
                return (
                  <GroupParticipant
                    key={part.aiId}
                    participant={part}
                    presenceState={state}
                    canRemove={
                      part.aiId !== activeIdentity.aiId &&
                      activeGroup.status === 'ACTIVE'
                    }
                    onRemove={(aiId) =>
                      onRemoveGroupParticipant(activeGroup.groupId, aiId)
                    }
                  />
                );
              })}
            </div>
          </div>

          {invitableIdentities.length > 0 && activeGroup.status === 'ACTIVE' && (
            <div className="space-y-1.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <div className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 px-1">
                Invite another AI
              </div>
              {invitableIdentities.map((id) => (
                <button
                  key={id.aiId}
                  type="button"
                  onClick={() =>
                    onInviteGroupParticipant(activeGroup.groupId, id.aiId)
                  }
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span>
                    {id.displayName} ({id.handle})
                  </span>
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <UserPlus className="w-3.5 h-3.5" />
                    Invite
                  </span>
                </button>
              ))}
            </div>
          )}

          {activeGroup.status === 'ACTIVE' && (
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onEndGroup(activeGroup.groupId);
                  setGroupPanelOpen(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                End group conversation
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
};
