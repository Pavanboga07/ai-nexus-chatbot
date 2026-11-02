import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  FileText,
  Paperclip,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { PublicAIIdentity } from '../protocol';
import { ChatAttachment } from '../chatbot/engine';
import {
  GatewayStatusInfo,
  ProviderStatusInfo,
} from '../services/chatbotApiClient';
import {
  getPresenceBadgeMeta,
  resolveIdentityPresence,
} from '../utils/presence';

export const AVAILABLE_MODELS = [
  {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    description: 'Fast multimodal reasoning & streaming',
  },
  {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    description: 'Ultra-low latency everyday chat',
  },
  {
    provider: 'gemini',
    model: 'gemini-flash-latest',
    label: 'Gemini Flash Latest',
    description: 'Latest stable Flash release',
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    label: 'GPT-4o Mini',
    description: 'OpenAI-compatible fast model',
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    label: 'GPT-4o',
    description: 'OpenAI-compatible flagship model',
  },
];

interface ModelSelectorProps {
  currentModel: string;
  providerStatus?: ProviderStatusInfo[];
  onSelectModel: (provider: string, model: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModel,
  providerStatus = [],
  onSelectModel,
}) => {
  const [open, setOpen] = useState(false);
  const currentObj =
    AVAILABLE_MODELS.find((m) => m.model === currentModel) ??
    AVAILABLE_MODELS[0];

  const isProviderConfigured = (provider: string) => {
    if (!providerStatus || providerStatus.length === 0) return true;
    const found = providerStatus.find((p) => p.provider === provider);
    return found ? found.configured : false;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Select AI Model"
        data-testid="model-selector-btn"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors whitespace-nowrap shrink-0"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isProviderConfigured(currentObj.provider)
              ? 'bg-emerald-500'
              : 'bg-amber-500'
          }`}
        />
        <span>{currentObj.label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
      </button>

      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute bottom-9 right-0 z-40 w-64 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-1.5 space-y-0.5"
        >
          {AVAILABLE_MODELS.map((m) => {
            const selected = m.model === currentModel;
            const configured = isProviderConfigured(m.provider);
            return (
              <button
                key={m.model}
                type="button"
                data-testid={`select-model-${m.model}`}
                onClick={() => {
                  onSelectModel(m.provider, m.model);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors text-left ${
                  selected
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{m.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-normal ${
                        configured
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {configured ? 'Ready' : 'No API key'}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {m.description}
                  </div>
                </div>
                {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface AIAutocompleteProps {
  mode: 'identity' | 'command' | null;
  query: string;
  identities: PublicAIIdentity[];
  activeAiId: string;
  gatewayStatus: GatewayStatusInfo;
  onSelectSuggestion: (text: string) => void;
  onClose: () => void;
}

export const AIAutocomplete: React.FC<AIAutocompleteProps> = ({
  mode,
  query,
  identities,
  activeAiId,
  gatewayStatus,
  onSelectSuggestion,
  onClose,
}) => {
  if (!mode) return null;

  const remoteIdentities = identities.filter((i) => i.aiId !== activeAiId);

  const commandSuggestions = [
    {
      title: "Ask Bob's AI about availability",
      subtitle: 'Check calendar free/busy windows tomorrow',
      value: "Ask Bob's AI whether he is available tomorrow for a meeting.",
    },
    {
      title: "Coordinate meeting time with Bob's AI",
      subtitle: 'Ask availability and confirm the best slot',
      value:
        "Ask Bob's AI whether he is available tomorrow. If necessary, ask which time works best.",
    },
    {
      title: "Ask Charlie's AI for project status",
      subtitle: 'Request authorized work summary from @charlie',
      value: "Ask Charlie's AI what the current Phase 8 security status is.",
    },
    {
      title: 'Broadcast to all AIs in group',
      subtitle: 'Ask every participant AI in the active group session',
      value: '/ask-all Share your concise readiness assessment for our Q4 launch.',
    },
    {
      title: 'Share a memory with another AI',
      subtitle: 'Grant read-only access to a specific preference',
      value: '/share-memory @bob Alice prefers 30-minute afternoon syncs after 2 PM PST.',
    },
  ].filter(
    (c) =>
      !query ||
      c.title.toLowerCase().includes(query.toLowerCase()) ||
      c.value.toLowerCase().includes(query.toLowerCase())
  );

  if (mode === 'identity') {
    return (
      <div className="mb-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-1.5 space-y-0.5">
        <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
          <span>Communicate with a Personal AI</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        {remoteIdentities.map((id) => {
          const state = resolveIdentityPresence(id, gatewayStatus);
          const meta = getPresenceBadgeMeta(state);
          return (
            <button
              key={id.aiId}
              type="button"
              onClick={() =>
                onSelectSuggestion(
                  `Ask ${id.ownerDisplayName.split(' ')[0]}'s AI whether `
                )
              }
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <div className="relative w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-center font-semibold text-[11px]">
                  {id.displayName.slice(0, 1)}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white dark:border-zinc-900 ${meta.dotClass}`}
                  />
                </div>
                <div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {id.displayName}{' '}
                    <span className="text-zinc-400 font-normal">{id.handle}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Owner: {id.ownerDisplayName}
                  </div>
                </div>
              </div>
              <span className={`text-[11px] font-medium ${meta.textClass}`}>
                {meta.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-1.5 space-y-0.5 max-h-64 overflow-y-auto">
      <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
        <span>Suggestions & AI-to-AI actions</span>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-600"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      {commandSuggestions.map((item) => (
        <button
          key={item.title}
          type="button"
          onClick={() => onSelectSuggestion(item.value)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <div>
            <div className="font-medium text-zinc-900 dark:text-zinc-100">
              {item.title}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {item.subtitle}
            </div>
          </div>
          <Sparkles className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        </button>
      ))}
    </div>
  );
};

interface ComposerProps {
  value: string;
  onChange: (val: string) => void;
  onSend: () => void;
  onStopGeneration?: () => void;
  isSending: boolean;
  activeIdentity: PublicAIIdentity;
  identities: PublicAIIdentity[];
  gatewayStatus: GatewayStatusInfo;
  providerStatus?: ProviderStatusInfo[];
  attachments: ChatAttachment[];
  onAddAttachment: (att?: ChatAttachment) => void;
  onRemoveAttachment: (id: string) => void;
  onSelectModel: (provider: string, model: string) => void;
}

export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSend,
  onStopGeneration,
  isSending,
  activeIdentity,
  identities,
  gatewayStatus,
  providerStatus = [],
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  onSelectModel,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [autocompleteMode, setAutocompleteMode] = useState<
    'identity' | 'command' | null
  >(null);

  // Auto-expand textarea height smoothly
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const handleTextChange = (nextVal: string) => {
    onChange(nextVal);
    if (nextVal.startsWith('/')) {
      setAutocompleteMode('command');
    } else if (nextVal.endsWith('@')) {
      setAutocompleteMode('identity');
    } else if (autocompleteMode && !nextVal.includes('/') && !nextVal.includes('@')) {
      setAutocompleteMode(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      let excerpt = '';
      if (
        file.type.startsWith('text/') ||
        /\.(txt|md|json|csv|ts|tsx|js|py)$/i.test(file.name)
      ) {
        try {
          const text = await file.text();
          excerpt = text.slice(0, 1500);
        } catch {
          // ignore
        }
      }
      const sizeKb = Math.max(1, Math.round(file.size / 1024));
      onAddAttachment({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        type: 'file',
        sizeLabel: `${sizeKb} KB`,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        contentExcerpt: excerpt || undefined,
      });
    }
    e.target.value = '';
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 pb-4 pt-2 shrink-0">
      <AIAutocomplete
        mode={autocompleteMode}
        query={value.replace(/^[/]|@/g, '')}
        identities={identities}
        activeAiId={activeIdentity.aiId}
        gatewayStatus={gatewayStatus}
        onSelectSuggestion={(text) => {
          onChange(text);
          setAutocompleteMode(null);
          textareaRef.current?.focus();
        }}
        onClose={() => setAutocompleteMode(null)}
      />

      <div className="rounded-2xl border border-zinc-200/90 dark:border-zinc-800/90 bg-white dark:bg-[#16161A] shadow-sm focus-within:border-zinc-400 dark:focus-within:border-zinc-600 transition-colors p-3">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2.5">
            {attachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300"
              >
                <FileText className="w-3.5 h-3.5 text-zinc-400" />
                <span>{att.name}</span>
                <span className="text-zinc-400">({att.sizeLabel})</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  aria-label={`Remove ${att.name}`}
                  className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!isSending) {
                onSend();
              }
            }
          }}
          rows={1}
          aria-label="Message your Personal AI or collaborate with another AI"
          placeholder={`Message ${activeIdentity.displayName}, or ask another AI (e.g. "Ask Bob's AI whether he is available tomorrow")…`}
          className="w-full resize-none bg-transparent text-[15px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none leading-relaxed max-h-44"
        />

        <div className="flex items-center justify-between gap-2 pt-2.5 mt-1">
          {/* Left Composer Actions */}
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.click();
                } else {
                  onAddAttachment();
                }
              }}
              aria-label="Attach file"
              title="Attach document"
              className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() =>
                setAutocompleteMode((prev) =>
                  prev === 'identity' ? null : 'identity'
                )
              }
              aria-label="Mention or ask another Personal AI"
              title="Communicate with another AI"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors"
            >
              <AtSign className="w-3.5 h-3.5" />
              <span>Ask AI</span>
            </button>
          </div>

          {/* Right Composer Actions: Model Selector + Send / Stop Button */}
          <div className="flex items-center gap-2">
            <ModelSelector
              currentModel={activeIdentity.configuredModel}
              providerStatus={providerStatus}
              onSelectModel={onSelectModel}
            />

            {isSending && onStopGeneration ? (
              <button
                type="button"
                onClick={onStopGeneration}
                data-testid="stop-generation-btn"
                aria-label="Stop generating"
                title="Stop generating"
                className="w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center hover:bg-rose-700 transition-colors shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!value.trim() || isSending}
                aria-label="Send message"
                data-testid="send-message-btn"
                className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center hover:opacity-90 disabled:opacity-30 transition-opacity shrink-0"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
