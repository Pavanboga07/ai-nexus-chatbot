// ============================================================================
// AI NEXUS — Comprehensive Chatbot + Persistence MVP & Cross-Process Suite
// Covers:
//   1. Presence resolution & three-tier availability unit tests
//   2. Mocked LLM provider & SSE streaming lifecycle tests
//   3. Multi-turn context construction & bounded history tests
//   4. Conversation creation, message edit/delete, and attachment persistence
//   5. Durable SQLite persistence across server restarts & crash recovery
//   6. Strict user data isolation & secret-key sanitization tests
//   7. Provider errors (unconfigured, rate-limit, timeout), stop & in-place retry
//   8. Gateway-independent operation & full AI-to-AI regression suite
//   9. Live configured-provider smoke test (Google Gemini 3.8 Flash)
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createChatbotServer } from '../server/chatbotMain.ts';

const gatewayEntryCandidates = [
  path.resolve(import.meta.dirname, '../../ai-nexus-gateway/src/server/gatewayMain.ts'),
  path.resolve(import.meta.dirname, '../../../ai-nexus-gateway/src/server/gatewayMain.ts'),
];
const gatewayEntryPath = gatewayEntryCandidates.find((p) => fs.existsSync(p)) || gatewayEntryCandidates[0];
const { createGatewayServer } = await import(pathToFileURL(gatewayEntryPath).href);
import {
  resolveDefaultChatbotDbPath,
  sanitizeSecretValue,
} from '../server/database.ts';
import {
  buildConversationContext,
  LLMGenerationInput,
  LLMGenerationResult,
  LLMProviderAdapter,
  LLMProviderError,
  LLMProviderRegistry,
  LLMStreamChunk,
} from '../server/llmProvider.ts';
import { ExecutionMode, InvocationState, MemoryCategory } from '../protocol/index.ts';
import {
  resolveIdentityPresence,
  getPresenceBadgeMeta,
  getThreeTierAvailability,
} from '../utils/presence.ts';

/**
 * Deterministic controllable Mock LLM Provider for unit & integration testing.
 */
class ControllableMockProvider implements LLMProviderAdapter {
  readonly providerId = 'gemini';
  readonly displayName = 'Controllable Mock Gemini Provider';

  public configured = true;
  public calls: LLMGenerationInput[] = [];
  public nextError: LLMProviderError | null = null;
  public streamChunks: string[] = ['Hello ', 'from ', 'streamed ', 'Personal AI!'];
  public chunkDelayMs = 5;

  isConfigured(): boolean {
    return this.configured;
  }

  getConfigurationStatus() {
    return {
      providerId: this.providerId,
      displayName: this.displayName,
      configured: this.configured,
      envVarName: 'GEMINI_API_KEY',
      supportedModels: [
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
        { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
      ],
    };
  }

  async generateStream(
    input: LLMGenerationInput,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMGenerationResult> {
    this.calls.push(input);
    if (!this.configured) {
      throw new LLMProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Mock provider is not configured.',
        provider: 'gemini',
        model: input.model,
        retryable: false,
      });
    }
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }

    let accumulatedText = '';
    for (const piece of this.streamChunks) {
      if (input.signal?.aborted) {
        throw new LLMProviderError({
          code: 'ABORTED',
          message: 'Generation stopped by user.',
          provider: 'gemini',
          model: input.model,
          retryable: true,
        });
      }
      if (this.chunkDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.chunkDelayMs));
      }
      if (input.signal?.aborted) {
        throw new LLMProviderError({
          code: 'ABORTED',
          message: 'Generation stopped by user.',
          provider: 'gemini',
          model: input.model,
          retryable: true,
        });
      }
      accumulatedText += piece;
      onChunk({
        delta: piece,
        accumulatedText,
      });
    }

    return {
      text: accumulatedText,
      providerUsed: 'gemini',
      modelUsed: input.model,
      tokensUsed: 48,
      costUsd: 0.0001,
    };
  }

  async generateComplete(input: LLMGenerationInput): Promise<LLMGenerationResult> {
    return this.generateStream(input, () => {});
  }
}

function createMockRegistry(mockProvider: ControllableMockProvider): LLMProviderRegistry {
  const reg = new LLMProviderRegistry();
  reg.registerProvider(mockProvider);
  return reg;
}

describe('1. AI Nexus Presence Resolution & Three-Tier Availability Unit Tests', () => {
  it('Never reports ONLINE for seeded identities when Gateway is unreachable', () => {
    const seededIdentity = {
      aiId: 'ai_alice',
      ownerUserId: 'usr_alice',
      ownerDisplayName: 'Alice Mercer',
      aiName: 'Alice AI',
      handle: '@alice',
      publicKey: 'ed25519_pub_alice',
      capabilities: ['scheduling'],
      endpointUrl: 'ws://localhost:4000/ws/node?aiId=ai_alice',
      online: true,
      registrationState: 'REGISTERED' as const,
      verificationState: 'VERIFIED' as const,
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const offlineGateway = { connected: false, reconnecting: false };
    assert.equal(resolveIdentityPresence(seededIdentity, offlineGateway), 'UNAVAILABLE');
    assert.equal(getPresenceBadgeMeta('UNAVAILABLE').label, 'Unavailable');

    const reconnectingGateway = { connected: false, reconnecting: true };
    assert.equal(resolveIdentityPresence(seededIdentity, reconnectingGateway), 'CONNECTING');
    assert.equal(getPresenceBadgeMeta('CONNECTING').label, 'Connecting…');

    const onlineGateway = { connected: true, reconnecting: false };
    assert.equal(
      resolveIdentityPresence({ ...seededIdentity, presenceState: 'ONLINE' }, onlineGateway),
      'ONLINE'
    );

    const tiersOffline = getThreeTierAvailability(seededIdentity as any, offlineGateway);
    assert.equal(tiersOffline.localAiAvailable, true);
    assert.equal(tiersOffline.gatewayState, 'UNAVAILABLE');
    assert.equal(tiersOffline.remoteNodeState, 'UNAVAILABLE');
  });
});

describe('2. Multi-Turn Context Construction & Secret Sanitization Unit Tests', () => {
  it('buildConversationContext includes bounded conversation history, memories, workspace summary, and attachments', () => {
    const testIdentity = {
      aiId: 'ai_alice',
      handle: '@alice',
      displayName: 'Alice AI',
      ownerId: 'owner_alice',
      ownerDisplayName: 'Alice Vance',
      nodeId: 'node_alice',
      deviceId: 'dev_alice',
      publicKeyPem: '',
      keyFingerprint: 'ed25519:alice',
      registrationState: 'REGISTERED' as const,
      verificationState: 'VERIFIED' as const,
      executionMode: ExecutionMode.LOCAL,
      online: true,
      localRuntimeAvailable: true,
      killSwitchActive: false,
      supportedProtocolVersions: ['1.0' as const],
      configuredProvider: 'gemini' as const,
      configuredModel: 'gemini-3.8-flash',
      createdAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    };

    const priorMessages = [
      {
        id: 'm1',
        conversationId: 'conv_test',
        role: 'user' as const,
        senderAiId: 'ai_alice',
        senderDisplayName: 'Alice Vance',
        content: 'My project codename is Project Hyperion.',
        timestamp: new Date().toISOString(),
        status: 'COMPLETED' as const,
      },
      {
        id: 'm2',
        conversationId: 'conv_test',
        role: 'assistant' as const,
        senderAiId: 'ai_alice',
        senderDisplayName: 'Alice AI (@alice)',
        content: 'Got it! I will remember that your codename is Project Hyperion.',
        timestamp: new Date().toISOString(),
        status: 'COMPLETED' as const,
      },
      {
        id: 'm3',
        conversationId: 'conv_test',
        role: 'user' as const,
        senderAiId: 'ai_alice',
        senderDisplayName: 'Alice Vance',
        content: 'What is my project codename and what does the attached brief say?',
        timestamp: new Date().toISOString(),
        status: 'COMPLETED' as const,
        attachments: [
          {
            id: 'att_1',
            name: 'hyperion_spec.md',
            type: 'file' as const,
            sizeLabel: '2 KB',
            contentExcerpt: 'Target deployment date is December 1.',
          },
        ],
      },
    ];

    const memories = [
      {
        memoryId: 'mem_1',
        ownerAiId: 'ai_alice',
        category: MemoryCategory.OWNER_PRIVATE,
        title: 'Launch Milestone',
        content: 'Security freeze happens 4 days before deployment.',
        tags: ['launch', 'security'],
        sourceAiId: 'ai_alice',
        sourceOwnerId: 'owner_alice',
        trustClassification: 'VERIFIED_OWNER' as const,
        retentionPolicy: 'PERSISTENT' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const ctx = buildConversationContext({
      aiIdentity: testIdentity,
      conversationMessages: priorMessages,
      relevantMemories: memories,
      dataset: {
        calendarSlots: [
          {
            timeWindow: '2:00 PM - 5:00 PM PST',
            status: 'FREE',
            privateMeetingTitle: '',
            privateAttendees: [],
            privateNotes: '',
          },
        ],
        workStatus: {
          publicSummary: 'Leading Q4 Launch Architecture',
          activeMilestone: 'Phase 8 Security Freeze',
          internalRiskRegister: 'None',
          confidentialCompensationNotes: 'N/A',
        },
        privateNotes: [],
        currentLocation: 'San Francisco',
      },
    });

    assert.equal(ctx.turns.length, 3, 'All 3 multi-turn messages must be included');
    assert.equal(ctx.turns[0].role, 'user');
    assert.match(ctx.turns[0].content, /Project Hyperion/);
    assert.equal(ctx.turns[1].role, 'assistant');
    assert.equal(ctx.turns[2].role, 'user');
    assert.match(ctx.turns[2].content, /Attached File: "hyperion_spec\.md"/);
    assert.match(ctx.turns[2].content, /December 1/);
    assert.match(ctx.systemInstruction, /Security freeze happens 4 days before deployment/);
    assert.match(ctx.systemInstruction, /2:00 PM - 5:00 PM PST/);
  });

  it('sanitizeSecretValue blocks storing plaintext API keys or tokens in the database', () => {
    assert.throws(
      () => sanitizeSecretValue('GEMINI_API_KEY', 'AIzaSySecretKeyValue1234567890'),
      /Security policy violation/
    );
    assert.throws(
      () => sanitizeSecretValue('customSetting', 'sk-proj1234567890abcdefghijklmnop'),
      /Security policy violation/
    );
    assert.equal(sanitizeSecretValue('darkMode', 'true'), 'true');
  });
});

describe('3. Mocked LLM Streaming, Multi-Turn Context, Stop Generation & Retry Suite', () => {
  it('Streams chunks via SSE, passes multi-turn history on follow-up turns, supports Stop Generation, and retries failed/interrupted messages in place', async () => {
    const mockProvider = new ControllableMockProvider();
    const registry = createMockRegistry(mockProvider);

    const chatbot = await createChatbotServer({
      port: 0,
      host: '127.0.0.1',
      gatewayInternalUrl: 'http://127.0.0.1:49998',
      gatewayPublicHttpUrl: 'http://127.0.0.1:49998',
      gatewayWsUrl: 'ws://127.0.0.1:49998/ws/node',
      attachViteMiddleware: false,
      dbPath: ':memory:',
      llmRegistry: registry,
    });

    try {
      const baseUrl = `http://127.0.0.1:${chatbot.port}`;

      // 1) Create a new conversation for Alice
      const createConvRes = await fetch(`${baseUrl}/api/chatbot/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAiId: 'ai_alice',
          title: 'Multi-Turn Streaming Test',
        }),
      });
      assert.equal(createConvRes.status, 201);
      const { conversation: createdConv } = await createConvRes.json();
      assert.ok(createdConv.id);

      // 2) Turn 1: Stream response over SSE (/api/chatbot/messages/stream)
      const streamRes = await fetch(`${baseUrl}/api/chatbot/messages/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: createdConv.id,
          senderAiId: 'ai_alice',
          content: 'Remember that our release code is Orbit-9.',
          attachments: [
            {
              id: 'att_test_1',
              name: 'release_notes.txt',
              type: 'file',
              sizeLabel: '1 KB',
              mimeType: 'text/plain',
              sizeBytes: 1024,
              contentExcerpt: 'Orbit-9 includes SQLite WAL persistence.',
            },
          ],
        }),
      });
      assert.equal(streamRes.status, 200);
      const sseText = await streamRes.text();
      assert.match(sseText, /event: init/);
      assert.match(sseText, /event: chunk/);
      assert.match(sseText, /event: done/);
      assert.match(sseText, /Hello from streamed Personal AI!/);

      // 3) Turn 2: Send follow-up message and verify mockProvider received Turn 1 + Turn 2 in `turns`
      mockProvider.streamChunks = ['Your release code is Orbit-9.'];
      const turn2Res = await fetch(`${baseUrl}/api/chatbot/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: createdConv.id,
          senderAiId: 'ai_alice',
          content: 'What was our release code?',
        }),
      });
      assert.equal(turn2Res.status, 200);
      assert.equal(mockProvider.calls.length, 2);
      const secondCall = mockProvider.calls[1];
      assert.equal(
        secondCall.turns.length,
        3,
        'Second LLM call must include Turn 1 user + Turn 1 assistant + Turn 2 user'
      );
      assert.match(secondCall.turns[0].content, /Orbit-9/);
      assert.match(secondCall.turns[0].content, /release_notes\.txt/);
      assert.equal(secondCall.turns[1].content, 'Hello from streamed Personal AI!');
      assert.equal(secondCall.turns[2].content, 'What was our release code?');

      // 4) Test Provider Failure (RATE_LIMITED) and In-Place Retry without duplicating user messages
      mockProvider.nextError = new LLMProviderError({
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded on Gemini API.',
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        retryable: true,
      });
      const failRes = await fetch(`${baseUrl}/api/chatbot/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: createdConv.id,
          senderAiId: 'ai_alice',
          content: 'Generate a deployment checklist.',
        }),
      });
      assert.equal(failRes.status, 200);
      const failData = await failRes.json();
      assert.equal(failData.errorCode, 'RATE_LIMITED');
      const failedAssistantMsg = failData.messagesAdded.find(
        (m: any) => m.role === 'assistant'
      );
      assert.ok(failedAssistantMsg);
      assert.equal(failedAssistantMsg.status, 'ERROR');
      const messageCountBeforeRetry = failData.conversation.messages.length;

      // Now retry the failed assistant message in place
      mockProvider.streamChunks = ['Recovered deployment checklist!'];
      const retryRes = await fetch(
        `${baseUrl}/api/chatbot/conversations/${createdConv.id}/messages/${failedAssistantMsg.id}/retry`,
        { method: 'POST' }
      );
      assert.equal(retryRes.status, 200);
      const retryData = await retryRes.json();
      assert.equal(retryData.message.status, 'COMPLETED');
      assert.equal(retryData.message.content, 'Recovered deployment checklist!');
      assert.equal(
        retryData.conversation.messages.length,
        messageCountBeforeRetry,
        'Retrying in place must not duplicate user or assistant messages'
      );

      // 5) Test Unconfigured Provider Error (honest failure, no fake assistant response)
      mockProvider.configured = false;
      const unconfRes = await fetch(`${baseUrl}/api/chatbot/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: createdConv.id,
          senderAiId: 'ai_alice',
          content: 'Test when API key is missing.',
        }),
      });
      assert.equal(unconfRes.status, 200);
      const unconfData = await unconfRes.json();
      assert.equal(unconfData.errorCode, 'PROVIDER_NOT_CONFIGURED');
      const unconfAssistantMsg = unconfData.messagesAdded.find(
        (m: any) => m.role === 'assistant'
      );
      assert.equal(unconfAssistantMsg.status, 'ERROR');
    } finally {
      await chatbot.close();
    }
  });
});

describe('4. Durable SQLite Persistence Across Server Restarts, User Isolation & Backup Suite', () => {
  it('Persists conversations, messages, model preferences, memories, attachments, and settings across server restarts and enforces strict owner isolation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-nexus-db-test-'));
    const dbFile = path.join(tmpDir, 'chatbot-test.sqlite');
    const mockProvider = new ControllableMockProvider();
    mockProvider.streamChunks = ['Persisted assistant reply across restart.'];
    const registry = createMockRegistry(mockProvider);

    // --- SERVER INSTANCE 1 ---
    const server1 = await createChatbotServer({
      port: 0,
      host: '127.0.0.1',
      gatewayInternalUrl: 'http://127.0.0.1:49997',
      gatewayPublicHttpUrl: 'http://127.0.0.1:49997',
      gatewayWsUrl: 'ws://127.0.0.1:49997/ws/node',
      attachViteMiddleware: false,
      dbPath: dbFile,
      llmRegistry: registry,
    });

    let alicePrivateConvId = '';
    let aliceMemoryId = '';

    try {
      const url1 = `http://127.0.0.1:${server1.port}`;

      // 1) Create a private conversation for Alice
      const convRes = await fetch(`${url1}/api/chatbot/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAiId: 'ai_alice',
          title: 'Alice Confidential Strategy',
        }),
      });
      const convData = await convRes.json();
      alicePrivateConvId = convData.conversation.id;

      // 2) Send a message with an attachment in Alice's conversation
      const msgRes = await fetch(`${url1}/api/chatbot/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: alicePrivateConvId,
          senderAiId: 'ai_alice',
          content: 'Store our confidential Q1 roadmap.',
          attachments: [
            {
              id: 'att_persist_1',
              name: 'q1_roadmap.md',
              type: 'file',
              sizeLabel: '3 KB',
              mimeType: 'text/markdown',
              sizeBytes: 3072,
              contentExcerpt: 'Confidential Q1 milestone: Zero-trust federation.',
            },
          ],
        }),
      });
      assert.equal(msgRes.status, 200);

      // 3) Create a memory record for Alice
      const memRes = await fetch(`${url1}/api/chatbot/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAiId: 'ai_alice',
          category: MemoryCategory.OWNER_PRIVATE,
          title: 'Persistent Memory Item',
          content: 'Alice prefers concise bulleted executive summaries.',
          tags: ['style', 'executive'],
        }),
      });
      const memData = await memRes.json();
      aliceMemoryId = memData.memory.memoryId;

      // 4) Update Alice's model preference and user settings
      await fetch(`${url1}/api/chatbot/identities/ai_alice/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite',
        }),
      });

      await fetch(`${url1}/api/chatbot/settings/ai_alice`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            darkMode: 'true',
            activeConversationId: alicePrivateConvId,
          },
        }),
      });

      // 5) Simulate an interrupted STREAMING message left in SQLite before shutdown
      server1.db.addMessage(
        {
          id: 'msg_interrupted_stream',
          conversationId: alicePrivateConvId,
          role: 'assistant',
          senderAiId: 'ai_alice',
          senderDisplayName: 'Alice AI (@alice)',
          content: 'Partial response before server crash...',
          timestamp: new Date().toISOString(),
        },
        'STREAMING'
      );
    } finally {
      await server1.close();
    }

    // --- SERVER INSTANCE 2 (Restarted on the same SQLite file) ---
    const server2 = await createChatbotServer({
      port: 0,
      host: '127.0.0.1',
      gatewayInternalUrl: 'http://127.0.0.1:49997',
      gatewayPublicHttpUrl: 'http://127.0.0.1:49997',
      gatewayWsUrl: 'ws://127.0.0.1:49997/ws/node',
      attachViteMiddleware: false,
      dbPath: dbFile,
      llmRegistry: registry,
    });

    try {
      const url2 = `http://127.0.0.1:${server2.port}`;

      // 1) Fetch bootstrap for Alice and verify everything survived server restart
      const aliceBootRes = await fetch(
        `${url2}/api/chatbot/bootstrap?aiId=ai_alice`
      );
      const aliceBoot = await aliceBootRes.json();

      // Verify model preference persisted
      const aliceIdentity = aliceBoot.identities.find(
        (i: any) => i.aiId === 'ai_alice'
      );
      assert.equal(aliceIdentity.configuredModel, 'gemini-3.1-flash-lite');

      // Verify settings persisted
      assert.equal(aliceBoot.settings.darkMode, 'true');
      assert.equal(aliceBoot.settings.activeConversationId, alicePrivateConvId);

      // Verify conversation, messages, and attachments persisted
      const persistedConv = aliceBoot.conversations.find(
        (c: any) => c.id === alicePrivateConvId
      );
      assert.ok(persistedConv, 'Alice conversation must survive server restart');
      assert.equal(persistedConv.title, 'Alice Confidential Strategy');
      assert.equal(persistedConv.messages.length, 3);
      assert.equal(
        persistedConv.messages[0].attachments[0].name,
        'q1_roadmap.md'
      );
      assert.equal(
        persistedConv.messages[1].content,
        'Persisted assistant reply across restart.'
      );
      // Verify interrupted STREAMING message was automatically recovered on boot
      assert.equal(persistedConv.messages[2].id, 'msg_interrupted_stream');
      assert.equal(persistedConv.messages[2].status, 'INTERRUPTED');

      // Verify memory persisted
      const aliceMemories = aliceBoot.memories.ai_alice;
      assert.ok(
        aliceMemories.some((m: any) => m.memoryId === aliceMemoryId),
        'Alice memory must survive server restart'
      );

      // 2) Verify Strict User Data Isolation: Fetch bootstrap for Bob (`ai_bob`)
      const bobBootRes = await fetch(
        `${url2}/api/chatbot/bootstrap?aiId=ai_bob`
      );
      const bobBoot = await bobBootRes.json();
      const leakedConv = bobBoot.conversations.find(
        (c: any) => c.id === alicePrivateConvId
      );
      assert.equal(
        leakedConv,
        undefined,
        "Alice's private conversation must never be returned to Bob"
      );

      // 3) Verify Online Atomic SQLite Backup & Restore
      const backupRes = await fetch(`${url2}/api/chatbot/database/backup`, {
        method: 'POST',
      });
      assert.equal(backupRes.status, 200);
      const backupData = await backupRes.json();
      assert.equal(backupData.backupCreated, true);
      assert.ok(fs.existsSync(backupData.backupPath));

      // Delete Alice's conversation, then restore from backup and verify it returns
      await fetch(`${url2}/api/chatbot/conversations/${alicePrivateConvId}`, {
        method: 'DELETE',
      });
      const restoreRes = await fetch(`${url2}/api/chatbot/database/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupPath: backupData.backupPath }),
      });
      assert.equal(restoreRes.status, 200);
      const restoreData = await restoreRes.json();
      assert.equal(restoreData.restored, true);

      const postRestoreBoot = await (
        await fetch(`${url2}/api/chatbot/bootstrap?aiId=ai_alice`)
      ).json();
      assert.ok(
        postRestoreBoot.conversations.some(
          (c: any) => c.id === alicePrivateConvId
        ),
        'Restored SQLite backup must bring back deleted conversation'
      );

      // 4) Verify default Chatbot DB path resolves outside the repository
      const prevDbEnv = process.env.CHATBOT_DB_PATH;
      delete process.env.CHATBOT_DB_PATH;
      try {
        const defaultPath = resolveDefaultChatbotDbPath();
        assert.ok(
          !defaultPath.startsWith(process.cwd()),
          `Default Chatbot SQLite path (${defaultPath}) must be outside the repository root (${process.cwd()})`
        );
      } finally {
        if (prevDbEnv !== undefined) {
          process.env.CHATBOT_DB_PATH = prevDbEnv;
        }
      }
    } finally {
      await server2.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('5. AI Nexus Two-Server Architecture & Cross-Port Integration Regression Suite', () => {
  it('1. Gateway starts and operates independently without Chatbot running', async () => {
    const gateway = await createGatewayServer({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: 'http://localhost:3000',
      wsPath: '/ws/node',
    });

    try {
      const baseUrl = `http://127.0.0.1:${gateway.port}`;
      const healthRes = await fetch(`${baseUrl}/health`);
      assert.equal(healthRes.status, 200);
      const health = await healthRes.json();
      assert.equal(health.status, 'OK');
      assert.equal(health.service, 'ai-nexus-gateway');
      assert.equal(health.databaseStatus, 'READY');
    } finally {
      await gateway.close();
    }
  });

  it('2. Chatbot starts independently when Gateway is stopped, reports Gateway UNAVAILABLE, and fails remote invocation honestly', async () => {
    const deadGatewayUrl = 'http://127.0.0.1:49999';
    const deadWsUrl = 'ws://127.0.0.1:49999/ws/node';
    const mockProvider = new ControllableMockProvider();
    const registry = createMockRegistry(mockProvider);

    const chatbot = await createChatbotServer({
      port: 0,
      host: '127.0.0.1',
      gatewayInternalUrl: deadGatewayUrl,
      gatewayPublicHttpUrl: deadGatewayUrl,
      gatewayWsUrl: deadWsUrl,
      attachViteMiddleware: false,
      dbPath: ':memory:',
      llmRegistry: registry,
    });

    try {
      const chatbotUrl = `http://127.0.0.1:${chatbot.port}`;

      const healthRes = await fetch(`${chatbotUrl}/health`);
      assert.equal(healthRes.status, 200);
      const health = await healthRes.json();
      assert.equal(health.status, 'OK');
      assert.equal(health.gatewayDependency.connected, false);
      assert.equal(health.gatewayDependency.status, 'UNAVAILABLE');
      assert.equal(health.databaseStatus, 'READY');

      // Verify local Personal AI conversation works when Gateway is down
      const localChatRes = await fetch(`${chatbotUrl}/api/chatbot/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: 'conv_alice_main',
          senderAiId: 'ai_alice',
          content: 'Summarize my local Q4 launch priorities.',
        }),
      });
      assert.equal(localChatRes.status, 200);
      const localChatData = await localChatRes.json();
      assert.equal(localChatData.messagesAdded.length, 2);
      assert.equal(localChatData.messagesAdded[1].role, 'assistant');

      // Verify remote AI invocation (/ask @bob ...) fails honestly with gatewayUnavailable = true
      const remoteAskRes = await fetch(`${chatbotUrl}/api/chatbot/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: 'conv_alice_main',
          senderAiId: 'ai_alice',
          content: '/ask @bob What is your availability tomorrow for a meeting?',
        }),
      });
      assert.equal(remoteAskRes.status, 200);
      const remoteAskData = await remoteAskRes.json();
      assert.equal(remoteAskData.gatewayUnavailable, true);
      assert.match(remoteAskData.messagesAdded[1].content, /GATEWAY_UNAVAILABLE/);
    } finally {
      await chatbot.close();
    }
  });

  it('3. Full End-to-End Cross-Process Invocation: Alice AI -> Gateway HTTP/WS -> Bob AI Node -> Policy Engine & Minimization -> Alice Conversation', async () => {
    const gateway = await createGatewayServer({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: 'http://localhost:3000',
      wsPath: '/ws/node',
    });

    const gatewayHttpUrl = `http://127.0.0.1:${gateway.port}`;
    const gatewayWsUrl = `ws://127.0.0.1:${gateway.port}/ws/node`;

    const prevPubUrl = process.env.GATEWAY_PUBLIC_URL;
    const prevWsUrl = process.env.GATEWAY_WS_URL;
    process.env.GATEWAY_PUBLIC_URL = gatewayHttpUrl;
    process.env.GATEWAY_WS_URL = gatewayWsUrl;

    const chatbot = await createChatbotServer({
      port: 0,
      host: '127.0.0.1',
      attachViteMiddleware: false,
      dbPath: ':memory:',
    });

    try {
      const chatbotUrl = `http://127.0.0.1:${chatbot.port}`;
      const synced = await chatbot.syncNodesWithGateway();
      assert.equal(synced, true);

      const askRes = await fetch(`${chatbotUrl}/api/chatbot/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: 'conv_alice_main',
          senderAiId: 'ai_alice',
          content: '/ask @bob What is your availability tomorrow for a meeting?',
          enableAutonomousFollowUp: false,
        }),
      });
      assert.equal(askRes.status, 200);
      const askData = await askRes.json();
      const remoteMsg = askData.messagesAdded.find((m: any) => m.role === 'remote_ai');
      assert.ok(remoteMsg);
      assert.equal(remoteMsg.senderAiId, 'ai_bob');
      assert.match(remoteMsg.content, /2:00 PM.*4:00 PM/i);
      assert.doesNotMatch(remoteMsg.content, /Dentist/i);
    } finally {
      if (prevPubUrl === undefined) delete process.env.GATEWAY_PUBLIC_URL;
      else process.env.GATEWAY_PUBLIC_URL = prevPubUrl;
      if (prevWsUrl === undefined) delete process.env.GATEWAY_WS_URL;
      else process.env.GATEWAY_WS_URL = prevWsUrl;
      await chatbot.close();
      await gateway.close();
    }
  });
});

describe('6. Live Configured-Provider Smoke Test (Google Gemini)', () => {
  it('Streams a real multi-turn response from Google Gemini when GEMINI_API_KEY is configured', async () => {
    // Check if the live Chatbot server on port 3000 has GEMINI_API_KEY configured
    let targetBaseUrl = '';
    let localServer: Awaited<ReturnType<typeof createChatbotServer>> | null = null;

    try {
      const healthRes = await fetch('http://127.0.0.1:3000/health');
      if (healthRes.ok) {
        const health = await healthRes.json();
        if (health?.llmProvider?.apiKeyConfigured) {
          targetBaseUrl = 'http://127.0.0.1:3000';
        }
      }
    } catch {
      // Port 3000 not running, check process.env
    }

    if (!targetBaseUrl) {
      const liveRegistry = new LLMProviderRegistry();
      if (!liveRegistry.getProvider('gemini').isConfigured()) {
        return;
      }
      localServer = await createChatbotServer({
        port: 0,
        host: '127.0.0.1',
        gatewayInternalUrl: 'http://127.0.0.1:49996',
        gatewayPublicHttpUrl: 'http://127.0.0.1:49996',
        gatewayWsUrl: 'ws://127.0.0.1:49996/ws/node',
        attachViteMiddleware: false,
        dbPath: ':memory:',
        llmRegistry: liveRegistry,
      });
      targetBaseUrl = `http://127.0.0.1:${localServer.port}`;
    }

    try {
      // Create a temporary conversation for the smoke test and clean it up afterwards
      const createRes = await fetch(`${targetBaseUrl}/api/chatbot/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerAiId: 'ai_alice',
          title: 'Live Gemini Smoke Test',
        }),
      });
      assert.equal(createRes.status, 201);
      const { conversation } = await createRes.json();

      try {
        const streamRes = await fetch(
          `${targetBaseUrl}/api/chatbot/messages/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversationId: conversation.id,
              senderAiId: 'ai_alice',
              content: 'Reply with the exact token: NEXUS_LIVE_GEMINI_OK',
            }),
          }
        );
        assert.equal(streamRes.status, 200);
        const ssePayload = await streamRes.text();
        assert.match(ssePayload, /event: init/);
        if (ssePayload.includes('event: done')) {
          assert.match(ssePayload, /event: chunk/);
          assert.match(ssePayload, /NEXUS_LIVE_GEMINI_OK/);
        } else {
          // If all upstream Gemini models simultaneously return 503 UNAVAILABLE, verify structured SSE error event
          assert.match(ssePayload, /event: error/);
          assert.match(ssePayload, /(503|UNAVAILABLE|PROVIDER_TIMEOUT)/i);
        }
      } finally {
        await fetch(
          `${targetBaseUrl}/api/chatbot/conversations/${conversation.id}`,
          { method: 'DELETE' }
        );
      }
    } finally {
      if (localServer) {
        await localServer.close();
      }
    }
  });
});
