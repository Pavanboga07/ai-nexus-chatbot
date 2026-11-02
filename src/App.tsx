import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';
import {
  AuditEventRecord,
  ExecutionMode,
  GroupSession,
  InvocationRecord,
  MemoryEntry,
  MemoryShareGrant,
  PermissionRule,
  PublicAIIdentity,
} from './protocol';
import {
  ChatAttachment,
  ChatMessage as ChatMessageModel,
  ConversationThread,
} from './chatbot/engine';
import {
  chatbotApiClient,
  GatewayStatusInfo,
  ProviderStatusInfo,
} from './services/chatbotApiClient';
import { PrimaryScreen, Sidebar } from './components/Sidebar';
import { ChatHeader } from './components/ChatHeader';
import { EmptyState, InvocationStatus } from './components/EmptyState';
import { ChatMessage } from './components/ChatMessage';
import { Composer } from './components/Composer';
import { NetworkPermissionsView } from './components/NetworkPermissionsView';
import { MemoryVaultView } from './components/MemoryVaultView';
import { SettingsModal } from './components/SettingsModal';

export function App() {
  const [activeScreen, setActiveScreen] = useState<PrimaryScreen>('chat');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [darkMode, setDarkMode] = useState<boolean>(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Core Platform State
  const [activeAiId, setActiveAiId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.sessionStorage.getItem('nexus_active_ai_id') || 'ai_alice';
    }
    return 'ai_alice';
  });
  const [identities, setIdentities] = useState<PublicAIIdentity[]>([]);
  const [conversations, setConversations] = useState<ConversationThread[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [groups, setGroups] = useState<GroupSession[]>([]);
  const [permissionsByOwner, setPermissionsByOwner] = useState<
    Record<string, PermissionRule[]>
  >({});
  const [memoriesByOwner, setMemoriesByOwner] = useState<
    Record<string, MemoryEntry[]>
  >({});
  const [memoryGrants, setMemoryGrants] = useState<MemoryShareGrant[]>([]);
  const [invocations, setInvocations] = useState<InvocationRecord[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<InvocationRecord[]>(
    []
  );
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusInfo[]>(
    []
  );
  const [isReconnectingGateway, setIsReconnectingGateway] =
    useState<boolean>(false);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusInfo>({
    connected: true,
    reconnecting: false,
    state: 'ONLINE',
    httpUrl: import.meta.env.VITE_GATEWAY_HTTP_URL || 'http://localhost:4000',
    wsUrl:
      import.meta.env.VITE_GATEWAY_WS_URL || 'ws://localhost:4000/ws/node',
    error: null,
  });

  // Chat & Composer State
  const [sidebarSearch, setSidebarSearch] = useState<string>('');
  const [composerText, setComposerText] = useState<string>('');
  const [autonomousFollowUp, setAutonomousFollowUp] = useState<boolean>(true);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [statusActivityText, setStatusActivityText] = useState<string | null>(
    null
  );
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Streaming & Abort Refs
  const isSendingRef = useRef<boolean>(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const restoredAiSettingsRef = useRef<string | null>(null);

  // New Group Conversation Modal State
  const [groupModalOpen, setGroupModalOpen] = useState<boolean>(false);
  const [newGroupTitle, setNewGroupTitle] = useState<string>(
    'Product & Architecture Sync'
  );
  const [selectedGroupPeers, setSelectedGroupPeers] = useState<string[]>([
    'ai_bob',
    'ai_charlie',
  ]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Sync Dark Mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const fetchBootstrap = async (
    aiIdToLoad: string = activeAiId,
    options?: { reconnect?: boolean; preserveStreaming?: boolean }
  ) => {
    try {
      const data = await chatbotApiClient.fetchBootstrap(aiIdToLoad, options);
      setIdentities(data.identities ?? []);
      if (!options?.preserveStreaming || !isSendingRef.current) {
        setConversations(data.conversations ?? []);
      }
      setGroups(data.groups ?? []);
      setPermissionsByOwner(data.permissions ?? {});
      setMemoriesByOwner(data.memories ?? {});
      setMemoryGrants(data.memoryGrants ?? []);
      setInvocations(data.invocations ?? []);
      setPendingApprovals(data.pendingApprovals ?? []);
      setAuditEvents(data.auditEvents ?? []);
      if (data.providerStatus) {
        setProviderStatus(data.providerStatus);
      }

      // Restore user settings & active conversation on initial load or identity switch
      if (
        data.settings &&
        restoredAiSettingsRef.current !== aiIdToLoad &&
        !isSendingRef.current
      ) {
        restoredAiSettingsRef.current = aiIdToLoad;
        if (typeof data.settings.darkMode === 'string') {
          setDarkMode(data.settings.darkMode === 'true');
        }
        if (typeof data.settings.autonomousFollowUp === 'string') {
          setAutonomousFollowUp(data.settings.autonomousFollowUp !== 'false');
        }
        const savedConvId = data.settings.activeConversationId;
        if (
          savedConvId &&
          (data.conversations ?? []).some((c) => c.id === savedConvId)
        ) {
          setActiveConversationId(savedConvId);
        }
      }

      if (data.gatewayStatus) {
        const connected = Boolean(data.gatewayStatus.connected);
        setGatewayStatus({
          connected,
          reconnecting: false,
          state: connected ? 'ONLINE' : 'UNAVAILABLE',
          httpUrl:
            data.gatewayStatus.httpUrl ||
            import.meta.env.VITE_GATEWAY_HTTP_URL ||
            'http://localhost:4000',
          wsUrl:
            data.gatewayStatus.wsUrl ||
            import.meta.env.VITE_GATEWAY_WS_URL ||
            'ws://localhost:4000/ws/node',
          error: data.gatewayStatus.error ?? null,
        });
      }
    } catch (err) {
      console.error('[App] fetchBootstrap error:', err);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('nexus_active_ai_id', activeAiId);
    }
    fetchBootstrap(activeAiId);
  }, [activeAiId]);

  // Poll Gateway connectivity in the background (skip overwriting conversations while streaming)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isReconnectingGateway && !isSendingRef.current) {
        fetchBootstrap(activeAiId, { preserveStreaming: true });
      }
    }, 3500);
    return () => clearInterval(interval);
  }, [activeAiId, isReconnectingGateway]);

  const handleSelectConversation = (convId: string | null) => {
    setActiveConversationId(convId);
    chatbotApiClient
      .updateSettings(activeAiId, {
        activeConversationId: convId ?? '',
      })
      .catch(() => {});
  };

  const handleToggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      chatbotApiClient
        .updateSettings(activeAiId, { darkMode: String(next) })
        .catch(() => {});
      return next;
    });
  };

  const handleToggleAutonomousFollowUp = (enabled: boolean) => {
    setAutonomousFollowUp(enabled);
    chatbotApiClient
      .updateSettings(activeAiId, { autonomousFollowUp: String(enabled) })
      .catch(() => {});
  };

  const handleReconnectGateway = async () => {
    setIsReconnectingGateway(true);
    setGatewayStatus((prev) => ({
      ...prev,
      reconnecting: true,
      state: 'CONNECTING',
    }));
    try {
      await new Promise((r) => setTimeout(r, 900));
      await fetchBootstrap(activeAiId, { reconnect: true });
    } finally {
      setIsReconnectingGateway(false);
    }
  };

  const effectiveGatewayStatus: GatewayStatusInfo = isReconnectingGateway
    ? { ...gatewayStatus, reconnecting: true, state: 'CONNECTING' }
    : gatewayStatus;

  const activeIdentity: PublicAIIdentity =
    identities.find((i) => i.aiId === activeAiId) ??
    identities[0] ?? {
      aiId: 'ai_alice',
      handle: '@alice',
      displayName: 'Alice AI',
      ownerId: 'owner_alice',
      ownerDisplayName: 'Alice Vance',
      nodeId: 'node_alice_local_mac01',
      deviceId: 'dev_alice_mbp16',
      publicKeyPem: '',
      keyFingerprint: 'ed25519:a11ce98f4d20b7e1c9034f82',
      registrationState: 'REGISTERED',
      verificationState: 'VERIFIED',
      executionMode: ExecutionMode.LOCAL,
      online: effectiveGatewayStatus.connected,
      presenceState: effectiveGatewayStatus.reconnecting
        ? 'CONNECTING'
        : effectiveGatewayStatus.connected
        ? 'ONLINE'
        : 'UNAVAILABLE',
      localRuntimeAvailable: true,
      killSwitchActive: false,
      supportedProtocolVersions: ['1.0'],
      configuredProvider: 'gemini',
      configuredModel: 'gemini-3.8-flash',
      createdAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    };

  const currentProviderInfo = providerStatus.find(
    (p) => p.provider === activeIdentity.configuredProvider
  );
  const isCurrentProviderUnconfigured =
    currentProviderInfo && !currentProviderInfo.configured;

  const activeConversation = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId) ?? null
    : null;

  const activeGroup =
    activeConversation?.isGroup && activeConversation.groupId
      ? groups.find((g) => g.groupId === activeConversation.groupId) ?? null
      : null;

  const filteredConversations = conversations.filter((c) =>
    sidebarSearch.trim() === ''
      ? true
      : c.title.toLowerCase().includes(sidebarSearch.toLowerCase()) ||
        c.messages.some((m) =>
          m.content.toLowerCase().includes(sidebarSearch.toLowerCase())
        )
  );

  const closeMobileSidebarIfNeeded = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const handleStartNewChat = () => {
    setActiveScreen('chat');
    handleSelectConversation(null);
    setComposerText('');
    closeMobileSidebarIfNeeded();
  };

  const upsertConversationInState = (updatedConv: ConversationThread) => {
    setConversations((prev) => {
      const exists = prev.some((c) => c.id === updatedConv.id);
      if (!exists) return [updatedConv, ...prev];
      return prev.map((c) => (c.id === updatedConv.id ? updatedConv : c));
    });
  };

  const handleStopGeneration = async () => {
    const msgId = streamingMessageIdRef.current;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    if (msgId) {
      try {
        await chatbotApiClient.stopMessageGeneration(msgId);
      } catch {
        // ignore
      }
      streamingMessageIdRef.current = null;
    }
    isSendingRef.current = false;
    setIsSending(false);
    setStatusActivityText(null);
    await fetchBootstrap(activeAiId);
  };

  const handleSendMessage = async (overrideContent?: string) => {
    const textToSend = (overrideContent ?? composerText).trim();
    if (!textToSend || isSendingRef.current) return;

    if (!overrideContent) {
      setComposerText('');
    }
    isSendingRef.current = true;
    setIsSending(true);
    setActiveScreen('chat');

    // Determine natural human-readable activity status
    let stepTimer: NodeJS.Timeout | null = null;
    const remoteMatch = textToSend.match(
      /(?:\/ask\s+@?(bob|charlie|alice)|(?:ask|contact|check with|ping)\s+@?(bob|charlie|alice))/i
    );

    if (remoteMatch) {
      const targetRaw = (remoteMatch[1] || remoteMatch[2] || 'Bob').toLowerCase();
      const targetName =
        targetRaw.charAt(0).toUpperCase() + targetRaw.slice(1);
      setStatusActivityText(`Contacting ${targetName}'s AI via Gateway…`);
      stepTimer = setTimeout(() => {
        setStatusActivityText(
          `${targetName}'s AI is checking the information it is allowed to share…`
        );
      }, 450);
    } else if (
      textToSend.startsWith('/ask-all') ||
      activeConversation?.isGroup
    ) {
      setStatusActivityText(
        'Coordinating with participant AIs in the group…'
      );
    } else {
      setStatusActivityText(`${activeIdentity.displayName} is thinking…`);
    }

    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      let targetConvId = activeConversation?.id;
      if (!targetConvId) {
        const cleanTitle = textToSend
          .replace(/^\/ask\s+/i, 'Ask ')
          .slice(0, 44);
        const created = await chatbotApiClient.createConversation(
          activeAiId,
          cleanTitle
        );
        targetConvId = created.id;
        upsertConversationInState(created);
        handleSelectConversation(created.id);
      }

      const attachmentsToSend = [...attachments];
      setAttachments([]);

      await chatbotApiClient.streamMessage(
        {
          conversationId: targetConvId,
          senderAiId: activeAiId,
          content: textToSend,
          enableAutonomousFollowUp: autonomousFollowUp,
          attachments: attachmentsToSend,
        },
        {
          onInit: ({ conversation, assistantMessage }) => {
            if (assistantMessage?.id) {
              streamingMessageIdRef.current = assistantMessage.id;
            }
            if (conversation) {
              upsertConversationInState(conversation);
              handleSelectConversation(conversation.id);
            }
          },
          onChunk: ({ messageId, accumulated }) => {
            setStatusActivityText(null);
            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== targetConvId) return c;
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          content: accumulated,
                          status: 'STREAMING',
                        }
                      : m
                  ),
                };
              })
            );
          },
          onDone: ({ conversation }) => {
            streamingMessageIdRef.current = null;
            if (conversation) {
              upsertConversationInState(conversation);
            }
          },
          onAborted: ({ conversation }) => {
            streamingMessageIdRef.current = null;
            if (conversation) {
              upsertConversationInState(conversation);
            }
          },
          onError: ({ conversation }) => {
            streamingMessageIdRef.current = null;
            if (conversation) {
              upsertConversationInState(conversation);
            }
          },
        },
        abortController.signal
      );

      await fetchBootstrap(activeAiId);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[App] streamMessage error:', err);
      }
      await fetchBootstrap(activeAiId);
    } finally {
      if (stepTimer) clearTimeout(stepTimer);
      streamAbortRef.current = null;
      streamingMessageIdRef.current = null;
      isSendingRef.current = false;
      setIsSending(false);
      setStatusActivityText(null);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    }
  };

  const handleRetryMessage = async (msg: ChatMessageModel) => {
    if (!activeConversation || isSendingRef.current) return;
    isSendingRef.current = true;
    setIsSending(true);
    setStatusActivityText(`${activeIdentity.displayName} is retrying response…`);
    try {
      const data = await chatbotApiClient.retryMessage(
        activeConversation.id,
        msg.id
      );
      if (data?.conversation) {
        upsertConversationInState(data.conversation);
      }
      await fetchBootstrap(activeAiId);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
      setStatusActivityText(null);
    }
  };

  const handleDeleteMessage = async (msg: ChatMessageModel) => {
    if (!activeConversation) return;
    const res = await chatbotApiClient.deleteMessage(
      activeConversation.id,
      msg.id
    );
    if (res?.conversation) {
      upsertConversationInState(res.conversation);
    } else {
      await fetchBootstrap(activeAiId);
    }
  };

  const handleCreateGroupSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupTitle.trim()) return;
    const participantAiIds = Array.from(
      new Set([activeAiId, ...selectedGroupPeers])
    );
    const { conversation } = await chatbotApiClient.createGroup({
      title: newGroupTitle.trim(),
      createdByAiId: activeAiId,
      participantAiIds,
    });
    setGroupModalOpen(false);
    await fetchBootstrap(activeAiId);
    setActiveScreen('chat');
    handleSelectConversation(conversation.id);
    closeMobileSidebarIfNeeded();
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#FAF9F6] dark:bg-[#0A0A0B] text-zinc-900 dark:text-zinc-100">
      {/* Left Collapsible Conversational Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeScreen={activeScreen}
        onSelectScreen={(screen) => {
          setActiveScreen(screen);
          closeMobileSidebarIfNeeded();
        }}
        onNewChat={handleStartNewChat}
        searchQuery={sidebarSearch}
        onSearchChange={setSidebarSearch}
        conversations={filteredConversations}
        groups={groups}
        activeConversationId={activeConversationId}
        onSelectConversation={(convId) => {
          handleSelectConversation(convId);
          setActiveScreen('chat');
          closeMobileSidebarIfNeeded();
        }}
        onTogglePin={async (convId) => {
          await chatbotApiClient.updateConversation(convId, {
            togglePin: true,
          });
          await fetchBootstrap(activeAiId);
        }}
        onRenameConversation={async (convId, title) => {
          await chatbotApiClient.updateConversation(convId, { title });
          await fetchBootstrap(activeAiId);
        }}
        onDeleteConversation={async (convId) => {
          await chatbotApiClient.deleteConversation(convId);
          if (activeConversationId === convId) {
            handleSelectConversation(null);
          }
          await fetchBootstrap(activeAiId);
        }}
        onStartGroupModal={() => setGroupModalOpen(true)}
        identities={identities}
        activeIdentity={activeIdentity}
        onSwitchIdentity={(aiId) => {
          restoredAiSettingsRef.current = null;
          setActiveAiId(aiId);
        }}
        pendingRequestsCount={pendingApprovals.length}
        gatewayStatus={effectiveGatewayStatus}
      />

      {/* Right Primary Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <ChatHeader
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          activeIdentity={activeIdentity}
          activeConversation={
            activeScreen === 'chat' ? activeConversation : null
          }
          activeGroup={activeScreen === 'chat' ? activeGroup : null}
          allIdentities={identities}
          gatewayStatus={effectiveGatewayStatus}
          darkMode={darkMode}
          onToggleDarkMode={handleToggleDarkMode}
          onOpenSettings={() => setActiveScreen('settings')}
          onNewChat={handleStartNewChat}
          onInviteGroupParticipant={async (groupId, aiId) => {
            await chatbotApiClient.inviteGroupParticipant(groupId, aiId);
            await fetchBootstrap(activeAiId);
          }}
          onRemoveGroupParticipant={async (groupId, aiId) => {
            await chatbotApiClient.removeGroupParticipant(groupId, aiId);
            await fetchBootstrap(activeAiId);
          }}
          onEndGroup={async (groupId) => {
            await chatbotApiClient.endGroup(groupId);
            await fetchBootstrap(activeAiId);
          }}
        />

        {/* Unconfigured LLM Provider Notice */}
        {isCurrentProviderUnconfigured && (
          <div
            role="status"
            aria-live="polite"
            data-testid="provider-unconfigured-banner"
            className="px-4 sm:px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-4 shrink-0"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>
                <strong>{currentProviderInfo?.label} not configured:</strong>{' '}
                {currentProviderInfo?.statusMessage} Switch to a configured model or set the environment variable on the server.
              </span>
            </span>
            <button
              type="button"
              onClick={async () => {
                await chatbotApiClient.updateModel(
                  activeIdentity.aiId,
                  'gemini',
                  'gemini-3.8-flash'
                );
                await fetchBootstrap(activeAiId);
              }}
              className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 font-medium shrink-0 transition-colors"
            >
              Use Gemini 3.8 Flash
            </button>
          </div>
        )}

        {/* Gateway Reconnecting Notice */}
        {effectiveGatewayStatus.reconnecting && (
          <div
            role="status"
            aria-live="polite"
            data-testid="gateway-reconnecting-banner"
            className="px-4 sm:px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-4 shrink-0"
          >
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>
                <strong>Gateway reconnecting:</strong> Establishing authenticated WebSocket transport to AI Nexus Gateway ({effectiveGatewayStatus.wsUrl})…
              </span>
            </span>
            <span className="text-[11px] font-medium shrink-0">
              CONNECTING
            </span>
          </div>
        )}

        {/* Gateway Offline / Unavailable Notice */}
        {!effectiveGatewayStatus.connected &&
          !effectiveGatewayStatus.reconnecting && (
            <div
              role="status"
              aria-live="polite"
              data-testid="gateway-offline-banner"
              className="px-4 sm:px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-4 shrink-0"
            >
              <span>
                <strong>Network Gateway offline:</strong> {activeIdentity.displayName} is available locally, but remote AI-to-AI communication (@bob, @charlie) is unavailable while the Gateway service on port 4000 cannot be reached.
              </span>
              <button
                type="button"
                data-testid="gateway-reconnect-btn"
                onClick={handleReconnectGateway}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 font-medium shrink-0 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reconnect</span>
              </button>
            </div>
          )}

        {/* SCREEN 1: MAIN CHAT EXPERIENCE */}
        {activeScreen === 'chat' && (
          <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="flex-1 overflow-y-auto flex flex-col">
                <EmptyState
                  activeIdentity={activeIdentity}
                  identities={identities}
                  gatewayStatus={effectiveGatewayStatus}
                  onSelectPrompt={(prompt) => handleSendMessage(prompt)}
                  onStartGroupConversation={() => setGroupModalOpen(true)}
                />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
                <div className="max-w-3xl mx-auto space-y-6">
                  {activeConversation.messages.map((msg) => (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      copiedMsgId={copiedMsgId}
                      onCopyMessage={(m) => {
                        navigator.clipboard?.writeText(m.content);
                        setCopiedMsgId(m.id);
                        setTimeout(() => setCopiedMsgId(null), 1500);
                      }}
                      onRegenerateMessage={(m) => handleRetryMessage(m)}
                      onRetryMessage={(m) => handleRetryMessage(m)}
                      onDeleteMessage={(m) => handleDeleteMessage(m)}
                      onEditUserMessage={async (m, newText) => {
                        await chatbotApiClient.updateMessage(
                          activeConversation.id,
                          m.id,
                          { content: newText }
                        );
                        // Find the assistant message immediately following this user message to retry in place, or send new
                        const msgIdx = activeConversation.messages.findIndex(
                          (item) => item.id === m.id
                        );
                        const nextAssistant =
                          msgIdx >= 0
                            ? activeConversation.messages
                                .slice(msgIdx + 1)
                                .find((item) => item.role === 'assistant')
                            : undefined;
                        if (nextAssistant) {
                          await handleRetryMessage(nextAssistant);
                        } else {
                          await handleSendMessage(newText);
                        }
                      }}
                      onFeedbackMessage={async (m, feedback) => {
                        await chatbotApiClient.updateMessage(
                          activeConversation.id,
                          m.id,
                          { feedback }
                        );
                        await fetchBootstrap(activeAiId);
                      }}
                    />
                  ))}

                  {isSending && statusActivityText && (
                    <div className="pt-1">
                      <InvocationStatus statusText={statusActivityText} />
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            )}

            {/* Refined Conversational Composer */}
            <Composer
              value={composerText}
              onChange={setComposerText}
              onSend={() => handleSendMessage()}
              onStopGeneration={handleStopGeneration}
              isSending={isSending}
              activeIdentity={activeIdentity}
              identities={identities}
              gatewayStatus={effectiveGatewayStatus}
              providerStatus={providerStatus}
              attachments={attachments}
              onAddAttachment={(att) =>
                setAttachments((prev) => [
                  ...prev,
                  att ?? {
                    id: `att_${Date.now()}`,
                    name: 'Q4_Launch_Brief.md',
                    type: 'file',
                    sizeLabel: '4 KB',
                    mimeType: 'text/markdown',
                    sizeBytes: 4096,
                    contentExcerpt:
                      'Q4 Launch Brief: Security review freeze is Nov 14, public launch target is Nov 18, and default-deny policy enforcement is active.',
                  },
                ])
              }
              onRemoveAttachment={(id) =>
                setAttachments((prev) => prev.filter((a) => a.id !== id))
              }
              onSelectModel={async (provider, model) => {
                await chatbotApiClient.updateModel(
                  activeIdentity.aiId,
                  provider,
                  model
                );
                await fetchBootstrap(activeAiId);
              }}
            />
          </main>
        )}

        {/* SCREEN 2: NETWORK EXPERIENCE */}
        {activeScreen === 'network' && (
          <main className="flex-1 overflow-y-auto">
            <NetworkPermissionsView
              identities={identities}
              activeAiId={activeAiId}
              gatewayStatus={effectiveGatewayStatus}
              permissionsByOwner={permissionsByOwner}
              pendingApprovals={pendingApprovals}
              invocations={invocations}
              onToggleNodeOnline={async (aiId, online, mode) => {
                await chatbotApiClient.updateNodePresence(aiId, online, mode);
                await fetchBootstrap(activeAiId);
              }}
              onToggleKillSwitch={async (aiId, active) => {
                await chatbotApiClient.updateNodeKillSwitch(aiId, active);
                await fetchBootstrap(activeAiId);
              }}
              onRotateKey={async (aiId) => {
                await chatbotApiClient.rotateNodeKey(aiId);
                await fetchBootstrap(activeAiId);
              }}
              onVerifyPairing={async (aiId, nodeId) => {
                const res = await chatbotApiClient.verifyNodePairing(
                  aiId,
                  nodeId
                );
                await fetchBootstrap(activeAiId);
                return res.verified
                  ? `Verified identity signature (${res.challengeId}).`
                  : `Verification failed: ${res.reason}`;
              }}
              onUpdatePermissionMode={async (ownerAiId, ruleId, mode) => {
                await chatbotApiClient.updatePermissionMode(
                  ownerAiId,
                  ruleId,
                  mode
                );
                await fetchBootstrap(activeAiId);
              }}
              onResolveApproval={async (requestId, approve) => {
                await chatbotApiClient.resolveApproval(requestId, approve);
                await fetchBootstrap(activeAiId);
              }}
              onAskAiInChat={(prompt) => {
                setActiveScreen('chat');
                handleSendMessage(prompt);
              }}
            />
          </main>
        )}

        {/* SCREEN 3: MEMORY EXPERIENCE */}
        {activeScreen === 'memory' && (
          <main className="flex-1 overflow-y-auto">
            <MemoryVaultView
              activeAiId={activeAiId}
              identities={identities}
              memoriesByOwner={memoriesByOwner}
              memoryGrants={memoryGrants}
              onAddMemory={async (params) => {
                await chatbotApiClient.addMemory(params);
                await fetchBootstrap(activeAiId);
              }}
              onUpdateMemory={async (memoryId, updates) => {
                await chatbotApiClient.updateMemory(memoryId, updates);
                await fetchBootstrap(activeAiId);
              }}
              onDeleteMemory={async (memoryId) => {
                await chatbotApiClient.deleteMemory(memoryId);
                await fetchBootstrap(activeAiId);
              }}
              onShareMemory={async (params) => {
                await chatbotApiClient.shareMemory(params);
                await fetchBootstrap(activeAiId);
              }}
              onRevokeGrant={async (grantId, ownerAiId) => {
                const msg = await chatbotApiClient.revokeMemoryGrant(
                  grantId,
                  ownerAiId
                );
                await fetchBootstrap(activeAiId);
                return msg;
              }}
            />
          </main>
        )}

        {/* SCREEN 4: SETTINGS EXPERIENCE */}
        {activeScreen === 'settings' && (
          <main className="flex-1 overflow-y-auto">
            <SettingsModal
              darkMode={darkMode}
              onToggleDarkMode={handleToggleDarkMode}
              activeIdentity={activeIdentity}
              identities={identities}
              onSwitchIdentity={(aiId) => {
                restoredAiSettingsRef.current = null;
                setActiveAiId(aiId);
              }}
              onUpdateModel={async (aiId, provider, model) => {
                await chatbotApiClient.updateModel(aiId, provider, model);
                await fetchBootstrap(activeAiId);
              }}
              onToggleNodeOnline={async (aiId, online, mode) => {
                await chatbotApiClient.updateNodePresence(aiId, online, mode);
                await fetchBootstrap(activeAiId);
              }}
              onToggleKillSwitch={async (aiId, active) => {
                await chatbotApiClient.updateNodeKillSwitch(aiId, active);
                await fetchBootstrap(activeAiId);
              }}
              onRotateKey={async (aiId) => {
                await chatbotApiClient.rotateNodeKey(aiId);
                await fetchBootstrap(activeAiId);
              }}
              autonomousFollowUp={autonomousFollowUp}
              onToggleAutonomousFollowUp={handleToggleAutonomousFollowUp}
              permissionsByOwner={permissionsByOwner}
              invocations={invocations}
              auditEvents={auditEvents}
              gatewayStatus={effectiveGatewayStatus}
              providerStatus={providerStatus}
              onCreateDatabaseBackup={async () => {
                const res = await chatbotApiClient.createDatabaseBackup();
                return res.backupPath;
              }}
            />
          </main>
        )}
      </div>

      {/* Start Group Conversation Modal */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateGroupSession}
            className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Start a group conversation
              </h2>
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Bring multiple Personal AIs into one shared conversation to collaborate on a topic or schedule.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-500 mb-1">
                  Conversation topic
                </label>
                <input
                  type="text"
                  value={newGroupTitle}
                  onChange={(e) => setNewGroupTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-500 mb-1.5">
                  Invite Personal AIs
                </label>
                <div className="space-y-1.5">
                  {identities
                    .filter((i) => i.aiId !== activeAiId)
                    .map((peer) => {
                      const checked = selectedGroupPeers.includes(peer.aiId);
                      return (
                        <label
                          key={peer.aiId}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                        >
                          <div>
                            <div className="font-medium text-zinc-900 dark:text-zinc-100">
                              {peer.displayName} ({peer.handle})
                            </div>
                            <div className="text-[11px] text-zinc-500">
                              Owner: {peer.ownerDisplayName}
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedGroupPeers((prev) => [
                                  ...prev,
                                  peer.aiId,
                                ]);
                              } else {
                                setSelectedGroupPeers((prev) =>
                                  prev.filter((id) => id !== peer.aiId)
                                );
                              }
                            }}
                            className="rounded border-zinc-300"
                          />
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
              >
                Create group chat
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
export default App;
