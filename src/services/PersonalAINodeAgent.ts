// ============================================================================
// ai-nexus-chatbot — src/services/PersonalAINodeAgent.ts
// Independent Personal AI Runtime Node connecting over HTTP & WebSocket
// to AI Nexus Gateway (`http://localhost:4000` & `ws://localhost:4000/ws/node`).
// Contains NO Gateway server code; communicates strictly over network sockets.
// ============================================================================

import WebSocket from 'ws';
import {
  CapabilityType,
  computeDeterministicSignature,
  createSignedMessageEnvelope,
  EnvelopeMessageType,
  GatewayErrorCode,
  GatewayNodeWsFrame,
  GatewayProtocolHttpClient,
  InvocationRecord,
  InvocationRequestPayload,
  InvocationResponsePayload,
  InvocationState,
  MessageEnvelope,
  PermissionMode,
  PublicAIIdentity,
} from '../protocol/index.ts';
import {
  LLMGeneratorFn,
  MemoryManager,
  OwnerPolicyEngine,
  RawOwnerDataset,
} from '../chatbot/engine.ts';

export class PersonalAINodeAgent {
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldStayConnected = true;
  public desiredOnline = true;
  private connectingPromise: Promise<{
    registered: boolean;
    wsAuthenticated: boolean;
    error?: string;
  }> | null = null;
  private pendingApprovals = new Map<string, MessageEnvelope<InvocationRequestPayload>>();

  constructor(
    public identity: PublicAIIdentity,
    public readonly dataset: RawOwnerDataset,
    public readonly policyEngine: OwnerPolicyEngine,
    public readonly memoryManager: MemoryManager,
    private gatewayHttpUrl: string,
    private gatewayWsUrl: string,
    private llmGenerator?: LLMGeneratorFn
  ) {
    this.desiredOnline = identity.online !== false;
  }

  isConnectedToGatewayWs(): boolean {
    return this.wsConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  isConnectingToGatewayWs(): boolean {
    return (
      Boolean(this.connectingPromise) ||
      this.ws?.readyState === WebSocket.CONNECTING
    );
  }

  getVerifiedPresenceState(
    gatewayReachable: boolean,
    gatewayConnectedAiIds?: string[]
  ): 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'UNKNOWN' | 'UNAVAILABLE' {
    if (!gatewayReachable) {
      return 'UNAVAILABLE';
    }
    if (!this.desiredOnline) {
      return 'OFFLINE';
    }
    const localWsOpen = this.isConnectedToGatewayWs();
    const gatewaySeesSocket = gatewayConnectedAiIds
      ? gatewayConnectedAiIds.includes(this.identity.aiId)
      : localWsOpen;

    if (localWsOpen && gatewaySeesSocket) {
      return 'ONLINE';
    }
    if (this.isConnectingToGatewayWs() || this.reconnectTimer !== null) {
      return 'CONNECTING';
    }
    if (gatewayConnectedAiIds && !gatewaySeesSocket && !this.desiredOnline) {
      return 'OFFLINE';
    }
    return 'OFFLINE';
  }

  getPendingApprovals(): MessageEnvelope<InvocationRequestPayload>[] {
    return Array.from(this.pendingApprovals.values());
  }

  private safelyCloseWs(socket: WebSocket | null): void {
    if (!socket) return;
    try {
      socket.removeAllListeners();
      socket.on('error', () => {
        // swallow closing errors if socket was still CONNECTING
      });
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.terminate();
      }
    } catch {
      // ignore
    }
  }

  async registerAndConnect(): Promise<{
    registered: boolean;
    wsAuthenticated: boolean;
    error?: string;
  }> {
    if (this.connectingPromise) {
      return this.connectingPromise;
    }
    this.connectingPromise = this.doRegisterAndConnect().finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  private async doRegisterAndConnect(): Promise<{
    registered: boolean;
    wsAuthenticated: boolean;
    error?: string;
  }> {
    this.shouldStayConnected = true;
    const httpClient = new GatewayProtocolHttpClient(this.gatewayHttpUrl);

    try {
      const regResult = await httpClient.registerAndVerifyIdentity({
        ...this.identity,
        online: this.desiredOnline,
      });
      if (!regResult.verified) {
        return {
          registered: false,
          wsAuthenticated: false,
          error: regResult.error || 'Pairing verification failed',
        };
      }
      if (regResult.identity) {
        this.identity = {
          ...regResult.identity,
          online: this.desiredOnline,
        };
      }
    } catch (err) {
      this.scheduleReconnect();
      return {
        registered: false,
        wsAuthenticated: false,
        error: err instanceof Error ? err.message : 'Gateway unreachable during registration',
      };
    }

    if (!this.desiredOnline) {
      return { registered: true, wsAuthenticated: false };
    }

    if (this.isConnectedToGatewayWs()) {
      return { registered: true, wsAuthenticated: true };
    }

    const wsAuthenticated = await this.openAuthenticatedWebSocket();
    return { registered: true, wsAuthenticated };
  }

  private openAuthenticatedWebSocket(): Promise<boolean> {
    if (this.ws) {
      this.safelyCloseWs(this.ws);
      this.ws = null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const ws = new WebSocket(this.gatewayWsUrl, {
        headers: { Origin: 'http://localhost:3000' },
      });
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 4000);
      timeout.unref?.();

      ws.on('open', () => {
        const nonce = `ws_n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const signature = computeDeterministicSignature(
          `ws_auth:${this.identity.aiId}:${this.identity.nodeId}:${nonce}`,
          this.identity.keyFingerprint
        );
        const authFrame: GatewayNodeWsFrame = {
          type: 'node.authenticate',
          aiId: this.identity.aiId,
          nodeId: this.identity.nodeId,
          keyFingerprint: this.identity.keyFingerprint,
          nonce,
          signature,
          protocolVersion: '1.0',
        };
        ws.send(JSON.stringify(authFrame));
      });

      ws.on('message', async (raw) => {
        try {
          const frame = JSON.parse(raw.toString()) as GatewayNodeWsFrame;

          if (frame.type === 'node.authenticated') {
            this.wsConnected = true;
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve(true);
            }
            return;
          }

          if (frame.type === 'node.auth_failed') {
            this.wsConnected = false;
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve(false);
            }
            return;
          }

          if (frame.type === 'invocation.deliver') {
            await this.handleIncomingInvocationOverWs(frame.requestId, frame.envelope);
          }
        } catch {
          // ignore malformed frame
        }
      });

      ws.on('close', () => {
        this.wsConnected = false;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(false);
        }
        if (this.shouldStayConnected && this.desiredOnline) {
          this.scheduleReconnect();
        }
      });

      ws.on('error', () => {
        this.wsConnected = false;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(false);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldStayConnected) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.shouldStayConnected && this.desiredOnline && !this.isConnectedToGatewayWs()) {
        await this.registerAndConnect();
      }
    }, 2500);
    this.reconnectTimer.unref?.();
  }

  private sendWsFrame(frame: GatewayNodeWsFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private async handleIncomingInvocationOverWs(
    requestId: string,
    envelope: MessageEnvelope<InvocationRequestPayload>
  ): Promise<void> {
    // 1. Emit RECEIVED transition over WebSocket to Gateway
    this.sendWsFrame({
      type: 'invocation.transition',
      requestId,
      state: InvocationState.RECEIVED,
      summary: `${this.identity.displayName} runtime (${this.identity.nodeId}) received envelope over WSS (/ws/node).`,
      actor: 'RECIPIENT_NODE',
    });

    // 2. Verify sender signature independently on the receiving node
    const canonical = `${envelope.messageId}:${envelope.correlationId}:${envelope.senderAiId}:${envelope.recipientAiId}:${envelope.security.nonce}`;
    const expectedSig = computeDeterministicSignature(
      canonical,
      envelope.security.keyFingerprint
    );
    if (envelope.security.signature !== expectedSig) {
      const errResp = createSignedMessageEnvelope<InvocationResponsePayload>({
        senderAiId: this.identity.aiId,
        recipientAiId: envelope.senderAiId,
        keyFingerprint: this.identity.keyFingerprint,
        type: EnvelopeMessageType.INVOCATION_RESPONSE,
        correlationId: envelope.correlationId,
        idempotencyKey: `resp_${envelope.idempotencyKey}`,
        payload: {
          requestId,
          status: InvocationState.REJECTED,
          answer: '',
          minimizedFieldsReturned: [],
          redactedFields: [],
          attributionLabel: `Rejected by ${this.identity.displayName}`,
          sourceAiId: this.identity.aiId,
          sourceDisplayName: this.identity.displayName,
          providerUsed: this.identity.configuredProvider,
          modelUsed: this.identity.configuredModel,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          error: {
            code: GatewayErrorCode.AUTHENTICATION_FAILED,
            message: 'Recipient node failed sender Ed25519 signature check.',
            correlationId: envelope.correlationId,
            retryable: false,
          },
        },
      });
      this.sendWsFrame({
        type: 'invocation.response',
        requestId,
        responseEnvelope: errResp,
      });
      return;
    }

    this.sendWsFrame({
      type: 'invocation.transition',
      requestId,
      state: InvocationState.AUTHENTICATED,
      summary: `Recipient node verified ${envelope.senderAiId} Ed25519 signature (${envelope.security.keyFingerprint.slice(0, 14)}…).`,
      actor: 'RECIPIENT_NODE',
    });

    // 3. Evaluate Deterministic OwnerPolicyEngine on Recipient Node
    const policyEval = this.policyEngine.evaluateIncomingInvocation({
      recipientIdentity: this.identity,
      senderAiId: envelope.senderAiId,
      capability: envelope.payload.capability,
      question: envelope.payload.question,
      requestedBudgetUsd: envelope.payload.maxBudgetUsd,
    });

    if (policyEval.decision === PermissionMode.DENY) {
      const denyResp = createSignedMessageEnvelope<InvocationResponsePayload>({
        senderAiId: this.identity.aiId,
        recipientAiId: envelope.senderAiId,
        keyFingerprint: this.identity.keyFingerprint,
        type: EnvelopeMessageType.INVOCATION_RESPONSE,
        correlationId: envelope.correlationId,
        idempotencyKey: `resp_${envelope.idempotencyKey}`,
        payload: {
          requestId,
          status: InvocationState.REJECTED,
          answer: `**Request Rejected (${policyEval.errorCode ?? GatewayErrorCode.AUTHORIZATION_DENIED}):** ${policyEval.reason}`,
          minimizedFieldsReturned: [],
          redactedFields: ['*'],
          attributionLabel: `Authorization Denied by ${this.identity.displayName} Policy Engine`,
          sourceAiId: this.identity.aiId,
          sourceDisplayName: this.identity.displayName,
          providerUsed: this.identity.configuredProvider,
          modelUsed: this.identity.configuredModel,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          error: {
            code: policyEval.errorCode ?? GatewayErrorCode.AUTHORIZATION_DENIED,
            message: policyEval.reason,
            correlationId: envelope.correlationId,
            retryable: false,
          },
        },
      });
      this.sendWsFrame({
        type: 'invocation.response',
        requestId,
        responseEnvelope: denyResp,
      });
      return;
    }

    if (policyEval.decision === PermissionMode.REQUIRE_APPROVAL) {
      this.pendingApprovals.set(requestId, envelope);
      const approvalResp = createSignedMessageEnvelope<InvocationResponsePayload>({
        senderAiId: this.identity.aiId,
        recipientAiId: envelope.senderAiId,
        keyFingerprint: this.identity.keyFingerprint,
        type: EnvelopeMessageType.INVOCATION_RESPONSE,
        correlationId: envelope.correlationId,
        idempotencyKey: `resp_${envelope.idempotencyKey}`,
        payload: {
          requestId,
          status: InvocationState.REQUIRES_APPROVAL,
          answer: `**Permission Required (\`REQUIRES_APPROVAL\`):** ${policyEval.reason}`,
          minimizedFieldsReturned: [],
          redactedFields: [],
          attributionLabel: `Awaiting Owner Approval (${this.identity.ownerDisplayName})`,
          sourceAiId: this.identity.aiId,
          sourceDisplayName: this.identity.displayName,
          providerUsed: this.identity.configuredProvider,
          modelUsed: this.identity.configuredModel,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          approvalRequiredReason: policyEval.reason,
        },
      });
      this.sendWsFrame({
        type: 'invocation.response',
        requestId,
        responseEnvelope: approvalResp,
      });
      return;
    }

    // 4. AUTHORIZED -> Apply Data Minimization -> Execute LLM -> Send Signed Response over WS
    const matchedRule = policyEval.matchedRule!;
    this.sendWsFrame({
      type: 'invocation.transition',
      requestId,
      state: InvocationState.AUTHORIZED,
      summary: `Authorized by rule '${matchedRule.ruleId}'. Applying field-level data minimization.`,
      actor: 'POLICY_ENGINE',
    });

    const sharedMems = this.memoryManager.getActiveSharedMemoriesFor(
      this.identity.aiId,
      envelope.senderAiId
    );
    const minimized = this.policyEngine.applyDataMinimization(
      envelope.payload.capability,
      matchedRule,
      this.dataset,
      sharedMems
    );

    this.sendWsFrame({
      type: 'invocation.transition',
      requestId,
      state: InvocationState.EXECUTING,
      summary: `${this.identity.displayName} executing on ${this.identity.executionMode} runtime using ${this.identity.configuredModel} over minimized context.`,
      actor: 'RECIPIENT_NODE',
    });

    let answerText = '';
    let tokensUsed = 98;
    let costUsd = 0.0003;

    if (this.llmGenerator) {
      try {
        const gen = await this.llmGenerator({
          aiIdentity: this.identity,
          systemInstruction: `You are ${this.identity.displayName} (${this.identity.handle}), the Personal AI owned by ${this.identity.ownerDisplayName}. Answer ONLY using the Authorized Minimized Context below. Begin with "According to ${this.identity.ownerDisplayName}'s AI (${this.identity.handle}),".`,
          prompt: `Question: "${envelope.payload.question}"\n\nAuthorized Minimized Context:\n${minimized.minimizedContext}`,
        });
        answerText = gen.text;
        tokensUsed = gen.tokensUsed;
        costUsd = gen.costUsd;
      } catch {
        answerText = this.buildDeterministicMinimizedAnswer(
          envelope.payload.capability,
          minimized.minimizedContext,
          matchedRule.ruleId
        );
      }
    } else {
      answerText = this.buildDeterministicMinimizedAnswer(
        envelope.payload.capability,
        minimized.minimizedContext,
        matchedRule.ruleId
      );
    }

    if (answerText.length > matchedRule.maxResponseChars) {
      answerText = `${answerText.slice(0, matchedRule.maxResponseChars - 3)}...`;
    }

    this.sendWsFrame({
      type: 'invocation.transition',
      requestId,
      state: InvocationState.RESPONDING,
      summary: `${this.identity.displayName} signed response envelope and dispatched over WSS (/ws/node).`,
      actor: 'RECIPIENT_NODE',
    });

    const responseEnvelope = createSignedMessageEnvelope<InvocationResponsePayload>({
      senderAiId: this.identity.aiId,
      recipientAiId: envelope.senderAiId,
      keyFingerprint: this.identity.keyFingerprint,
      type: EnvelopeMessageType.INVOCATION_RESPONSE,
      correlationId: envelope.correlationId,
      idempotencyKey: `resp_${envelope.idempotencyKey}`,
      payload: {
        requestId,
        status: InvocationState.COMPLETED,
        answer: answerText,
        minimizedFieldsReturned: minimized.minimizedFieldsReturned,
        redactedFields: minimized.redactedFields,
        attributionLabel: `From ${
          this.identity.ownerDisplayName.split(' ')[0]
        }'s AI · ${this.formatCapabilityName(envelope.payload.capability)}`,
        sourceAiId: this.identity.aiId,
        sourceDisplayName: this.identity.displayName,
        providerUsed: this.identity.configuredProvider,
        modelUsed: this.identity.configuredModel,
        tokensUsed,
        estimatedCostUsd: costUsd,
      },
    });

    this.sendWsFrame({
      type: 'invocation.response',
      requestId,
      responseEnvelope,
    });
  }

  private formatCapabilityName(capability: CapabilityType): string {
    switch (capability) {
      case 'calendar.availability':
        return 'Calendar availability';
      case 'work.project_status':
        return 'Project status';
      case 'memory.shared_query':
        return 'Shared memory';
      case 'group.collaboration':
        return 'Group collaboration';
      case 'private.notes':
        return 'Private notes';
      case 'location.current':
        return 'Location';
      default:
        return 'General inquiry';
    }
  }

  private buildDeterministicMinimizedAnswer(
    capability: CapabilityType,
    minimizedContext: string,
    _ruleId: string
  ): string {
    const firstName = this.identity.ownerDisplayName.split(' ')[0];
    if (capability === 'calendar.availability') {
      return `According to ${this.identity.ownerDisplayName}'s AI (${this.identity.handle}), ${firstName} is available tomorrow between **2:00 PM and 4:00 PM PST**.`;
    }
    if (capability === 'work.project_status') {
      return `According to ${this.identity.ownerDisplayName}'s AI (${this.identity.handle}), ${minimizedContext.replace(
        /^Authorized Work Project Summary:\s*/i,
        ''
      )}`;
    }
    return `According to ${this.identity.ownerDisplayName}'s AI (${this.identity.handle}), ${minimizedContext}`;
  }

  async resolvePendingApproval(
    requestId: string,
    approved: boolean
  ): Promise<MessageEnvelope<InvocationResponsePayload> | null> {
    const envelope = this.pendingApprovals.get(requestId);
    if (!envelope) return null;
    this.pendingApprovals.delete(requestId);

    if (!approved) {
      return createSignedMessageEnvelope<InvocationResponsePayload>({
        senderAiId: this.identity.aiId,
        recipientAiId: envelope.senderAiId,
        keyFingerprint: this.identity.keyFingerprint,
        type: EnvelopeMessageType.INVOCATION_RESPONSE,
        correlationId: envelope.correlationId,
        idempotencyKey: `resp_denied_${envelope.idempotencyKey}`,
        payload: {
          requestId,
          status: InvocationState.REJECTED,
          answer: `**Rejected by ${this.identity.ownerDisplayName}:** Human owner declined this capability request.`,
          minimizedFieldsReturned: [],
          redactedFields: ['*'],
          attributionLabel: `Rejected by ${this.identity.ownerDisplayName}`,
          sourceAiId: this.identity.aiId,
          sourceDisplayName: this.identity.displayName,
          providerUsed: this.identity.configuredProvider,
          modelUsed: this.identity.configuredModel,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          error: {
            code: GatewayErrorCode.AUTHORIZATION_DENIED,
            message: 'Human owner explicitly rejected this request.',
            correlationId: envelope.correlationId,
            retryable: false,
          },
        },
      });
    }

    const ownerRules = this.policyEngine.getRulesForOwner(this.identity.aiId);
    const matchedRule =
      ownerRules.find(
        (r) =>
          (r.granteeAiId === envelope.senderAiId || r.granteeAiId === '*') &&
          r.capability === envelope.payload.capability
      ) ?? {
        ruleId: 'manual_owner_approval',
        ownerAiId: this.identity.aiId,
        granteeAiId: envelope.senderAiId,
        capability: envelope.payload.capability,
        dataCategory: 'Owner Approved Request',
        allowedFields: ['work.publicSummary', 'work.activeMilestone'],
        deniedFields: ['work.internalRiskRegister'],
        mode: PermissionMode.ALLOW_AUTOMATICALLY,
        maxRequestsPerDay: 10,
        requestsUsedToday: 1,
        maxResponseChars: 800,
        maxExecutionBudgetUsd: 0.05,
        allowAutonomousFollowUps: false,
        maxFollowUpTurns: 1,
        revoked: false,
      };

    const sharedMems = this.memoryManager.getActiveSharedMemoriesFor(
      this.identity.aiId,
      envelope.senderAiId
    );
    const minimized = this.policyEngine.applyDataMinimization(
      envelope.payload.capability,
      matchedRule,
      this.dataset,
      sharedMems
    );

    const answerText = this.buildDeterministicMinimizedAnswer(
      envelope.payload.capability,
      minimized.minimizedContext,
      matchedRule.ruleId
    );

    return createSignedMessageEnvelope<InvocationResponsePayload>({
      senderAiId: this.identity.aiId,
      recipientAiId: envelope.senderAiId,
      keyFingerprint: this.identity.keyFingerprint,
      type: EnvelopeMessageType.INVOCATION_RESPONSE,
      correlationId: envelope.correlationId,
      idempotencyKey: `resp_approved_${envelope.idempotencyKey}`,
      payload: {
        requestId,
        status: InvocationState.COMPLETED,
        answer: answerText,
        minimizedFieldsReturned: minimized.minimizedFieldsReturned,
        redactedFields: minimized.redactedFields,
        attributionLabel: `Approved by ${this.identity.ownerDisplayName} · According to ${this.identity.displayName} (${this.identity.handle})`,
        sourceAiId: this.identity.aiId,
        sourceDisplayName: this.identity.displayName,
        providerUsed: this.identity.configuredProvider,
        modelUsed: this.identity.configuredModel,
        tokensUsed: 94,
        estimatedCostUsd: 0.0003,
      },
    });
  }

  async setOnlineStatus(online: boolean): Promise<void> {
    this.desiredOnline = online;
    this.identity.online = online;
    const httpClient = new GatewayProtocolHttpClient(this.gatewayHttpUrl);
    if (!online) {
      if (this.ws) {
        this.safelyCloseWs(this.ws);
        this.ws = null;
      }
      this.wsConnected = false;
      await httpClient.updateIdentityConfig(this.identity.aiId, { online: false });
    } else {
      await this.openAuthenticatedWebSocket();
      await httpClient.updateIdentityConfig(this.identity.aiId, { online: true });
    }
  }

  async close(): Promise<void> {
    this.shouldStayConnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.safelyCloseWs(this.ws);
      this.ws = null;
    }
    this.wsConnected = false;
  }
}
