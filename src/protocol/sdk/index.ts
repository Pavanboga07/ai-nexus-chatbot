// ============================================================================
// @ai-nexus/protocol — Public HTTP & WebSocket Client SDK (v1.0)
// Used by `ai-nexus-chatbot` and Personal AI Nodes to talk to `ai-nexus-gateway`
// ============================================================================

import {
  AuditEventRecord,
  ExecutionMode,
  GatewayErrorCode,
  InvocationRecord,
  InvocationRequestPayload,
  MessageEnvelope,
  PairingChallenge,
  PublicAIIdentity,
} from '../types/index.ts';
import { computeDeterministicSignature } from '../schemas/index.ts';

export interface GatewayHealthResponse {
  status: 'OK' | 'DEGRADED';
  service: 'ai-nexus-gateway';
  protocolVersion: '1.0';
  supportedProtocolVersions: string[];
  databaseReady: boolean;
  wsTransportActive: boolean;
  wsPath: string;
  registeredIdentitiesCount: number;
  connectedNodesCount: number;
  connectedNodeAiIds: string[];
  queuedMessagesCount: number;
  activeInvocationsCount: number;
  timestamp: string;
}

export class GatewayProtocolHttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async checkHealth(timeoutMs: number = 2000): Promise<{
    reachable: boolean;
    health?: GatewayHealthResponse;
    error?: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        return { reachable: false, error: `Gateway returned HTTP ${res.status}` };
      }
      const health = (await res.json()) as GatewayHealthResponse;
      return { reachable: true, health };
    } catch (err) {
      return {
        reachable: false,
        error: err instanceof Error ? err.message : 'Gateway unreachable',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async registerAndVerifyIdentity(identity: PublicAIIdentity): Promise<{
    verified: boolean;
    challenge?: PairingChallenge;
    identity?: PublicAIIdentity;
    error?: string;
  }> {
    // Step 1: Request short-lived pairing challenge from Gateway
    const chalRes = await fetch(`${this.baseUrl}/api/v1/pairing/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiId: identity.aiId,
        nodeId: identity.nodeId,
        identity,
      }),
    });
    if (!chalRes.ok) {
      const text = await chalRes.text();
      return { verified: false, error: `Challenge creation failed: ${text}` };
    }
    const { challenge } = (await chalRes.json()) as { challenge: PairingChallenge };

    // Step 2: Sign challenge locally with node's Ed25519 key
    const signature = computeDeterministicSignature(
      `${challenge.challengeId}:${challenge.nonce}:${challenge.aiId}`,
      identity.keyFingerprint
    );

    // Step 3: Submit signed proof of possession to Gateway
    const verRes = await fetch(`${this.baseUrl}/api/v1/pairing/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        aiId: identity.aiId,
        keyFingerprint: identity.keyFingerprint,
        signature,
      }),
    });
    const verData = (await verRes.json()) as {
      verified?: boolean;
      identity?: PublicAIIdentity;
      reason?: string;
    };
    return {
      verified: Boolean(verData.verified),
      challenge,
      identity: verData.identity,
      error: verData.reason,
    };
  }

  async listIdentities(): Promise<PublicAIIdentity[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/identities`);
    if (!res.ok) throw new Error(`Gateway HTTP ${res.status}`);
    const data = (await res.json()) as { identities?: PublicAIIdentity[] };
    return data.identities ?? [];
  }

  async rotateKey(aiId: string): Promise<PublicAIIdentity> {
    const res = await fetch(`${this.baseUrl}/api/v1/identities/${encodeURIComponent(aiId)}/rotate-key`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`Key rotation failed: HTTP ${res.status}`);
    const data = (await res.json()) as { identity: PublicAIIdentity };
    return data.identity;
  }

  async rotateIdentityKey(aiId: string): Promise<PublicAIIdentity> {
    return this.rotateKey(aiId);
  }

  async updateIdentityConfig(
    aiId: string,
    updates: {
      online?: boolean;
      executionMode?: ExecutionMode;
      killSwitchActive?: boolean;
      configuredProvider?: PublicAIIdentity['configuredProvider'];
      configuredModel?: string;
    }
  ): Promise<{
    identity: PublicAIIdentity;
    deliveredRecords?: InvocationRecord[];
  }> {
    const res = await fetch(`${this.baseUrl}/api/v1/identities/${encodeURIComponent(aiId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Status update failed: HTTP ${res.status}`);
    return (await res.json()) as {
      identity: PublicAIIdentity;
      deliveredRecords?: InvocationRecord[];
    };
  }

  async sendInvocation(
    envelope: MessageEnvelope<InvocationRequestPayload>,
    timeoutMs: number = 12000
  ): Promise<{
    accepted: boolean;
    queued: boolean;
    duplicate: boolean;
    record?: InvocationRecord;
    error?: { code: GatewayErrorCode; message: string };
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/invocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envelope }),
        signal: controller.signal,
      });
      const data = (await res.json()) as {
        accepted: boolean;
        queued: boolean;
        duplicate: boolean;
        record?: InvocationRecord;
        error?: { code: GatewayErrorCode; message: string };
      };
      return data;
    } catch (err) {
      return {
        accepted: false,
        queued: false,
        duplicate: false,
        error: {
          code: GatewayErrorCode.GATEWAY_UNAVAILABLE,
          message: `Cannot reach AI Nexus Gateway at ${this.baseUrl}: ${
            err instanceof Error ? err.message : 'Network error'
          }`,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async listInvocations(): Promise<{
    invocations: InvocationRecord[];
    queuedOffline: InvocationRecord[];
  }> {
    const res = await fetch(`${this.baseUrl}/api/v1/invocations`);
    if (!res.ok) throw new Error(`Gateway HTTP ${res.status}`);
    return (await res.json()) as {
      invocations: InvocationRecord[];
      queuedOffline: InvocationRecord[];
    };
  }

  async listAuditEvents(): Promise<AuditEventRecord[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/audit`);
    if (!res.ok) throw new Error(`Gateway HTTP ${res.status}`);
    const data = (await res.json()) as { events?: AuditEventRecord[] };
    return data.events ?? [];
  }
}
