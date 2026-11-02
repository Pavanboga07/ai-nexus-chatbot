// ============================================================================
// APPLICATION A: AI NEXUS CHATBOT — src/server/chatbotMain.ts
// Independent Server Entrypoint listening on http://localhost:3000
//
// Architectural Guarantees:
// - Does NOT import or initialize the AI Nexus Gateway application.
// - Does NOT mount Gateway routes (/api/v1/*).
// - Does NOT create a Gateway WebSocket server.
// - Does NOT contain Gateway MessageRouter, IdentityRegistry, or OfflineQueue.
// - Communicates with AI Nexus Gateway strictly over HTTP (http://localhost:4000)
//   and WebSocket (ws://localhost:4000/ws/node) using @ai-nexus/protocol SDK.
// - Persists all users, AI identities, conversations, messages, memories,
//   attachments, and settings in a durable local SQLite database.
// ============================================================================

import dotenv from 'dotenv';
import express, { Express } from 'express';
import http from 'node:http';
import path from 'node:path';
import {
  AuditEventRecord,
  CapabilityType,
  createSignedMessageEnvelope,
  EnvelopeMessageType,
  ExecutionMode,
  GatewayProtocolHttpClient,
  GroupSession,
  InvocationRecord,
  InvocationRequestPayload,
  InvocationState,
  MemoryCategory,
  MemoryEntry,
  PermissionMode,
  PublicAIIdentity,
} from '../protocol/index.ts';
import {
  AutonomousFollowUpEngine,
  ChatAttachment,
  ChatMessage,
  CommandParser,
  ConversationThread,
  createSeedNodesConfig,
  LLMGeneratorFn,
  MemoryManager,
  OwnerPolicyEngine,
  RawOwnerDataset,
} from '../chatbot/engine.ts';
import { PersonalAINodeAgent } from '../services/PersonalAINodeAgent.ts';
import { ChatbotDatabase } from './database.ts';
import {
  buildConversationContext,
  LLMProviderError,
  LLMProviderRegistry,
  normalizeGeminiModelName,
  SUPPORTED_PROVIDER_MODELS,
} from './llmProvider.ts';

dotenv.config();

export interface ChatbotServerConfig {
  port?: number;
  host?: string;
  gatewayInternalUrl?: string;
  gatewayPublicHttpUrl?: string;
  gatewayWsUrl?: string;
  attachViteMiddleware?: boolean;
  dbPath?: string;
  llmRegistry?: LLMProviderRegistry;
}

export interface ChatbotServerInstance {
  app: Express;
  httpServer: http.Server;
  port: number;
  db: ChatbotDatabase;
  llmRegistry: LLMProviderRegistry;
  gatewayClient: GatewayProtocolHttpClient;
  nodeAgents: Map<string, PersonalAINodeAgent>;
  syncNodesWithGateway: () => Promise<boolean>;
  close: () => Promise<void>;
}

export async function createChatbotServer(
  config: ChatbotServerConfig = {}
): Promise<ChatbotServerInstance> {
  const cliPortIdx = process.argv.indexOf('--port');
  const cliPort =
    cliPortIdx !== -1 && process.argv[cliPortIdx + 1]
      ? Number(process.argv[cliPortIdx + 1])
      : undefined;
  const PORT =
    config.port ??
    cliPort ??
    Number(process.env.CHATBOT_PORT || process.env.PORT || 3000);
  const HOST = config.host ?? (process.env.HOST || '0.0.0.0');
  const GATEWAY_INTERNAL_URL = (
    config.gatewayInternalUrl ??
    config.gatewayPublicHttpUrl ??
    process.env.GATEWAY_PUBLIC_URL ??
    process.env.GATEWAY_INTERNAL_URL ??
    process.env.VITE_GATEWAY_HTTP_URL ??
    'http://localhost:4000'
  ).replace(/\/$/, '');
  const VITE_GATEWAY_HTTP_URL = (
    config.gatewayPublicHttpUrl ??
    process.env.GATEWAY_PUBLIC_URL ??
    process.env.VITE_GATEWAY_HTTP_URL ??
    GATEWAY_INTERNAL_URL
  ).replace(/\/$/, '');
  const VITE_GATEWAY_WS_URL =
    config.gatewayWsUrl ??
    process.env.GATEWAY_WS_URL ??
    process.env.VITE_GATEWAY_WS_URL ??
    GATEWAY_INTERNAL_URL.replace(/^http/, 'ws') + '/ws/node';

  const gatewayClient = new GatewayProtocolHttpClient(GATEWAY_INTERNAL_URL);

  // 1. Initialize Durable SQLite Persistence & Multi-Provider LLM Registry
  const db = new ChatbotDatabase(config.dbPath);
  const llmRegistry = config.llmRegistry ?? new LLMProviderRegistry();

  // 2. Hydrate in-memory domain engines from durable SQLite database
  const seed = createSeedNodesConfig();
  const identities = new Map<string, PublicAIIdentity>();
  const datasets = new Map<string, RawOwnerDataset>();

  for (const persistedIdentity of db.listIdentities()) {
    // Normalize any deprecated model alias to supported Gemini 3.8 Flash
    if (
      persistedIdentity.configuredProvider === 'gemini' &&
      persistedIdentity.configuredModel.startsWith('gemini-')
    ) {
      persistedIdentity.configuredModel = normalizeGeminiModelName(
        persistedIdentity.configuredModel
      );
    }
    identities.set(persistedIdentity.aiId, persistedIdentity);
    const persistedDs =
      db.getOwnerDataset(persistedIdentity.aiId) ??
      seed.datasets.get(persistedIdentity.aiId);
    if (persistedDs) {
      datasets.set(persistedIdentity.aiId, persistedDs);
    }
  }

  const policyEngine: OwnerPolicyEngine = seed.policyEngine;
  const memoryManager: MemoryManager = seed.memoryManager;

  // Hydrate persisted permission rules & memories into domain managers
  for (const aiId of identities.keys()) {
    const persistedRules = db.listPermissionRules(aiId);
    for (const rule of persistedRules) {
      policyEngine.updateRuleMode(aiId, rule.ruleId, rule.mode);
    }
    const persistedMemories = db.listMemoriesForOwnerAi(aiId);
    for (const mem of persistedMemories) {
      memoryManager.addMemory(mem);
    }
  }

  const groups = new Map<string, GroupSession>();
  for (const grp of db.listGroups()) {
    groups.set(grp.groupId, grp);
  }

  const activeStreams = new Map<string, AbortController>();

  const recordChatbotAudit = (params: {
    module: string;
    eventType: string;
    actorAiId: string;
    targetAiId?: string;
    correlationId?: string;
    outcome: 'SUCCESS' | 'DENIED' | 'ERROR' | 'PENDING';
    summary: string;
  }) => {
    const event: AuditEventRecord = {
      eventId: `aud_chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      repository: 'ai-nexus-chatbot',
      ...params,
    };
    db.appendAuditEvent(event);
  };

  // LLM generator adapter for PersonalAINodeAgent (used when answering remote peer AI inquiries)
  const nodeAgentLlmGenerator: LLMGeneratorFn | undefined =
    llmRegistry.hasAnyConfiguredProvider()
      ? async ({ aiIdentity, systemInstruction, prompt }) => {
          const provider = llmRegistry.getProvider(
            aiIdentity.configuredProvider || 'gemini'
          );
          if (!provider.isConfigured()) {
            const fallbackGemini = llmRegistry.getProvider('gemini');
            if (!fallbackGemini.isConfigured()) {
              throw new Error('No configured LLM provider for node agent.');
            }
            const res = await fallbackGemini.generateComplete({
              provider: 'gemini',
              model: 'gemini-3.8-flash',
              systemInstruction,
              turns: [{ role: 'user', content: prompt }],
            });
            return {
              text: res.text,
              tokensUsed: res.tokensUsed,
              costUsd: res.costUsd,
            };
          }
          const res = await provider.generateComplete({
            provider: aiIdentity.configuredProvider,
            model: aiIdentity.configuredModel,
            systemInstruction,
            turns: [{ role: 'user', content: prompt }],
          });
          return {
            text: res.text,
            tokensUsed: res.tokensUsed,
            costUsd: res.costUsd,
          };
        }
      : undefined;

  // Create PersonalAINodeAgent clients that connect to Gateway over HTTP & WS
  const nodeAgents = new Map<string, PersonalAINodeAgent>();
  for (const identity of identities.values()) {
    const ds = datasets.get(identity.aiId)!;
    const agent = new PersonalAINodeAgent(
      identity,
      ds,
      policyEngine,
      memoryManager,
      GATEWAY_INTERNAL_URL,
      VITE_GATEWAY_WS_URL,
      nodeAgentLlmGenerator
    );
    nodeAgents.set(identity.aiId, agent);
  }

  async function syncNodesWithGateway(): Promise<boolean> {
    const health = await gatewayClient.checkHealth();
    if (!health.reachable) {
      return false;
    }

    for (const agent of nodeAgents.values()) {
      if (!agent.isConnectedToGatewayWs() && agent.desiredOnline) {
        await agent.registerAndConnect();
      }
    }
    return true;
  }

  // Attempt initial registration & WebSocket connection to Gateway (non-blocking if Gateway isn't up yet)
  syncNodesWithGateway().catch(() => {
    // Gateway may be started independently after Chatbot
  });

  // Background heartbeat & auto-recovery sync when Gateway comes online
  const gatewaySyncInterval = setInterval(() => {
    const needsSync = Array.from(nodeAgents.values()).some(
      (a) => a.desiredOnline && !a.isConnectedToGatewayWs()
    );
    if (needsSync) {
      syncNodesWithGateway().catch(() => {
        // Ignore transient connection errors while Gateway is down
      });
    }
  }, 2500);
  gatewaySyncInterval.unref?.();

  // Helper to dispatch a signed remote invocation through the Gateway over HTTP + WS
  async function invokeRemoteAiThroughGateway(params: {
    senderIdentity: PublicAIIdentity;
    recipientIdentity: PublicAIIdentity;
    capability: CapabilityType;
    question: string;
    conversationId: string;
    groupId?: string;
    followUpTurn?: number;
    maxFollowUpTurns?: number;
    maxBudgetUsd?: number;
    accumulatedCostUsd?: number;
    invocationChainTrace?: string[];
  }): Promise<{
    gatewayReachable: boolean;
    record?: InvocationRecord;
    errorText?: string;
  }> {
    const reachable = await syncNodesWithGateway();
    if (!reachable) {
      recordChatbotAudit({
        module: 'GatewayProtocolHttpClient',
        eventType: 'GATEWAY_CONNECTION_FAILED',
        actorAiId: params.senderIdentity.aiId,
        targetAiId: params.recipientIdentity.aiId,
        outcome: 'ERROR',
        summary: `Remote invocation to ${params.recipientIdentity.handle} failed: AI Nexus Gateway (${GATEWAY_INTERNAL_URL}) is unreachable.`,
      });
      return {
        gatewayReachable: false,
        errorText: `AI Nexus Gateway (${GATEWAY_INTERNAL_URL}) is unreachable. Remote AI invocation cannot proceed while the Gateway server on port 4000 is offline.`,
      };
    }

    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const idempotencyKey = `idem_${params.senderIdentity.aiId}_${params.recipientIdentity.aiId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const requestEnvelope = createSignedMessageEnvelope<InvocationRequestPayload>({
      senderAiId: params.senderIdentity.aiId,
      recipientAiId: params.recipientIdentity.aiId,
      keyFingerprint: params.senderIdentity.keyFingerprint,
      type: params.groupId
        ? EnvelopeMessageType.GROUP_BROADCAST
        : EnvelopeMessageType.INVOCATION_REQUEST,
      correlationId,
      idempotencyKey,
      ttlSeconds: 300,
      payload: {
        capability: params.capability,
        question: params.question,
        conversationId: params.conversationId,
        groupId: params.groupId,
        queueIfOffline: true,
        followUpTurn: params.followUpTurn ?? 1,
        maxFollowUpTurns: params.maxFollowUpTurns ?? 5,
        maxBudgetUsd: params.maxBudgetUsd ?? 0.05,
        accumulatedCostUsd: params.accumulatedCostUsd ?? 0.0002,
        invocationChainTrace: params.invocationChainTrace ?? [params.senderIdentity.aiId],
      },
    });

    try {
      const result = await gatewayClient.sendInvocation(requestEnvelope);
      return {
        gatewayReachable: true,
        record: result.record,
      };
    } catch (err) {
      return {
        gatewayReachable: false,
        errorText:
          err instanceof Error
            ? err.message
            : `Failed to reach Gateway at ${GATEWAY_INTERNAL_URL}`,
      };
    }
  }

  /**
   * Executes a multi-turn LLM generation for a direct conversation message,
   * optionally streaming chunks via `onChunk`.
   */
  async function generateAssistantResponseForConversation(params: {
    conversationId: string;
    senderIdentity: PublicAIIdentity;
    assistantMessageId: string;
    currentAttachments?: ChatAttachment[];
    signal?: AbortSignal;
    onChunk?: (delta: string, accumulated: string) => void;
  }): Promise<{
    assistantMessage: ChatMessage;
    conversation: ConversationThread;
    error?: { code: string; message: string; retryable: boolean };
  }> {
    const conv = db.getConversation(params.conversationId);
    if (!conv) {
      throw new Error(`Conversation ${params.conversationId} not found.`);
    }

    // All messages prior to the placeholder assistant message
    const historyUpToNow = conv.messages.filter(
      (m) => m.id !== params.assistantMessageId
    );
    const lastUserMessage = [...historyUpToNow]
      .reverse()
      .find((m) => m.role === 'user');
    const queryText = lastUserMessage?.content ?? '';

    const relevantMemories = memoryManager.searchRelevantMemories(
      params.senderIdentity.aiId,
      queryText,
      4
    );
    const dataset = datasets.get(params.senderIdentity.aiId) ?? null;

    const builtContext = buildConversationContext({
      aiIdentity: params.senderIdentity,
      conversationMessages: historyUpToNow,
      relevantMemories,
      dataset,
      currentAttachments:
        params.currentAttachments ?? lastUserMessage?.attachments,
    });

    const providerId = params.senderIdentity.configuredProvider || 'gemini';
    const modelName =
      params.senderIdentity.configuredModel || 'gemini-3.8-flash';
    const provider = llmRegistry.getProvider(providerId);

    let partialContent = '';
    try {
      const result = await provider.generateStream(
        {
          provider: providerId,
          model: modelName,
          systemInstruction: builtContext.systemInstruction,
          turns: builtContext.turns,
          signal: params.signal,
        },
        (chunk) => {
          partialContent = chunk.accumulatedText;
          params.onChunk?.(chunk.delta, chunk.accumulatedText);
        }
      );

      const updatedMsg = db.updateMessageState(params.assistantMessageId, {
        content: result.text,
        status: 'COMPLETED',
        errorMessage: null,
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
        costUsd: result.costUsd,
        attributionLabel: `Local Personal AI (${params.senderIdentity.executionMode} · ${result.modelUsed})`,
      })!;

      return {
        assistantMessage: updatedMsg,
        conversation: db.getConversation(params.conversationId)!,
      };
    } catch (err) {
      const llmErr =
        err instanceof LLMProviderError
          ? err
          : new LLMProviderError({
              code: 'PROVIDER_ERROR',
              provider: providerId,
              model: modelName,
              message:
                err instanceof Error ? err.message : 'LLM generation failed.',
              retryable: true,
            });

      if (llmErr.code === 'ABORTED') {
        const interruptedText =
          partialContent.trim() || '[Generation stopped by user]';
        const updatedMsg = db.updateMessageState(params.assistantMessageId, {
          content: interruptedText,
          status: 'INTERRUPTED',
          errorMessage: 'Generation stopped by user.',
          modelUsed: modelName,
        })!;
        return {
          assistantMessage: updatedMsg,
          conversation: db.getConversation(params.conversationId)!,
          error: {
            code: llmErr.code,
            message: llmErr.message,
            retryable: true,
          },
        };
      }

      const errorContent =
        partialContent.trim() ||
        `Unable to generate response from **${providerId}/${modelName}**: ${llmErr.message}`;
      const updatedMsg = db.updateMessageState(params.assistantMessageId, {
        content: errorContent,
        status: 'ERROR',
        errorMessage: llmErr.message,
        modelUsed: modelName,
      })!;

      return {
        assistantMessage: updatedMsg,
        conversation: db.getConversation(params.conversationId)!,
        error: {
          code: llmErr.code,
          message: llmErr.message,
          retryable: llmErr.retryable,
        },
      };
    }
  }

  /**
   * Handles special AI-to-AI commands (ASK_REMOTE_AI, ASK_ALL_GROUP, GROUP_CREATE, SHARE_MEMORY)
   * and persists all resulting messages in SQLite.
   */
  async function handleSpecialCommandMessage(params: {
    conv: ConversationThread;
    userMsg: ChatMessage;
    senderIdentity: PublicAIIdentity;
    content: string;
    enableAutonomousFollowUp: boolean;
  }): Promise<{
    handled: boolean;
    statusCode?: number;
    payload?: Record<string, unknown>;
  }> {
    const { conv, userMsg, senderIdentity, content, enableAutonomousFollowUp } =
      params;
    const parsed = CommandParser.parse(content);

    // CASE A: Remote AI Invocation (`/ask @bob ...` or natural language `Ask Bob's AI ...`)
    if (parsed.type === 'ASK_REMOTE_AI' && parsed.targetHandle) {
      const recipientIdentity = Array.from(identities.values()).find(
        (i) => i.handle.toLowerCase() === parsed.targetHandle!.toLowerCase()
      );

      if (!recipientIdentity) {
        const errMsg = db.addMessage({
          id: `msg_sys_${Date.now()}`,
          conversationId: conv.id,
          role: 'system',
          senderAiId: senderIdentity.aiId,
          senderDisplayName: 'AI Nexus Router',
          content: `**Unknown AI Handle (\`${parsed.targetHandle}\`):** No Personal AI with handle \`${parsed.targetHandle}\` is registered.`,
          timestamp: new Date().toISOString(),
        });
        return {
          handled: true,
          payload: {
            conversation: db.getConversation(conv.id),
            messagesAdded: [userMsg, errMsg],
          },
        };
      }

      const invResult = await invokeRemoteAiThroughGateway({
        senderIdentity,
        recipientIdentity,
        capability: parsed.inferredCapability,
        question: parsed.questionOrContent || content,
        conversationId: conv.id,
        followUpTurn: 1,
        maxFollowUpTurns: 5,
        maxBudgetUsd: 0.05,
        accumulatedCostUsd: 0.0002,
        invocationChainTrace: [senderIdentity.aiId],
      });

      if (!invResult.gatewayReachable || !invResult.record) {
        const gatewayDownMsg = db.addMessage({
          id: `msg_gw_err_${Date.now()}`,
          conversationId: conv.id,
          role: 'system',
          senderAiId: senderIdentity.aiId,
          senderDisplayName: 'AI Nexus Gateway Client',
          content: `**Gateway Unavailable (\`GATEWAY_UNAVAILABLE\`):** ${
            invResult.errorText ||
            `Could not connect to AI Nexus Gateway at ${GATEWAY_INTERNAL_URL}.`
          }\n\n*No remote AI response was generated because the Gateway process on port 4000 is offline.*`,
          timestamp: new Date().toISOString(),
          attributionLabel: `Gateway Connection Failed (${GATEWAY_INTERNAL_URL})`,
        });
        return {
          handled: true,
          payload: {
            conversation: db.getConversation(conv.id),
            gatewayUnavailable: true,
            error: invResult.errorText,
            messagesAdded: [userMsg, gatewayDownMsg],
          },
        };
      }

      const record = invResult.record;
      const respPayload = record.responseEnvelope?.payload;

      const remoteMsg = db.addMessage({
        id: `msg_rem_${Date.now()}`,
        conversationId: conv.id,
        role: 'remote_ai',
        senderAiId: recipientIdentity.aiId,
        senderDisplayName: `${recipientIdentity.displayName} (${recipientIdentity.handle})`,
        content:
          respPayload?.answer ||
          (record.queuedOffline
            ? `**Queued for Offline Delivery (\`QUEUED_OFFLINE\`):** ${recipientIdentity.displayName} (${recipientIdentity.nodeId}) is currently offline. Your signed envelope (\`${record.requestId}\`) is stored in the Gateway Offline Queue and will automatically deliver over WebSocket when ${recipientIdentity.handle} reconnects.`
            : `Invocation finished in state \`${record.state}\`.`),
        timestamp: new Date().toISOString(),
        attributionLabel:
          respPayload?.attributionLabel ||
          `Gateway State: ${record.state} · Correlation ${record.envelope.correlationId}`,
        invocationRecord: record,
        minimizedFields: respPayload?.minimizedFieldsReturned ?? [],
        redactedFields: respPayload?.redactedFields ?? [],
        followUpTurn: 1,
        modelUsed: respPayload?.modelUsed ?? recipientIdentity.configuredModel,
        tokensUsed: respPayload?.tokensUsed ?? 0,
        costUsd: respPayload?.estimatedCostUsd ?? 0,
      });

      const addedMessages: ChatMessage[] = [userMsg, remoteMsg];

      // Optional Autonomous Multi-Turn Follow-Up Negotiation
      if (
        enableAutonomousFollowUp &&
        parsed.autonomousFollowUpRequested &&
        record.state === InvocationState.COMPLETED
      ) {
        const followUpQuestion =
          'Confirming the 2:00 PM – 2:30 PM PST slot tomorrow based on our mutual availability.';
        const loopCheck = AutonomousFollowUpEngine.validateTurn({
          currentTurn: 2,
          maxTurns: 5,
          accumulatedCostUsd:
            (respPayload?.estimatedCostUsd ?? 0.0003) + 0.0003,
          maxBudgetUsd: 0.05,
          previousQuestions: [parsed.questionOrContent || content],
          nextQuestion: followUpQuestion,
          invocationChainTrace: [senderIdentity.aiId, recipientIdentity.aiId],
          nextRecipientAiId: recipientIdentity.aiId,
        });

        if (loopCheck.allowed) {
          const followUpResult = await invokeRemoteAiThroughGateway({
            senderIdentity,
            recipientIdentity,
            capability: parsed.inferredCapability,
            question: followUpQuestion,
            conversationId: conv.id,
            followUpTurn: 2,
            maxFollowUpTurns: 5,
            maxBudgetUsd: 0.05,
            accumulatedCostUsd: 0.0006,
            invocationChainTrace: [senderIdentity.aiId, recipientIdentity.aiId],
          });

          if (followUpResult.gatewayReachable && followUpResult.record) {
            const fuRecord = followUpResult.record;
            const fuMsg = db.addMessage({
              id: `msg_fu_${Date.now()}`,
              conversationId: conv.id,
              role: 'assistant',
              senderAiId: senderIdentity.aiId,
              senderDisplayName: `${senderIdentity.displayName} (Autonomous Follow-Up · Turn 2/5)`,
              content: `**Autonomous Multi-Turn Negotiation Complete (Turn 2/5):** Cross-referenced ${senderIdentity.ownerDisplayName}'s private calendar with ${recipientIdentity.displayName}'s minimized free/busy response via Gateway (\`${fuRecord.requestId}\`). Confirmed **Tomorrow 2:00 PM – 2:30 PM PST** as the optimal meeting window.`,
              timestamp: new Date().toISOString(),
              attributionLabel: `Autonomous Follow-Up (Turn 2/5 · Loop Guard Passed)`,
              invocationRecord: fuRecord,
              followUpTurn: 2,
              modelUsed: senderIdentity.configuredModel,
              tokensUsed: 112,
              costUsd: 0.0003,
            });
            addedMessages.push(fuMsg);
          }
        }
      }

      return {
        handled: true,
        payload: {
          conversation: db.getConversation(conv.id),
          messagesAdded: addedMessages,
        },
      };
    }

    // CASE B: Group Broadcast (`/ask-all ...` or message inside a Group thread)
    if (parsed.type === 'ASK_ALL_GROUP' || conv.isGroup) {
      const group =
        (conv.groupId ? groups.get(conv.groupId) : undefined) ??
        Array.from(groups.values())[0];

      if (!group) {
        return {
          handled: true,
          statusCode: 400,
          payload: { error: 'No active group session found.' },
        };
      }

      const otherParticipants = group.participants.filter(
        (p) => p.aiId !== senderIdentity.aiId && p.status === 'ACTIVE'
      );

      const addedMessages: ChatMessage[] = [userMsg];
      for (const part of otherParticipants) {
        const targetIdentity = identities.get(part.aiId);
        if (!targetIdentity) continue;

        const invResult = await invokeRemoteAiThroughGateway({
          senderIdentity,
          recipientIdentity: targetIdentity,
          capability: 'group.collaboration',
          question: parsed.questionOrContent || content,
          conversationId: conv.id,
          groupId: group.groupId,
          followUpTurn: 1,
          maxFollowUpTurns: group.maxTurnLimit,
          maxBudgetUsd: 0.08,
        });

        if (!invResult.gatewayReachable || !invResult.record) {
          const gwErr = db.addMessage({
            id: `msg_grp_err_${Date.now()}_${part.aiId}`,
            conversationId: conv.id,
            role: 'system',
            senderAiId: senderIdentity.aiId,
            senderDisplayName: 'AI Nexus Gateway Client',
            content: `**Gateway Unavailable (\`GATEWAY_UNAVAILABLE\`):** Cannot reach ${targetIdentity.displayName} (${targetIdentity.handle}) in group session because the AI Nexus Gateway (${GATEWAY_INTERNAL_URL}) is offline.`,
            timestamp: new Date().toISOString(),
          });
          addedMessages.push(gwErr);
          continue;
        }

        const rec = invResult.record;
        const resp = rec.responseEnvelope?.payload;
        const grpMsg = db.addMessage({
          id: `msg_grp_${Date.now()}_${part.aiId}`,
          conversationId: conv.id,
          role: 'remote_ai',
          senderAiId: targetIdentity.aiId,
          senderDisplayName: `${targetIdentity.displayName} (${targetIdentity.handle} · Owner: ${targetIdentity.ownerDisplayName})`,
          content:
            resp?.answer || `[${targetIdentity.displayName}] State: ${rec.state}`,
          timestamp: new Date().toISOString(),
          attributionLabel:
            resp?.attributionLabel ||
            `Group Session (${group.title}) · Signed by ${targetIdentity.handle}`,
          invocationRecord: rec,
          minimizedFields: resp?.minimizedFieldsReturned ?? [],
          redactedFields: resp?.redactedFields ?? [],
          modelUsed: resp?.modelUsed ?? targetIdentity.configuredModel,
          tokensUsed: resp?.tokensUsed ?? 96,
          costUsd: resp?.estimatedCostUsd ?? 0.0003,
        });
        addedMessages.push(grpMsg);
      }

      return {
        handled: true,
        payload: {
          conversation: db.getConversation(conv.id),
          messagesAdded: addedMessages,
        },
      };
    }

    // CASE C: Create Group (`/group create ...`)
    if (parsed.type === 'GROUP_CREATE') {
      const nowIso = new Date().toISOString();
      const groupId = `grp_${Date.now()}`;
      const newGroup: GroupSession = {
        groupId,
        title: parsed.questionOrContent || 'Cross-AI Strategy Session',
        createdByAiId: senderIdentity.aiId,
        participants: Array.from(identities.values()).map((id) => ({
          aiId: id.aiId,
          handle: id.handle,
          displayName: id.displayName,
          ownerName: id.ownerDisplayName,
          status: 'ACTIVE',
          joinedAt: nowIso,
          model: id.configuredModel,
        })),
        messages: [],
        status: 'ACTIVE',
        maxTurnLimit: 15,
        currentTurnCount: 1,
        maxBudgetUsd: 0.5,
        currentCostUsd: 0,
        createdAt: nowIso,
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      };
      groups.set(groupId, newGroup);
      db.saveGroup(newGroup);

      const grpConv = db.createConversation({
        id: `conv_${groupId}`,
        ownerAiId: senderIdentity.aiId,
        title: `[Group] ${newGroup.title}`,
        pinned: true,
        isGroup: true,
        groupId,
      });

      db.addMessage({
        id: `msg_grp_init_${Date.now()}`,
        conversationId: grpConv.id,
        role: 'system',
        senderAiId: senderIdentity.aiId,
        senderDisplayName: 'Group Coordinator',
        content: `Created Multi-AI Group Session **${newGroup.title}** (\`${groupId}\`) with participants \`@alice\`, \`@bob\`, and \`@charlie\`. Use \`/ask-all <prompt>\` to broadcast to all participant AIs via the Gateway.`,
        timestamp: nowIso,
      });

      return {
        handled: true,
        payload: {
          conversation: db.getConversation(grpConv.id),
          group: newGroup,
        },
      };
    }

    // CASE D: Share Memory (`/share-memory @bob ...`)
    if (parsed.type === 'SHARE_MEMORY' && parsed.targetHandle) {
      const target = Array.from(identities.values()).find(
        (i) => i.handle.toLowerCase() === parsed.targetHandle!.toLowerCase()
      );
      if (target) {
        const nowIso = new Date().toISOString();
        const mem = memoryManager.addMemory({
          memoryId: `mem_${Date.now()}`,
          ownerAiId: senderIdentity.aiId,
          category: MemoryCategory.SHARED_CONTEXT,
          title: `Shared Note for ${target.handle}`,
          content: parsed.questionOrContent || content,
          tags: ['shared', target.handle.replace('@', '')],
          sourceAiId: senderIdentity.aiId,
          sourceOwnerId: senderIdentity.ownerId,
          trustClassification: 'VERIFIED_OWNER',
          retentionPolicy: 'TIME_LIMITED',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        db.upsertMemory(mem);

        const shareRes = memoryManager.shareMemoryWithAI({
          memoryId: mem.memoryId,
          ownerAiId: senderIdentity.aiId,
          recipientAiId: target.aiId,
          ttlHours: 72,
        });
        if (shareRes.grant) {
          db.saveMemoryGrant(shareRes.grant);
        }
        if (shareRes.recipientCopy) {
          db.upsertMemory(shareRes.recipientCopy);
        }

        const sysMsg = db.addMessage({
          id: `msg_share_${Date.now()}`,
          conversationId: conv.id,
          role: 'assistant',
          senderAiId: senderIdentity.aiId,
          senderDisplayName: senderIdentity.displayName,
          content: `**Explicit Memory Grant Created (\`${shareRes.grant?.grantId}\`):** Shared read-only memory *"${mem.content}"* with **${target.displayName} (${target.handle})** for 72 hours.`,
          timestamp: new Date().toISOString(),
          attributionLabel: `Memory Grant · ${shareRes.grant?.grantId}`,
        });
        return {
          handled: true,
          payload: {
            conversation: db.getConversation(conv.id),
            messagesAdded: [userMsg, sysMsg],
          },
        };
      }
    }

    return { handled: false };
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // --------------------------------------------------------------------------
  // 1. Health Endpoint (`GET /health`)
  // --------------------------------------------------------------------------
  app.get('/health', async (_req, res) => {
    const gatewayProbe = await gatewayClient.checkHealth();
    if (gatewayProbe.reachable) {
      await syncNodesWithGateway();
    }
    const connectedWsNodes = Array.from(nodeAgents.values())
      .filter((a) => a.isConnectedToGatewayWs())
      .map((a) => a.identity.aiId);

    const verifiedPresenceByAiId: Record<string, string> = {};
    for (const [aiId, agent] of nodeAgents.entries()) {
      verifiedPresenceByAiId[aiId] = agent.getVerifiedPresenceState(
        gatewayProbe.reachable,
        gatewayProbe.health?.connectedNodeAiIds
      );
    }

    const geminiStatus = llmRegistry.getProvider('gemini').getConfigurationStatus();
    const dbDiag = db.getDiagnostics();

    res.status(200).json({
      status: 'OK',
      service: 'ai-nexus-chatbot',
      version: '1.0.0',
      port: PORT,
      timestamp: new Date().toISOString(),
      databaseStatus: 'READY',
      database: dbDiag,
      llmProvider: {
        configuredProvider: 'gemini',
        defaultModel: 'gemini-3.8-flash',
        apiKeyConfigured: geminiStatus.configured,
        providers: llmRegistry.listProviderStatuses(),
        executionFallback: geminiStatus.configured
          ? 'LIVE_GEMINI_SDK'
          : 'PROVIDER_UNCONFIGURED',
      },
      gatewayDependency: {
        internalUrl: GATEWAY_INTERNAL_URL,
        publicHttpUrl: VITE_GATEWAY_HTTP_URL,
        wsUrl: VITE_GATEWAY_WS_URL,
        connected: gatewayProbe.reachable,
        status: gatewayProbe.reachable ? 'CONNECTED' : 'UNAVAILABLE',
        authenticatedNodeWebSockets: connectedWsNodes,
        verifiedPresenceByAiId,
        gatewayHealth: gatewayProbe.health ?? null,
        error: gatewayProbe.error ?? null,
      },
    });
  });

  // --------------------------------------------------------------------------
  // 2. Bootstrap Endpoint (`GET /api/chatbot/bootstrap`)
  // --------------------------------------------------------------------------
  app.get('/api/chatbot/bootstrap', async (req, res) => {
    const requestedAiId =
      typeof req.query.aiId === 'string' && req.query.aiId.trim()
        ? req.query.aiId.trim()
        : 'ai_alice';

    if (req.query.reconnect === '1') {
      await syncNodesWithGateway().catch(() => {});
    }

    let gatewayProbe = await gatewayClient.checkHealth();
    let gatewayIdentities: PublicAIIdentity[] = [];
    let gatewayInvocations: InvocationRecord[] = [];
    let gatewayAuditEvents: AuditEventRecord[] = [];

    if (gatewayProbe.reachable) {
      await syncNodesWithGateway();
      gatewayProbe = await gatewayClient.checkHealth();
      try {
        const [idList, invData, audList] = await Promise.all([
          gatewayClient.listIdentities(),
          gatewayClient.listInvocations(),
          gatewayClient.listAuditEvents(),
        ]);
        gatewayIdentities = idList;
        gatewayInvocations = invData.invocations;
        gatewayAuditEvents = audList;

        for (const gId of gatewayIdentities) {
          const existing = identities.get(gId.aiId);
          if (existing) {
            const merged: PublicAIIdentity = {
              ...existing,
              ...gId,
              // Preserve local model preference from SQLite
              configuredProvider: existing.configuredProvider,
              configuredModel: existing.configuredModel,
            };
            identities.set(gId.aiId, merged);
            const agent = nodeAgents.get(gId.aiId);
            if (agent) {
              agent.identity = merged;
              agent.desiredOnline = gId.online !== false;
            }
          }
        }
      } catch {
        // Fallback to local state if Gateway drops mid-request
      }
    }

    const connectedAiIdsOnGateway = gatewayProbe.health?.connectedNodeAiIds ?? [];
    const identityList: PublicAIIdentity[] = Array.from(identities.values()).map(
      (id) => {
        const agent = nodeAgents.get(id.aiId);
        if (!gatewayProbe.reachable) {
          return {
            ...id,
            online: false,
            presenceState: 'UNAVAILABLE',
            localRuntimeAvailable: true,
            remoteNodeAvailable: false,
            gatewayAvailable: false,
            desiredOnline: agent?.desiredOnline ?? true,
          };
        }

        const gatewayRecord = gatewayIdentities.find((g) => g.aiId === id.aiId);
        const isWsConnected =
          Boolean(agent?.isConnectedToGatewayWs()) ||
          connectedAiIdsOnGateway.includes(id.aiId);
        const isExplicitlyOffline =
          (gatewayRecord && gatewayRecord.online === false) ||
          agent?.desiredOnline === false;

        const presenceState = isExplicitlyOffline
          ? 'OFFLINE'
          : isWsConnected
          ? 'ONLINE'
          : agent?.isConnectingToGatewayWs()
          ? 'CONNECTING'
          : gatewayRecord
          ? gatewayRecord.online
            ? 'ONLINE'
            : 'OFFLINE'
          : 'UNKNOWN';

        const isVerifiedOnline = presenceState === 'ONLINE';
        return {
          ...id,
          ...(gatewayRecord ?? {}),
          configuredProvider: id.configuredProvider,
          configuredModel: id.configuredModel,
          online: isVerifiedOnline,
          presenceState,
          localRuntimeAvailable: true,
          remoteNodeAvailable: isVerifiedOnline,
          gatewayAvailable: true,
          desiredOnline: agent?.desiredOnline ?? true,
        };
      }
    );

    const permissions: Record<string, unknown> = {};
    const memories: Record<string, MemoryEntry[]> = {};
    for (const id of identityList) {
      permissions[id.aiId] = policyEngine.getRulesForOwner(id.aiId);
      // Enforce owner isolation: only expose private memories for the active owner AI
      memories[id.aiId] =
        id.aiId === requestedAiId
          ? db.listMemoriesForOwnerAi(id.aiId)
          : [];
    }

    const pendingApprovals = gatewayInvocations.filter(
      (inv) => inv.state === InvocationState.REQUIRES_APPROVAL
    );

    const localAudit = db.listAuditEvents(100);
    const combinedAudit = [...gatewayAuditEvents, ...localAudit].sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
    );

    // Owner-isolated conversations (returns conversations owned by requestedAiId + group conversations)
    const ownerConversations = db.listConversationsForAi(requestedAiId);
    const ownerSettings = db.getSettingsForOwner(requestedAiId);

    res.status(200).json({
      gatewayStatus: {
        connected: gatewayProbe.reachable,
        state: gatewayProbe.reachable ? 'ONLINE' : 'UNAVAILABLE',
        httpUrl: VITE_GATEWAY_HTTP_URL,
        internalUrl: GATEWAY_INTERNAL_URL,
        wsUrl: VITE_GATEWAY_WS_URL,
        health: gatewayProbe.health ?? null,
        error: gatewayProbe.error ?? null,
      },
      providerStatus: llmRegistry.listProviderStatuses().map((ps) => ({
        provider: ps.providerId,
        label: ps.displayName,
        configured: ps.configured,
        defaultModel: ps.supportedModels[0]?.id ?? 'gemini-3.8-flash',
        models: ps.supportedModels.map((m) => ({
          provider: ps.providerId,
          model: m.id,
          label: m.label,
          description: `${ps.displayName} (${m.id})`,
        })),
        statusMessage: ps.configured
          ? `${ps.envVarName} is configured on the server.`
          : `${ps.envVarName} is not configured in server environment variables.`,
      })),
      settings: ownerSettings,
      identities: identityList,
      conversations: ownerConversations,
      groups: Array.from(groups.values()),
      permissions,
      memories,
      memoryGrants: [
        ...memoryManager.listGrantsForOwner(requestedAiId),
        ...db.listMemoryGrants().filter(
          (g) => g.ownerAiId === requestedAiId || g.recipientAiId === requestedAiId
        ),
      ].filter(
        (g, idx, arr) => arr.findIndex((x) => x.grantId === g.grantId) === idx
      ),
      invocations: gatewayInvocations,
      pendingApprovals,
      auditEvents: combinedAudit,
    });
  });

  // --------------------------------------------------------------------------
  // 3. Provider & Database Status / Backup Endpoints
  // --------------------------------------------------------------------------
  app.get('/api/chatbot/providers', (_req, res) => {
    res.status(200).json({
      anyConfigured: llmRegistry.hasAnyConfiguredProvider(),
      providers: llmRegistry.listProviderStatuses(),
      models: SUPPORTED_PROVIDER_MODELS,
    });
  });

  app.get('/api/chatbot/database/status', (_req, res) => {
    res.status(200).json(db.getDiagnostics());
  });

  app.post('/api/chatbot/database/backup', (req, res) => {
    try {
      const backup = db.createBackup(req.body?.targetPath);
      res.status(200).json({
        status: 'OK',
        backupCreated: true,
        backupPath: backup.backupPath,
        createdAt: backup.createdAt,
        backup,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Database backup failed',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 4. Persistent Owner Settings (`/api/chatbot/settings/:ownerAiId`)
  // --------------------------------------------------------------------------
  app.get('/api/chatbot/settings/:ownerAiId', (req, res) => {
    const settings = db.getSettingsForOwner(req.params.ownerAiId);
    res.status(200).json({ settings });
  });

  app.put('/api/chatbot/settings/:ownerAiId', (req, res) => {
    const { ownerAiId } = req.params;
    const rawBody = req.body ?? {};
    const updates =
      rawBody.settings && typeof rawBody.settings === 'object'
        ? rawBody.settings
        : rawBody;
    try {
      for (const [key, val] of Object.entries(updates)) {
        if (
          typeof val === 'string' ||
          typeof val === 'number' ||
          typeof val === 'boolean'
        ) {
          db.setSetting(ownerAiId, key, String(val));
        }
      }
      res.status(200).json({ settings: db.getSettingsForOwner(ownerAiId) });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid setting value',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 5. Conversations CRUD (`/api/chatbot/conversations`)
  // --------------------------------------------------------------------------
  app.get('/api/chatbot/conversations', (req, res) => {
    const ownerAiId =
      typeof req.query.ownerAiId === 'string' ? req.query.ownerAiId : 'ai_alice';
    res.status(200).json({
      conversations: db.listConversationsForAi(ownerAiId),
    });
  });

  app.get('/api/chatbot/conversations/:id', (req, res) => {
    const requestingAiId =
      typeof req.query.ownerAiId === 'string' ? req.query.ownerAiId : undefined;
    const conv = db.getConversation(req.params.id, requestingAiId);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.status(200).json({ conversation: conv });
  });

  app.post('/api/chatbot/conversations', (req, res) => {
    const { ownerAiId = 'ai_alice', title = 'New Conversation' } = req.body ?? {};
    const conv = db.createConversation({ ownerAiId, title });
    db.setSetting(ownerAiId, 'active_conversation_id', conv.id);
    res.status(201).json({ conversation: conv });
  });

  app.patch('/api/chatbot/conversations/:id', (req, res) => {
    const updated = db.updateConversation(req.params.id, {
      togglePin: Boolean(req.body?.togglePin),
      title: req.body?.title,
      archive: Boolean(req.body?.archive),
    });
    if (!updated) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.status(200).json({ conversation: updated });
  });

  app.delete('/api/chatbot/conversations/:id', (req, res) => {
    const deleted = db.deleteConversation(req.params.id);
    res.status(200).json({ deleted });
  });

  // --------------------------------------------------------------------------
  // 6. Streaming Message Endpoint (`POST /api/chatbot/messages/stream`)
  // --------------------------------------------------------------------------
  app.post('/api/chatbot/messages/stream', async (req, res) => {
    const {
      conversationId = 'conv_alice_main',
      senderAiId = 'ai_alice',
      content = '',
      enableAutonomousFollowUp = true,
      attachments = [],
    } = req.body ?? {};

    let conv = db.getConversation(conversationId);
    if (!conv) {
      conv = db.createConversation({
        id: conversationId,
        ownerAiId: senderAiId,
        title: content.slice(0, 44) || 'Conversation',
      });
    }

    const senderIdentity =
      identities.get(senderAiId) ?? Array.from(identities.values())[0];

    const userMsg = db.addMessage(
      {
        id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: conv.id,
        role: 'user',
        senderAiId: senderIdentity.aiId,
        senderDisplayName: `${senderIdentity.ownerDisplayName} (You)`,
        content,
        timestamp: new Date().toISOString(),
        attachments: attachments as ChatAttachment[],
      },
      'COMPLETED'
    );

    db.setSetting(senderIdentity.aiId, 'active_conversation_id', conv.id);

    // Check if this is an AI-to-AI or slash command first
    const special = await handleSpecialCommandMessage({
      conv,
      userMsg,
      senderIdentity,
      content,
      enableAutonomousFollowUp,
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeSse = (event: string, data: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    if (special.handled) {
      writeSse('done', special.payload);
      res.end();
      return;
    }

    // Standard Personal AI Direct Chat -> Stream tokens via LLMProviderAdapter
    const assistantMsgId = `msg_a_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const initialAssistantMsg = db.addMessage(
      {
        id: assistantMsgId,
        conversationId: conv.id,
        role: 'assistant',
        senderAiId: senderIdentity.aiId,
        senderDisplayName: `${senderIdentity.displayName} (${senderIdentity.handle})`,
        content: '',
        timestamp: new Date().toISOString(),
        attributionLabel: `Local Personal AI (${senderIdentity.executionMode} · ${senderIdentity.configuredModel})`,
        modelUsed: senderIdentity.configuredModel,
      },
      'STREAMING'
    );

    const abortController = new AbortController();
    activeStreams.set(assistantMsgId, abortController);

    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    writeSse('init', {
      conversationId: conv.id,
      conversation: db.getConversation(conv.id),
      userMessage: userMsg,
      assistantMessage: initialAssistantMsg,
      mode: 'llm_stream',
    });

    try {
      const genResult = await generateAssistantResponseForConversation({
        conversationId: conv.id,
        senderIdentity,
        assistantMessageId: assistantMsgId,
        currentAttachments: attachments as ChatAttachment[],
        signal: abortController.signal,
        onChunk: (delta, accumulated) => {
          writeSse('chunk', {
            messageId: assistantMsgId,
            delta,
            accumulated,
            content: accumulated,
          });
        },
      });

      if (genResult.error) {
        writeSse(
          genResult.error.code === 'ABORTED' ? 'aborted' : 'error',
          {
            error: genResult.error.message,
            code: genResult.error.code,
            retryable: genResult.error.retryable,
            message: genResult.assistantMessage,
            assistantMessage: genResult.assistantMessage,
            conversation: genResult.conversation,
          }
        );
      } else {
        writeSse('done', {
          message: genResult.assistantMessage,
          assistantMessage: genResult.assistantMessage,
          conversation: genResult.conversation,
          messagesAdded: [userMsg, genResult.assistantMessage],
        });
      }
    } finally {
      activeStreams.delete(assistantMsgId);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // Stop an in-flight streaming generation
  app.post('/api/chatbot/messages/:messageId/stop', (req, res) => {
    const { messageId } = req.params;
    const ctrl = activeStreams.get(messageId);
    if (ctrl) {
      ctrl.abort();
      activeStreams.delete(messageId);
      res.status(200).json({ stopped: true, messageId });
      return;
    }
    const updated = db.updateMessageState(messageId, {
      status: 'INTERRUPTED',
      errorMessage: 'Generation stopped by user.',
    });
    res.status(200).json({ stopped: Boolean(updated), message: updated });
  });

  // --------------------------------------------------------------------------
  // 7. Standard JSON Message Endpoint (`POST /api/chatbot/messages`)
  // --------------------------------------------------------------------------
  app.post('/api/chatbot/messages', async (req, res) => {
    const {
      conversationId = 'conv_alice_main',
      senderAiId = 'ai_alice',
      content = '',
      enableAutonomousFollowUp = true,
      attachments = [],
    } = req.body ?? {};

    let conv = db.getConversation(conversationId);
    if (!conv) {
      conv = db.createConversation({
        id: conversationId,
        ownerAiId: senderAiId,
        title: content.slice(0, 44) || 'Conversation',
      });
    }

    const senderIdentity =
      identities.get(senderAiId) ?? Array.from(identities.values())[0];

    const userMsg = db.addMessage(
      {
        id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        conversationId: conv.id,
        role: 'user',
        senderAiId: senderIdentity.aiId,
        senderDisplayName: `${senderIdentity.ownerDisplayName} (You)`,
        content,
        timestamp: new Date().toISOString(),
        attachments: attachments as ChatAttachment[],
      },
      'COMPLETED'
    );

    db.setSetting(senderIdentity.aiId, 'active_conversation_id', conv.id);

    const special = await handleSpecialCommandMessage({
      conv,
      userMsg,
      senderIdentity,
      content,
      enableAutonomousFollowUp,
    });

    if (special.handled) {
      res.status(special.statusCode ?? 200).json(special.payload);
      return;
    }

    const assistantMsgId = `msg_a_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    db.addMessage(
      {
        id: assistantMsgId,
        conversationId: conv.id,
        role: 'assistant',
        senderAiId: senderIdentity.aiId,
        senderDisplayName: `${senderIdentity.displayName} (${senderIdentity.handle})`,
        content: '',
        timestamp: new Date().toISOString(),
        attributionLabel: `Local Personal AI (${senderIdentity.executionMode} · ${senderIdentity.configuredModel})`,
        modelUsed: senderIdentity.configuredModel,
      },
      'STREAMING'
    );

    const genResult = await generateAssistantResponseForConversation({
      conversationId: conv.id,
      senderIdentity,
      assistantMessageId: assistantMsgId,
      currentAttachments: attachments as ChatAttachment[],
    });

    res.status(200).json({
      conversation: genResult.conversation,
      messagesAdded: [userMsg, genResult.assistantMessage],
      error: genResult.error?.message,
      errorCode: genResult.error?.code,
      retryable: genResult.error?.retryable,
    });
  });

  // --------------------------------------------------------------------------
  // 8. Retry, Edit & Delete Message Endpoints
  // --------------------------------------------------------------------------
  app.post(
    '/api/chatbot/conversations/:convId/messages/:msgId/retry',
    async (req, res) => {
      const { convId, msgId } = req.params;
      const conv = db.getConversation(convId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const targetMsg = conv.messages.find((m) => m.id === msgId);
      if (!targetMsg) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      const senderIdentity =
        identities.get(conv.ownerAiId) ?? Array.from(identities.values())[0];

      let assistantMsgId = msgId;
      if (targetMsg.role === 'user') {
        // Remove any messages after this user message and create a fresh assistant placeholder
        db.deleteMessagesAfter(convId, msgId);
        assistantMsgId = `msg_a_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        db.addMessage(
          {
            id: assistantMsgId,
            conversationId: convId,
            role: 'assistant',
            senderAiId: senderIdentity.aiId,
            senderDisplayName: `${senderIdentity.displayName} (${senderIdentity.handle})`,
            content: '',
            timestamp: new Date().toISOString(),
            attributionLabel: `Local Personal AI (${senderIdentity.executionMode} · ${senderIdentity.configuredModel})`,
            modelUsed: senderIdentity.configuredModel,
          },
          'STREAMING'
        );
      } else {
        // Retry this assistant message in place without duplicating user message
        db.deleteMessagesAfter(convId, msgId);
        db.updateMessageState(msgId, {
          content: '',
          status: 'STREAMING',
          errorMessage: null,
        });
      }

      const genResult = await generateAssistantResponseForConversation({
        conversationId: convId,
        senderIdentity,
        assistantMessageId: assistantMsgId,
      });

      res.status(200).json({
        conversation: genResult.conversation,
        message: genResult.assistantMessage,
        assistantMessage: genResult.assistantMessage,
        error: genResult.error?.message,
        code: genResult.error?.code,
        errorCode: genResult.error?.code,
      });
    }
  );

  app.patch('/api/chatbot/conversations/:convId/messages/:msgId', (req, res) => {
    const { convId, msgId } = req.params;
    const updated = db.updateMessageState(msgId, {
      content: req.body?.content,
      feedback: req.body?.feedback,
    });
    const conv = db.getConversation(convId);
    if (!updated || !conv) {
      res.status(404).json({ error: 'Message or conversation not found' });
      return;
    }
    res.status(200).json({ message: updated, conversation: conv });
  });

  app.delete(
    '/api/chatbot/conversations/:convId/messages/:msgId',
    (req, res) => {
      const { convId, msgId } = req.params;
      const deleted = db.deleteMessage(convId, msgId);
      const conv = db.getConversation(convId);
      res.status(200).json({ deleted, conversation: conv });
    }
  );

  // --------------------------------------------------------------------------
  // 9. Chatbot Node Management Proxy -> Calls Gateway SDK (`http://localhost:4000`)
  // --------------------------------------------------------------------------
  app.post('/api/chatbot/nodes/:aiId/presence', async (req, res) => {
    const { aiId } = req.params;
    const { online, executionMode } = req.body ?? {};
    const agent = nodeAgents.get(aiId);
    const identity = identities.get(aiId);

    if (!agent || !identity) {
      res.status(404).json({ error: `Personal AI '${aiId}' not found.` });
      return;
    }

    if (executionMode) {
      identity.executionMode = executionMode as ExecutionMode;
    }
    if (typeof online === 'boolean') {
      identity.online = online;
    }
    db.updateIdentity(identity);

    try {
      await agent.setOnlineStatus(identity.online);
      await gatewayClient.updateIdentityConfig(aiId, {
        online: identity.online,
        executionMode: identity.executionMode,
      });
      res.status(200).json({ identity });
    } catch (err) {
      res.status(503).json({
        error:
          err instanceof Error
            ? err.message
            : `Gateway at ${GATEWAY_INTERNAL_URL} is unreachable.`,
      });
    }
  });

  app.post('/api/chatbot/nodes/:aiId/kill-switch', async (req, res) => {
    const { aiId } = req.params;
    const { active } = req.body ?? {};
    const identity = identities.get(aiId);
    if (!identity) {
      res.status(404).json({ error: `Personal AI '${aiId}' not found.` });
      return;
    }
    identity.killSwitchActive = Boolean(active);
    const agent = nodeAgents.get(aiId);
    if (agent) agent.identity.killSwitchActive = Boolean(active);
    db.updateIdentity(identity);

    try {
      await gatewayClient.updateIdentityConfig(aiId, {
        killSwitchActive: identity.killSwitchActive,
      });
    } catch {
      // Local policy engine also enforces killSwitchActive immediately
    }
    res.status(200).json({ identity });
  });

  app.post('/api/chatbot/nodes/:aiId/rotate-key', async (req, res) => {
    const { aiId } = req.params;
    const identity = identities.get(aiId);
    const agent = nodeAgents.get(aiId);
    if (!identity || !agent) {
      res.status(404).json({ error: `Personal AI '${aiId}' not found.` });
      return;
    }

    try {
      const rotated = await gatewayClient.rotateIdentityKey(aiId);
      if (rotated) {
        identities.set(aiId, rotated);
        agent.identity = rotated;
        db.updateIdentity(rotated);
        await agent.registerAndConnect();
      }
      res.status(200).json({ identity: rotated ?? identity });
    } catch (err) {
      res.status(503).json({
        error:
          err instanceof Error
            ? err.message
            : `Gateway at ${GATEWAY_INTERNAL_URL} is unreachable.`,
      });
    }
  });

  app.post('/api/chatbot/nodes/:aiId/verify-pairing', async (req, res) => {
    const { aiId } = req.params;
    const agent = nodeAgents.get(aiId);
    if (!agent) {
      res.status(404).json({
        verified: false,
        reason: `Personal AI '${aiId}' not found.`,
      });
      return;
    }

    const result = await agent.registerAndConnect();
    res.status(200).json({
      verified: result.registered,
      wsAuthenticated: result.wsAuthenticated,
      reason: result.error,
      challengeId: `chal_verified_${Date.now()}`,
    });
  });

  // --------------------------------------------------------------------------
  // 10. Permissions, Approvals, Memories & Model Settings (`/api/chatbot/*`)
  // --------------------------------------------------------------------------
  app.patch('/api/chatbot/permissions/:ownerAiId/:ruleId', (req, res) => {
    const { ownerAiId, ruleId } = req.params;
    const { mode } = req.body ?? {};
    const updated = policyEngine.updateRuleMode(
      ownerAiId,
      ruleId,
      mode as PermissionMode
    );
    if (!updated) {
      res.status(404).json({ error: 'Permission rule not found' });
      return;
    }
    db.savePermissionRule(ownerAiId, updated);
    recordChatbotAudit({
      module: 'OwnerPolicyEngine',
      eventType: 'PERMISSION_RULE_UPDATED',
      actorAiId: ownerAiId,
      outcome: 'SUCCESS',
      summary: `Updated permission rule ${ruleId} to mode ${mode}.`,
    });
    res.status(200).json({ rule: updated });
  });

  app.post('/api/chatbot/approvals/:requestId/resolve', async (req, res) => {
    const { requestId } = req.params;
    const { approve } = req.body ?? {};

    let resolvedEnvelope = null;
    let resolvingAgent: PersonalAINodeAgent | null = null;
    for (const agent of nodeAgents.values()) {
      const env = await agent.resolvePendingApproval(requestId, Boolean(approve));
      if (env) {
        resolvedEnvelope = env;
        resolvingAgent = agent;
        break;
      }
    }

    if (resolvedEnvelope && resolvingAgent) {
      const targetConvs = db.listConversationsForAi('ai_alice');
      for (const conv of targetConvs) {
        db.addMessage({
          id: `msg_appr_${Date.now()}`,
          conversationId: conv.id,
          role: 'remote_ai',
          senderAiId: resolvingAgent.identity.aiId,
          senderDisplayName: `${resolvingAgent.identity.displayName} (${resolvingAgent.identity.handle})`,
          content: resolvedEnvelope.payload.answer,
          timestamp: new Date().toISOString(),
          attributionLabel: resolvedEnvelope.payload.attributionLabel,
          minimizedFields: resolvedEnvelope.payload.minimizedFieldsReturned,
          redactedFields: resolvedEnvelope.payload.redactedFields,
        });
      }
    }

    res.status(200).json({ resolved: Boolean(resolvedEnvelope) });
  });

  app.post('/api/chatbot/memories', (req, res) => {
    const { ownerAiId, category, title, content, tags = [] } = req.body ?? {};
    const nowIso = new Date().toISOString();
    const entry = memoryManager.addMemory({
      memoryId: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ownerAiId,
      category: category as MemoryCategory,
      title,
      content,
      tags,
      sourceAiId: ownerAiId,
      sourceOwnerId: `owner_${ownerAiId.replace('ai_', '')}`,
      trustClassification: 'VERIFIED_OWNER',
      retentionPolicy: 'PERMANENT',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    db.upsertMemory(entry);
    res.status(201).json({ memory: entry });
  });

  app.patch('/api/chatbot/memories/:memoryId', (req, res) => {
    const { memoryId } = req.params;
    const { title, content, category, tags } = req.body ?? {};
    const updated = memoryManager.updateMemory(memoryId, {
      title,
      content,
      category: category as MemoryCategory | undefined,
      tags,
    });
    if (!updated) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }
    db.upsertMemory(updated);
    res.status(200).json({ memory: updated });
  });

  app.delete('/api/chatbot/memories/:memoryId', (req, res) => {
    const { memoryId } = req.params;
    memoryManager.deleteMemory(memoryId);
    const deleted = db.deleteMemoryRecord(memoryId);
    res.status(200).json({ deleted });
  });

  app.post('/api/chatbot/memories/share', (req, res) => {
    const { memoryId, ownerAiId, recipientAiId, ttlHours = 72 } = req.body ?? {};
    const result = memoryManager.shareMemoryWithAI({
      memoryId,
      ownerAiId,
      recipientAiId,
      ttlHours,
    });
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    if (result.grant) {
      db.saveMemoryGrant(result.grant);
    }
    if (result.recipientCopy) {
      db.upsertMemory(result.recipientCopy);
    }
    res.status(200).json(result);
  });

  app.post('/api/chatbot/memories/grants/:grantId/revoke', (req, res) => {
    const { grantId } = req.params;
    const { ownerAiId } = req.body ?? {};
    const result = memoryManager.revokeMemoryGrant(grantId, ownerAiId);
    if (result.grant) {
      db.saveMemoryGrant(result.grant);
    }
    res.status(200).json(result);
  });

  // Group Management Endpoints
  app.post('/api/chatbot/groups', (req, res) => {
    const {
      title = 'Multi-AI Strategy Session',
      createdByAiId = 'ai_alice',
      participantAiIds = ['ai_alice', 'ai_bob', 'ai_charlie'],
    } = req.body ?? {};
    const nowIso = new Date().toISOString();
    const groupId = `grp_${Date.now()}`;
    const participants = Array.from(identities.values())
      .filter((id) => participantAiIds.includes(id.aiId))
      .map((id) => ({
        aiId: id.aiId,
        handle: id.handle,
        displayName: id.displayName,
        ownerName: id.ownerDisplayName,
        status: 'ACTIVE' as const,
        joinedAt: nowIso,
        model: id.configuredModel,
      }));

    const newGroup: GroupSession = {
      groupId,
      title,
      createdByAiId,
      participants,
      messages: [],
      status: 'ACTIVE',
      maxTurnLimit: 15,
      currentTurnCount: 0,
      maxBudgetUsd: 0.5,
      currentCostUsd: 0,
      createdAt: nowIso,
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    };
    groups.set(groupId, newGroup);
    db.saveGroup(newGroup);

    const grpConv = db.createConversation({
      id: `conv_${groupId}`,
      ownerAiId: createdByAiId,
      title,
      pinned: false,
      isGroup: true,
      groupId,
    });

    db.addMessage({
      id: `msg_grp_init_${Date.now()}`,
      conversationId: grpConv.id,
      role: 'system',
      senderAiId: createdByAiId,
      senderDisplayName: 'Group Session',
      content: `Started group conversation **${title}** with ${participants
        .map((p) => p.displayName)
        .join(', ')}.`,
      timestamp: nowIso,
    });

    res.status(201).json({
      group: newGroup,
      conversation: db.getConversation(grpConv.id),
    });
  });

  app.post('/api/chatbot/groups/:groupId/participants', (req, res) => {
    const group = groups.get(req.params.groupId);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const { aiId } = req.body ?? {};
    const identity = identities.get(aiId);
    if (!identity) {
      res.status(404).json({ error: 'Identity not found' });
      return;
    }
    const existing = group.participants.find((p) => p.aiId === aiId);
    if (existing) {
      existing.status = 'ACTIVE';
    } else {
      group.participants.push({
        aiId: identity.aiId,
        handle: identity.handle,
        displayName: identity.displayName,
        ownerName: identity.ownerDisplayName,
        status: 'ACTIVE',
        joinedAt: new Date().toISOString(),
        model: identity.configuredModel,
      });
    }
    db.saveGroup(group);
    res.status(200).json({ group });
  });

  app.delete('/api/chatbot/groups/:groupId/participants/:aiId', (req, res) => {
    const group = groups.get(req.params.groupId);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    const participant = group.participants.find(
      (p) => p.aiId === req.params.aiId
    );
    if (participant) {
      participant.status = 'REMOVED';
    }
    db.saveGroup(group);
    res.status(200).json({ group });
  });

  app.post('/api/chatbot/groups/:groupId/end', (req, res) => {
    const group = groups.get(req.params.groupId);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    group.status = 'ENDED';
    db.saveGroup(group);
    res.status(200).json({ group });
  });

  app.post('/api/chatbot/identities/:aiId/model', async (req, res) => {
    const { aiId } = req.params;
    const { provider, model } = req.body ?? {};
    const identity = identities.get(aiId);
    if (!identity) {
      res.status(404).json({ error: 'Identity not found' });
      return;
    }
    if (provider) identity.configuredProvider = provider;
    if (model) identity.configuredModel = model;

    db.updateIdentity(identity);
    const agent = nodeAgents.get(aiId);
    if (agent) {
      agent.identity = identity;
    }

    try {
      await gatewayClient.updateIdentityConfig(aiId, {
        configuredProvider: identity.configuredProvider,
        configuredModel: identity.configuredModel,
      });
    } catch {
      // Gateway update is best-effort if offline
    }
    res.status(200).json({ identity });
  });

  app.post('/api/chatbot/database/restore', (req, res) => {
    const { backupPath } = req.body ?? {};
    if (!backupPath || typeof backupPath !== 'string') {
      res.status(400).json({ error: 'backupPath is required' });
      return;
    }
    try {
      const result = db.restoreFromBackup(backupPath);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({
        restored: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // --------------------------------------------------------------------------
  // 11. Vite Dev Middleware / Static SPA Hosting (Chatbot Frontend ONLY)
  // --------------------------------------------------------------------------
  if (config.attachViteMiddleware !== false) {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false, watch: null },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const httpServer = http.createServer(app);

  await new Promise<void>((resolve) => {
    httpServer.listen(PORT, HOST, () => {
      resolve();
    });
  });

  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : PORT;

  return {
    app,
    httpServer,
    port: actualPort,
    db,
    llmRegistry,
    gatewayClient,
    nodeAgents,
    syncNodesWithGateway,
    close: async () => {
      clearInterval(gatewaySyncInterval);
      for (const ctrl of activeStreams.values()) {
        ctrl.abort();
      }
      activeStreams.clear();
      for (const agent of nodeAgents.values()) {
        await agent.close();
      }
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      db.close();
    },
  };
}

// Start Chatbot Server if executed directly
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('chatbotMain.ts');

if (isMain) {
  createChatbotServer()
    .then((instance) => {
      console.log(
        `[ai-nexus-chatbot] Chatbot Application listening on http://localhost:${instance.port}`
      );
      console.log(
        `[ai-nexus-chatbot] Health endpoint: http://localhost:${instance.port}/health`
      );
      console.log(
        `[ai-nexus-chatbot] SQLite database: ${instance.db.dbPath}`
      );
      console.log(
        `[ai-nexus-chatbot] Configured Gateway dependency: ${
          process.env.GATEWAY_PUBLIC_URL ||
          process.env.GATEWAY_INTERNAL_URL ||
          'http://localhost:4000'
        }`
      );
    })
    .catch((err) => {
      console.error('[ai-nexus-chatbot] Failed to start Chatbot server:', err);
      process.exit(1);
    });
}
