import React, { useState } from 'react';
import {
  Activity,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Cpu,
  Globe,
  KeyRound,
  Lock,
  Moon,
  Shield,
  Sliders,
  Sparkles,
  Sun,
} from 'lucide-react';
import {
  AuditEventRecord,
  ExecutionMode,
  InvocationRecord,
  PermissionRule,
  PublicAIIdentity,
} from '../protocol';
import { AVAILABLE_MODELS } from './Composer';
import { ArchitectureBlueprintView } from './ArchitectureBlueprintView';
import {
  GatewayStatusInfo,
  ProviderStatusInfo,
} from '../services/chatbotApiClient';

export type SettingsCategory =
  | 'general'
  | 'personal_ai'
  | 'models'
  | 'memory'
  | 'network'
  | 'privacy'
  | 'security'
  | 'usage'
  | 'advanced';

interface SettingsNavigationProps {
  activeCategory: SettingsCategory;
  onSelectCategory: (cat: SettingsCategory) => void;
}

export const SettingsNavigation: React.FC<SettingsNavigationProps> = ({
  activeCategory,
  onSelectCategory,
}) => {
  const categories: Array<{
    id: SettingsCategory;
    label: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    { id: 'general', label: 'General', icon: Sliders },
    { id: 'personal_ai', label: 'Personal AI', icon: Sparkles },
    { id: 'models', label: 'Models', icon: Cpu },
    { id: 'memory', label: 'Memory', icon: Brain },
    { id: 'network', label: 'Network', icon: Globe },
    { id: 'privacy', label: 'Privacy and permissions', icon: Shield },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'usage', label: 'Usage', icon: Activity },
    { id: 'advanced', label: 'Advanced developer settings', icon: Code2 },
  ];

  return (
    <nav
      aria-label="Settings Categories"
      className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0 lg:w-60 shrink-0"
    >
      {categories.map((cat) => {
        const Icon = cat.icon;
        const active = activeCategory === cat.id;
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelectCategory(cat.id)}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap text-left ${
              active
                ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Icon className="w-4 h-4 text-zinc-500 dark:text-zinc-400 shrink-0" />
            <span>{cat.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

interface SettingsModalProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  activeIdentity: PublicAIIdentity;
  identities: PublicAIIdentity[];
  onSwitchIdentity: (aiId: string) => void;
  onUpdateModel: (aiId: string, provider: string, model: string) => void;
  onToggleNodeOnline: (
    aiId: string,
    online: boolean,
    executionMode?: ExecutionMode
  ) => void;
  onToggleKillSwitch: (aiId: string, active: boolean) => void;
  onRotateKey: (aiId: string) => void;
  autonomousFollowUp: boolean;
  onToggleAutonomousFollowUp: (enabled: boolean) => void;
  permissionsByOwner: Record<string, PermissionRule[]>;
  invocations: InvocationRecord[];
  auditEvents: AuditEventRecord[];
  gatewayStatus: GatewayStatusInfo;
  providerStatus?: ProviderStatusInfo[];
  onCreateDatabaseBackup?: () => Promise<string>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  darkMode,
  onToggleDarkMode,
  activeIdentity,
  identities,
  onSwitchIdentity,
  onUpdateModel,
  onToggleNodeOnline,
  onToggleKillSwitch,
  onRotateKey,
  autonomousFollowUp,
  onToggleAutonomousFollowUp,
  permissionsByOwner,
  invocations,
  auditEvents,
  gatewayStatus,
  providerStatus = [],
  onCreateDatabaseBackup,
}) => {
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>('general');
  const [autoMemoryRecall, setAutoMemoryRecall] = useState(true);
  const [defaultShareTtl, setDefaultShareTtl] = useState(72);
  const [showCryptoDetails, setShowCryptoDetails] = useState(false);
  const [showArchitectureBlueprint, setShowArchitectureBlueprint] =
    useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  const myRules = permissionsByOwner[activeIdentity.aiId] ?? [];
  const totalCostUsd = invocations.reduce(
    (acc, inv) =>
      acc + (inv.responseEnvelope?.payload.estimatedCostUsd ?? 0.0002),
    0
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Configure your Personal AI, model preferences, privacy boundaries, and network behavior.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <SettingsNavigation
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
        />

        <div className="flex-1 w-full rounded-2xl border border-zinc-200/90 dark:border-zinc-800/90 bg-white dark:bg-zinc-900 p-6 space-y-6">
          {/* 1. GENERAL */}
          {activeCategory === 'general' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  General
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Appearance and conversation interface preferences.
                </p>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Theme
                    </div>
                    <div className="text-xs text-zinc-500">
                      Choose between a calm dark workspace or warm light appearance.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleDarkMode}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {darkMode ? (
                      <>
                        <Moon className="w-3.5 h-3.5" />
                        <span>Dark theme</span>
                      </>
                    ) : (
                      <>
                        <Sun className="w-3.5 h-3.5" />
                        <span>Light theme</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Active Personal AI
                    </div>
                    <div className="text-xs text-zinc-500">
                      {activeIdentity.displayName} ({activeIdentity.handle}) · Owned by{' '}
                      {activeIdentity.ownerDisplayName}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveCategory('personal_ai')}
                    className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Manage profile
                  </button>
                </div>

                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Autonomous AI-to-AI follow-ups
                    </div>
                    <div className="text-xs text-zinc-500">
                      Allow your Personal AI to complete multi-turn scheduling and clarification queries automatically (capped at 5 turns).
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleAutonomousFollowUp(!autonomousFollowUp)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                      autonomousFollowUp
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                        : 'border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    {autonomousFollowUp ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Send message on Enter
                    </div>
                    <div className="text-xs text-zinc-500">
                      Press Enter to send, or Shift + Enter to insert a new line.
                    </div>
                  </div>
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Enabled
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 2. PERSONAL AI */}
          {activeCategory === 'personal_ai' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Personal AI
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Manage your Personal AI identity, availability, and runtime mode.
                </p>
              </div>

              <div className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                    Active Personal AI Identity
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {identities.map((id) => {
                      const active = id.aiId === activeIdentity.aiId;
                      return (
                        <button
                          key={id.aiId}
                          type="button"
                          onClick={() => onSwitchIdentity(id.aiId)}
                          className={`p-3 rounded-xl border text-left transition-colors ${
                            active
                              ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-800/80'
                              : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                          }`}
                        >
                          <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                            {id.displayName}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {id.handle} · {id.ownerDisplayName}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Online availability
                    </div>
                    <div className="text-xs text-zinc-500">
                      When offline, incoming requests from other AIs are held in the Gateway queue until you reconnect.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onToggleNodeOnline(
                        activeIdentity.aiId,
                        !activeIdentity.online
                      )
                    }
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                      activeIdentity.online
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    {activeIdentity.online ? 'Online' : 'Offline'}
                  </button>
                </div>

                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Hosting & execution mode
                    </div>
                    <div className="text-xs text-zinc-500">
                      Select how your Personal AI processes requests.
                    </div>
                  </div>
                  <div className="inline-flex rounded-xl p-0.5 bg-zinc-100 dark:bg-zinc-800">
                    {(
                      [
                        ExecutionMode.LOCAL,
                        ExecutionMode.HYBRID,
                        ExecutionMode.CLOUD,
                      ] as const
                    ).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          onToggleNodeOnline(
                            activeIdentity.aiId,
                            activeIdentity.online,
                            mode
                          )
                        }
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                          activeIdentity.executionMode === mode
                            ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                            : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. MODELS */}
          {activeCategory === 'models' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Models & LLM Providers
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Choose the language model powering {activeIdentity.displayName}. API keys are managed securely on the server via environment variables and never exposed to browser storage.
                </p>
              </div>

              {providerStatus.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {providerStatus.map((ps) => (
                    <div
                      key={ps.provider}
                      className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {ps.label}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            ps.configured
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {ps.configured ? 'Configured' : 'API Key Not Set'}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        {ps.statusMessage}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {AVAILABLE_MODELS.map((m) => {
                  const selected = activeIdentity.configuredModel === m.model;
                  const provObj = providerStatus.find(
                    (p) => p.provider === m.provider
                  );
                  const isReady = provObj ? provObj.configured : true;
                  return (
                    <button
                      key={m.model}
                      type="button"
                      onClick={() =>
                        onUpdateModel(activeIdentity.aiId, m.provider, m.model)
                      }
                      className={`w-full flex items-center justify-between p-3.5 rounded-xl border text-left transition-colors ${
                        selected
                          ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-800/70'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {m.label}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              isReady
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isReady ? 'Ready' : 'Requires server key'}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          Provider: {m.provider} · Model ID: {m.model}
                        </div>
                      </div>
                      {selected && (
                        <Check className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. MEMORY */}
          {activeCategory === 'memory' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Memory
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Control how your Personal AI recalls and shares stored context.
                </p>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Automatic memory recall in conversations
                    </div>
                    <div className="text-xs text-zinc-500">
                      Allow your Personal AI to reference relevant personal memories when answering you.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoMemoryRecall((p) => !p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                      autoMemoryRecall
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                        : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600'
                    }`}
                  >
                    {autoMemoryRecall ? 'Enabled' : 'Paused'}
                  </button>
                </div>

                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Default duration when sharing with another AI
                    </div>
                    <div className="text-xs text-zinc-500">
                      Shared memories automatically expire after this period unless revoked earlier.
                    </div>
                  </div>
                  <select
                    value={defaultShareTtl}
                    onChange={(e) => setDefaultShareTtl(Number(e.target.value))}
                    className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs"
                  >
                    <option value={24}>24 hours</option>
                    <option value={72}>3 days</option>
                    <option value={168}>7 days</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* 5. NETWORK */}
          {activeCategory === 'network' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Network
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Configure how your Personal AI coordinates with other AIs across the network.
                </p>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      Autonomous multi-turn coordination
                    </div>
                    <div className="text-xs text-zinc-500">
                      Allow your AI to ask clarifying follow-up questions (up to 5 turns) when you ask it to coordinate a time or task with another AI.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onToggleAutonomousFollowUp(!autonomousFollowUp)
                    }
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-medium ${
                      autonomousFollowUp
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                        : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    {autonomousFollowUp ? 'Enabled (Max 5 turns)' : 'Disabled'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 6. PRIVACY AND PERMISSIONS */}
          {activeCategory === 'privacy' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Privacy and permissions
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Default-deny protection ensures external AIs only see fields you explicitly allow.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Pause all incoming AI requests (Kill Switch)
                  </div>
                  <div className="text-xs text-zinc-500">
                    Immediately block all external Personal AIs from querying {activeIdentity.displayName}.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onToggleKillSwitch(
                      activeIdentity.aiId,
                      !activeIdentity.killSwitchActive
                    )
                  }
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-medium ${
                    activeIdentity.killSwitchActive
                      ? 'bg-rose-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {activeIdentity.killSwitchActive
                    ? 'All Incoming Paused'
                    : 'Pause incoming'}
                </button>
              </div>

              <div className="text-xs text-zinc-500">
                Active sharing rules for {activeIdentity.displayName}:{' '}
                <strong>{myRules.length} configured rules</strong>. Manage individual AI rules in the Network screen.
              </div>
            </div>
          )}

          {/* 7. SECURITY */}
          {activeCategory === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Security
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Identity verification and prompt-injection protection.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 space-y-2 text-xs">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  Untrusted external input guard: Active
                </div>
                <p className="text-zinc-500">
                  All incoming requests from other AIs are inspected for instruction-override attempts before reaching your policy engine or language model.
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowCryptoDetails((p) => !p)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  {showCryptoDetails ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                  <span>Advanced cryptographic identity configuration</span>
                </button>

                {showCryptoDetails && (
                  <div className="mt-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-3 text-xs">
                    <div className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                      Active Key Fingerprint: {activeIdentity.keyFingerprint}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRotateKey(activeIdentity.aiId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Rotate Ed25519 signing key</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 8. USAGE */}
          {activeCategory === 'usage' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Usage
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Activity summary and policy execution budgets.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="text-xs text-zinc-500">
                    AI-to-AI requests routed
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-1">
                    {invocations.length}
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="text-xs text-zinc-500">
                    Estimated session cost
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-1">
                    ${totalCostUsd.toFixed(4)}
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="text-xs text-zinc-500">
                    Per-request budget ceiling
                  </div>
                  <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mt-1">
                    $0.0500
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 9. ADVANCED DEVELOPER SETTINGS (Includes Architecture Blueprint) */}
          {activeCategory === 'advanced' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Advanced developer settings
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Gateway connection diagnostics and system architecture specifications.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono space-y-1.5">
                <div>Chatbot Application: http://localhost:3000 (Online)</div>
                <div>
                  Database Engine: SQLite (node:sqlite WAL mode, persistent on disk)
                </div>
                <div>
                  Gateway HTTP Endpoint: {gatewayStatus.httpUrl} (
                  {gatewayStatus.connected ? 'CONNECTED' : 'UNAVAILABLE'})
                </div>
                <div>Gateway WebSocket Transport: {gatewayStatus.wsUrl}</div>
              </div>

              {onCreateDatabaseBackup && (
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Online SQLite Database Backup
                    </div>
                    <div className="text-xs text-zinc-500">
                      Create an atomic snapshot of conversations, messages, memories, and settings via SQLite VACUUM INTO.
                    </div>
                    {backupNotice && (
                      <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                        {backupNotice}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid="create-db-backup-btn"
                    onClick={async () => {
                      const path = await onCreateDatabaseBackup();
                      setBackupNotice(`Snapshot saved: ${path}`);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium shrink-0"
                  >
                    Create Backup Snapshot
                  </button>
                </div>
              )}

              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowArchitectureBlueprint((p) => !p)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>
                    {showArchitectureBlueprint
                      ? 'Hide Developer / System Architecture Blueprint'
                      : 'Open Developer / System Architecture Blueprint'}
                  </span>
                </button>

                {showArchitectureBlueprint && (
                  <div className="mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                    <ArchitectureBlueprintView auditEvents={auditEvents} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
