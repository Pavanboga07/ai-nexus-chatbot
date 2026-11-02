import React, { useState } from 'react';
import {
  CheckCircle2,
  FileCode2,
  FolderGit2,
  Layers,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { AuditEventRecord } from '../protocol';
import {
  ARCHITECTURE_DIAGRAMS,
  REQUIREMENTS_MATRIX,
} from '../data/architectureDocs';

interface ArchitectureBlueprintViewProps {
  auditEvents: AuditEventRecord[];
}

export const ArchitectureBlueprintView: React.FC<ArchitectureBlueprintViewProps> = ({
  auditEvents,
}) => {
  const [selectedTab, setSelectedTab] = useState<'diagrams' | 'repositories' | 'requirements' | 'audit'>('diagrams');

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Phase 0 – Phase 8 Architectural Specification · Strict Two-Repository Isolation
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            AI Nexus System Architecture & Requirements Traceability
          </h1>
        </div>

        {/* Interactive Tab Selector */}
        <div
          role="tablist"
          aria-label="Architecture Blueprint Sections"
          className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg self-start"
        >
          <button
            role="tab"
            aria-selected={selectedTab === 'diagrams'}
            type="button"
            onClick={() => setSelectedTab('diagrams')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              selectedTab === 'diagrams'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Architecture Diagrams
          </button>
          <button
            role="tab"
            aria-selected={selectedTab === 'repositories'}
            type="button"
            onClick={() => setSelectedTab('repositories')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              selectedTab === 'repositories'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Two-Repository Structure
          </button>
          <button
            role="tab"
            aria-selected={selectedTab === 'requirements'}
            type="button"
            onClick={() => setSelectedTab('requirements')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              selectedTab === 'requirements'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Requirements Matrix
          </button>
          <button
            role="tab"
            aria-selected={selectedTab === 'audit'}
            type="button"
            onClick={() => setSelectedTab('audit')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              selectedTab === 'audit'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Cryptographic Audit Log ({auditEvents.length})
          </button>
        </div>
      </div>

      {/* Tab 1: Architecture Diagrams */}
      {selectedTab === 'diagrams' && (
        <div className="space-y-6">
          {ARCHITECTURE_DIAGRAMS.map((diag) => (
            <div
              key={diag.id}
              className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {diag.number}. {diag.title}
                </h2>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  Mermaid Blueprint Specification
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {diag.summary}
              </p>
              <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800">
                {diag.mermaidCode}
              </pre>
              <div className="pt-2 space-y-1.5">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Enforced Architectural Invariants:
                </div>
                <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                  {diag.keyInvariants.map((inv, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{inv}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 2: Two-Repository Separation */}
      {selectedTab === 'repositories' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div className="flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-indigo-500" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 font-mono">
                ai-nexus-chatbot
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Application A (Independent Git Repository in <code>/ai-nexus-chatbot</code> · Port <code>3000</code>). Hosts React frontend, Chatbot BFF, Personal AI Orchestrator, LLM Provider Adapter, Memory Vault, and Gateway SDK Client. Contains zero Gateway server modules.
            </p>
            <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto">
{`ai-nexus-chatbot/
├── .git/ (Independent Git Repo)
├── package.json (Port 3000)
├── .env.example & Dockerfile
├── README.md & DEPLOYMENT.md
├── src/
│   ├── client/main.tsx
│   ├── server/chatbotMain.ts
│   ├── features/
│   ├── services/PersonalAINodeAgent.ts
│   ├── components/
│   └── lib/
└── tests/`}
            </pre>
          </div>

          <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-500" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 font-mono">
                ai-nexus-gateway
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Application B (Independent Git Repository in <code>/ai-nexus-gateway</code> · HTTP Port <code>4000</code> · WebSocket <code>ws://localhost:4000/ws/node</code>). Zero-knowledge AI communication infrastructure: IdentityRegistry, AuthenticationService, WebSocketNodeTransport, MessageRouter, OfflineQueueManager, SecurityGuards, and AuditService.
            </p>
            <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto">
{`ai-nexus-gateway/
├── .git/ (Independent Git Repo)
├── package.json (Port 4000)
├── .env.example & Dockerfile
├── README.md & DEPLOYMENT.md
├── src/
│   ├── server/gatewayMain.ts
│   ├── identity/IdentityRegistry.ts
│   ├── auth/AuthenticationService.ts
│   ├── transport/WebSocketNodeTransport.ts
│   ├── routing/MessageRouter.ts
│   ├── invocation/InvocationManager.ts
│   ├── queue/OfflineQueueManager.ts
│   ├── security/SecurityGuards.ts
│   └── audit/AuditService.ts
└── tests/gateway.test.ts`}
            </pre>
          </div>

          <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-5 h-5 text-amber-500" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 font-mono">
                ai-nexus-protocol
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Versioned Public Contract Package (<code>/ai-nexus-protocol</code>). Defines typed Message Envelopes, 13-State Invocation Machine, 19 Error Codes, WebSocket wire frames, and <code>GatewayProtocolHttpClient</code> SDK without sharing internal implementation.
            </p>
            <pre className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto">
{`ai-nexus-protocol/
├── .git/ (Independent Git Repo)
├── package.json (@ai-nexus/protocol)
├── README.md
└── src/
    ├── schemas/index.ts
    ├── types/index.ts
    ├── events/index.ts
    └── sdk/index.ts`}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 3: Requirements Matrix */}
      {selectedTab === 'requirements' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Req ID</th>
                <th className="py-3 px-4">Repository & Module</th>
                <th className="py-3 px-4">Specification Description</th>
                <th className="py-3 px-4">Verification & Tests</th>
                <th className="py-3 px-4">Known Limitations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {REQUIREMENTS_MATRIX.map((row) => (
                <tr key={row.reqId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="py-3.5 px-4 align-top font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                    {row.reqId}
                    <div className="text-emerald-600 dark:text-emerald-400 font-normal mt-0.5">
                      {row.status}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 align-top font-mono text-xs text-slate-700 dark:text-slate-300">
                    <div>{row.repository}</div>
                    <div className="text-slate-500">{row.module}</div>
                  </td>
                  <td className="py-3.5 px-4 align-top text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {row.description}
                  </td>
                  <td className="py-3.5 px-4 align-top text-xs font-mono text-slate-600 dark:text-slate-400">
                    {row.testCoverage}
                  </td>
                  <td className="py-3.5 px-4 align-top text-xs text-slate-500 dark:text-slate-400">
                    {row.knownLimitations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: Cryptographic Audit Log */}
      {selectedTab === 'audit' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Repository / Module</th>
                <th className="py-3 px-4">Event Type</th>
                <th className="py-3 px-4">Actor → Target</th>
                <th className="py-3 px-4">Outcome</th>
                <th className="py-3 px-4">Audit Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs font-mono tabular-nums">
              {auditEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                    No remote actions recorded yet. Trigger an `/ask @bob` command or rotate a key to generate audit records.
                  </td>
                </tr>
              ) : (
                auditEvents.map((ev) => (
                  <tr key={ev.eventId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                      {ev.repository} / {ev.module}
                    </td>
                    <td className="py-3 px-4 text-indigo-600 dark:text-indigo-400 font-semibold">
                      {ev.eventType}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {ev.actorAiId} {ev.targetAiId ? `→ ${ev.targetAiId}` : ''}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={
                          ev.outcome === 'SUCCESS'
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : ev.outcome === 'DENIED' || ev.outcome === 'REVOKED'
                            ? 'text-red-600 dark:text-red-400 font-semibold'
                            : 'text-amber-600 dark:text-amber-400 font-semibold'
                        }
                      >
                        {ev.outcome}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans text-slate-700 dark:text-slate-300">
                      {ev.summary}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
