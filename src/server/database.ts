// ============================================================================
// AI NEXUS CHATBOT — Durable SQLite Persistence Layer (`src/server/database.ts`)
// Uses Node.js built-in `node:sqlite` (DatabaseSync) with WAL mode, foreign keys,
// idempotent migrations, owner data isolation, and online atomic backup.
// Never stores plaintext API keys in database records.
// ============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AuditEventRecord,
  GroupSession,
  MemoryCategory,
  MemoryEntry,
  MemoryShareGrant,
  PermissionMode,
  PermissionRule,
  PublicAIIdentity,
} from '../protocol/index.ts';
import {
  ChatAttachment,
  ChatMessage,
  ConversationThread,
  createSeedNodesConfig,
  RawOwnerDataset,
} from '../chatbot/engine.ts';

export type MessageDeliveryStatus =
  | 'STREAMING'
  | 'COMPLETED'
  | 'ERROR'
  | 'INTERRUPTED';

export interface PersistedUserRecord {
  id: string;
  display_name: string;
  created_at: string;
}

export interface PersistedAIIdentityRecord {
  id: string;
  owner_id: string;
  name: string;
  handle: string;
  provider_config_ref: string;
  model_preference: string;
  created_at: string;
  updated_at: string;
}

export interface PersistedSettingRecord {
  id: string;
  owner_id: string;
  key: string;
  value: string;
  updated_at: string;
}

const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: '001_initial_core_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_identities (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        handle TEXT NOT NULL UNIQUE,
        provider_config_ref TEXT NOT NULL,
        model_preference TEXT NOT NULL,
        identity_json TEXT NOT NULL,
        dataset_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ai_identities_owner ON ai_identities(owner_id);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        ai_identity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        is_group INTEGER NOT NULL DEFAULT 0,
        group_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_identity_id) REFERENCES ai_identities(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_owner_updated
        ON conversations(owner_id, ai_identity_id, archived_at, updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        sender_ai_id TEXT NOT NULL,
        sender_display_name TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        error_message TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        seq_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_order
        ON messages(conversation_id, seq_order ASC, created_at ASC);

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_id TEXT,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        content_excerpt TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        ai_identity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_identity_id) REFERENCES ai_identities(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_memory_records_owner
        ON memory_records(owner_id, ai_identity_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, key),
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_settings_owner_key ON settings(owner_id, key);

      CREATE TABLE IF NOT EXISTS group_sessions (
        group_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_by_ai_id TEXT NOT NULL,
        group_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS permission_rules (
        rule_id TEXT PRIMARY KEY,
        owner_ai_id TEXT NOT NULL,
        rule_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_share_grants (
        grant_id TEXT PRIMARY KEY,
        owner_ai_id TEXT NOT NULL,
        recipient_ai_id TEXT NOT NULL,
        grant_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
    `,
  },
];

export function sanitizeSecretValue(key: string, value: string): string {
  const lowerKey = key.toLowerCase();
  if (
    lowerKey.includes('api_key') ||
    lowerKey.includes('apikey') ||
    lowerKey.includes('secret') ||
    lowerKey.includes('token') ||
    lowerKey.includes('password') ||
    /^sk-[a-zA-Z0-9]{12,}/.test(value) ||
    /^AIza[a-zA-Z0-9_-]{20,}/.test(value)
  ) {
    throw new Error(
      `Security policy violation: Plaintext API keys or secrets cannot be stored in database settings (${key}). Configure credentials via server environment variables.`
    );
  }
  return value;
}

export function resolveProviderConfigRef(provider: string): string {
  const clean = provider.toLowerCase();
  if (clean === 'openai') return 'env:OPENAI_API_KEY';
  if (clean === 'anthropic') return 'env:ANTHROPIC_API_KEY';
  return 'env:GEMINI_API_KEY';
}

export function resolveDefaultChatbotDbPath(customDbPath?: string): string {
  const expandHome = (p: string) =>
    p.startsWith('~/') || p.startsWith('~\\')
      ? path.join(os.homedir(), p.slice(2))
      : p;

  if (customDbPath) {
    return customDbPath === ':memory:' ? ':memory:' : path.resolve(expandHome(customDbPath));
  }
  if (process.env.CHATBOT_DB_PATH) {
    const raw = process.env.CHATBOT_DB_PATH.trim();
    return raw === ':memory:' ? ':memory:' : path.resolve(expandHome(raw));
  }
  const appDataBase =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(os.homedir(), '.ai-nexus-chatbot');
  const appDataDir =
    process.env.LOCALAPPDATA || process.env.APPDATA
      ? path.join(appDataBase, 'ai-nexus-chatbot')
      : appDataBase;
  return path.join(appDataDir, 'chatbot.sqlite');
}

export class ChatbotDatabase {
  public readonly db: DatabaseSync;
  public readonly dbPath: string;
  private seqCounter = 1;

  constructor(customDbPath?: string) {
    let resolvedPath = resolveDefaultChatbotDbPath(customDbPath);

    if (resolvedPath !== ':memory:') {
      const dir = path.dirname(resolvedPath);
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (err) {
        if (!customDbPath && !process.env.CHATBOT_DB_PATH) {
          const fallbackDir = path.join(os.tmpdir(), 'ai-nexus-chatbot');
          fs.mkdirSync(fallbackDir, { recursive: true });
          resolvedPath = path.join(fallbackDir, 'chatbot.sqlite');
        } else {
          throw err;
        }
      }
    }

    this.dbPath = resolvedPath;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.runMigrations();
    this.recoverInterruptedStreamsOnBoot();
    this.seedInitialDataIfNeeded();

    const maxSeqRow = this.db
      .prepare('SELECT COALESCE(MAX(seq_order), 0) AS max_seq FROM messages')
      .get() as { max_seq?: number } | undefined;
    this.seqCounter = (maxSeqRow?.max_seq ?? 0) + 1;
  }

  public runMigrations(): { applied: number; totalVersions: number } {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    let applied = 0;
    for (const migration of MIGRATIONS) {
      const exists = this.db
        .prepare('SELECT version FROM schema_migrations WHERE version = ?')
        .get(migration.version) as { version: number } | undefined;

      if (!exists) {
        this.db.exec('BEGIN TRANSACTION;');
        try {
          this.db.exec(migration.sql);
          this.db
            .prepare(
              'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
            )
            .run(migration.version, migration.name, new Date().toISOString());
          this.db.exec('COMMIT;');
          applied++;
        } catch (err) {
          this.db.exec('ROLLBACK;');
          throw err;
        }
      }
    }
    return { applied, totalVersions: MIGRATIONS.length };
  }

  /**
   * Ensures any message left in STREAMING state when the process previously exited
   * is cleanly marked as INTERRUPTED so conversation history is never corrupted.
   */
  private recoverInterruptedStreamsOnBoot(): void {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE messages
         SET status = 'INTERRUPTED',
             completed_at = COALESCE(completed_at, ?),
             error_message = COALESCE(error_message, 'Generation was interrupted by a server restart.')
         WHERE status = 'STREAMING'`
      )
      .run(nowIso);
  }

  private seedInitialDataIfNeeded(): void {
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM ai_identities')
      .get() as { cnt: number };
    if (countRow.cnt > 0) {
      return;
    }

    const seed = createSeedNodesConfig();
    const nowIso = new Date().toISOString();

    this.db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Seed Users & AI Identities
      for (const identity of seed.identities) {
        this.db
          .prepare(
            'INSERT OR IGNORE INTO users (id, display_name, created_at) VALUES (?, ?, ?)'
          )
          .run(identity.ownerId, identity.ownerDisplayName, identity.createdAt || nowIso);

        const dataset = seed.datasets.get(identity.aiId) ?? null;
        this.db
          .prepare(
            `INSERT INTO ai_identities (
              id, owner_id, name, handle, provider_config_ref, model_preference,
              identity_json, dataset_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            identity.aiId,
            identity.ownerId,
            identity.displayName,
            identity.handle,
            resolveProviderConfigRef(identity.configuredProvider),
            identity.configuredModel,
            JSON.stringify(identity),
            dataset ? JSON.stringify(dataset) : null,
            identity.createdAt || nowIso,
            nowIso
          );

        // Default user settings
        this.setSettingInternal(
          identity.ownerId,
          'preferred_model',
          identity.configuredModel,
          nowIso
        );
        this.setSettingInternal(
          identity.ownerId,
          'preferred_provider',
          identity.configuredProvider,
          nowIso
        );
        this.setSettingInternal(
          identity.ownerId,
          'autonomous_follow_up',
          'true',
          nowIso
        );
      }

      // 2. Seed Group Sessions
      for (const grp of seed.groups.values()) {
        this.db
          .prepare(
            `INSERT INTO group_sessions (group_id, title, created_by_ai_id, group_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            grp.groupId,
            grp.title,
            grp.createdByAiId,
            JSON.stringify(grp),
            grp.createdAt,
            nowIso
          );
      }

      // 3. Seed Conversations & Messages
      for (const conv of seed.conversations.values()) {
        const ownerIdentity =
          seed.identities.find((i) => i.aiId === conv.ownerAiId) ??
          seed.identities[0];
        this.db
          .prepare(
            `INSERT INTO conversations (
              id, owner_id, ai_identity_id, title, pinned, is_group, group_id,
              created_at, updated_at, archived_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            conv.id,
            ownerIdentity.ownerId,
            conv.ownerAiId,
            conv.title,
            conv.pinned ? 1 : 0,
            conv.isGroup ? 1 : 0,
            conv.groupId ?? null,
            conv.createdAt,
            conv.updatedAt,
            conv.archived ? nowIso : null
          );

        for (const msg of conv.messages) {
          this.insertMessageInternal(msg, 'COMPLETED', null);
        }
      }

      // 4. Seed Memories & Grants
      for (const identity of seed.identities) {
        const memories = seed.memoryManager.listMemoriesForOwner(identity.aiId);
        for (const mem of memories) {
          this.db
            .prepare(
              `INSERT INTO memory_records (
                id, owner_id, ai_identity_id, title, content, category, source,
                tags_json, metadata_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              mem.memoryId,
              identity.ownerId,
              mem.ownerAiId,
              mem.title,
              mem.content,
              mem.category,
              mem.sourceAiId || 'owner_input',
              JSON.stringify(mem.tags ?? []),
              JSON.stringify(mem),
              mem.createdAt,
              mem.updatedAt
            );
        }

        const rules = seed.policyEngine.getRulesForOwner(identity.aiId);
        for (const rule of rules) {
          this.db
            .prepare(
              `INSERT INTO permission_rules (rule_id, owner_ai_id, rule_json, updated_at)
               VALUES (?, ?, ?, ?)`
            )
            .run(rule.ruleId, identity.aiId, JSON.stringify(rule), nowIso);
        }
      }

      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  private setSettingInternal(
    ownerId: string,
    key: string,
    value: string,
    updatedAt = new Date().toISOString()
  ): PersistedSettingRecord {
    const cleanValue = sanitizeSecretValue(key, value);
    const id = `set_${ownerId}_${key}`;
    this.db
      .prepare(
        `INSERT INTO settings (id, owner_id, key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`
      )
      .run(id, ownerId, key, cleanValue, updatedAt);
    return { id, owner_id: ownerId, key, value: cleanValue, updated_at: updatedAt };
  }

  // --------------------------------------------------------------------------
  // Users & AI Identities
  // --------------------------------------------------------------------------

  public listUsers(): PersistedUserRecord[] {
    return this.db
      .prepare('SELECT id, display_name, created_at FROM users ORDER BY created_at ASC')
      .all() as unknown as PersistedUserRecord[];
  }

  public listIdentities(): PublicAIIdentity[] {
    const rows = this.db
      .prepare(
        'SELECT id, owner_id, name, handle, provider_config_ref, model_preference, identity_json FROM ai_identities ORDER BY created_at ASC'
      )
      .all() as Array<{
      id: string;
      owner_id: string;
      name: string;
      handle: string;
      provider_config_ref: string;
      model_preference: string;
      identity_json: string;
    }>;

    return rows.map((r) => {
      const parsed = JSON.parse(r.identity_json) as PublicAIIdentity;
      return {
        ...parsed,
        aiId: r.id,
        ownerId: r.owner_id,
        displayName: r.name,
        handle: r.handle,
        configuredModel: r.model_preference,
      };
    });
  }

  public getIdentity(aiId: string): PublicAIIdentity | null {
    const row = this.db
      .prepare(
        'SELECT id, owner_id, name, handle, provider_config_ref, model_preference, identity_json FROM ai_identities WHERE id = ?'
      )
      .get(aiId) as
      | {
          id: string;
          owner_id: string;
          name: string;
          handle: string;
          provider_config_ref: string;
          model_preference: string;
          identity_json: string;
        }
      | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.identity_json) as PublicAIIdentity;
    return {
      ...parsed,
      aiId: row.id,
      ownerId: row.owner_id,
      displayName: row.name,
      handle: row.handle,
      configuredModel: row.model_preference,
    };
  }

  public getOwnerDataset(aiId: string): RawOwnerDataset | null {
    const row = this.db
      .prepare('SELECT dataset_json FROM ai_identities WHERE id = ?')
      .get(aiId) as { dataset_json: string | null } | undefined;
    if (!row?.dataset_json) return null;
    return JSON.parse(row.dataset_json) as RawOwnerDataset;
  }

  public updateIdentity(identity: PublicAIIdentity): PublicAIIdentity {
    const nowIso = new Date().toISOString();
    const providerRef = resolveProviderConfigRef(identity.configuredProvider);
    this.db
      .prepare(
        `UPDATE ai_identities
         SET name = ?,
             handle = ?,
             provider_config_ref = ?,
             model_preference = ?,
             identity_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        identity.displayName,
        identity.handle,
        providerRef,
        identity.configuredModel,
        JSON.stringify(identity),
        nowIso,
        identity.aiId
      );

    this.setSettingInternal(
      identity.ownerId,
      'preferred_model',
      identity.configuredModel,
      nowIso
    );
    this.setSettingInternal(
      identity.ownerId,
      'preferred_provider',
      identity.configuredProvider,
      nowIso
    );
    return identity;
  }

  // --------------------------------------------------------------------------
  // Conversations & Messages (with Strict Owner Isolation)
  // --------------------------------------------------------------------------

  public listConversationsForAi(
    aiId: string,
    includeArchived = false
  ): ConversationThread[] {
    const identity = this.getIdentity(aiId);
    const ownerId = identity?.ownerId ?? `owner_${aiId.replace(/^ai_/, '')}`;

    // Include conversations owned by this AI's owner OR group conversations where this AI participates
    const rows = this.db
      .prepare(
        `SELECT id, owner_id, ai_identity_id, title, pinned, is_group, group_id,
                created_at, updated_at, archived_at
         FROM conversations
         WHERE (ai_identity_id = ? AND owner_id = ? OR is_group = 1)
           AND (? = 1 OR archived_at IS NULL)
         ORDER BY pinned DESC, updated_at DESC`
      )
      .all(aiId, ownerId, includeArchived ? 1 : 0) as Array<{
      id: string;
      owner_id: string;
      ai_identity_id: string;
      title: string;
      pinned: number;
      is_group: number;
      group_id: string | null;
      created_at: string;
      updated_at: string;
      archived_at: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      ownerAiId: r.ai_identity_id,
      title: r.title,
      pinned: Boolean(r.pinned),
      archived: Boolean(r.archived_at),
      isGroup: Boolean(r.is_group),
      groupId: r.group_id ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messages: this.listMessagesForConversation(r.id),
    }));
  }

  public getConversation(
    conversationId: string,
    requestingAiId?: string
  ): ConversationThread | null {
    const row = this.db
      .prepare(
        `SELECT id, owner_id, ai_identity_id, title, pinned, is_group, group_id,
                created_at, updated_at, archived_at
         FROM conversations
         WHERE id = ? AND archived_at IS NULL`
      )
      .get(conversationId) as
      | {
          id: string;
          owner_id: string;
          ai_identity_id: string;
          title: string;
          pinned: number;
          is_group: number;
          group_id: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        }
      | undefined;

    if (!row) return null;

    // Enforce owner isolation on private (non-group) conversations
    if (
      requestingAiId &&
      !row.is_group &&
      row.ai_identity_id !== requestingAiId
    ) {
      return null;
    }

    return {
      id: row.id,
      ownerAiId: row.ai_identity_id,
      title: row.title,
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived_at),
      isGroup: Boolean(row.is_group),
      groupId: row.group_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: this.listMessagesForConversation(row.id),
    };
  }

  public createConversation(params: {
    id?: string;
    ownerAiId: string;
    title: string;
    pinned?: boolean;
    isGroup?: boolean;
    groupId?: string;
  }): ConversationThread {
    const nowIso = new Date().toISOString();
    const identity = this.getIdentity(params.ownerAiId);
    const ownerId =
      identity?.ownerId ?? `owner_${params.ownerAiId.replace(/^ai_/, '')}`;
    const convId =
      params.id ||
      `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    this.db
      .prepare(
        `INSERT INTO conversations (
          id, owner_id, ai_identity_id, title, pinned, is_group, group_id,
          created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        convId,
        ownerId,
        params.ownerAiId,
        params.title.trim() || 'New Conversation',
        params.pinned ? 1 : 0,
        params.isGroup ? 1 : 0,
        params.groupId ?? null,
        nowIso,
        nowIso
      );

    return {
      id: convId,
      ownerAiId: params.ownerAiId,
      title: params.title.trim() || 'New Conversation',
      pinned: Boolean(params.pinned),
      archived: false,
      isGroup: Boolean(params.isGroup),
      groupId: params.groupId,
      createdAt: nowIso,
      updatedAt: nowIso,
      messages: [],
    };
  }

  public updateConversation(
    conversationId: string,
    updates: { togglePin?: boolean; title?: string; archive?: boolean },
    requestingAiId?: string
  ): ConversationThread | null {
    const existing = this.getConversation(conversationId, requestingAiId);
    if (!existing) return null;

    const nowIso = new Date().toISOString();
    const nextPinned = updates.togglePin ? !existing.pinned : existing.pinned;
    const nextTitle =
      typeof updates.title === 'string' && updates.title.trim()
        ? updates.title.trim()
        : existing.title;
    const archivedAt = updates.archive ? nowIso : null;

    this.db
      .prepare(
        `UPDATE conversations
         SET title = ?, pinned = ?, updated_at = ?, archived_at = COALESCE(?, archived_at)
         WHERE id = ?`
      )
      .run(nextTitle, nextPinned ? 1 : 0, nowIso, archivedAt, conversationId);

    return this.getConversation(conversationId);
  }

  public deleteConversation(
    conversationId: string,
    requestingAiId?: string
  ): boolean {
    if (requestingAiId) {
      const existing = this.getConversation(conversationId, requestingAiId);
      if (!existing) return false;
    }
    const res = this.db
      .prepare('DELETE FROM conversations WHERE id = ?')
      .run(conversationId);
    return Number(res.changes) > 0;
  }

  public listMessagesForConversation(conversationId: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, role, sender_ai_id, sender_display_name,
                content, model, status, error_message, metadata_json,
                created_at, completed_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY seq_order ASC, created_at ASC`
      )
      .all(conversationId) as Array<{
      id: string;
      conversation_id: string;
      role: ChatMessage['role'];
      sender_ai_id: string;
      sender_display_name: string;
      content: string;
      model: string | null;
      status: MessageDeliveryStatus;
      error_message: string | null;
      metadata_json: string | null;
      created_at: string;
      completed_at: string | null;
    }>;

    return rows.map((r) => {
      const extra = r.metadata_json
        ? (JSON.parse(r.metadata_json) as Partial<ChatMessage>)
        : {};
      return {
        ...extra,
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role,
        senderAiId: r.sender_ai_id,
        senderDisplayName: r.sender_display_name,
        content: r.content,
        timestamp: r.created_at,
        modelUsed: r.model ?? extra.modelUsed,
        status: r.status,
        errorMessage: r.error_message ?? undefined,
        completedAt: r.completed_at ?? undefined,
      };
    });
  }

  private insertMessageInternal(
    message: ChatMessage,
    status: MessageDeliveryStatus = 'COMPLETED',
    errorMessage: string | null = null
  ): ChatMessage {
    const seq = this.seqCounter++;
    const completedAt =
      status === 'COMPLETED' || status === 'INTERRUPTED' || status === 'ERROR'
        ? new Date().toISOString()
        : null;

    const metadata: Partial<ChatMessage> = {
      attributionLabel: message.attributionLabel,
      invocationRecord: message.invocationRecord,
      minimizedFields: message.minimizedFields,
      redactedFields: message.redactedFields,
      followUpTurn: message.followUpTurn,
      tokensUsed: message.tokensUsed,
      costUsd: message.costUsd,
      attachments: message.attachments,
      feedback: message.feedback,
    };

    this.db
      .prepare(
        `INSERT INTO messages (
          id, conversation_id, role, sender_ai_id, sender_display_name,
          content, model, status, error_message, metadata_json,
          created_at, completed_at, seq_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.conversationId,
        message.role,
        message.senderAiId,
        message.senderDisplayName,
        message.content,
        message.modelUsed ?? null,
        status,
        errorMessage,
        JSON.stringify(metadata),
        message.timestamp,
        completedAt,
        seq
      );

    // Persist attachment metadata records if any
    if (message.attachments && message.attachments.length > 0) {
      const convRow = this.db
        .prepare('SELECT owner_id FROM conversations WHERE id = ?')
        .get(message.conversationId) as { owner_id: string } | undefined;
      const ownerId = convRow?.owner_id ?? 'owner_alice';
      for (const att of message.attachments) {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO attachments (
              id, conversation_id, message_id, owner_id, name, mime_type,
              size_bytes, content_excerpt, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            att.id,
            message.conversationId,
            message.id,
            ownerId,
            att.name,
            att.mimeType ?? (att.type === 'image' ? 'image/png' : 'text/plain'),
            att.sizeBytes ?? 1024,
            att.contentExcerpt ?? null,
            message.timestamp
          );
      }
    }

    this.db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(message.timestamp, message.conversationId);

    return {
      ...message,
      status,
      errorMessage: errorMessage ?? undefined,
      completedAt: completedAt ?? undefined,
    };
  }

  public addMessage(
    message: ChatMessage,
    status: MessageDeliveryStatus = 'COMPLETED',
    errorMessage: string | null = null
  ): ChatMessage {
    return this.insertMessageInternal(message, status, errorMessage);
  }

  public updateMessageState(
    messageId: string,
    updates: {
      content?: string;
      status?: MessageDeliveryStatus;
      errorMessage?: string | null;
      modelUsed?: string;
      tokensUsed?: number;
      costUsd?: number;
      attributionLabel?: string;
      feedback?: 'up' | 'down' | null;
    }
  ): ChatMessage | null {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, role, sender_ai_id, sender_display_name,
                content, model, status, error_message, metadata_json,
                created_at, completed_at
         FROM messages WHERE id = ?`
      )
      .get(messageId) as
      | {
          id: string;
          conversation_id: string;
          role: ChatMessage['role'];
          sender_ai_id: string;
          sender_display_name: string;
          content: string;
          model: string | null;
          status: MessageDeliveryStatus;
          error_message: string | null;
          metadata_json: string | null;
          created_at: string;
          completed_at: string | null;
        }
      | undefined;

    if (!row) return null;

    const existingMeta = row.metadata_json
      ? (JSON.parse(row.metadata_json) as Partial<ChatMessage>)
      : {};

    const nextContent =
      typeof updates.content === 'string' ? updates.content : row.content;
    const nextStatus = updates.status ?? row.status;
    const nextError =
      updates.errorMessage !== undefined
        ? updates.errorMessage
        : row.error_message;
    const nextModel = updates.modelUsed ?? row.model;
    const nextCompletedAt =
      nextStatus === 'COMPLETED' ||
      nextStatus === 'INTERRUPTED' ||
      nextStatus === 'ERROR'
        ? new Date().toISOString()
        : row.completed_at;

    const nextMeta: Partial<ChatMessage> = {
      ...existingMeta,
      attributionLabel:
        updates.attributionLabel ?? existingMeta.attributionLabel,
      tokensUsed: updates.tokensUsed ?? existingMeta.tokensUsed,
      costUsd: updates.costUsd ?? existingMeta.costUsd,
      feedback:
        updates.feedback !== undefined
          ? updates.feedback
          : existingMeta.feedback,
    };

    this.db
      .prepare(
        `UPDATE messages
         SET content = ?,
             model = ?,
             status = ?,
             error_message = ?,
             metadata_json = ?,
             completed_at = ?
         WHERE id = ?`
      )
      .run(
        nextContent,
        nextModel ?? null,
        nextStatus,
        nextError ?? null,
        JSON.stringify(nextMeta),
        nextCompletedAt,
        messageId
      );

    this.db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), row.conversation_id);

    return {
      ...nextMeta,
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      senderAiId: row.sender_ai_id,
      senderDisplayName: row.sender_display_name,
      content: nextContent,
      timestamp: row.created_at,
      modelUsed: nextModel ?? undefined,
      status: nextStatus,
      errorMessage: nextError ?? undefined,
      completedAt: nextCompletedAt ?? undefined,
    };
  }

  public deleteMessage(conversationId: string, messageId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ?')
      .run(messageId, conversationId);
    return Number(res.changes) > 0;
  }

  /**
   * Truncates all messages in a conversation created strictly after the given messageId
   * (used when editing a user message or retrying an assistant generation).
   */
  public deleteMessagesAfter(conversationId: string, messageId: string): void {
    const target = this.db
      .prepare(
        'SELECT seq_order FROM messages WHERE id = ? AND conversation_id = ?'
      )
      .get(messageId, conversationId) as { seq_order: number } | undefined;
    if (!target) return;
    this.db
      .prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND seq_order > ?'
      )
      .run(conversationId, target.seq_order);
  }

  // --------------------------------------------------------------------------
  // Memory Records (with Owner Isolation)
  // --------------------------------------------------------------------------

  public listMemoriesForOwnerAi(ownerAiId: string): MemoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, owner_id, ai_identity_id, title, content, category, source,
                tags_json, metadata_json, created_at, updated_at
         FROM memory_records
         WHERE ai_identity_id = ?
         ORDER BY updated_at DESC`
      )
      .all(ownerAiId) as Array<{
      id: string;
      owner_id: string;
      ai_identity_id: string;
      title: string;
      content: string;
      category: MemoryCategory;
      source: string;
      tags_json: string;
      metadata_json: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((r) => {
      const meta = r.metadata_json
        ? (JSON.parse(r.metadata_json) as Partial<MemoryEntry>)
        : {};
      return {
        memoryId: r.id,
        ownerAiId: r.ai_identity_id,
        category: r.category,
        title: r.title,
        content: r.content,
        tags: JSON.parse(r.tags_json || '[]'),
        sourceAiId: r.source,
        sourceOwnerId: r.owner_id,
        trustClassification: meta.trustClassification ?? 'VERIFIED_OWNER',
        retentionPolicy: meta.retentionPolicy ?? 'PERMANENT',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  public upsertMemory(entry: MemoryEntry): MemoryEntry {
    const identity = this.getIdentity(entry.ownerAiId);
    const ownerId =
      identity?.ownerId ??
      entry.sourceOwnerId ??
      `owner_${entry.ownerAiId.replace(/^ai_/, '')}`;

    this.db
      .prepare(
        `INSERT INTO memory_records (
          id, owner_id, ai_identity_id, title, content, category, source,
          tags_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          content = excluded.content,
          category = excluded.category,
          tags_json = excluded.tags_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`
      )
      .run(
        entry.memoryId,
        ownerId,
        entry.ownerAiId,
        entry.title || 'Untitled Memory',
        entry.content || '',
        entry.category || MemoryCategory.OWNER_PRIVATE,
        entry.sourceAiId || 'owner_input',
        JSON.stringify(entry.tags ?? []),
        JSON.stringify(entry),
        entry.createdAt || new Date().toISOString(),
        entry.updatedAt || new Date().toISOString()
      );
    return entry;
  }

  public deleteMemoryRecord(memoryId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM memory_records WHERE id = ?')
      .run(memoryId);
    return Number(res.changes) > 0;
  }

  // --------------------------------------------------------------------------
  // Owner Settings (Persistent Across Browser Refreshes & Server Restarts)
  // --------------------------------------------------------------------------

  public getSettingsForOwner(ownerIdOrAiId: string): Record<string, string> {
    const ownerId = ownerIdOrAiId.startsWith('ai_')
      ? this.getIdentity(ownerIdOrAiId)?.ownerId ??
        `owner_${ownerIdOrAiId.replace(/^ai_/, '')}`
      : ownerIdOrAiId;

    const rows = this.db
      .prepare('SELECT key, value FROM settings WHERE owner_id = ?')
      .all(ownerId) as Array<{ key: string; value: string }>;

    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  public setSetting(
    ownerIdOrAiId: string,
    key: string,
    value: string
  ): PersistedSettingRecord {
    const ownerId = ownerIdOrAiId.startsWith('ai_')
      ? this.getIdentity(ownerIdOrAiId)?.ownerId ??
        `owner_${ownerIdOrAiId.replace(/^ai_/, '')}`
      : ownerIdOrAiId;
    return this.setSettingInternal(ownerId, key, value);
  }

  // --------------------------------------------------------------------------
  // Groups, Permissions & Memory Share Grants Persistence
  // --------------------------------------------------------------------------

  public listGroups(): GroupSession[] {
    const rows = this.db
      .prepare('SELECT group_json FROM group_sessions ORDER BY created_at ASC')
      .all() as Array<{ group_json: string }>;
    return rows.map((r) => JSON.parse(r.group_json) as GroupSession);
  }

  public saveGroup(group: GroupSession): void {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO group_sessions (group_id, title, created_by_ai_id, group_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(group_id) DO UPDATE SET
           title = excluded.title,
           group_json = excluded.group_json,
           updated_at = excluded.updated_at`
      )
      .run(
        group.groupId,
        group.title,
        group.createdByAiId,
        JSON.stringify(group),
        group.createdAt,
        nowIso
      );
  }

  public listPermissionRules(ownerAiId: string): PermissionRule[] {
    const rows = this.db
      .prepare('SELECT rule_json FROM permission_rules WHERE owner_ai_id = ?')
      .all(ownerAiId) as Array<{ rule_json: string }>;
    return rows.map((r) => JSON.parse(r.rule_json) as PermissionRule);
  }

  public savePermissionRule(ownerAiId: string, rule: PermissionRule): void {
    this.db
      .prepare(
        `INSERT INTO permission_rules (rule_id, owner_ai_id, rule_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(rule_id) DO UPDATE SET
           rule_json = excluded.rule_json,
           updated_at = excluded.updated_at`
      )
      .run(rule.ruleId, ownerAiId, JSON.stringify(rule), new Date().toISOString());
  }

  public listMemoryGrants(): MemoryShareGrant[] {
    const rows = this.db
      .prepare('SELECT grant_json FROM memory_share_grants')
      .all() as Array<{ grant_json: string }>;
    return rows.map((r) => JSON.parse(r.grant_json) as MemoryShareGrant);
  }

  public saveMemoryGrant(grant: MemoryShareGrant): void {
    this.db
      .prepare(
        `INSERT INTO memory_share_grants (grant_id, owner_ai_id, recipient_ai_id, grant_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(grant_id) DO UPDATE SET
           grant_json = excluded.grant_json,
           updated_at = excluded.updated_at`
      )
      .run(
        grant.grantId,
        grant.ownerAiId,
        grant.recipientAiId,
        JSON.stringify(grant),
        new Date().toISOString()
      );
  }

  public appendAuditEvent(event: AuditEventRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO audit_events (event_id, timestamp, event_json)
         VALUES (?, ?, ?)`
      )
      .run(event.eventId, event.timestamp, JSON.stringify(event));
  }

  public listAuditEvents(limit = 100): AuditEventRecord[] {
    const rows = this.db
      .prepare(
        'SELECT event_json FROM audit_events ORDER BY timestamp DESC LIMIT ?'
      )
      .all(limit) as Array<{ event_json: string }>;
    return rows.map((r) => JSON.parse(r.event_json) as AuditEventRecord);
  }

  // --------------------------------------------------------------------------
  // Backup Strategy (`VACUUM INTO`)
  // --------------------------------------------------------------------------

  public createBackup(customBackupPath?: string): {
    backupPath: string;
    createdAt: string;
    sizeBytes: number;
  } {
    const createdAt = new Date().toISOString();
    const backupDir =
      this.dbPath === ':memory:'
        ? path.resolve(process.cwd(), 'data/backups')
        : path.resolve(path.dirname(this.dbPath), 'backups');

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath =
      customBackupPath ??
      path.join(
        backupDir,
        `ai-nexus-chatbot-backup-${Date.now()}.sqlite`
      );

    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }

    const escaped = backupPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}';`);
    const stat = fs.statSync(backupPath);

    return {
      backupPath,
      createdAt,
      sizeBytes: stat.size,
    };
  }

  /**
   * Restores all tables from an atomic SQLite backup file into the active database.
   */
  public restoreFromBackup(backupPath: string): {
    restored: boolean;
    sourcePath: string;
    restoredAt: string;
  } {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file does not exist: ${backupPath}`);
    }
    const escaped = path.resolve(backupPath).replace(/'/g, "''");
    this.db.exec(`ATTACH DATABASE '${escaped}' AS backup_src;`);
    try {
      this.db.exec('PRAGMA foreign_keys = OFF;');
      this.db.exec('BEGIN TRANSACTION;');
      const tables = [
        'users',
        'ai_identities',
        'conversations',
        'messages',
        'attachments',
        'memory_records',
        'memory_share_grants',
        'permission_rules',
        'group_sessions',
        'settings',
        'audit_events',
      ];
      for (const tbl of tables) {
        this.db.exec(`DELETE FROM main.${tbl};`);
        this.db.exec(`INSERT INTO main.${tbl} SELECT * FROM backup_src.${tbl};`);
      }
      this.db.exec('COMMIT;');
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      this.db.exec('PRAGMA foreign_keys = ON;');
      throw err;
    } finally {
      this.db.exec('DETACH DATABASE backup_src;');
    }

    return {
      restored: true,
      sourcePath: path.resolve(backupPath),
      restoredAt: new Date().toISOString(),
    };
  }

  public getDiagnostics(): {
    dbPath: string;
    migrationVersionsApplied: number;
    usersCount: number;
    identitiesCount: number;
    conversationsCount: number;
    messagesCount: number;
    memoriesCount: number;
    settingsCount: number;
  } {
    const count = (table: string) =>
      (
        this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
          c: number;
        }
      ).c;

    return {
      dbPath: this.dbPath,
      migrationVersionsApplied: count('schema_migrations'),
      usersCount: count('users'),
      identitiesCount: count('ai_identities'),
      conversationsCount: count('conversations'),
      messagesCount: count('messages'),
      memoriesCount: count('memory_records'),
      settingsCount: count('settings'),
    };
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // ignore if already closed
    }
  }
}
