// ============================================================================
// AI NEXUS CHATBOT — Pure Domain Engine (`ai-nexus-chatbot`)
// Contains NO Gateway server modules, NO Gateway imports, NO shared transport.
// ============================================================================

import {
  CapabilityType,
  ExecutionMode,
  GatewayErrorCode,
  GroupParticipant,
  GroupSession,
  InvocationRecord,
  MemoryCategory,
  MemoryEntry,
  MemoryShareGrant,
  PermissionMode,
  PermissionRule,
  PublicAIIdentity,
} from '../protocol/index.ts';

// ----------------------------------------------------------------------------
// 1. CommandParser & IntentRouter
// ----------------------------------------------------------------------------

export type ParsedCommandType =
  | 'DIRECT_CHAT'
  | 'ASK_REMOTE_AI'
  | 'ASK_ALL_GROUP'
  | 'GROUP_CREATE'
  | 'GROUP_INVITE'
  | 'GROUP_REMOVE'
  | 'GROUP_END'
  | 'SHARE_MEMORY'
  | 'REVOKE_MEMORY'
  | 'OPEN_NETWORK'
  | 'OPEN_PERMISSIONS';

export interface ParsedUserCommand {
  type: ParsedCommandType;
  rawInput: string;
  targetHandle?: string;
  questionOrContent?: string;
  inferredCapability: CapabilityType;
  isNaturalLanguageIntent: boolean;
  autonomousFollowUpRequested?: boolean;
}

export class CommandParser {
  static inferCapability(text: string): CapabilityType {
    const lower = text.toLowerCase();
    if (
      lower.includes('availab') ||
      lower.includes('calendar') ||
      lower.includes('free') ||
      lower.includes('schedule') ||
      lower.includes('meeting') ||
      lower.includes('tomorrow') ||
      lower.includes('time slot')
    ) {
      return 'calendar.availability';
    }
    if (
      lower.includes('private note') ||
      lower.includes('diary') ||
      lower.includes('journal') ||
      lower.includes('secret') ||
      lower.includes('password')
    ) {
      return 'private.notes';
    }
    if (
      lower.includes('where are you') ||
      lower.includes('location') ||
      lower.includes('gps') ||
      lower.includes('address')
    ) {
      return 'location.current';
    }
    if (
      lower.includes('memory') ||
      lower.includes('preference') ||
      lower.includes('shared')
    ) {
      return 'memory.shared_query';
    }
    if (
      lower.includes('project') ||
      lower.includes('proposal') ||
      lower.includes('roadmap') ||
      lower.includes('status') ||
      lower.includes('work') ||
      lower.includes('deployment') ||
      lower.includes('budget') ||
      lower.includes('risk')
    ) {
      return 'work.project_status';
    }
    return 'general.inquiry';
  }

  static parse(input: string): ParsedUserCommand {
    const trimmed = input.trim();

    const askMatch = trimmed.match(/^\/ask\s+(@?[a-zA-Z0-9_-]+)\s+([\s\S]+)$/i);
    if (askMatch) {
      const handle = askMatch[1].startsWith('@')
        ? askMatch[1].toLowerCase()
        : `@${askMatch[1].toLowerCase()}`;
      const question = askMatch[2].trim();
      return {
        type: 'ASK_REMOTE_AI',
        rawInput: trimmed,
        targetHandle: handle,
        questionOrContent: question,
        inferredCapability: this.inferCapability(question),
        isNaturalLanguageIntent: false,
        autonomousFollowUpRequested:
          question.toLowerCase().includes('coordinate') ||
          question.toLowerCase().includes('book') ||
          question.toLowerCase().includes('confirm a slot') ||
          question.toLowerCase().includes('follow up'),
      };
    }

    const askAllMatch = trimmed.match(/^\/ask-all\s+([\s\S]+)$/i);
    if (askAllMatch) {
      const question = askAllMatch[1].trim();
      return {
        type: 'ASK_ALL_GROUP',
        rawInput: trimmed,
        questionOrContent: question,
        inferredCapability: 'group.collaboration',
        isNaturalLanguageIntent: false,
      };
    }

    if (/^\/group\s+create/i.test(trimmed)) {
      const title =
        trimmed.replace(/^\/group\s+create\s*/i, '').trim() ||
        'Cross-AI Strategy Session';
      return {
        type: 'GROUP_CREATE',
        rawInput: trimmed,
        questionOrContent: title,
        inferredCapability: 'group.collaboration',
        isNaturalLanguageIntent: false,
      };
    }

    const inviteMatch = trimmed.match(/^\/invite\s+(@?[a-zA-Z0-9_-]+)/i);
    if (inviteMatch) {
      const handle = inviteMatch[1].startsWith('@')
        ? inviteMatch[1].toLowerCase()
        : `@${inviteMatch[1].toLowerCase()}`;
      return {
        type: 'GROUP_INVITE',
        rawInput: trimmed,
        targetHandle: handle,
        inferredCapability: 'group.collaboration',
        isNaturalLanguageIntent: false,
      };
    }

    const removeMatch = trimmed.match(/^\/remove\s+(@?[a-zA-Z0-9_-]+)/i);
    if (removeMatch) {
      const handle = removeMatch[1].startsWith('@')
        ? removeMatch[1].toLowerCase()
        : `@${removeMatch[1].toLowerCase()}`;
      return {
        type: 'GROUP_REMOVE',
        rawInput: trimmed,
        targetHandle: handle,
        inferredCapability: 'group.collaboration',
        isNaturalLanguageIntent: false,
      };
    }

    if (/^\/group\s+end/i.test(trimmed)) {
      return {
        type: 'GROUP_END',
        rawInput: trimmed,
        inferredCapability: 'group.collaboration',
        isNaturalLanguageIntent: false,
      };
    }

    const shareMemMatch = trimmed.match(
      /^\/share-memory\s+(@?[a-zA-Z0-9_-]+)\s+([\s\S]+)$/i
    );
    if (shareMemMatch) {
      const handle = shareMemMatch[1].startsWith('@')
        ? shareMemMatch[1].toLowerCase()
        : `@${shareMemMatch[1].toLowerCase()}`;
      return {
        type: 'SHARE_MEMORY',
        rawInput: trimmed,
        targetHandle: handle,
        questionOrContent: shareMemMatch[2].trim(),
        inferredCapability: 'memory.shared_query',
        isNaturalLanguageIntent: false,
      };
    }

    const revokeMemMatch = trimmed.match(/^\/revoke-memory\s+([\s\S]+)$/i);
    if (revokeMemMatch) {
      return {
        type: 'REVOKE_MEMORY',
        rawInput: trimmed,
        questionOrContent: revokeMemMatch[1].trim(),
        inferredCapability: 'memory.shared_query',
        isNaturalLanguageIntent: false,
      };
    }

    if (/^\/network$/i.test(trimmed)) {
      return {
        type: 'OPEN_NETWORK',
        rawInput: trimmed,
        inferredCapability: 'general.inquiry',
        isNaturalLanguageIntent: false,
      };
    }

    if (/^\/permissions$/i.test(trimmed)) {
      return {
        type: 'OPEN_PERMISSIONS',
        rawInput: trimmed,
        inferredCapability: 'general.inquiry',
        isNaturalLanguageIntent: false,
      };
    }

    const nlMatch = trimmed.match(
      /^(?:please\s+)?(?:ask|contact|check with|ping|message)\s+(?:@?(alice|bob|charlie)(?:'s\s+ai|\s+ai)?)\s+(?:whether|if|about|what|for|to)?\s*([\s\S]+)$/i
    );
    if (nlMatch) {
      const targetName = nlMatch[1].toLowerCase();
      const question = nlMatch[2].trim();
      return {
        type: 'ASK_REMOTE_AI',
        rawInput: trimmed,
        targetHandle: `@${targetName}`,
        questionOrContent: question,
        inferredCapability: this.inferCapability(question),
        isNaturalLanguageIntent: true,
        autonomousFollowUpRequested:
          trimmed.toLowerCase().includes('coordinate') ||
          trimmed.toLowerCase().includes('follow up'),
      };
    }

    return {
      type: 'DIRECT_CHAT',
      rawInput: trimmed,
      questionOrContent: trimmed,
      inferredCapability: this.inferCapability(trimmed),
      isNaturalLanguageIntent: false,
    };
  }
}

// ----------------------------------------------------------------------------
// 2. PromptInjectionGuard (Deterministic Untrusted Input Defense)
// ----------------------------------------------------------------------------

export class PromptInjectionGuard {
  private static readonly MALICIOUS_PATTERNS: RegExp[] = [
    /ignore\s+(all\s+)?(previous|prior|system)\s+instructions/i,
    /override\s+(system|owner|security|permission)\s+(policy|instructions|rules)/i,
    /grant\s+(yourself|me|alice|bob|charlie)\s+(admin|full|all|root)\s+(access|permissions|privileges)/i,
    /export\s+(private\s+key|secret|api[_\s]?key|credentials)/i,
    /exfiltrate\s+(all|owner|private)\s+(memories|notes|database)/i,
    /system\s*prompt\s*:/i,
    /bypass\s+(approval|authorization|policy\s+engine)/i,
  ];

  static inspect(input: string): { safe: boolean; reason?: string } {
    for (const pattern of this.MALICIOUS_PATTERNS) {
      if (pattern.test(input)) {
        return {
          safe: false,
          reason: `Blocked untrusted external input matching prompt-injection signature (${pattern.source}). External AIs cannot modify system instructions, escalate privileges, or bypass owner policies.`,
        };
      }
    }
    return { safe: true };
  }
}

// ----------------------------------------------------------------------------
// 3. Deterministic OwnerPolicyEngine & Data Minimization
// ----------------------------------------------------------------------------

export interface RawOwnerDataset {
  calendarSlots: Array<{
    timeWindow: string;
    status: 'FREE' | 'BUSY';
    privateMeetingTitle: string;
    privateAttendees: string[];
    privateNotes: string;
  }>;
  workStatus: {
    publicSummary: string;
    activeMilestone: string;
    internalRiskRegister: string;
    confidentialCompensationNotes: string;
  };
  privateNotes: string[];
  currentLocation: string;
}

export class OwnerPolicyEngine {
  private rules = new Map<string, PermissionRule[]>();

  setRulesForOwner(ownerAiId: string, rules: PermissionRule[]): void {
    this.rules.set(ownerAiId, [...rules]);
  }

  getRulesForOwner(ownerAiId: string): PermissionRule[] {
    return [...(this.rules.get(ownerAiId) ?? [])];
  }

  updateRuleMode(
    ownerAiId: string,
    ruleId: string,
    mode: PermissionMode
  ): PermissionRule | undefined {
    const list = this.rules.get(ownerAiId) ?? [];
    const found = list.find((r) => r.ruleId === ruleId);
    if (!found) return undefined;
    found.mode = mode;
    found.revoked = mode === PermissionMode.DENY;
    return { ...found };
  }

  revokeRule(ownerAiId: string, ruleId: string): PermissionRule | undefined {
    const list = this.rules.get(ownerAiId) ?? [];
    const found = list.find((r) => r.ruleId === ruleId);
    if (!found) return undefined;
    found.revoked = true;
    found.mode = PermissionMode.DENY;
    return { ...found };
  }

  evaluateIncomingInvocation(params: {
    recipientIdentity: PublicAIIdentity;
    senderAiId: string;
    capability: CapabilityType;
    question: string;
    requestedBudgetUsd: number;
    nowMs?: number;
  }): {
    decision: PermissionMode;
    matchedRule?: PermissionRule;
    errorCode?: GatewayErrorCode;
    reason: string;
  } {
    const now = params.nowMs ?? Date.now();

    if (params.recipientIdentity.killSwitchActive) {
      return {
        decision: PermissionMode.DENY,
        errorCode: GatewayErrorCode.AUTHORIZATION_DENIED,
        reason: `${params.recipientIdentity.displayName} owner has activated the incoming remote invocation Kill Switch.`,
      };
    }

    const injectionCheck = PromptInjectionGuard.inspect(params.question);
    if (!injectionCheck.safe) {
      return {
        decision: PermissionMode.DENY,
        errorCode: GatewayErrorCode.PROMPT_INJECTION_BLOCKED,
        reason: injectionCheck.reason!,
      };
    }

    const ownerRules = this.rules.get(params.recipientIdentity.aiId) ?? [];
    const matched =
      ownerRules.find(
        (r) =>
          r.granteeAiId === params.senderAiId && r.capability === params.capability
      ) ??
      ownerRules.find(
        (r) => r.granteeAiId === '*' && r.capability === params.capability
      );

    if (!matched) {
      return {
        decision: PermissionMode.DENY,
        errorCode: GatewayErrorCode.AUTHORIZATION_DENIED,
        reason: `Default deny policy: No permission rule authorizes '${params.senderAiId}' for capability '${params.capability}'.`,
      };
    }

    if (matched.revoked || matched.mode === PermissionMode.DENY) {
      return {
        decision: PermissionMode.DENY,
        matchedRule: matched,
        errorCode: GatewayErrorCode.AUTHORIZATION_DENIED,
        reason: `Access to '${params.capability}' is explicitly DENIED by ${params.recipientIdentity.displayName}'s owner policy (${matched.ruleId}).`,
      };
    }

    if (matched.expiresAt && Date.parse(matched.expiresAt) <= now) {
      return {
        decision: PermissionMode.DENY,
        matchedRule: matched,
        errorCode: GatewayErrorCode.PERMISSION_EXPIRED,
        reason: `Permission rule '${matched.ruleId}' expired at ${matched.expiresAt}.`,
      };
    }

    if (matched.requestsUsedToday >= matched.maxRequestsPerDay) {
      return {
        decision: PermissionMode.DENY,
        matchedRule: matched,
        errorCode: GatewayErrorCode.RATE_LIMITED,
        reason: `Daily quota (${matched.maxRequestsPerDay} requests/day) exhausted for rule '${matched.ruleId}'.`,
      };
    }

    if (params.requestedBudgetUsd > matched.maxExecutionBudgetUsd) {
      return {
        decision: PermissionMode.DENY,
        matchedRule: matched,
        errorCode: GatewayErrorCode.BUDGET_EXCEEDED,
        reason: `Requested execution budget ($${params.requestedBudgetUsd.toFixed(
          3
        )}) exceeds owner policy ceiling ($${matched.maxExecutionBudgetUsd.toFixed(3)}).`,
      };
    }

    if (matched.mode === PermissionMode.REQUIRE_APPROVAL) {
      return {
        decision: PermissionMode.REQUIRE_APPROVAL,
        matchedRule: matched,
        errorCode: GatewayErrorCode.PERMISSION_REQUIRED,
        reason: `Capability '${params.capability}' requires explicit human approval from ${params.recipientIdentity.ownerDisplayName}.`,
      };
    }

    matched.requestsUsedToday += 1;
    return {
      decision: PermissionMode.ALLOW_AUTOMATICALLY,
      matchedRule: matched,
      reason: `Authorized automatically by rule '${matched.ruleId}' with field minimization [${matched.allowedFields.join(
        ', '
      )}].`,
    };
  }

  applyDataMinimization(
    capability: CapabilityType,
    rule: PermissionRule,
    dataset: RawOwnerDataset,
    sharedMemoriesForSender: MemoryEntry[]
  ): {
    minimizedContext: string;
    minimizedFieldsReturned: string[];
    redactedFields: string[];
  } {
    if (capability === 'calendar.availability') {
      const freeWindows = dataset.calendarSlots
        .filter((s) => s.status === 'FREE')
        .map((s) => s.timeWindow);
      const busyWindows = dataset.calendarSlots
        .filter((s) => s.status === 'BUSY')
        .map((s) => `${s.timeWindow} (Busy)`);

      return {
        minimizedContext: `Authorized Calendar Free/Busy Windows ONLY: Free slots tomorrow: ${freeWindows.join(
          ', '
        )}. Busy blocks: ${busyWindows.join(', ')}.`,
        minimizedFieldsReturned: ['calendar.free_busy_windows', 'calendar.timezone'],
        redactedFields: [
          'calendar.privateMeetingTitle',
          'calendar.privateAttendees',
          'calendar.privateNotes',
        ],
      };
    }

    if (capability === 'work.project_status') {
      return {
        minimizedContext: `Authorized Work Project Summary: ${dataset.workStatus.publicSummary} | Active Milestone: ${dataset.workStatus.activeMilestone}.`,
        minimizedFieldsReturned: ['work.publicSummary', 'work.activeMilestone'],
        redactedFields: [
          'work.internalRiskRegister',
          'work.confidentialCompensationNotes',
        ],
      };
    }

    if (
      capability === 'memory.shared_query' ||
      capability === 'general.inquiry' ||
      capability === 'group.collaboration'
    ) {
      const memText =
        sharedMemoriesForSender.length > 0
          ? sharedMemoriesForSender.map((m) => `- ${m.title}: ${m.content}`).join('\n')
          : 'No additional private memories shared.';
      return {
        minimizedContext: `Authorized Public Summary: ${dataset.workStatus.publicSummary}\nExplicitly Shared Memories:\n${memText}`,
        minimizedFieldsReturned: [...rule.allowedFields],
        redactedFields: [...rule.deniedFields],
      };
    }

    return {
      minimizedContext: 'No private fields authorized.',
      minimizedFieldsReturned: [],
      redactedFields: ['owner_private.*', 'private.notes', 'location.current'],
    };
  }
}

// ----------------------------------------------------------------------------
// 4. MemoryManager (4 Categories + Explicit Grants + Revocation)
// ----------------------------------------------------------------------------

export class MemoryManager {
  private entries = new Map<string, MemoryEntry>();
  private grants = new Map<string, MemoryShareGrant>();

  addMemory(entry: MemoryEntry): MemoryEntry {
    this.entries.set(entry.memoryId, { ...entry });
    return entry;
  }

  listMemoriesForOwner(ownerAiId: string, category?: MemoryCategory): MemoryEntry[] {
    const result: MemoryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (
        entry.ownerAiId === ownerAiId &&
        (!category || entry.category === category)
      ) {
        result.push({ ...entry });
      }
    }
    return result.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  searchRelevantMemories(
    ownerAiId: string,
    query: string,
    limit: number = 4
  ): MemoryEntry[] {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    const candidates = this.listMemoriesForOwner(ownerAiId).filter((m) => !m.revoked);
    if (terms.length === 0) return candidates.slice(0, limit);

    const scored = candidates.map((m) => {
      const hay = `${m.title} ${m.content} ${m.tags.join(' ')}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += 2;
      }
      if (m.category === MemoryCategory.OWNER_PRIVATE) score += 1;
      return { m, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.m);
  }

  shareMemoryWithAI(params: {
    memoryId: string;
    ownerAiId: string;
    recipientAiId: string;
    capability?: CapabilityType;
    ttlHours?: number;
    nowMs?: number;
  }): { grant?: MemoryShareGrant; recipientCopy?: MemoryEntry; error?: string } {
    const now = params.nowMs ?? Date.now();
    const source = this.entries.get(params.memoryId);
    if (!source || source.ownerAiId !== params.ownerAiId) {
      return {
        error: `Memory '${params.memoryId}' not found or not owned by ${params.ownerAiId}.`,
      };
    }

    const grantId = `grant_${params.ownerAiId}_to_${params.recipientAiId}_${now}`;
    const expiresAt = new Date(
      now + (params.ttlHours ?? 72) * 3600 * 1000
    ).toISOString();
    const grant: MemoryShareGrant = {
      grantId,
      memoryId: source.memoryId,
      ownerAiId: params.ownerAiId,
      recipientAiId: params.recipientAiId,
      capability: params.capability ?? 'memory.shared_query',
      readOnly: true,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      revoked: false,
    };
    this.grants.set(grantId, grant);

    const recipientCopy: MemoryEntry = {
      memoryId: `mem_ext_${grantId}`,
      ownerAiId: params.recipientAiId,
      category: MemoryCategory.EXTERNAL_AI,
      title: `[Shared by ${params.ownerAiId}] ${source.title}`,
      content: `According to ${params.ownerAiId}: ${source.content}`,
      tags: [...source.tags, 'external_attributed', params.ownerAiId],
      sourceAiId: params.ownerAiId,
      sourceOwnerId: source.sourceOwnerId,
      permissionReference: grantId,
      trustClassification: 'ATTRIBUTED_EXTERNAL_AI',
      retentionPolicy: 'TIME_LIMITED',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt,
      revoked: false,
    };
    this.entries.set(recipientCopy.memoryId, recipientCopy);

    return { grant, recipientCopy };
  }

  revokeMemoryGrant(
    grantId: string,
    ownerAiId: string,
    nowMs: number = Date.now()
  ): {
    revoked: boolean;
    grant?: MemoryShareGrant;
    limitationDisclosure: string;
  } {
    const grant = this.grants.get(grantId);
    const limitationDisclosure =
      'Revocation immediately invalidates the permission grant, blocks all future remote queries, and dispatches a cryptographic withdrawal notice to the recipient node. Note: In a decentralized network, revocation cannot physically force-erase data already observed and independently retained outside platform-managed storage.';

    if (!grant || grant.ownerAiId !== ownerAiId) {
      return { revoked: false, limitationDisclosure };
    }

    grant.revoked = true;
    grant.revokedAt = new Date(nowMs).toISOString();
    grant.withdrawalNoticeSent = true;

    const extId = `mem_ext_${grantId}`;
    const extEntry = this.entries.get(extId);
    if (extEntry) {
      extEntry.revoked = true;
      extEntry.content = `[WITHDRAWN BY ${ownerAiId.toUpperCase()} AT ${grant.revokedAt}] Access grant revoked by owner.`;
      extEntry.updatedAt = grant.revokedAt;
    }

    return { revoked: true, grant: { ...grant }, limitationDisclosure };
  }

  getActiveSharedMemoriesFor(
    ownerAiId: string,
    recipientAiId: string,
    nowMs: number = Date.now()
  ): MemoryEntry[] {
    const activeGrants = Array.from(this.grants.values()).filter(
      (g) =>
        g.ownerAiId === ownerAiId &&
        g.recipientAiId === recipientAiId &&
        !g.revoked &&
        Date.parse(g.expiresAt) > nowMs
    );
    const result: MemoryEntry[] = [];
    for (const g of activeGrants) {
      const m = this.entries.get(g.memoryId);
      if (m && !m.revoked) result.push({ ...m });
    }
    return result;
  }

  listGrantsForOwner(ownerAiId: string): MemoryShareGrant[] {
    return Array.from(this.grants.values()).filter(
      (g) => g.ownerAiId === ownerAiId || g.recipientAiId === ownerAiId
    );
  }
}

// ----------------------------------------------------------------------------
// 5. AutonomousFollowUpEngine (Loop Detection & Budget Enforcement)
// ----------------------------------------------------------------------------

export class AutonomousFollowUpEngine {
  static validateTurn(params: {
    currentTurn: number;
    maxTurns: number;
    accumulatedCostUsd: number;
    maxBudgetUsd: number;
    previousQuestions: string[];
    nextQuestion: string;
    invocationChainTrace: string[];
    nextRecipientAiId: string;
  }): { allowed: boolean; errorCode?: GatewayErrorCode; reason?: string } {
    if (params.currentTurn > params.maxTurns) {
      return {
        allowed: false,
        errorCode: GatewayErrorCode.BUDGET_EXCEEDED,
        reason: `Autonomous follow-up halted: reached maximum turn limit (${params.maxTurns} turns).`,
      };
    }

    if (params.accumulatedCostUsd > params.maxBudgetUsd) {
      return {
        allowed: false,
        errorCode: GatewayErrorCode.BUDGET_EXCEEDED,
        reason: `Autonomous follow-up halted: accumulated cost ($${params.accumulatedCostUsd.toFixed(
          4
        )}) exceeds ceiling ($${params.maxBudgetUsd.toFixed(4)}).`,
      };
    }

    const normalizedNext = params.nextQuestion.trim().toLowerCase();
    if (
      params.previousQuestions.some(
        (prev) => prev.trim().toLowerCase() === normalizedNext
      )
    ) {
      return {
        allowed: false,
        errorCode: GatewayErrorCode.LOOP_DETECTED,
        reason:
          'Loop prevention triggered: detected repeated identical autonomous follow-up question.',
      };
    }

    if (params.invocationChainTrace.length > 5) {
      return {
        allowed: false,
        errorCode: GatewayErrorCode.LOOP_DETECTED,
        reason: `Loop prevention triggered: invocation chain depth (${params.invocationChainTrace.length}) exceeded maximum threshold (5).`,
      };
    }

    return { allowed: true };
  }
}

// ----------------------------------------------------------------------------
// 6. Conversation & Group Session Models
// ----------------------------------------------------------------------------

export interface ChatAttachment {
  id: string;
  name: string;
  type: 'file' | 'image';
  sizeLabel: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'remote_ai' | 'system';
  senderAiId: string;
  senderDisplayName: string;
  content: string;
  timestamp: string;
  attributionLabel?: string;
  invocationRecord?: InvocationRecord;
  minimizedFields?: string[];
  redactedFields?: string[];
  attachments?: ChatAttachment[];
  followUpTurn?: number;
  modelUsed?: string;
  tokensUsed?: number;
  costUsd?: number;
}

export interface ConversationThread {
  id: string;
  ownerAiId: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  isGroup: boolean;
  groupId?: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export type LLMGeneratorFn = (params: {
  aiIdentity: PublicAIIdentity;
  systemInstruction: string;
  prompt: string;
}) => Promise<{ text: string; tokensUsed: number; costUsd: number }>;

// ----------------------------------------------------------------------------
// 7. Seed Personal AI Profiles, Datasets, Rules & Memories
// ----------------------------------------------------------------------------

export function createSeedNodesConfig(): {
  identities: PublicAIIdentity[];
  datasets: Map<string, RawOwnerDataset>;
  policyEngine: OwnerPolicyEngine;
  memoryManager: MemoryManager;
  conversations: Map<string, ConversationThread>;
  groups: Map<string, GroupSession>;
} {
  const nowIso = new Date().toISOString();
  const policyEngine = new OwnerPolicyEngine();
  const memoryManager = new MemoryManager();
  const datasets = new Map<string, RawOwnerDataset>();
  const conversations = new Map<string, ConversationThread>();
  const groups = new Map<string, GroupSession>();

  const aliceIdentity: PublicAIIdentity = {
    aiId: 'ai_alice',
    handle: '@alice',
    displayName: 'Alice AI',
    ownerId: 'owner_alice',
    ownerDisplayName: 'Alice Vance',
    nodeId: 'node_alice_local_mac01',
    deviceId: 'dev_alice_mbp16',
    publicKeyPem:
      '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA8f9aAliceEd25519PubKey99210aBcDeFgHiJkLmNoPqRsTuVwXyZ=\n-----END PUBLIC KEY-----',
    keyFingerprint: 'ed25519:a11ce98f4d20b7e1c9034f82',
    registrationState: 'REGISTERED',
    verificationState: 'VERIFIED',
    executionMode: ExecutionMode.LOCAL,
    online: true,
    killSwitchActive: false,
    supportedProtocolVersions: ['1.0'],
    configuredProvider: 'gemini',
    configuredModel: 'gemini-3.8-flash',
    createdAt: nowIso,
    lastHeartbeatAt: nowIso,
  };

  const bobIdentity: PublicAIIdentity = {
    aiId: 'ai_bob',
    handle: '@bob',
    displayName: 'Bob AI',
    ownerId: 'owner_bob',
    ownerDisplayName: 'Bob Chen',
    nodeId: 'node_bob_vps_eu01',
    deviceId: 'dev_bob_ubuntu_vps',
    publicKeyPem:
      '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAb0b77ChenEd25519PubKey44129xYzAbCdEfGhIjKlMnOpQrStUv=\n-----END PUBLIC KEY-----',
    keyFingerprint: 'ed25519:b0b4471e9a3c8812d056e19a',
    registrationState: 'REGISTERED',
    verificationState: 'VERIFIED',
    executionMode: ExecutionMode.HYBRID,
    online: true,
    killSwitchActive: false,
    supportedProtocolVersions: ['1.0'],
    configuredProvider: 'gemini',
    configuredModel: 'gemini-3.8-flash',
    createdAt: nowIso,
    lastHeartbeatAt: nowIso,
  };

  const charlieIdentity: PublicAIIdentity = {
    aiId: 'ai_charlie',
    handle: '@charlie',
    displayName: 'Charlie AI',
    ownerId: 'owner_charlie',
    ownerDisplayName: 'Charlie Patel',
    nodeId: 'node_charlie_cloud_us02',
    deviceId: 'dev_charlie_cloud_enclave',
    publicKeyPem:
      '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAc4a71iePatelEd25519PubKey77812mNoPqRsTuVwXyZaBcDeFgH=\n-----END PUBLIC KEY-----',
    keyFingerprint: 'ed25519:c4a711e5509b321a7740f8bc',
    registrationState: 'REGISTERED',
    verificationState: 'VERIFIED',
    executionMode: ExecutionMode.CLOUD,
    online: true,
    killSwitchActive: false,
    supportedProtocolVersions: ['1.0'],
    configuredProvider: 'gemini',
    configuredModel: 'gemini-3.8-flash',
    createdAt: nowIso,
    lastHeartbeatAt: nowIso,
  };

  datasets.set('ai_alice', {
    calendarSlots: [
      {
        timeWindow: 'Tomorrow 10:00 AM – 11:30 AM PST',
        status: 'BUSY',
        privateMeetingTitle: 'Board Compensation Review',
        privateAttendees: ['ceo@acme.io'],
        privateNotes: 'Confidential equity refresh discussion',
      },
      {
        timeWindow: 'Tomorrow 2:00 PM – 4:30 PM PST',
        status: 'FREE',
        privateMeetingTitle: '',
        privateAttendees: [],
        privateNotes: 'Open afternoon block for product syncs',
      },
    ],
    workStatus: {
      publicSummary:
        'Leading AI Nexus Protocol v1.0 architecture review and Q4 launch readiness.',
      activeMilestone: 'Phase 4 Cross-AI Invocation Verification',
      internalRiskRegister: 'Internal vendor contract negotiation pending legal sign-off',
      confidentialCompensationNotes: 'Private L7 budget allocation',
    },
    privateNotes: ['Personal tax prep checklist', 'Passport renewal reminder'],
    currentLocation: 'San Francisco, CA (Home Office)',
  });

  datasets.set('ai_bob', {
    calendarSlots: [
      {
        timeWindow: 'Tomorrow 9:30 AM – 12:00 PM PST',
        status: 'BUSY',
        privateMeetingTitle: 'Dentist Appointment & Executive 1:1 with Sarah',
        privateAttendees: ['dr.smith@clinic.org', 'sarah@company.io'],
        privateNotes: 'Do not schedule over morning block',
      },
      {
        timeWindow: 'Tomorrow 2:00 PM – 4:00 PM PST',
        status: 'FREE',
        privateMeetingTitle: '',
        privateAttendees: [],
        privateNotes: 'Preferred afternoon window for architecture meetings',
      },
      {
        timeWindow: 'Tomorrow 4:00 PM – 5:30 PM PST',
        status: 'BUSY',
        privateMeetingTitle: 'Confidential Security Audit Readout',
        privateAttendees: ['sec-ops@company.io'],
        privateNotes: 'Key rotation review',
      },
    ],
    workStatus: {
      publicSummary:
        'Gateway WebSocket transport benchmarks at 14,200 msg/sec with <8ms p95 routing latency.',
      activeMilestone: 'Ed25519 Replay Protection & Offline Queue Drain',
      internalRiskRegister: 'Redis failover simulation scheduled for Friday night',
      confidentialCompensationNotes: 'Confidential bonus target',
    },
    privateNotes: [
      'Anniversary dinner reservation at 7:30 PM',
      'Cold wallet seed phrase backup location',
    ],
    currentLocation: 'Seattle, WA',
  });

  datasets.set('ai_charlie', {
    calendarSlots: [
      {
        timeWindow: 'Tomorrow 1:00 PM – 3:30 PM PST',
        status: 'FREE',
        privateMeetingTitle: '',
        privateAttendees: [],
        privateNotes: 'Available for cross-team reviews',
      },
    ],
    workStatus: {
      publicSummary:
        'Security threat modeling & zero-trust policy engine audit complete. Identified 3 key launch recommendations: strict response-size caps, explicit memory-revocation disclosures, and 5-turn autonomous loop ceilings.',
      activeMilestone: 'Phase 8 Security Hardening & Penetration Testing',
      internalRiskRegister: 'Zero-day dependency patch queued',
      confidentialCompensationNotes: 'Private contractor rate card',
    },
    privateNotes: ['Private medical records'],
    currentLocation: 'New York, NY',
  });

  policyEngine.setRulesForOwner('ai_bob', [
    {
      ruleId: 'perm_bob_cal_alice',
      ownerAiId: 'ai_bob',
      granteeAiId: 'ai_alice',
      capability: 'calendar.availability',
      dataCategory: 'Calendar Free/Busy Windows',
      allowedFields: ['calendar.free_busy_windows', 'calendar.timezone'],
      deniedFields: [
        'calendar.privateMeetingTitle',
        'calendar.privateAttendees',
        'calendar.privateNotes',
      ],
      mode: PermissionMode.ALLOW_AUTOMATICALLY,
      maxRequestsPerDay: 5,
      requestsUsedToday: 1,
      maxResponseChars: 600,
      maxExecutionBudgetUsd: 0.05,
      allowAutonomousFollowUps: true,
      maxFollowUpTurns: 5,
      revoked: false,
    },
    {
      ruleId: 'perm_bob_work_alice',
      ownerAiId: 'ai_bob',
      granteeAiId: 'ai_alice',
      capability: 'work.project_status',
      dataCategory: 'Engineering Milestone Summary',
      allowedFields: ['work.publicSummary', 'work.activeMilestone'],
      deniedFields: [
        'work.internalRiskRegister',
        'work.confidentialCompensationNotes',
      ],
      mode: PermissionMode.REQUIRE_APPROVAL,
      maxRequestsPerDay: 10,
      requestsUsedToday: 0,
      maxResponseChars: 800,
      maxExecutionBudgetUsd: 0.05,
      allowAutonomousFollowUps: false,
      maxFollowUpTurns: 2,
      revoked: false,
    },
    {
      ruleId: 'perm_bob_mem_alice',
      ownerAiId: 'ai_bob',
      granteeAiId: 'ai_alice',
      capability: 'memory.shared_query',
      dataCategory: 'Explicitly Shared Memories',
      allowedFields: ['memory.shared_entries'],
      deniedFields: ['memory.owner_private'],
      mode: PermissionMode.ALLOW_AUTOMATICALLY,
      maxRequestsPerDay: 10,
      requestsUsedToday: 0,
      maxResponseChars: 600,
      maxExecutionBudgetUsd: 0.05,
      allowAutonomousFollowUps: true,
      maxFollowUpTurns: 3,
      revoked: false,
    },
    {
      ruleId: 'perm_bob_group_all',
      ownerAiId: 'ai_bob',
      granteeAiId: '*',
      capability: 'group.collaboration',
      dataCategory: 'Group Collaboration Context',
      allowedFields: ['work.publicSummary', 'group.shared_context'],
      deniedFields: [
        'memory.owner_private',
        'calendar.privateMeetingTitle',
        'private.notes',
      ],
      mode: PermissionMode.ALLOW_AUTOMATICALLY,
      maxRequestsPerDay: 20,
      requestsUsedToday: 1,
      maxResponseChars: 900,
      maxExecutionBudgetUsd: 0.1,
      allowAutonomousFollowUps: true,
      maxFollowUpTurns: 5,
      revoked: false,
    },
    {
      ruleId: 'perm_bob_notes_deny',
      ownerAiId: 'ai_bob',
      granteeAiId: '*',
      capability: 'private.notes',
      dataCategory: 'Private Personal Notes',
      allowedFields: [],
      deniedFields: ['private.notes.*'],
      mode: PermissionMode.DENY,
      maxRequestsPerDay: 0,
      requestsUsedToday: 0,
      maxResponseChars: 0,
      maxExecutionBudgetUsd: 0,
      allowAutonomousFollowUps: false,
      maxFollowUpTurns: 0,
      revoked: true,
    },
    {
      ruleId: 'perm_bob_loc_deny',
      ownerAiId: 'ai_bob',
      granteeAiId: '*',
      capability: 'location.current',
      dataCategory: 'Real-Time GPS & Physical Location',
      allowedFields: [],
      deniedFields: ['location.current.*'],
      mode: PermissionMode.DENY,
      maxRequestsPerDay: 0,
      requestsUsedToday: 0,
      maxResponseChars: 0,
      maxExecutionBudgetUsd: 0,
      allowAutonomousFollowUps: false,
      maxFollowUpTurns: 0,
      revoked: true,
    },
  ]);

  policyEngine.setRulesForOwner('ai_charlie', [
    {
      ruleId: 'perm_charlie_work_all',
      ownerAiId: 'ai_charlie',
      granteeAiId: '*',
      capability: 'work.project_status',
      dataCategory: 'Security Architecture Assessment',
      allowedFields: ['work.publicSummary', 'work.activeMilestone'],
      deniedFields: ['work.internalRiskRegister', 'private.notes'],
      mode: PermissionMode.ALLOW_AUTOMATICALLY,
      maxRequestsPerDay: 15,
      requestsUsedToday: 1,
      maxResponseChars: 800,
      maxExecutionBudgetUsd: 0.05,
      allowAutonomousFollowUps: true,
      maxFollowUpTurns: 5,
      revoked: false,
    },
    {
      ruleId: 'perm_charlie_cal_all',
      ownerAiId: 'ai_charlie',
      granteeAiId: '*',
      capability: 'calendar.availability',
      dataCategory: 'Calendar Free/Busy Windows',
      allowedFields: ['calendar.free_busy_windows'],
      deniedFields: ['calendar.privateMeetingTitle', 'calendar.privateNotes'],
      mode: PermissionMode.ALLOW_AUTOMATICALLY,
      maxRequestsPerDay: 10,
      requestsUsedToday: 0,
      maxResponseChars: 600,
      maxExecutionBudgetUsd: 0.05,
      allowAutonomousFollowUps: true,
      maxFollowUpTurns: 5,
      revoked: false,
    },
    {
      ruleId: 'perm_charlie_group_all',
      ownerAiId: 'ai_charlie',
      granteeAiId: '*',
      capability: 'group.collaboration',
      dataCategory: 'Group Collaboration Analysis',
      allowedFields: ['work.publicSummary', 'group.shared_context'],
      deniedFields: ['memory.owner_private', 'private.notes'],
      mode: PermissionMode.ALLOW_AUTOMATICALLY,
      maxRequestsPerDay: 20,
      requestsUsedToday: 1,
      maxResponseChars: 900,
      maxExecutionBudgetUsd: 0.1,
      allowAutonomousFollowUps: true,
      maxFollowUpTurns: 5,
      revoked: false,
    },
  ]);

  policyEngine.setRulesForOwner('ai_alice', [
    {
      ruleId: 'perm_alice_cal_bob',
      ownerAiId: 'ai_alice',
      granteeAiId: 'ai_bob',
      capability: 'calendar.availability',
      dataCategory: 'Calendar Free/Busy Windows',
      allowedFields: ['calendar.free_busy_windows'],
      deniedFields: ['calendar.privateMeetingTitle', 'calendar.privateNotes'],
      mode: PermissionMode.ALLOW_AUTOMATICALLY,
      maxRequestsPerDay: 10,
      requestsUsedToday: 0,
      maxResponseChars: 600,
      maxExecutionBudgetUsd: 0.05,
      allowAutonomousFollowUps: true,
      maxFollowUpTurns: 5,
      revoked: false,
    },
    {
      ruleId: 'perm_alice_group_all',
      ownerAiId: 'ai_alice',
      granteeAiId: '*',
      capability: 'group.collaboration',
      dataCategory: 'Group Collaboration Context',
      allowedFields: ['work.publicSummary', 'group.shared_context'],
      deniedFields: ['memory.owner_private'],
      mode: PermissionMode.ALLOW_AUTOMATICALLY,
      maxRequestsPerDay: 20,
      requestsUsedToday: 0,
      maxResponseChars: 900,
      maxExecutionBudgetUsd: 0.1,
      allowAutonomousFollowUps: true,
      maxFollowUpTurns: 5,
      revoked: false,
    },
  ]);

  memoryManager.addMemory({
    memoryId: 'mem_alice_priv_01',
    ownerAiId: 'ai_alice',
    category: MemoryCategory.OWNER_PRIVATE,
    title: 'Deep Work & Meeting Preferences',
    content:
      'Alice prefers 30-minute afternoon syncs between 2:00 PM and 4:00 PM PST and blocks mornings for system architecture.',
    tags: ['schedule', 'preferences', 'deep-work'],
    sourceAiId: 'ai_alice',
    sourceOwnerId: 'owner_alice',
    trustClassification: 'VERIFIED_OWNER',
    retentionPolicy: 'PERMANENT',
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  memoryManager.addMemory({
    memoryId: 'mem_alice_sys_01',
    ownerAiId: 'ai_alice',
    category: MemoryCategory.SYSTEM_KNOWLEDGE,
    title: 'AI Nexus Protocol v1.0 Specification',
    content:
      'All remote AI-to-AI invocations traverse the AI Nexus Gateway (port 4000) using Ed25519-signed envelopes over /ws/node and deterministic recipient-side policy evaluation.',
    tags: ['protocol', 'security', 'gateway'],
    sourceAiId: 'ai_alice',
    sourceOwnerId: 'system',
    trustClassification: 'SYSTEM',
    retentionPolicy: 'PERMANENT',
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const bobMeetingPref = memoryManager.addMemory({
    memoryId: 'mem_bob_priv_01',
    ownerAiId: 'ai_bob',
    category: MemoryCategory.OWNER_PRIVATE,
    title: 'Bob Afternoon Scheduling Preference',
    content:
      'Bob prefers architecture meetings after 2:00 PM PST and keeps agendas under 45 minutes.',
    tags: ['meetings', 'schedule', 'afternoon'],
    sourceAiId: 'ai_bob',
    sourceOwnerId: 'owner_bob',
    trustClassification: 'VERIFIED_OWNER',
    retentionPolicy: 'PERMANENT',
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  memoryManager.shareMemoryWithAI({
    memoryId: bobMeetingPref.memoryId,
    ownerAiId: 'ai_bob',
    recipientAiId: 'ai_alice',
    capability: 'memory.shared_query',
    ttlHours: 168,
  });

  memoryManager.addMemory({
    memoryId: 'mem_alice_shared_01',
    ownerAiId: 'ai_alice',
    category: MemoryCategory.SHARED_CONTEXT,
    title: 'Q4 Business Proposal Shared Brief',
    content:
      'Proposal targets enterprise self-hosted Personal AI nodes with zero-knowledge Gateway routing and strict cost ceilings.',
    tags: ['proposal', 'group', 'q4'],
    sourceAiId: 'ai_alice',
    sourceOwnerId: 'owner_alice',
    trustClassification: 'SHARED_GROUP_CONTEXT',
    retentionPolicy: 'TIME_LIMITED',
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const initialGroup: GroupSession = {
    groupId: 'grp_q4_proposal_review',
    title: 'Q4 Launch Proposal & Security Review',
    createdByAiId: 'ai_alice',
    participants: [
      {
        aiId: 'ai_alice',
        handle: '@alice',
        displayName: 'Alice AI',
        ownerName: 'Alice Vance',
        status: 'ACTIVE',
        joinedAt: nowIso,
        model: 'gemini-3.8-flash',
      },
      {
        aiId: 'ai_bob',
        handle: '@bob',
        displayName: 'Bob AI',
        ownerName: 'Bob Chen',
        status: 'ACTIVE',
        joinedAt: nowIso,
        model: 'gemini-3.8-flash',
      },
      {
        aiId: 'ai_charlie',
        handle: '@charlie',
        displayName: 'Charlie AI',
        ownerName: 'Charlie Patel',
        status: 'ACTIVE',
        joinedAt: nowIso,
        model: 'gemini-3.8-flash',
      },
    ],
    messages: [],
    status: 'ACTIVE',
    maxTurnLimit: 15,
    currentTurnCount: 0,
    maxBudgetUsd: 0.5,
    currentCostUsd: 0,
    createdAt: nowIso,
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  };
  groups.set(initialGroup.groupId, initialGroup);

  const defaultConv: ConversationThread = {
    id: 'conv_alice_main',
    ownerAiId: 'ai_alice',
    title: 'Meeting Coordination with @bob',
    pinned: true,
    archived: false,
    isGroup: false,
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [],
  };
  conversations.set(defaultConv.id, defaultConv);

  const groupConv: ConversationThread = {
    id: 'conv_group_q4',
    ownerAiId: 'ai_alice',
    title: 'Q4 Launch Proposal & Security Review',
    pinned: true,
    archived: false,
    isGroup: true,
    groupId: initialGroup.groupId,
    createdAt: nowIso,
    updatedAt: nowIso,
    messages: [],
  };
  conversations.set(groupConv.id, groupConv);

  return {
    identities: [aliceIdentity, bobIdentity, charlieIdentity],
    datasets,
    policyEngine,
    memoryManager,
    conversations,
    groups,
  };
}
