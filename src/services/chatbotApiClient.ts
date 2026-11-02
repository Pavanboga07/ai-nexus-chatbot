// ============================================================================
// AI Nexus Chatbot — Frontend Service Layer (`src/services/chatbotApiClient.ts`)
// Encapsulates all BFF, SSE streaming, persistence, and Gateway-proxied APIs.
// ============================================================================

import {
  AuditEventRecord,
  ExecutionMode,
  GroupSession,
  InvocationRecord,
  MemoryCategory,
  MemoryEntry,
  MemoryShareGrant,
  PermissionMode,
  PermissionRule,
  PublicAIIdentity,
} from '../protocol';
import { ChatAttachment, ChatMessage, ConversationThread } from '../chatbot/engine';

export interface GatewayStatusInfo {
  connected: boolean;
  reconnecting?: boolean;
  state?: 'ONLINE' | 'CONNECTING' | 'UNAVAILABLE';
  httpUrl: string;
  internalUrl?: string;
  wsUrl: string;
  error?: string | null;
}

export interface ProviderStatusInfo {
  provider: 'gemini' | 'openai';
  label: string;
  configured: boolean;
  defaultModel: string;
  models: Array<{
    provider: 'gemini' | 'openai';
    model: string;
    label: string;
    description: string;
  }>;
  statusMessage: string;
}

export interface BootstrapPayload {
  gatewayStatus: GatewayStatusInfo;
  providerStatus?: ProviderStatusInfo[];
  settings?: Record<string, string>;
  identities: PublicAIIdentity[];
  conversations: ConversationThread[];
  groups: GroupSession[];
  permissions: Record<string, PermissionRule[]>;
  memories: Record<string, MemoryEntry[]>;
  memoryGrants: MemoryShareGrant[];
  invocations: InvocationRecord[];
  pendingApprovals: InvocationRecord[];
  auditEvents: AuditEventRecord[];
}

export interface StreamCallbacks {
  onInit?: (payload: {
    conversation: ConversationThread;
    userMessage: ChatMessage;
    assistantMessage?: ChatMessage;
    mode: 'llm_stream' | 'protocol';
  }) => void;
  onChunk?: (payload: {
    messageId: string;
    delta: string;
    accumulated: string;
  }) => void;
  onDone?: (payload: {
    conversation: ConversationThread;
    message?: ChatMessage;
    messagesAdded?: ChatMessage[];
    gatewayUnavailable?: boolean;
  }) => void;
  onAborted?: (payload: {
    conversation: ConversationThread;
    message?: ChatMessage;
  }) => void;
  onError?: (payload: {
    conversation?: ConversationThread | null;
    message?: ChatMessage;
    code?: string;
    error: string;
    retryable?: boolean;
  }) => void;
}

export const chatbotApiClient = {
  async fetchBootstrap(
    aiId: string,
    options?: { reconnect?: boolean }
  ): Promise<BootstrapPayload> {
    const query = new URLSearchParams({ aiId });
    if (options?.reconnect) {
      query.set('reconnect', '1');
    }
    const res = await fetch(`/api/chatbot/bootstrap?${query.toString()}`);
    if (!res.ok) {
      throw new Error(`Bootstrap request failed with status ${res.status}`);
    }
    return res.json();
  },

  async fetchHealth(): Promise<Record<string, unknown>> {
    const res = await fetch('/health');
    return res.json();
  },

  async createConversation(ownerAiId: string, title: string): Promise<ConversationThread> {
    const res = await fetch('/api/chatbot/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerAiId, title }),
    });
    const data = await res.json();
    return data.conversation;
  },

  async updateConversation(
    convId: string,
    updates: { togglePin?: boolean; title?: string }
  ): Promise<ConversationThread> {
    const res = await fetch(`/api/chatbot/conversations/${encodeURIComponent(convId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    return data.conversation;
  },

  async deleteConversation(convId: string): Promise<void> {
    await fetch(`/api/chatbot/conversations/${encodeURIComponent(convId)}`, {
      method: 'DELETE',
    });
  },

  async sendMessage(params: {
    conversationId: string;
    senderAiId: string;
    content: string;
    enableAutonomousFollowUp: boolean;
    attachments: ChatAttachment[];
  }): Promise<{
    conversation: ConversationThread;
    messagesAdded?: ChatMessage[];
    gatewayUnavailable?: boolean;
    error?: string;
  }> {
    const res = await fetch('/api/chatbot/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  },

  async streamMessage(
    params: {
      conversationId: string;
      senderAiId: string;
      content: string;
      enableAutonomousFollowUp: boolean;
      attachments: ChatAttachment[];
    },
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch('/api/chatbot/messages/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    });

    if (!res.ok || !res.body) {
      let errMsg = `Stream failed with status ${res.status}`;
      try {
        const json = await res.json();
        if (json?.error) errMsg = json.error;
      } catch {
        // ignore
      }
      callbacks.onError?.({ error: errMsg, retryable: true });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          currentEvent = 'message';
          continue;
        }
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          try {
            const payload = JSON.parse(dataStr);
            if (currentEvent === 'init') {
              callbacks.onInit?.(payload);
            } else if (currentEvent === 'chunk') {
              callbacks.onChunk?.(payload);
            } else if (currentEvent === 'done') {
              callbacks.onDone?.(payload);
            } else if (currentEvent === 'aborted') {
              callbacks.onAborted?.(payload);
            } else if (currentEvent === 'error') {
              callbacks.onError?.(payload);
            }
          } catch {
            // ignore malformed frame
          }
        }
      }
    }
  },

  async stopMessageGeneration(messageId: string): Promise<{ stopped: boolean }> {
    const res = await fetch(
      `/api/chatbot/messages/${encodeURIComponent(messageId)}/stop`,
      {
        method: 'POST',
      }
    );
    return res.json();
  },

  async retryMessage(
    convId: string,
    msgId: string
  ): Promise<{
    message: ChatMessage;
    conversation: ConversationThread;
    error?: string;
    code?: string;
  }> {
    const res = await fetch(
      `/api/chatbot/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(
        msgId
      )}/retry`,
      {
        method: 'POST',
      }
    );
    return res.json();
  },

  async updateMessage(
    convId: string,
    msgId: string,
    updates: { content?: string; feedback?: 'up' | 'down' | null }
  ): Promise<{ message: ChatMessage; conversation: ConversationThread }> {
    const res = await fetch(
      `/api/chatbot/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(
        msgId
      )}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }
    );
    return res.json();
  },

  async deleteMessage(
    convId: string,
    msgId: string
  ): Promise<{ deleted: boolean; conversation?: ConversationThread }> {
    const res = await fetch(
      `/api/chatbot/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(
        msgId
      )}`,
      {
        method: 'DELETE',
      }
    );
    return res.json();
  },

  async updateSettings(
    ownerAiId: string,
    settings: Record<string, string | boolean | number>
  ): Promise<{ settings: Record<string, string> }> {
    const res = await fetch(
      `/api/chatbot/settings/${encodeURIComponent(ownerAiId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      }
    );
    return res.json();
  },

  async createDatabaseBackup(): Promise<{
    backupCreated: boolean;
    backupPath: string;
    createdAt: string;
  }> {
    const res = await fetch('/api/chatbot/database/backup', {
      method: 'POST',
    });
    return res.json();
  },

  async updateNodePresence(
    aiId: string,
    online: boolean,
    executionMode?: ExecutionMode
  ): Promise<void> {
    await fetch(`/api/chatbot/nodes/${encodeURIComponent(aiId)}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ online, executionMode }),
    });
  },

  async updateNodeKillSwitch(aiId: string, active: boolean): Promise<void> {
    await fetch(`/api/chatbot/nodes/${encodeURIComponent(aiId)}/kill-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
  },

  async rotateNodeKey(aiId: string): Promise<void> {
    await fetch(`/api/chatbot/nodes/${encodeURIComponent(aiId)}/rotate-key`, {
      method: 'POST',
    });
  },

  async verifyNodePairing(
    aiId: string,
    nodeId: string
  ): Promise<{ verified: boolean; challengeId?: string; reason?: string }> {
    const res = await fetch(
      `/api/chatbot/nodes/${encodeURIComponent(aiId)}/verify-pairing`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      }
    );
    if (!res.ok) {
      return { verified: false, reason: 'Gateway unreachable' };
    }
    return res.json();
  },

  async updatePermissionMode(
    ownerAiId: string,
    ruleId: string,
    mode: PermissionMode
  ): Promise<void> {
    await fetch(
      `/api/chatbot/permissions/${encodeURIComponent(ownerAiId)}/${encodeURIComponent(
        ruleId
      )}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      }
    );
  },

  async resolveApproval(requestId: string, approve: boolean): Promise<void> {
    await fetch(`/api/chatbot/approvals/${encodeURIComponent(requestId)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve }),
    });
  },

  async addMemory(params: {
    ownerAiId: string;
    category: MemoryCategory;
    title: string;
    content: string;
    tags: string[];
  }): Promise<MemoryEntry> {
    const res = await fetch('/api/chatbot/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    return data.memory;
  },

  async updateMemory(
    memoryId: string,
    updates: {
      title?: string;
      content?: string;
      category?: MemoryCategory;
      tags?: string[];
    }
  ): Promise<MemoryEntry> {
    const res = await fetch(`/api/chatbot/memories/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    return data.memory;
  },

  async deleteMemory(memoryId: string): Promise<void> {
    await fetch(`/api/chatbot/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
    });
  },

  async shareMemory(params: {
    memoryId: string;
    ownerAiId: string;
    recipientAiId: string;
    ttlHours: number;
  }): Promise<void> {
    await fetch('/api/chatbot/memories/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  },

  async revokeMemoryGrant(grantId: string, ownerAiId: string): Promise<string> {
    const res = await fetch(
      `/api/chatbot/memories/grants/${encodeURIComponent(grantId)}/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerAiId }),
      }
    );
    const data = await res.json();
    return data.limitationDisclosure ?? 'Access grant revoked.';
  },

  async updateModel(aiId: string, provider: string, model: string): Promise<void> {
    await fetch(`/api/chatbot/identities/${encodeURIComponent(aiId)}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model }),
    });
  },

  async createGroup(params: {
    title: string;
    createdByAiId: string;
    participantAiIds: string[];
  }): Promise<{ group: GroupSession; conversation: ConversationThread }> {
    const res = await fetch('/api/chatbot/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  },

  async inviteGroupParticipant(groupId: string, aiId: string): Promise<void> {
    await fetch(
      `/api/chatbot/groups/${encodeURIComponent(groupId)}/participants`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiId }),
      }
    );
  },

  async removeGroupParticipant(groupId: string, aiId: string): Promise<void> {
    await fetch(
      `/api/chatbot/groups/${encodeURIComponent(
        groupId
      )}/participants/${encodeURIComponent(aiId)}`,
      {
        method: 'DELETE',
      }
    );
  },

  async endGroup(groupId: string): Promise<void> {
    await fetch(`/api/chatbot/groups/${encodeURIComponent(groupId)}/end`, {
      method: 'POST',
    });
  },
};
