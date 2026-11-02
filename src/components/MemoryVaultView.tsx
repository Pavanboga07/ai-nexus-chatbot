import React, { useState } from 'react';
import {
  Brain,
  Check,
  Edit3,
  Eye,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  MemoryCategory,
  MemoryEntry,
  MemoryShareGrant,
  PublicAIIdentity,
} from '../protocol';

interface MemoryVaultViewProps {
  activeAiId: string;
  identities: PublicAIIdentity[];
  memoriesByOwner: Record<string, MemoryEntry[]>;
  memoryGrants: MemoryShareGrant[];
  onAddMemory: (params: {
    ownerAiId: string;
    category: MemoryCategory;
    title: string;
    content: string;
    tags: string[];
  }) => Promise<void> | void;
  onUpdateMemory: (
    memoryId: string,
    updates: {
      title?: string;
      content?: string;
      category?: MemoryCategory;
      tags?: string[];
    }
  ) => Promise<void> | void;
  onDeleteMemory: (memoryId: string) => Promise<void> | void;
  onShareMemory: (params: {
    memoryId: string;
    ownerAiId: string;
    recipientAiId: string;
    ttlHours: number;
  }) => Promise<void> | void;
  onRevokeGrant: (grantId: string, ownerAiId: string) => Promise<string>;
}

export const MemoryVaultView: React.FC<MemoryVaultViewProps> = ({
  activeAiId,
  identities,
  memoriesByOwner,
  memoryGrants,
  onAddMemory,
  onUpdateMemory,
  onDeleteMemory,
  onShareMemory,
  onRevokeGrant,
}) => {
  const [activeTab, setActiveTab] = useState<
    'my_memories' | 'from_other_ais' | 'shared_with_others' | 'group_context'
  >('my_memories');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('preferences, work');

  // Edit state
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // Share modal state
  const [sharingMemory, setSharingMemory] = useState<MemoryEntry | null>(null);
  const [shareRecipientId, setShareRecipientId] = useState<string>('ai_bob');
  const [shareHours, setShareHours] = useState<number>(72);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const ownerMemories = memoriesByOwner[activeAiId] ?? [];
  const peerIdentities = identities.filter((i) => i.aiId !== activeAiId);

  const filteredMemories = ownerMemories.filter((m) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      m.title.toLowerCase().includes(q) ||
      m.content.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q));

    if (!matchesSearch) return false;

    if (activeTab === 'my_memories') {
      return (
        m.category === MemoryCategory.OWNER_PRIVATE ||
        m.category === MemoryCategory.SYSTEM_KNOWLEDGE
      );
    }
    if (activeTab === 'from_other_ais') {
      return m.category === MemoryCategory.EXTERNAL_AI;
    }
    if (activeTab === 'group_context') {
      return m.category === MemoryCategory.SHARED_CONTEXT;
    }
    return true;
  });

  const myOutboundGrants = memoryGrants.filter(
    (g) => g.ownerAiId === activeAiId
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    await onAddMemory({
      ownerAiId: activeAiId,
      category:
        activeTab === 'group_context'
          ? MemoryCategory.SHARED_CONTEXT
          : MemoryCategory.OWNER_PRIVATE,
      title: newTitle.trim(),
      content: newContent.trim(),
      tags: newTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setNewTitle('');
    setNewContent('');
    setShowAddForm(false);
    setStatusNotice('Saved to your personal memory space.');
    setTimeout(() => setStatusNotice(null), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Memory
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Personal knowledge your AI remembers for you, clearly separated from information shared by other AIs.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New memory</span>
        </button>
      </div>

      {statusNotice && (
        <div className="p-3.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-zinc-400 hover:text-zinc-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Add Memory Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreate}
          className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Add a personal memory
            </h2>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title (e.g., Afternoon scheduling preference)"
              required
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="What should your Personal AI remember?"
              rows={3}
              required
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
            <input
              type="text"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="w-full px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
            >
              Save memory
            </button>
          </div>
        </form>
      )}

      {/* Search & Category Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-1 overflow-x-auto text-xs font-medium">
          {(
            [
              { id: 'my_memories', label: 'My memories' },
              { id: 'from_other_ais', label: 'Information from other AIs' },
              {
                id: 'shared_with_others',
                label: `Shared with others (${
                  myOutboundGrants.filter((g) => !g.revoked).length
                })`,
              },
              { id: 'group_context', label: 'Shared group context' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-56">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories…"
            aria-label="Search memories"
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Tab 3: Shared with others (Outbound Grants) */}
      {activeTab === 'shared_with_others' ? (
        <div className="space-y-3">
          {myOutboundGrants.length === 0 ? (
            <div className="p-8 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 text-center text-xs text-zinc-500">
              You have not shared any private memories with other Personal AIs yet.
            </div>
          ) : (
            myOutboundGrants.map((grant) => {
              const recipient = identities.find(
                (i) => i.aiId === grant.recipientAiId
              );
              const mem = ownerMemories.find(
                (m) => m.memoryId === grant.memoryId
              );
              return (
                <div
                  key={grant.grantId}
                  className="p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {mem?.title ?? grant.memoryId}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full ${
                          grant.revoked
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {grant.revoked ? 'Access revoked' : 'Shared read-only'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Shared with{' '}
                      <strong>
                        {recipient?.displayName ?? grant.recipientAiId}
                      </strong>{' '}
                      · Expires{' '}
                      {new Date(grant.expiresAt).toLocaleDateString()}
                    </p>
                  </div>

                  {!grant.revoked && (
                    <button
                      type="button"
                      onClick={async () => {
                        const disclosure = await onRevokeGrant(
                          grant.grantId,
                          activeAiId
                        );
                        setStatusNotice(disclosure);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-medium self-start sm:self-center shrink-0"
                    >
                      Revoke access
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Memories List (My Memories, From Other AIs, Group Context) */
        <div className="space-y-3">
          {filteredMemories.length === 0 ? (
            <div className="p-8 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 text-center text-xs text-zinc-500">
              No memories in this section yet.
            </div>
          ) : (
            filteredMemories.map((mem) => {
              const isExternal = mem.category === MemoryCategory.EXTERNAL_AI;
              const isEditing = editingMemoryId === mem.memoryId;
              const sourceIdentity = identities.find(
                (i) => i.aiId === mem.sourceAiId
              );

              return (
                <div
                  key={mem.memoryId}
                  className="p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 space-y-3 transition-colors"
                >
                  {isEditing ? (
                    <form
                      className="space-y-3"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await onUpdateMemory(mem.memoryId, {
                          title: editTitle.trim(),
                          content: editContent.trim(),
                        });
                        setEditingMemoryId(null);
                      }}
                    >
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100"
                      />
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingMemoryId(null)}
                          className="px-3 py-1 rounded-md text-xs text-zinc-500"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-3 py-1 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                        >
                          Save changes
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center flex-wrap gap-2">
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {mem.title.replace(/^\[Shared by [^\]]+\]\s*/i, '')}
                            </h3>
                            {isExternal ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                <ShieldCheck className="w-3 h-3" />
                                From {sourceIdentity?.displayName ?? mem.sourceAiId}
                              </span>
                            ) : (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                {mem.category === MemoryCategory.SHARED_CONTEXT
                                  ? 'Group context'
                                  : 'Personal memory'}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {!isExternal && (
                            <button
                              type="button"
                              onClick={() => {
                                setSharingMemory(mem);
                                setShareRecipientId(
                                  peerIdentities[0]?.aiId ?? 'ai_bob'
                                );
                              }}
                              aria-label={`Share ${mem.title}`}
                              title="Share with another AI"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMemoryId(mem.memoryId);
                              setEditTitle(mem.title);
                              setEditContent(mem.content);
                            }}
                            aria-label={`Edit ${mem.title}`}
                            title="Edit memory"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteMemory(mem.memoryId)}
                            aria-label={`Delete ${mem.title}`}
                            title="Delete memory"
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                        {mem.content}
                      </p>

                      <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                        <div className="flex flex-wrap gap-1.5">
                          {mem.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <span>
                          Updated{' '}
                          {new Date(mem.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Share Memory Modal */}
      {sharingMemory && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Share memory with another AI
              </h3>
              <button
                type="button"
                onClick={() => setSharingMemory(null)}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 text-xs space-y-1">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {sharingMemory.title}
              </div>
              <div className="text-zinc-500 line-clamp-2">
                {sharingMemory.content}
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-500 mb-1">
                  Recipient Personal AI
                </label>
                <select
                  value={shareRecipientId}
                  onChange={(e) => setShareRecipientId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                >
                  {peerIdentities.map((id) => (
                    <option key={id.aiId} value={id.aiId}>
                      {id.displayName} ({id.handle}) — {id.ownerDisplayName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-500 mb-1">
                  Access duration
                </label>
                <select
                  value={shareHours}
                  onChange={(e) => setShareHours(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                >
                  <option value={24}>24 hours</option>
                  <option value={72}>3 days (72 hours)</option>
                  <option value={168}>7 days</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSharingMemory(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onShareMemory({
                    memoryId: sharingMemory.memoryId,
                    ownerAiId: activeAiId,
                    recipientAiId: shareRecipientId,
                    ttlHours: shareHours,
                  });
                  setSharingMemory(null);
                  setStatusNotice(
                    'Shared read-only memory grant created. You can revoke access anytime.'
                  );
                }}
                className="px-4 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
              >
                Grant read-only access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
