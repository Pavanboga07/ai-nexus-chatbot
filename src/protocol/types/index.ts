// ============================================================================
// @ai-nexus/protocol — Types & Enums (v1.0)
// ============================================================================

export const SUPPORTED_PROTOCOL_VERSIONS = ['1.0'] as const;
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export enum InvocationState {
  CREATED = 'CREATED',
  SENT = 'SENT',
  RECEIVED = 'RECEIVED',
  AUTHENTICATED = 'AUTHENTICATED',
  AUTHORIZED = 'AUTHORIZED',
  EXECUTING = 'EXECUTING',
  RESPONDING = 'RESPONDING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  REQUIRES_APPROVAL = 'REQUIRES_APPROVAL',
}

export enum PermissionMode {
  ALLOW_AUTOMATICALLY = 'ALLOW_AUTOMATICALLY',
  REQUIRE_APPROVAL = 'REQUIRE_APPROVAL',
  DENY = 'DENY',
}

export enum MemoryCategory {
  OWNER_PRIVATE = 'owner_private',
  EXTERNAL_AI = 'external_ai',
  SHARED_CONTEXT = 'shared_context',
  SYSTEM_KNOWLEDGE = 'system_knowledge',
}

export enum ExecutionMode {
  LOCAL = 'LOCAL',
  CLOUD = 'CLOUD',
  HYBRID = 'HYBRID',
}

export enum GatewayErrorCode {
  IDENTITY_NOT_FOUND = 'IDENTITY_NOT_FOUND',
  IDENTITY_REVOKED = 'IDENTITY_REVOKED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  AUTHORIZATION_DENIED = 'AUTHORIZATION_DENIED',
  PERMISSION_EXPIRED = 'PERMISSION_EXPIRED',
  PERMISSION_REQUIRED = 'PERMISSION_REQUIRED',
  NODE_OFFLINE = 'NODE_OFFLINE',
  REQUEST_EXPIRED = 'REQUEST_EXPIRED',
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',
  RATE_LIMITED = 'RATE_LIMITED',
  PROTOCOL_VERSION_UNSUPPORTED = 'PROTOCOL_VERSION_UNSUPPORTED',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  GROUP_SESSION_CLOSED = 'GROUP_SESSION_CLOSED',
  LOOP_DETECTED = 'LOOP_DETECTED',
  PROMPT_INJECTION_BLOCKED = 'PROMPT_INJECTION_BLOCKED',
  GATEWAY_UNAVAILABLE = 'GATEWAY_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export enum EnvelopeMessageType {
  INVOCATION_REQUEST = 'ai.invocation.request',
  INVOCATION_RESPONSE = 'ai.invocation.response',
  GROUP_SESSION_MESSAGE = 'ai.group.message',
  GROUP_BROADCAST = 'ai.group.broadcast',
  DELIVERY_ACK = 'ai.delivery.ack',
  MEMORY_SHARE_GRANT = 'ai.memory.grant',
  MEMORY_WITHDRAWAL = 'ai.memory.withdrawal',
}

export type CapabilityType =
  | 'calendar.availability'
  | 'work.project_status'
  | 'memory.shared_query'
  | 'group.collaboration'
  | 'private.notes'
  | 'location.current'
  | 'general.inquiry';

export interface NexusProtocolError {
  code: GatewayErrorCode;
  message: string;
  correlationId: string;
  retryable: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export type PresenceState =
  | 'ONLINE'
  | 'OFFLINE'
  | 'CONNECTING'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

export interface PublicAIIdentity {
  aiId: string;
  handle: string;
  displayName: string;
  ownerId: string;
  ownerDisplayName: string;
  nodeId: string;
  deviceId: string;
  publicKeyPem: string;
  keyFingerprint: string;
  registrationState: 'REGISTERED' | 'PENDING_CHALLENGE' | 'REVOKED';
  verificationState: 'VERIFIED' | 'UNVERIFIED' | 'REVOKED';
  executionMode: ExecutionMode;
  online: boolean;
  presenceState?: PresenceState;
  localRuntimeAvailable?: boolean;
  remoteNodeAvailable?: boolean;
  gatewayAvailable?: boolean;
  desiredOnline?: boolean;
  killSwitchActive: boolean;
  supportedProtocolVersions: ProtocolVersion[];
  configuredProvider: 'gemini' | 'openai' | 'anthropic' | 'local';
  configuredModel: string;
  createdAt: string;
  lastHeartbeatAt: string;
  revokedAt?: string;
}

export interface PairingChallenge {
  challengeId: string;
  aiId: string;
  nodeId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  verified: boolean;
}

export interface EnvelopeSecurityHeader {
  nonce: string;
  signature: string;
  keyFingerprint: string;
  algorithm: 'Ed25519-SHA256';
  invocationChainDepth: number;
  invocationChainTrace: string[];
}

export interface MessageEnvelope<TPayload = unknown> {
  protocolVersion: ProtocolVersion;
  messageId: string;
  correlationId: string;
  idempotencyKey: string;
  type: EnvelopeMessageType;
  senderAiId: string;
  recipientAiId: string;
  timestamp: string;
  expiresAt: string;
  permissionReference?: string;
  payload: TPayload;
  security: EnvelopeSecurityHeader;
}

export interface InvocationRequestPayload {
  requestId?: string;
  purpose?: string;
  capability: CapabilityType;
  question: string;
  structuredParameters?: Record<string, string | number | boolean>;
  maxResponseChars?: number;
  maxFollowUpTurns: number;
  currentTurn?: number;
  followUpTurn?: number;
  maxBudgetUsd: number;
  accumulatedCostUsd?: number;
  invocationChainTrace?: string[];
  conversationId?: string;
  queueIfOffline: boolean;
  groupId?: string;
}

export interface InvocationResponsePayload {
  requestId: string;
  status: InvocationState;
  answer: string;
  minimizedFieldsReturned: string[];
  redactedFields: string[];
  attributionLabel: string;
  sourceAiId: string;
  sourceDisplayName: string;
  providerUsed: string;
  modelUsed: string;
  tokensUsed: number;
  estimatedCostUsd: number;
  requiresFollowUp?: boolean;
  followUpQuestion?: string;
  approvalRequiredReason?: string;
  error?: NexusProtocolError;
}

export interface InvocationStateTransition {
  state: InvocationState;
  timestamp: string;
  summary: string;
  actor: 'SENDER_NODE' | 'GATEWAY' | 'RECIPIENT_NODE' | 'POLICY_ENGINE';
}

export interface InvocationRecord {
  requestId: string;
  correlationId: string;
  idempotencyKey: string;
  senderAiId: string;
  recipientAiId: string;
  capability: CapabilityType;
  question: string;
  state: InvocationState;
  transitions: InvocationStateTransition[];
  envelope: MessageEnvelope<InvocationRequestPayload>;
  responseEnvelope?: MessageEnvelope<InvocationResponsePayload>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  queuedOffline: boolean;
  approvalRequiredReason?: string;
}

export interface PermissionRule {
  ruleId: string;
  ownerAiId: string;
  granteeAiId: string | '*';
  capability: CapabilityType;
  dataCategory: string;
  allowedFields: string[];
  deniedFields: string[];
  mode: PermissionMode;
  maxRequestsPerDay: number;
  requestsUsedToday: number;
  maxResponseChars: number;
  maxExecutionBudgetUsd: number;
  allowAutonomousFollowUps: boolean;
  maxFollowUpTurns: number;
  expiresAt?: string;
  revoked: boolean;
}

export interface MemoryEntry {
  memoryId: string;
  ownerAiId: string;
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  sourceAiId: string;
  sourceOwnerId: string;
  sourceConversationId?: string;
  sourceRequestId?: string;
  permissionReference?: string;
  trustClassification:
    | 'VERIFIED_OWNER'
    | 'ATTRIBUTED_EXTERNAL_AI'
    | 'SHARED_GROUP_CONTEXT'
    | 'SYSTEM';
  retentionPolicy: 'PERMANENT' | 'PERSISTENT' | 'EPHEMERAL_SESSION' | 'TIME_LIMITED';
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  revoked?: boolean;
}

export interface MemoryShareGrant {
  grantId: string;
  memoryId: string;
  ownerAiId: string;
  recipientAiId: string;
  capability: CapabilityType;
  readOnly: true;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  revokedAt?: string;
  withdrawalNoticeSent?: boolean;
}

export interface GroupParticipant {
  aiId: string;
  handle: string;
  displayName: string;
  ownerName: string;
  status: 'ACTIVE' | 'IDLE' | 'INVITED' | 'REMOVED';
  joinedAt: string;
  model: string;
}

export interface GroupMessage {
  messageId: string;
  groupId: string;
  senderType: 'HUMAN_OWNER' | 'PERSONAL_AI' | 'SYSTEM';
  senderAiId: string;
  senderDisplayName: string;
  content: string;
  attributionLabel?: string;
  timestamp: string;
  turnNumber: number;
  tokensUsed?: number;
  costUsd?: number;
}

export interface GroupSession {
  groupId: string;
  title: string;
  createdByAiId: string;
  participants: GroupParticipant[];
  messages: GroupMessage[];
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  maxTurnLimit: number;
  currentTurnCount: number;
  maxBudgetUsd: number;
  currentCostUsd: number;
  createdAt: string;
  expiresAt: string;
}

export interface AuditEventRecord {
  eventId: string;
  timestamp: string;
  repository: 'ai-nexus-gateway' | 'ai-nexus-chatbot';
  module: string;
  eventType: string;
  actorAiId: string;
  targetAiId?: string;
  correlationId?: string;
  outcome: 'SUCCESS' | 'DENIED' | 'QUARANTINED' | 'QUEUED' | 'REVOKED' | 'ERROR' | 'PENDING';
  summary: string;
  metadata?: Record<string, string | number | boolean>;
}
