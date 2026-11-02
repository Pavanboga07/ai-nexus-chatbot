import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  FileText,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { ChatMessage as ChatMessageModel } from '../chatbot/engine';

interface AIAttributionProps {
  message: ChatMessageModel;
}

export const AIAttribution: React.FC<AIAttributionProps> = ({ message }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const label =
    message.attributionLabel || `From ${message.senderDisplayName}`;
  const isRemote = message.role === 'remote_ai';

  if (!isRemote && !message.invocationRecord) {
    return null;
  }

  const record = message.invocationRecord;
  const minimizedFields =
    message.minimizedFields ??
    record?.responseEnvelope?.payload.minimizedFieldsReturned ??
    [];
  const redactedFields =
    message.redactedFields ??
    record?.responseEnvelope?.payload.redactedFields ??
    [];

  return (
    <div className="mt-2.5">
      <div className="inline-flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-300">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{label}</span>
        </span>
        <span>·</span>
        <button
          type="button"
          onClick={() => setDetailsOpen((prev) => !prev)}
          className="inline-flex items-center gap-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 underline underline-offset-4 decoration-zinc-300 dark:decoration-zinc-700 transition-colors"
        >
          <span>{detailsOpen ? 'Hide details' : 'Details'}</span>
          {detailsOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
      </div>

      {detailsOpen && (
        <div className="mt-2.5 p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800/90 bg-zinc-100/60 dark:bg-zinc-900/60 text-xs space-y-2.5 max-w-xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-zinc-600 dark:text-zinc-300">
            <div>
              <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Source AI
              </div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {message.senderDisplayName}
              </div>
            </div>

            <div>
              <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Request status
              </div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {record?.state ?? 'Completed'} ·{' '}
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>

            {minimizedFields.length > 0 && (
              <div>
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  Authorized fields shared
                </div>
                <div className="text-emerald-700 dark:text-emerald-400 font-medium">
                  {minimizedFields.join(', ')}
                </div>
              </div>
            )}

            {redactedFields.length > 0 && (
              <div>
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  Private fields withheld by policy
                </div>
                <div className="text-zinc-500 dark:text-zinc-400">
                  {redactedFields.join(', ')}
                </div>
              </div>
            )}
          </div>

          {record && (
            <div className="pt-2 border-t border-zinc-200/70 dark:border-zinc-800/80">
              <button
                type="button"
                onClick={() => setAdvancedOpen((prev) => !prev)}
                className="text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                {advancedOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <span>Advanced security & protocol diagnostics</span>
              </button>

              {advancedOpen && (
                <div className="mt-2 p-2.5 rounded-lg bg-zinc-950 text-zinc-300 font-mono text-[11px] space-y-1 overflow-x-auto">
                  <div>Request ID: {record.requestId}</div>
                  <div>Correlation ID: {record.envelope.correlationId}</div>
                  <div>
                    Capability: {record.envelope.payload.capability}
                  </div>
                  <div>
                    Key Fingerprint: {record.envelope.security.keyFingerprint}
                  </div>
                  <div>
                    Lifecycle:{' '}
                    {record.transitions.map((t) => t.state).join(' → ')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface MessageActionsProps {
  message: ChatMessageModel;
  copied: boolean;
  onCopy: () => void;
  onRegenerate?: () => void;
  onStartEdit?: () => void;
  onDelete?: () => void;
  onFeedback?: (val: 'up' | 'down' | null) => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  message,
  copied,
  onCopy,
  onRegenerate,
  onStartEdit,
  onDelete,
  onFeedback,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const isUser = message.role === 'user';

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pt-1">
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy message"
        title="Copy"
        className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 transition-colors"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>

      {isUser && onStartEdit && (
        <button
          type="button"
          onClick={onStartEdit}
          aria-label="Edit message"
          title="Edit"
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
      )}

      {!isUser && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          aria-label="Regenerate response"
          title="Regenerate"
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      )}

      {!isUser && onFeedback && (
        <>
          <button
            type="button"
            onClick={() =>
              onFeedback(message.feedback === 'up' ? null : 'up')
            }
            aria-label="Helpful response"
            title="Helpful"
            className={`p-1.5 rounded-md transition-colors ${
              message.feedback === 'up'
                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70'
            }`}
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() =>
              onFeedback(message.feedback === 'down' ? null : 'down')
            }
            aria-label="Unhelpful response"
            title="Not helpful"
            className={`p-1.5 rounded-md transition-colors ${
              message.feedback === 'down'
                ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10'
                : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70'
            }`}
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
        </>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete message"
          title="Delete message"
          className="p-1.5 rounded-md text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen((prev) => !prev)}
          aria-label="More message options"
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70 transition-colors"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {moreOpen && (
          <div
            onMouseLeave={() => setMoreOpen(false)}
            className="absolute left-0 top-7 z-30 w-48 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg py-1.5 px-2.5 text-[11px] text-zinc-500 dark:text-zinc-400 space-y-1"
          >
            <div>
              Sent:{' '}
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            {message.modelUsed && <div>Model: {message.modelUsed}</div>}
            {message.status && <div>Status: {message.status}</div>}
            {typeof message.tokensUsed === 'number' &&
              message.tokensUsed > 0 && (
                <div>Tokens: {message.tokensUsed}</div>
              )}
          </div>
        )}
      </div>
    </div>
  );
};

// Lightweight, clean Markdown + Code Block renderer
function renderFormattedContent(
  content: string,
  copiedCodeIdx: number | null,
  onCopyCode: (code: string, idx: number) => void
) {
  const parts = content.split(/```(\w+)?\n([\s\S]*?)```/g);
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < parts.length; i += 3) {
    const textChunk = parts[i];
    const lang = parts[i + 1];
    const codeChunk = parts[i + 2];

    if (textChunk) {
      const paragraphs = textChunk.trim().split(/\n\n+/);
      paragraphs.forEach((para, pIdx) => {
        const lines = para.split('\n');
        const isList = lines.every(
          (l) => /^(\d+\.|-|\*)\s+/.test(l.trim())
        );

        if (isList) {
          elements.push(
            <ul
              key={`list_${i}_${pIdx}`}
              className="my-2.5 space-y-1.5 pl-4 list-disc marker:text-zinc-400"
            >
              {lines.map((line, lIdx) => {
                const cleaned = line.trim().replace(/^(\d+\.|-|\*)\s+/, '');
                return (
                  <li key={lIdx} className="leading-relaxed">
                    {renderInlineFormatting(cleaned)}
                  </li>
                );
              })}
            </ul>
          );
        } else {
          elements.push(
            <p key={`p_${i}_${pIdx}`} className="leading-[1.68] my-2 first:mt-0 last:mb-0">
              {renderInlineFormatting(para)}
            </p>
          );
        }
      });
    }

    if (typeof codeChunk === 'string') {
      const blockIndex = i;
      elements.push(
        <div
          key={`code_${i}`}
          className="my-3.5 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-100"
        >
          <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900/90 border-b border-zinc-800 text-[11px] font-mono text-zinc-400">
            <span>{lang || 'code'}</span>
            <button
              type="button"
              onClick={() => onCopyCode(codeChunk.trim(), blockIndex)}
              className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              {copiedCodeIdx === blockIndex ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy code</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-3.5 text-xs font-mono leading-relaxed overflow-x-auto">
            <code>{codeChunk.trim()}</code>
          </pre>
        </div>
      );
    }
  }

  return elements;
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return tokens.map((tok, idx) => {
    if (tok.startsWith('**') && tok.endsWith('**')) {
      return (
        <strong
          key={idx}
          className="font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith('`') && tok.endsWith('`')) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800/90 text-zinc-800 dark:text-zinc-200 font-mono text-[0.84em]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('*') && tok.endsWith('*')) {
      return (
        <em key={idx} className="italic text-zinc-600 dark:text-zinc-300">
          {tok.slice(1, -1)}
        </em>
      );
    }
    return tok;
  });
}

interface ChatMessageProps {
  message: ChatMessageModel;
  onCopyMessage: (msg: ChatMessageModel) => void;
  copiedMsgId: string | null;
  onRegenerateMessage: (msg: ChatMessageModel) => void;
  onRetryMessage?: (msg: ChatMessageModel) => void;
  onDeleteMessage?: (msg: ChatMessageModel) => void;
  onEditUserMessage: (msg: ChatMessageModel, newText: string) => void;
  onFeedbackMessage: (msg: ChatMessageModel, feedback: 'up' | 'down' | null) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onCopyMessage,
  copiedMsgId,
  onRegenerateMessage,
  onRetryMessage,
  onDeleteMessage,
  onEditUserMessage,
  onFeedbackMessage,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);

  const isUser = message.role === 'user';
  const isRemote = message.role === 'remote_ai';
  const isStreaming = message.status === 'STREAMING';
  const isErrorOrInterrupted =
    message.status === 'ERROR' || message.status === 'INTERRUPTED';

  const handleCopyCode = (code: string, idx: number) => {
    navigator.clipboard?.writeText(code);
    setCopiedCodeIdx(idx);
    setTimeout(() => setCopiedCodeIdx(null), 1500);
  };

  if (isUser) {
    return (
      <div
        data-testid={`msg-${message.role}-${message.id}`}
        className="group flex flex-col items-end"
      >
        <div className="max-w-[85%] sm:max-w-[76%] rounded-2xl px-4 py-2.5 bg-zinc-200/75 dark:bg-zinc-800/85 text-zinc-900 dark:text-zinc-100 text-[15px] leading-relaxed">
          {isEditing ? (
            <form
              className="space-y-2 min-w-[240px] sm:min-w-[360px]"
              onSubmit={(e) => {
                e.preventDefault();
                if (editDraft.trim()) {
                  onEditUserMessage(message, editDraft.trim());
                }
                setIsEditing(false);
              }}
            >
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={2}
                className="w-full rounded-lg p-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-2.5 py-1 rounded-md text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium"
                >
                  Save & Submit
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="whitespace-pre-wrap">{message.content}</div>
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {message.attachments.map((att) => (
                    <span
                      key={att.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/80 dark:bg-zinc-900/80 text-xs text-zinc-700 dark:text-zinc-300"
                    >
                      <FileText className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{att.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <MessageActions
          message={message}
          copied={copiedMsgId === message.id}
          onCopy={() => onCopyMessage(message)}
          onStartEdit={() => {
            setEditDraft(message.content);
            setIsEditing(true);
          }}
          onDelete={onDeleteMessage ? () => onDeleteMessage(message) : undefined}
        />
      </div>
    );
  }

  return (
    <div
      data-testid={`msg-${message.role}-${message.id}`}
      className="group flex items-start gap-3.5"
    >
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5 ${
          isRemote
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
            : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
        }`}
      >
        {message.senderDisplayName.slice(0, 1)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {message.senderDisplayName.replace(/\s*\(@[^)]+\)/, '')}
          </span>
          {isRemote && (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              External Personal AI
            </span>
          )}
          {message.modelUsed && !isRemote && (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-normal">
              {message.modelUsed}
            </span>
          )}
          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              <span>Streaming</span>
            </span>
          )}
        </div>

        <div className="text-[15px] text-zinc-800 dark:text-zinc-200 max-w-none">
          {renderFormattedContent(
            message.content,
            copiedCodeIdx,
            handleCopyCode
          )}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 align-middle bg-zinc-700 dark:bg-zinc-300 animate-pulse" />
          )}
        </div>

        {isErrorOrInterrupted && (
          <div
            data-testid={`msg-error-banner-${message.id}`}
            className="mt-2.5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3 max-w-xl"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {message.status === 'INTERRUPTED'
                  ? message.errorMessage || 'Generation stopped.'
                  : message.errorMessage || 'Provider failed to complete response.'}
              </span>
            </div>
            {Boolean(onRetryMessage || onRegenerateMessage) && (
              <button
                type="button"
                data-testid={`retry-msg-btn-${message.id}`}
                onClick={() =>
                  onRetryMessage
                    ? onRetryMessage(message)
                    : onRegenerateMessage(message)
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 font-medium shrink-0 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            )}
          </div>
        )}

        <AIAttribution message={message} />

        <MessageActions
          message={message}
          copied={copiedMsgId === message.id}
          onCopy={() => onCopyMessage(message)}
          onRegenerate={() =>
            onRetryMessage
              ? onRetryMessage(message)
              : onRegenerateMessage(message)
          }
          onDelete={onDeleteMessage ? () => onDeleteMessage(message) : undefined}
          onFeedback={(fb) => onFeedbackMessage(message, fb)}
        />
      </div>
    </div>
  );
};
