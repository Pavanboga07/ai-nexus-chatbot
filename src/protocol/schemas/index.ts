// ============================================================================
// @ai-nexus/protocol — Schemas, Validators & Signature Verification (v1.0)
// ============================================================================

import {
  EnvelopeMessageType,
  GatewayErrorCode,
  InvocationState,
  MessageEnvelope,
  NexusProtocolError,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '../types/index.ts';

const VALID_STATE_TRANSITIONS: Record<InvocationState, InvocationState[]> = {
  [InvocationState.CREATED]: [
    InvocationState.SENT,
    InvocationState.FAILED,
    InvocationState.CANCELLED,
  ],
  [InvocationState.SENT]: [
    InvocationState.RECEIVED,
    InvocationState.EXPIRED,
    InvocationState.FAILED,
    InvocationState.CANCELLED,
  ],
  [InvocationState.RECEIVED]: [
    InvocationState.AUTHENTICATED,
    InvocationState.REJECTED,
    InvocationState.EXPIRED,
    InvocationState.FAILED,
  ],
  [InvocationState.AUTHENTICATED]: [
    InvocationState.AUTHORIZED,
    InvocationState.REQUIRES_APPROVAL,
    InvocationState.REJECTED,
    InvocationState.EXPIRED,
  ],
  [InvocationState.REQUIRES_APPROVAL]: [
    InvocationState.AUTHORIZED,
    InvocationState.REJECTED,
    InvocationState.EXPIRED,
    InvocationState.CANCELLED,
  ],
  [InvocationState.AUTHORIZED]: [
    InvocationState.EXECUTING,
    InvocationState.FAILED,
    InvocationState.CANCELLED,
  ],
  [InvocationState.EXECUTING]: [
    InvocationState.RESPONDING,
    InvocationState.FAILED,
    InvocationState.CANCELLED,
    InvocationState.EXPIRED,
  ],
  [InvocationState.RESPONDING]: [
    InvocationState.COMPLETED,
    InvocationState.FAILED,
  ],
  [InvocationState.COMPLETED]: [],
  [InvocationState.REJECTED]: [],
  [InvocationState.FAILED]: [],
  [InvocationState.EXPIRED]: [],
  [InvocationState.CANCELLED]: [],
};

export function canTransitionInvocationState(
  from: InvocationState,
  to: InvocationState
): boolean {
  return VALID_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function computeDeterministicSignature(
  canonicalPayload: string,
  keyFingerprint: string
): string {
  let hash1 = 0x811c9dc5;
  let hash2 = 0xcbf29ce4;
  const input = `${keyFingerprint}::${canonicalPayload}`;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash1 ^= ch;
    hash1 = Math.imul(hash1, 0x01000193);
    hash2 ^= ch;
    hash2 = Math.imul(hash2, 0x100000001b3 & 0xffffffff);
  }
  const hex1 = (hash1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  let out = '';
  const slice = input.slice(0, 24);
  for (let i = 0; i < slice.length; i++) {
    out += slice.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return `ed25519_sig_${hex1}${hex2}_${out.slice(0, 32)}`;
}

export function createSignedMessageEnvelope<TPayload>(params: {
  messageId?: string;
  nonce?: string;
  senderAiId: string;
  recipientAiId: string;
  keyFingerprint: string;
  type?: EnvelopeMessageType;
  messageType?: EnvelopeMessageType;
  correlationId: string;
  idempotencyKey: string;
  payload: TPayload;
  permissionReference?: string;
  ttlSeconds?: number;
  invocationChainDepth?: number;
  invocationChainTrace?: string[];
  nowMs?: number;
}): MessageEnvelope<TPayload> {
  const now = params.nowMs ?? Date.now();
  const messageId =
    params.messageId ?? `msg_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const nonce =
    params.nonce ?? `n_${now}_${Math.random().toString(36).slice(2, 10)}`;
  const envelopeType =
    params.type ?? params.messageType ?? EnvelopeMessageType.INVOCATION_REQUEST;
  const canonical = `${messageId}:${params.correlationId}:${params.senderAiId}:${params.recipientAiId}:${nonce}`;
  const signature = computeDeterministicSignature(canonical, params.keyFingerprint);

  return {
    protocolVersion: '1.0',
    messageId,
    correlationId: params.correlationId,
    idempotencyKey: params.idempotencyKey,
    type: envelopeType,
    senderAiId: params.senderAiId,
    recipientAiId: params.recipientAiId,
    timestamp: new Date(now).toISOString(),
    expiresAt: new Date(now + (params.ttlSeconds ?? 300) * 1000).toISOString(),
    permissionReference: params.permissionReference,
    payload: params.payload,
    security: {
      nonce,
      signature,
      keyFingerprint: params.keyFingerprint,
      algorithm: 'Ed25519-SHA256',
      invocationChainDepth: params.invocationChainDepth ?? 1,
      invocationChainTrace: params.invocationChainTrace ?? [params.senderAiId],
    },
  };
}

export function validateMessageEnvelope(
  envelope: MessageEnvelope<unknown>,
  nowMs: number = Date.now()
): { valid: boolean; error?: NexusProtocolError } {
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(envelope.protocolVersion)) {
    return {
      valid: false,
      error: {
        code: GatewayErrorCode.PROTOCOL_VERSION_UNSUPPORTED,
        message: `Protocol version '${envelope.protocolVersion}' is not supported by AI Nexus Gateway v1.0.`,
        correlationId: envelope.correlationId || 'unknown',
        retryable: false,
      },
    };
  }

  if (
    !envelope.messageId ||
    !envelope.correlationId ||
    !envelope.idempotencyKey ||
    !envelope.senderAiId ||
    !envelope.recipientAiId
  ) {
    return {
      valid: false,
      error: {
        code: GatewayErrorCode.INVALID_MESSAGE,
        message: 'Envelope is missing required routing or correlation identifiers.',
        correlationId: envelope.correlationId || 'unknown',
        retryable: false,
      },
    };
  }

  const expiresMs = Date.parse(envelope.expiresAt);
  if (Number.isNaN(expiresMs) || expiresMs <= nowMs) {
    return {
      valid: false,
      error: {
        code: GatewayErrorCode.REQUEST_EXPIRED,
        message: `Envelope expired at ${envelope.expiresAt}.`,
        correlationId: envelope.correlationId,
        retryable: false,
      },
    };
  }

  if (
    !envelope.security ||
    !envelope.security.nonce ||
    !envelope.security.signature ||
    !envelope.security.keyFingerprint
  ) {
    return {
      valid: false,
      error: {
        code: GatewayErrorCode.AUTHENTICATION_FAILED,
        message: 'Envelope is missing required cryptographic security header.',
        correlationId: envelope.correlationId,
        retryable: false,
      },
    };
  }

  const serializedSize = JSON.stringify(envelope).length;
  if (serializedSize > 65536) {
    return {
      valid: false,
      error: {
        code: GatewayErrorCode.INVALID_MESSAGE,
        message: `Envelope size (${serializedSize} bytes) exceeds maximum allowed limit (65536 bytes).`,
        correlationId: envelope.correlationId,
        retryable: false,
      },
    };
  }

  return { valid: true };
}
