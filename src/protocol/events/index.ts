// ============================================================================
// @ai-nexus/protocol — Real-Time WebSocket Events & Wire Frames (v1.0)
// ============================================================================

import {
  InvocationRequestPayload,
  InvocationResponsePayload,
  InvocationState,
  MessageEnvelope,
} from '../types/index.ts';

export enum GatewayEventType {
  NODE_CONNECTED = 'node.connected',
  NODE_DISCONNECTED = 'node.disconnected',
  INVOCATION_CREATED = 'invocation.created',
  INVOCATION_RECEIVED = 'invocation.received',
  INVOCATION_AUTHORIZED = 'invocation.authorized',
  INVOCATION_REJECTED = 'invocation.rejected',
  INVOCATION_EXECUTING = 'invocation.executing',
  INVOCATION_RESPONDING = 'invocation.responding',
  INVOCATION_COMPLETED = 'invocation.completed',
  INVOCATION_FAILED = 'invocation.failed',
  INVOCATION_EXPIRED = 'invocation.expired',
  GROUP_CREATED = 'group.created',
  GROUP_PARTICIPANT_JOINED = 'group.participant.joined',
  GROUP_PARTICIPANT_LEFT = 'group.participant.left',
  GROUP_MESSAGE_CREATED = 'group.message.created',
  DELIVERY_ACKNOWLEDGED = 'delivery.acknowledged',
  MEMORY_WITHDRAWAL_NOTICE = 'memory.withdrawal.notice',
}

// Wire frames sent over ws://localhost:4000/ws/node between Personal AI Nodes and Gateway
export type GatewayNodeWsFrame =
  | {
      type: 'node.authenticate';
      aiId: string;
      nodeId: string;
      keyFingerprint: string;
      nonce: string;
      signature: string;
      protocolVersion: '1.0';
    }
  | {
      type: 'node.authenticated';
      aiId: string;
      nodeId: string;
      timestamp: string;
      drainedQueueCount: number;
    }
  | {
      type: 'node.auth_failed';
      reason: string;
    }
  | {
      type: 'invocation.deliver';
      requestId: string;
      envelope: MessageEnvelope<InvocationRequestPayload>;
    }
  | {
      type: 'invocation.transition';
      requestId: string;
      state: InvocationState;
      summary: string;
      actor: 'SENDER_NODE' | 'GATEWAY' | 'RECIPIENT_NODE' | 'POLICY_ENGINE';
    }
  | {
      type: 'invocation.response';
      requestId: string;
      responseEnvelope: MessageEnvelope<InvocationResponsePayload>;
    }
  | {
      type: 'ping';
      aiId?: string;
      timestamp: string;
    }
  | {
      type: 'pong';
      timestamp: string;
    };
