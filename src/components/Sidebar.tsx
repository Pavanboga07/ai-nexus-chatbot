import React, { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Check,
  ChevronUp,
  Edit3,
  Globe,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { GroupSession, PublicAIIdentity } from '../protocol';
import { ConversationThread } from '../chatbot/engine';
import { GatewayStatusInfo } from '../services/chatbotApiClient';
import {
  getPresenceBadgeMeta,
  getThreeTierAvailability,
  resolveIdentityPresence,
} from '../utils/presence';

export type PrimaryScreen = 'chat' | 'network' | 'memory' | 'settings';

interface ConversationListProps {
  conversations: ConversationThread[];
  groups: GroupSession[];
  activeConversationId: string | null;
  activeScreen: PrimaryScreen;
  onSelectConversation: (convId: string) => void;
  onTogglePin: (convId: string) => void;
  onRenameConversation: (convId: string, title: string) => void;
  onDeleteConversation: (convId: string) => void;
  onStartGroupModal: () => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  groups,
  activeConversationId,
  activeScreen,
  onSelectConversation,
  onTogglePin,
  onRenameConversation,
  onDeleteConversation,
  onStartGroupModal,
}) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');

  const pinned = conversations.filter((c) => c.pinned && !c.isGroup);
  const recent = conversations.filter((c) => !c.pinned && !c.isGroup);
  const groupConvs = conversations.filter((c) => c.isGroup);

  const renderRow = (conv: ConversationThread) => {
    const isSelected =
      activeScreen === 'chat' && activeConversationId === conv.id;
    const isEditing = editingId === conv.id;
    const cleanTitle = conv.title.replace(/^\[Group\]\s*/i, '');
    const linkedGroup = conv.groupId
      ? groups.find((g) => g.groupId === conv.groupId)
      : undefined;
    const activeGroupCount = linkedGroup
      ? linkedGroup.participants.filter((p) => p.status === 'ACTIVE').length
      : undefined;

    return (
      <div
        key={conv.id}
        className={`group relative flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
          isSelected
            ? 'bg-zinc-200/75 dark:bg-zinc-800/85 text-zinc-900 dark:text-zinc-100 font-medium shadow-2xs'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/45 dark:hover:bg-zinc-800/45 hover:text-zinc-900 dark:hover:text-zinc-200'
        }`}
      >
        {isEditing ? (
          <form
            className="flex items-center gap-1.5 w-full"
            onSubmit={(e) => {
              e.preventDefault();
              if (editingTitle.trim()) {
                onRenameConversation(conv.id, editingTitle.trim());
              }
              setEditingId(null);
            }}
          >
            <input
              type="text"
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              autoFocus
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
            <button
              type="submit"
              className="p-1 text-emerald-600 dark:text-emerald-400 hover:opacity-80"
              aria-label="Save conversation title"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="p-1 text-zinc-400 hover:text-zinc-600"
              aria-label="Cancel rename"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              data-testid={`conv-item-${conv.id}`}
              title={cleanTitle}
              onClick={() => onSelectConversation(conv.id)}
              className="flex items-center gap-2.5 text-left flex-1 min-w-0 pr-1.5 py-0.5"
            >
              {conv.isGroup ? (
                <Users
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected
                      ? 'text-zinc-700 dark:text-zinc-200'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }`}
                />
              ) : (
                <MessageSquare
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected
                      ? 'text-zinc-700 dark:text-zinc-200'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }`}
                />
              )}
              <span className="truncate leading-snug">{cleanTitle}</span>
              {conv.isGroup && typeof activeGroupCount === 'number' && (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
                  · {activeGroupCount} AIs
                </span>
              )}
            </button>

            <div className="relative flex items-center shrink-0">
              <button
                type="button"
                aria-label={`More options for ${cleanTitle}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === conv.id ? null : conv.id);
                }}
                className={`p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-300/50 dark:hover:bg-zinc-700/60 transition-opacity ${
                  openMenuId === conv.id || isSelected
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                }`}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>

              {openMenuId === conv.id && (
                <div
                  className="absolute right-0 top-7 z-30 w-36 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg py-1 text-xs"
                  onMouseLeave={() => setOpenMenuId(null)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onTogglePin(conv.id);
                      setOpenMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Pin className="w-3.5 h-3.5" />
                    <span>{conv.pinned ? 'Unpin chat' : 'Pin chat'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(conv.id);
                      setEditingTitle(cleanTitle);
                      setOpenMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Rename</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteConversation(conv.id);
                      setOpenMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {pinned.length > 0 && (
        <div className="space-y-1">
          <div className="px-2.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
            Pinned
          </div>
          <div className="space-y-0.5">{pinned.map(renderRow)}</div>
        </div>
      )}

      <div className="space-y-1">
        <div className="px-2.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
          Recent conversations
        </div>
        {recent.length === 0 ? (
          <p className="px-2.5 py-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            No recent chats yet
          </p>
        ) : (
          <div className="space-y-0.5">{recent.map(renderRow)}</div>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between px-2.5">
          <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
            Group conversations
          </span>
          <button
            type="button"
            onClick={onStartGroupModal}
            className="text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors whitespace-nowrap shrink-0"
          >
            + New group
          </button>
        </div>
        {groupConvs.length === 0 ? (
          <p className="px-2.5 py-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            Collaborate with multiple AIs
          </p>
        ) : (
          <div className="space-y-0.5">{groupConvs.map(renderRow)}</div>
        )}
      </div>
    </div>
  );
};

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeScreen: PrimaryScreen;
  onSelectScreen: (screen: PrimaryScreen) => void;
  onNewChat: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  conversations: ConversationThread[];
  groups: GroupSession[];
  activeConversationId: string | null;
  onSelectConversation: (convId: string) => void;
  onTogglePin: (convId: string) => void;
  onRenameConversation: (convId: string, title: string) => void;
  onDeleteConversation: (convId: string) => void;
  onStartGroupModal: () => void;
  identities: PublicAIIdentity[];
  activeIdentity: PublicAIIdentity;
  onSwitchIdentity: (aiId: string) => void;
  pendingRequestsCount: number;
  gatewayStatus: GatewayStatusInfo;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  activeScreen,
  onSelectScreen,
  onNewChat,
  searchQuery,
  onSearchChange,
  conversations,
  groups,
  activeConversationId,
  onSelectConversation,
  onTogglePin,
  onRenameConversation,
  onDeleteConversation,
  onStartGroupModal,
  identities,
  activeIdentity,
  onSwitchIdentity,
  pendingRequestsCount,
  gatewayStatus,
}) => {
  const [identityMenuOpen, setIdentityMenuOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!identityMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        switcherRef.current &&
        !switcherRef.current.contains(e.target as Node)
      ) {
        setIdentityMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIdentityMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [identityMenuOpen]);

  if (!isOpen) return null;

  const activePresenceState = resolveIdentityPresence(
    activeIdentity,
    gatewayStatus
  );
  const activePresenceMeta = getPresenceBadgeMeta(activePresenceState);
  const activeAvailability = getThreeTierAvailability(
    activeIdentity,
    gatewayStatus
  );

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label="Primary Sidebar Navigation"
        className="fixed inset-y-0 left-0 z-40 w-[268px] lg:static lg:z-auto flex flex-col justify-between bg-[#F4F3EF] dark:bg-[#121215] border-r border-zinc-200/80 dark:border-zinc-800/80 text-zinc-900 dark:text-zinc-100 shrink-0 select-none transition-all"
      >
        {/* Top Section: Brand + Collapse + New Chat + Search */}
        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between px-1.5 pt-0.5">
            <button
              type="button"
              onClick={onNewChat}
              className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 hover:opacity-80 transition-opacity whitespace-nowrap shrink-0"
            >
              <span className="w-6 h-6 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center text-xs font-bold">
                N
              </span>
              <span>AI Nexus</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Collapse sidebar"
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* 1. New Chat Button */}
          <button
            type="button"
            data-testid="new-chat-btn"
            onClick={onNewChat}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/90 border border-zinc-200/90 dark:border-zinc-800 text-sm font-medium text-zinc-900 dark:text-zinc-100 shadow-2xs transition-colors whitespace-nowrap"
          >
            <span className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
              <span>New chat</span>
            </span>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
              ⌘K
            </span>
          </button>

          {/* 2. Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              data-testid="sidebar-search-input"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-zinc-200/50 dark:bg-zinc-900/60 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Scrollable Middle: Pinned, Recent, Group Conversations */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <ConversationList
            conversations={conversations}
            groups={groups}
            activeConversationId={activeConversationId}
            activeScreen={activeScreen}
            onSelectConversation={onSelectConversation}
            onTogglePin={onTogglePin}
            onRenameConversation={onRenameConversation}
            onDeleteConversation={onDeleteConversation}
            onStartGroupModal={onStartGroupModal}
          />
        </div>

        {/* Bottom Section: Network, Memory, Settings & Compact Active Personal AI Selector */}
        <div className="p-3 border-t border-zinc-200/80 dark:border-zinc-800/80 space-y-2">
          <nav aria-label="Workspace Destinations" className="space-y-0.5">
            <button
              type="button"
              data-testid="nav-network-btn"
              onClick={() => onSelectScreen('network')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] transition-colors whitespace-nowrap ${
                activeScreen === 'network'
                  ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                <span>Network</span>
              </span>
              <span className="flex items-center gap-1.5">
                {pendingRequestsCount > 0 && (
                  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 tabular-nums">
                    {pendingRequestsCount} pending
                  </span>
                )}
              </span>
            </button>

            <button
              type="button"
              data-testid="nav-memory-btn"
              onClick={() => onSelectScreen('memory')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] transition-colors whitespace-nowrap ${
                activeScreen === 'memory'
                  ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Brain className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                <span>Memory</span>
              </span>
            </button>

            <button
              type="button"
              data-testid="nav-settings-btn"
              onClick={() => onSelectScreen('settings')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] transition-colors whitespace-nowrap ${
                activeScreen === 'settings'
                  ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Settings className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                <span>Settings</span>
              </span>
            </button>
          </nav>

          {/* Compact Active Personal AI Selector & Profile Bar */}
          <div ref={switcherRef} className="relative pt-1">
            <button
              type="button"
              data-testid="ai-switcher-trigger"
              onClick={() => setIdentityMenuOpen((prev) => !prev)}
              aria-expanded={identityMenuOpen}
              aria-label="Switch Active Personal AI Identity"
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-white/85 dark:bg-zinc-900/85 hover:bg-white dark:hover:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative w-7 h-7 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center text-xs font-semibold shrink-0">
                  {activeIdentity.displayName.slice(0, 1)}
                  <span
                    title={activePresenceMeta.description}
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 ${activePresenceMeta.dotClass}`}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {activeIdentity.displayName}
                    </span>
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
                      {activeIdentity.handle}
                    </span>
                  </div>
                  <div
                    className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate"
                    title={`Owner: ${activeIdentity.ownerDisplayName} · ${activeAvailability.compactSummary}`}
                  >
                    {activeAvailability.localStatusLabel} ·{' '}
                    <span className={activePresenceMeta.textClass}>
                      {activeAvailability.remoteStatusLabel}
                    </span>
                  </div>
                </div>
              </div>
              <ChevronUp
                className={`w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform ${
                  identityMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {identityMenuOpen && (
              <div className="absolute bottom-14 left-0 right-0 z-50 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-1.5 space-y-1">
                <div className="px-2.5 py-1 flex items-center justify-between text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  <span>Switch Personal AI</span>
                  <span>
                    {gatewayStatus.reconnecting
                      ? 'Gateway reconnecting…'
                      : gatewayStatus.connected
                      ? 'Gateway online'
                      : 'Gateway offline'}
                  </span>
                </div>
                {identities.map((id) => {
                  const selected = id.aiId === activeIdentity.aiId;
                  const state = resolveIdentityPresence(id, gatewayStatus);
                  const meta = getPresenceBadgeMeta(state);
                  return (
                    <button
                      key={id.aiId}
                      type="button"
                      data-testid={`ai-switcher-option-${id.aiId}`}
                      onClick={() => {
                        onSwitchIdentity(id.aiId);
                        setIdentityMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${
                        selected
                          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="min-w-0 text-left">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`}
                          />
                          <span className="truncate">{id.displayName}</span>
                          <span className="text-zinc-400 dark:text-zinc-500 shrink-0">
                            {id.handle}
                          </span>
                        </div>
                        <div className="pl-4 text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                          Local AI ready · {id.ownerDisplayName}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] font-medium ${meta.textClass}`}>
                          {meta.shortLabel}
                        </span>
                        {selected && (
                          <Check className="w-3.5 h-3.5 text-zinc-900 dark:text-zinc-100" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
