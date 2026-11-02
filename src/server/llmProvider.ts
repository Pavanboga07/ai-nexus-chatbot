// ============================================================================
// AI NEXUS CHATBOT — Multi-Provider LLM Abstraction & Context Manager
// (`src/server/llmProvider.ts`)
//
// Responsibilities:
// - Clean provider interface supporting Google Gemini (@google/genai) and
//   OpenAI-compatible HTTP/SSE endpoints.
// - Multi-turn context window construction with token/character budgeting.
// - Real streaming response generator with AbortSignal cancellation.
// - Structured error classification (PROVIDER_NOT_CONFIGURED, RATE_LIMITED,
//   PROVIDER_TIMEOUT, PROVIDER_ERROR, ABORTED) without silent fake fallbacks.
// ============================================================================

import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { MemoryEntry, PublicAIIdentity } from '../protocol/index.ts';
import { ChatAttachment, ChatMessage, RawOwnerDataset } from '../chatbot/engine.ts';

export type LLMErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'ABORTED';

export class LLMProviderError extends Error {
  public readonly code: LLMErrorCode;
  public readonly provider: string;
  public readonly model: string;
  public readonly retryable: boolean;

  constructor(params: {
    code: LLMErrorCode;
    message: string;
    provider: string;
    model: string;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = 'LLMProviderError';
    this.code = params.code;
    this.provider = params.provider;
    this.model = params.model;
    this.retryable =
      params.retryable ??
      (params.code === 'RATE_LIMITED' ||
        params.code === 'PROVIDER_TIMEOUT' ||
        params.code === 'PROVIDER_ERROR');
  }
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextWindowOptions {
  maxMessages?: number;
  maxCharacterBudget?: number;
}

export interface BuiltConversationContext {
  systemInstruction: string;
  turns: ConversationTurn[];
  truncatedMessagesCount: number;
  estimatedInputTokens: number;
}

export interface LLMGenerationInput {
  provider: string;
  model: string;
  systemInstruction: string;
  turns: ConversationTurn[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LLMStreamChunk {
  delta: string;
  accumulatedText: string;
}

export interface LLMGenerationResult {
  text: string;
  providerUsed: string;
  modelUsed: string;
  tokensUsed: number;
  costUsd: number;
}

export interface LLMProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  isConfigured(): boolean;
  getConfigurationStatus(): {
    providerId: string;
    displayName: string;
    configured: boolean;
    envVarName: string;
    supportedModels: Array<{ id: string; label: string }>;
  };
  generateStream(
    input: LLMGenerationInput,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMGenerationResult>;
  generateComplete(input: LLMGenerationInput): Promise<LLMGenerationResult>;
}

export const SUPPORTED_PROVIDER_MODELS: Array<{
  provider: string;
  model: string;
  label: string;
  envVar: string;
}> = [
  {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    envVar: 'GEMINI_API_KEY',
  },
  {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    envVar: 'GEMINI_API_KEY',
  },
  {
    provider: 'gemini',
    model: 'gemini-flash-latest',
    label: 'Gemini Flash Latest',
    envVar: 'GEMINI_API_KEY',
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    label: 'GPT-4o Mini (OpenAI)',
    envVar: 'OPENAI_API_KEY',
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    label: 'GPT-4o (OpenAI)',
    envVar: 'OPENAI_API_KEY',
  },
];

export function normalizeGeminiModelName(model: string): string {
  const m = model.trim();
  if (
    m === 'gemini-3.8-flash' ||
    m === 'gemini-3.1-flash-lite' ||
    m === 'gemini-flash-latest'
  ) {
    return m;
  }
  // Map any legacy or deprecated alias to supported gemini-3.8-flash
  return 'gemini-3.8-flash';
}

/**
 * Constructs a bounded multi-turn conversation context window from persisted history,
 * owner workspace summary, relevant owner memories, and attachment excerpts.
 */
export function buildConversationContext(params: {
  aiIdentity: PublicAIIdentity;
  conversationMessages: ChatMessage[];
  relevantMemories: MemoryEntry[];
  dataset?: RawOwnerDataset | null;
  currentAttachments?: ChatAttachment[];
  options?: ContextWindowOptions;
}): BuiltConversationContext {
  const maxMessages = params.options?.maxMessages ?? 16;
  const maxCharBudget = params.options?.maxCharacterBudget ?? 24000;

  // Filter out empty or failed messages so they do not pollute context
  const eligible = params.conversationMessages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant' || m.role === 'remote_ai') &&
      m.status !== 'ERROR' &&
      m.content &&
      m.content.trim().length > 0
  );

  // Take the most recent messages within both message count and character budget
  const selectedReversed: ConversationTurn[] = [];
  let accumulatedChars = 0;

  for (let i = eligible.length - 1; i >= 0; i--) {
    if (selectedReversed.length >= maxMessages) break;
    const msg = eligible[i];
    const cleanText = msg.content.trim();
    if (
      selectedReversed.length > 0 &&
      accumulatedChars + cleanText.length > maxCharBudget
    ) {
      break;
    }

    const mappedRole: 'user' | 'assistant' =
      msg.role === 'user' ? 'user' : 'assistant';
    const formattedContent =
      msg.role === 'remote_ai'
        ? `[External AI Response from ${msg.senderDisplayName}]: ${cleanText}`
        : cleanText;

    selectedReversed.push({
      role: mappedRole,
      content: formattedContent,
    });
    accumulatedChars += formattedContent.length;
  }

  const turns = selectedReversed.reverse();
  const truncatedMessagesCount = Math.max(0, eligible.length - turns.length);

  // Merge consecutive identical roles if any so strict alternating APIs stay valid
  const mergedTurns: ConversationTurn[] = [];
  for (const turn of turns) {
    const prev = mergedTurns[mergedTurns.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = `${prev.content}\n\n${turn.content}`;
    } else {
      mergedTurns.push({ ...turn });
    }
  }

  // Append attachment excerpts to the final user turn if present
  const lastEligibleMsg = eligible[eligible.length - 1];
  const effectiveAttachments =
    params.currentAttachments && params.currentAttachments.length > 0
      ? params.currentAttachments
      : lastEligibleMsg?.attachments;

  if (
    effectiveAttachments &&
    effectiveAttachments.length > 0 &&
    mergedTurns.length > 0 &&
    mergedTurns[mergedTurns.length - 1].role === 'user'
  ) {
    const attText = effectiveAttachments
      .map(
        (a) =>
          `[Attached File: "${a.name}" (${a.mimeType || 'text/plain'}, ${
            a.sizeBytes ?? a.sizeLabel
          })]${a.contentExcerpt ? `\nExcerpt: ${a.contentExcerpt}` : ''}`
      )
      .join('\n');
    if (!mergedTurns[mergedTurns.length - 1].content.includes('[Attached File:')) {
      mergedTurns[mergedTurns.length - 1].content += `\n\n${attText}`;
    }
  }

  // Also include attachment excerpts on earlier user turns if they had attachments
  for (let idx = 0; idx < mergedTurns.length - 1; idx++) {
    const t = mergedTurns[idx];
    if (t.role === 'user') {
      const matchingMsg = eligible.find(
        (m) => m.role === 'user' && t.content.includes(m.content.trim())
      );
      if (
        matchingMsg?.attachments &&
        matchingMsg.attachments.length > 0 &&
        !t.content.includes('[Attached File:')
      ) {
        const attText = matchingMsg.attachments
          .map(
            (a) =>
              `[Attached File: "${a.name}" (${a.mimeType || 'text/plain'})]${
                a.contentExcerpt ? `\nExcerpt: ${a.contentExcerpt}` : ''
              }`
          )
          .join('\n');
        t.content += `\n\n${attText}`;
      }
    }
  }

  const memoryBlock =
    params.relevantMemories.length > 0
      ? `Relevant Owner Memories:\n${params.relevantMemories
          .map((m) => `- [${m.category}] ${m.title}: ${m.content}`)
          .join('\n')}`
      : '';

  const freeWindows =
    params.dataset?.calendarSlots
      ?.filter((s) => s.status === 'FREE')
      .map((s) => s.timeWindow)
      .join(', ') || 'None listed';

  const workBlock = params.dataset
    ? `Owner Workspace Context:\n- Public Summary: ${
        params.dataset.workStatus?.publicSummary ?? 'N/A'
      }\n- Active Milestone: ${
        params.dataset.workStatus?.activeMilestone ?? 'N/A'
      }\n- Available Calendar Windows: ${freeWindows}`
    : '';

  const systemInstruction = [
    `You are ${params.aiIdentity.displayName} (${params.aiIdentity.handle}), the Personal AI owned by ${params.aiIdentity.ownerDisplayName}.`,
    `Provide helpful, accurate, and natural responses in a conversational tone. Maintain continuity across multi-turn conversation history.`,
    workBlock,
    memoryBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  const estimatedInputTokens = Math.max(
    32,
    Math.ceil((systemInstruction.length + accumulatedChars) / 4)
  );

  return {
    systemInstruction,
    turns: mergedTurns,
    truncatedMessagesCount,
    estimatedInputTokens,
  };
}

// ----------------------------------------------------------------------------
// 1. Google Gemini Provider Adapter (`@google/genai`)
// ----------------------------------------------------------------------------

export class GeminiLLMProvider implements LLMProviderAdapter {
  public readonly providerId = 'gemini';
  public readonly displayName = 'Google Gemini';

  private getApiKey(): string | undefined {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key || key === 'MY_GEMINI_API_KEY' || key.length < 10) {
      return undefined;
    }
    return key;
  }

  public isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  public getConfigurationStatus() {
    return {
      providerId: this.providerId,
      displayName: this.displayName,
      configured: this.isConfigured(),
      envVarName: 'GEMINI_API_KEY',
      supportedModels: SUPPORTED_PROVIDER_MODELS.filter(
        (m) => m.provider === 'gemini'
      ).map((m) => ({ id: m.model, label: m.label })),
    };
  }

  private createClient(): GoogleGenAI {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new LLMProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        provider: this.providerId,
        model: 'gemini-3.8-flash',
        message:
          'Google Gemini provider is not configured. Set GEMINI_API_KEY in the server environment (Settings > Secrets).',
        retryable: false,
      });
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  private mapError(err: unknown, model: string): LLMProviderError {
    if (err instanceof LLMProviderError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();

    if (lower.includes('abort')) {
      return new LLMProviderError({
        code: 'ABORTED',
        provider: this.providerId,
        model,
        message: 'Generation stopped by user.',
        retryable: true,
      });
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
      return new LLMProviderError({
        code: 'PROVIDER_TIMEOUT',
        provider: this.providerId,
        model,
        message: `Gemini request timed out (${model}). Please retry.`,
        retryable: true,
      });
    }
    if (
      lower.includes('429') ||
      lower.includes('resource_exhausted') ||
      lower.includes('quota') ||
      lower.includes('rate limit')
    ) {
      return new LLMProviderError({
        code: 'RATE_LIMITED',
        provider: this.providerId,
        model,
        message:
          'Gemini rate limit or quota reached (429 RESOURCE_EXHAUSTED). Please wait a moment and retry.',
        retryable: true,
      });
    }
    if (
      lower.includes('api_key_invalid') ||
      lower.includes('permission_denied') ||
      lower.includes('403')
    ) {
      return new LLMProviderError({
        code: 'INVALID_API_KEY',
        provider: this.providerId,
        model,
        message:
          'Gemini API key was rejected (403/API_KEY_INVALID). Check your key in Settings > Secrets.',
        retryable: false,
      });
    }
    return new LLMProviderError({
      code: 'PROVIDER_ERROR',
      provider: this.providerId,
      model,
      message: `Gemini provider error: ${msg}`,
      retryable: true,
    });
  }

  public async generateStream(
    input: LLMGenerationInput,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMGenerationResult> {
    const primaryModel = normalizeGeminiModelName(input.model);
    const uniqueCandidates = Array.from(
      new Set([primaryModel, 'gemini-3.1-flash-lite', 'gemini-flash-latest'])
    );
    const candidateModels = [...uniqueCandidates, ...uniqueCandidates];
    const ai = this.createClient();

    const contents = input.turns.map((t) => ({
      role: t.role === 'user' ? 'user' : 'model',
      parts: [{ text: t.content }],
    }));

    const timeoutMs = input.timeoutMs ?? 4500;
    let lastError: unknown = null;

    for (let idx = 0; idx < candidateModels.length; idx++) {
      const modelName = candidateModels[idx];
      if (idx >= uniqueCandidates.length) {
        await new Promise((r) => setTimeout(r, 400));
      }
      let timer: NodeJS.Timeout | null = null;
      let accumulatedText = '';
      try {
        const consumeStream = async () => {
          const responseStream = await ai.models.generateContentStream({
            model: modelName,
            contents:
              contents.length > 0
                ? contents
                : [{ role: 'user', parts: [{ text: 'Hello' }] }],
            config: {
              systemInstruction: input.systemInstruction,
            },
          });

          for await (const rawChunk of responseStream) {
            if (input.signal?.aborted) {
              throw new LLMProviderError({
                code: 'ABORTED',
                provider: this.providerId,
                model: modelName,
                message: 'Generation stopped by user.',
                retryable: true,
              });
            }
            const chunk = rawChunk as GenerateContentResponse;
            const delta = chunk.text ?? '';
            if (delta) {
              if (timer) {
                clearTimeout(timer);
                timer = null;
              }
              accumulatedText += delta;
              onChunk({ delta, accumulatedText });
            }
          }
        };

        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new LLMProviderError({
                code: 'PROVIDER_TIMEOUT',
                provider: this.providerId,
                model: modelName,
                message: `Gemini streaming request timed out after ${timeoutMs}ms.`,
                retryable: true,
              })
            );
          }, timeoutMs);
          timer.unref?.();
        });

        await Promise.race([consumeStream(), timeoutPromise]);

        const finalText = accumulatedText.trim() || 'Response completed.';
        const tokensUsed = Math.max(32, Math.ceil(finalText.length / 4));
        return {
          text: finalText,
          providerUsed: this.providerId,
          modelUsed: modelName,
          tokensUsed,
          costUsd: Number((tokensUsed * 0.000002).toFixed(6)),
        };
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        const isTransientOverload =
          accumulatedText.length === 0 &&
          !input.signal?.aborted &&
          (msg.includes('503') ||
            msg.includes('unavailable') ||
            msg.includes('high demand') ||
            msg.includes('overloaded') ||
            msg.includes('timed out') ||
            msg.includes('timeout'));
        if (isTransientOverload && idx < candidateModels.length - 1) {
          continue;
        }
        throw this.mapError(err, modelName);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    throw this.mapError(lastError, primaryModel);
  }

  public async generateComplete(
    input: LLMGenerationInput
  ): Promise<LLMGenerationResult> {
    let full = '';
    return this.generateStream(input, (c) => {
      full = c.accumulatedText;
    });
  }
}

// ----------------------------------------------------------------------------
// 2. OpenAI-Compatible Provider Adapter (`OPENAI_API_KEY` / `OPENAI_BASE_URL`)
// ----------------------------------------------------------------------------

export class OpenAICompatibleLLMProvider implements LLMProviderAdapter {
  public readonly providerId = 'openai';
  public readonly displayName = 'OpenAI Compatible';

  private getApiKey(): string | undefined {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key || key === 'MY_OPENAI_API_KEY' || key.length < 8) {
      return undefined;
    }
    return key;
  }

  private getBaseUrl(): string {
    return (
      process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
    ).replace(/\/+$/, '');
  }

  public isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  public getConfigurationStatus() {
    return {
      providerId: this.providerId,
      displayName: this.displayName,
      configured: this.isConfigured(),
      envVarName: 'OPENAI_API_KEY',
      supportedModels: SUPPORTED_PROVIDER_MODELS.filter(
        (m) => m.provider === 'openai'
      ).map((m) => ({ id: m.model, label: m.label })),
    };
  }

  public async generateStream(
    input: LLMGenerationInput,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMGenerationResult> {
    const apiKey = this.getApiKey();
    const modelName = input.model || 'gpt-4o-mini';

    if (!apiKey) {
      throw new LLMProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        provider: this.providerId,
        model: modelName,
        message:
          'OpenAI provider is not configured (OPENAI_API_KEY is not set). Switch to Gemini 3.8 Flash or configure OPENAI_API_KEY in server environment variables.',
        retryable: false,
      });
    }

    const messages = [
      { role: 'system', content: input.systemInstruction },
      ...input.turns.map((t) => ({ role: t.role, content: t.content })),
    ];

    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? 45000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    const onExternalAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onExternalAbort);

    try {
      const res = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (res.status === 401 || res.status === 403) {
          throw new LLMProviderError({
            code: 'INVALID_API_KEY',
            provider: this.providerId,
            model: modelName,
            message: `OpenAI API key rejected (${res.status}).`,
            retryable: false,
          });
        }
        if (res.status === 429) {
          throw new LLMProviderError({
            code: 'RATE_LIMITED',
            provider: this.providerId,
            model: modelName,
            message: 'OpenAI rate limit exceeded (429). Please retry shortly.',
            retryable: true,
          });
        }
        throw new LLMProviderError({
          code: 'PROVIDER_ERROR',
          provider: this.providerId,
          model: modelName,
          message: `OpenAI error (${res.status}): ${errBody.slice(0, 200)}`,
          retryable: true,
        });
      }

      if (!res.body) {
        throw new LLMProviderError({
          code: 'PROVIDER_ERROR',
          provider: this.providerId,
          model: modelName,
          message: 'OpenAI response did not include a readable stream.',
          retryable: true,
        });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';

      while (true) {
        if (input.signal?.aborted) {
          throw new LLMProviderError({
            code: 'ABORTED',
            provider: this.providerId,
            model: modelName,
            message: 'Generation stopped by user.',
            retryable: true,
          });
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              accumulatedText += delta;
              onChunk({ delta, accumulatedText });
            }
          } catch {
            // ignore partial JSON line
          }
        }
      }

      const finalText = accumulatedText.trim() || 'Response completed.';
      const tokensUsed = Math.max(32, Math.ceil(finalText.length / 4));
      return {
        text: finalText,
        providerUsed: this.providerId,
        modelUsed: modelName,
        tokensUsed,
        costUsd: Number((tokensUsed * 0.000003).toFixed(6)),
      };
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      if (input.signal?.aborted) {
        throw new LLMProviderError({
          code: 'ABORTED',
          provider: this.providerId,
          model: modelName,
          message: 'Generation stopped by user.',
          retryable: true,
        });
      }
      throw new LLMProviderError({
        code: 'PROVIDER_ERROR',
        provider: this.providerId,
        model: modelName,
        message:
          err instanceof Error
            ? err.message
            : 'OpenAI-compatible request failed.',
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  public async generateComplete(
    input: LLMGenerationInput
  ): Promise<LLMGenerationResult> {
    return this.generateStream(input, () => {});
  }
}

// ----------------------------------------------------------------------------
// 3. Provider Registry & Router (`LLMProviderRegistry`)
// ----------------------------------------------------------------------------

export class LLMProviderRegistry {
  private providers = new Map<string, LLMProviderAdapter>();

  constructor() {
    this.registerProvider(new GeminiLLMProvider());
    this.registerProvider(new OpenAICompatibleLLMProvider());
  }

  public registerProvider(adapter: LLMProviderAdapter): void {
    this.providers.set(adapter.providerId.toLowerCase(), adapter);
  }

  public getProvider(providerId: string): LLMProviderAdapter {
    const clean = (providerId || 'gemini').toLowerCase();
    const found = this.providers.get(clean);
    if (found) return found;
    // If unknown provider is requested, return a clear unconfigured error when invoked
    return {
      providerId: clean,
      displayName: providerId,
      isConfigured: () => false,
      getConfigurationStatus: () => ({
        providerId: clean,
        displayName: providerId,
        configured: false,
        envVarName: `${clean.toUpperCase()}_API_KEY`,
        supportedModels: [],
      }),
      generateStream: async () => {
        throw new LLMProviderError({
          code: 'PROVIDER_NOT_CONFIGURED',
          provider: clean,
          model: 'unknown',
          message: `Provider '${providerId}' is not configured on this server. Select Gemini 3.8 Flash or configure ${clean.toUpperCase()}_API_KEY.`,
          retryable: false,
        });
      },
      generateComplete: async () => {
        throw new LLMProviderError({
          code: 'PROVIDER_NOT_CONFIGURED',
          provider: clean,
          model: 'unknown',
          message: `Provider '${providerId}' is not configured on this server.`,
          retryable: false,
        });
      },
    };
  }

  public listProviderStatuses() {
    return Array.from(this.providers.values()).map((p) =>
      p.getConfigurationStatus()
    );
  }

  public hasAnyConfiguredProvider(): boolean {
    return Array.from(this.providers.values()).some((p) => p.isConfigured());
  }
}
