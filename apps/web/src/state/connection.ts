import { WsServerMessage } from '@lfc/contracts';
import { create } from 'zustand';

import { useClaims } from './claims';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'unauthorized';

/** The part of the browser WebSocket this module uses; tests pass a fake (network boundary). */
export interface SocketLike {
  onopen: ((this: SocketLike, event: unknown) => void) | null;
  onmessage: ((this: SocketLike, event: { data: unknown }) => void) | null;
  onclose: ((this: SocketLike, event: { code: number }) => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Exponential backoff with jitter: 0.5 s, 1 s, 2 s … capped at 30 s (brief 11). */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** attempt);
  return Math.round(base * (0.5 + random() * 0.5));
}

/** An explanation that has not arrived 30 s after its verdict is reported as missing (ADR 0009). */
export const EXPLANATION_TIMEOUT_MS = 30_000;

/** `wss://<host>/ws/session` for the page's own origin or an absolute gateway URL. */
export function sessionUrl(
  gatewayUrl: string,
  location: Pick<Location, 'protocol' | 'host'>,
): string {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored literal prefix, linear
  const origin = /^https?:\/\//.test(gatewayUrl)
    ? new URL(gatewayUrl)
    : { protocol: location.protocol, host: location.host };
  return `${origin.protocol === 'https:' ? 'wss' : 'ws'}://${origin.host}/ws/session`;
}

interface ConnectionStore {
  status: ConnectionStatus;
  sessionId: string | null;
  connect: (url: string, token: string, factory?: SocketFactory) => void;
  disconnect: () => void;
}

/** Adapts the browser WebSocket to SocketLike without a type cast. */
const browserSocket: SocketFactory = (url) => {
  const ws = new WebSocket(url);
  const adapter: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: (data) => {
      ws.send(data);
    },
    close: (code) => {
      ws.close(code);
    },
  };
  ws.onopen = (event) => adapter.onopen?.call(adapter, event);
  ws.onmessage = (event: MessageEvent<unknown>) =>
    adapter.onmessage?.call(adapter, { data: event.data });
  ws.onclose = (event) => adapter.onclose?.call(adapter, { code: event.code });
  return adapter;
};

let socket: SocketLike | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let stopped = true;
const explanationTimers = new Map<string, ReturnType<typeof setTimeout>>();

const clearExplanationTimer = (claimId: string) => {
  clearTimeout(explanationTimers.get(claimId));
  explanationTimers.delete(claimId);
};

export const useConnection = create<ConnectionStore>((set, get) => {
  const open = (url: string, token: string, factory: SocketFactory) => {
    const current = factory(url);
    socket = current;
    current.onopen = () => {
      current.send(JSON.stringify({ type: 'auth', schemaVersion: 1, token }));
    };
    current.onmessage = (event) => {
      let parsed: ReturnType<typeof WsServerMessage.safeParse> | undefined;
      try {
        parsed =
          typeof event.data === 'string'
            ? WsServerMessage.safeParse(JSON.parse(event.data))
            : undefined;
      } catch {
        parsed = undefined;
      }
      if (!parsed?.success) return;
      const message = parsed.data;
      if (message.type === 'session.ready') {
        attempt = 0;
        set({ status: 'open', sessionId: message.sessionId });
      } else if (message.type === 'error') {
        if (message.code === 'unauthorized') {
          stopped = true;
          set({ status: 'unauthorized', sessionId: null });
        }
      } else {
        useClaims.getState().applyEvent(message.event);
        if (message.event.type === 'claim.checked') {
          const { claimId } = message.event.payload;
          // At-least-once delivery: a repeated verdict restarts the one timer, and a claim whose
          // explanation already arrived needs none (review, phase 1).
          clearExplanationTimer(claimId);
          if (useClaims.getState().claims[claimId]?.explained !== undefined) return;
          explanationTimers.set(
            claimId,
            setTimeout(() => {
              explanationTimers.delete(claimId);
              useClaims.getState().markExplanationMissing(claimId);
            }, EXPLANATION_TIMEOUT_MS),
          );
        } else if (message.event.type === 'claim.explained') {
          clearExplanationTimer(message.event.payload.claimId);
        }
      }
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      if (stopped || get().status === 'unauthorized') {
        if (get().status !== 'unauthorized') set({ status: 'idle', sessionId: null });
        return;
      }
      set({ status: 'reconnecting', sessionId: null });
      retryTimer = setTimeout(() => {
        open(url, token, factory);
      }, backoffDelay(attempt++));
    };
  };

  return {
    status: 'idle',
    sessionId: null,
    connect: (url, token, factory = browserSocket) => {
      get().disconnect();
      stopped = false;
      attempt = 0;
      set({ status: 'connecting', sessionId: null });
      open(url, token, factory);
    },
    disconnect: () => {
      stopped = true;
      clearTimeout(retryTimer);
      explanationTimers.forEach((timer) => {
        clearTimeout(timer);
      });
      explanationTimers.clear();
      const current = socket;
      socket = null;
      current?.close(1000);
      set({ status: 'idle', sessionId: null });
    },
  };
});
