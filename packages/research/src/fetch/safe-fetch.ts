import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

import { Agent, fetch } from 'undici';

import type { NetworkPolicy } from './address.js';
import { PUBLIC_WEB, checkUrl } from './address.js';

/** DNS resolution; injectable so tests can map names to their fake server. */
export type Resolver = (hostname: string) => Promise<readonly LookupAddress[]>;

const systemResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** The URL or its target is not allowed (SSRF guard). Never retried. */
export class FetchBlockedError extends Error {
  constructor(readonly reason: string) {
    super(`fetch blocked: ${reason}`);
    this.name = 'FetchBlockedError';
  }
}

/** The fetch was allowed but failed (network, HTTP status, size, type, timeout). */
export class FetchFailedError extends Error {
  constructor(message: string, options?: ErrorOptions & { readonly status?: number }) {
    super(message, options);
    this.name = 'FetchFailedError';
    this.status = options?.status;
  }

  /** HTTP status when the server answered with a non-2xx status. */
  readonly status: number | undefined;
}

export interface SafeFetchOptions {
  /** `live-factcheck/<version> (+<repo URL>)` (brief 9.6). */
  readonly userAgent: string;
  /** Whole request including redirects and body. */
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects?: number;
  /** Production: `PUBLIC_WEB`. Only tests pass another policy. */
  readonly policy?: NetworkPolicy;
  readonly resolve?: Resolver;
}

export interface FetchedText {
  /** Final URL after redirects. */
  readonly url: string;
  readonly status: number;
  /** MIME type without parameters, lower case. */
  readonly contentType: string;
  readonly text: string;
}

export interface FetchTextOptions {
  /** Accepted MIME types, e.g. `['text/html']`. Anything else is refused before reading the body. */
  readonly accept: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface SafeFetcher {
  /** Fetches a URL chosen by strangers. 2xx only; other statuses are `FetchFailedError`. */
  fetchText(url: string, options: FetchTextOptions): Promise<FetchedText>;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType);
  const label = match?.[1] ?? 'utf-8';
  try {
    new TextDecoder(label);
    return label;
  } catch {
    return 'utf-8';
  }
}

/** The part of a web stream this module uses; undici's and the DOM's stream types differ. */
interface ByteStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: unknown }>;
    cancel(): Promise<void>;
  };
}

async function readLimited(body: ByteStream, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) {
      await reader.cancel();
      throw new FetchFailedError('unexpected body chunk');
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchFailedError('response too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * SSRF-safe fetching for URLs from search results (brief 15.5, research-pipeline.md):
 * static URL checks, DNS validation inside the connection's own lookup (so the checked address
 * is the connected address: no rebinding window), manual redirects re-checked hop by hop,
 * size and time limits, content-type allowlist.
 */
export function createSafeFetcher(options: SafeFetchOptions): SafeFetcher {
  const policy = options.policy ?? PUBLIC_WEB;
  const resolve = options.resolve ?? systemResolver;
  const maxRedirects = options.maxRedirects ?? 3;

  const lookup = ((
    hostname: string,
    lookupOptions: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    resolve(hostname).then(
      (addresses) => {
        const first = addresses[0];
        if (first === undefined || addresses.some((a) => !policy.isAllowedAddress(a.address))) {
          callback(new FetchBlockedError(`${hostname} resolves to an address that is not allowed`));
          return;
        }
        if (lookupOptions.all === true) {
          callback(null, addresses);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: unknown) => {
        callback(error);
      },
    );
  }) as unknown as LookupFunction;

  const agent = new Agent({ connect: { lookup }, connectTimeout: options.timeoutMs });

  return {
    async fetchText(rawUrl, fetchOptions) {
      const signal = AbortSignal.any([
        AbortSignal.timeout(options.timeoutMs),
        ...(fetchOptions.signal === undefined ? [] : [fetchOptions.signal]),
      ]);
      let current = rawUrl;
      for (let hop = 0; ; hop++) {
        const check = checkUrl(current, policy);
        if (!check.ok) {
          throw new FetchBlockedError(hop === 0 ? check.reason : `redirect to ${check.reason}`);
        }
        let response;
        try {
          response = await fetch(check.url, {
            dispatcher: agent,
            redirect: 'manual',
            signal,
            headers: {
              'user-agent': options.userAgent,
              accept: fetchOptions.accept.join(', '),
              ...fetchOptions.headers,
            },
          });
        } catch (error) {
          const blocked = findBlocked(error);
          if (blocked !== undefined) {
            throw blocked;
          }
          throw new FetchFailedError('request failed', { cause: error });
        }

        if (REDIRECTS.has(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (location === null) {
            throw new FetchFailedError('redirect without location');
          }
          if (hop >= maxRedirects) {
            throw new FetchFailedError('too many redirects');
          }
          current = new URL(location, check.url).toString();
          continue;
        }
        if (response.status < 200 || response.status > 299) {
          await response.body?.cancel();
          throw new FetchFailedError(`HTTP ${String(response.status)}`, {
            status: response.status,
          });
        }
        const contentTypeHeader = response.headers.get('content-type') ?? '';
        const contentType = contentTypeHeader.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!fetchOptions.accept.includes(contentType)) {
          await response.body?.cancel();
          throw new FetchFailedError(`content type ${contentType || '(none)'} not accepted`);
        }
        const declared = Number(response.headers.get('content-length') ?? '0');
        if (declared > options.maxBytes) {
          await response.body?.cancel();
          throw new FetchFailedError('response too large');
        }
        let bytes: Uint8Array;
        try {
          bytes =
            response.body === null
              ? new Uint8Array()
              : await readLimited(response.body, options.maxBytes);
        } catch (error) {
          if (error instanceof FetchFailedError) throw error;
          throw new FetchFailedError('reading the response failed', { cause: error });
        }
        const text = new TextDecoder(charsetOf(contentTypeHeader)).decode(bytes);
        return { url: check.url.toString(), status: response.status, contentType, text };
      }
    },
  };
}

/** undici wraps connect errors; find our own block reason inside the cause chain. */
function findBlocked(error: unknown): FetchBlockedError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof FetchBlockedError) return current;
    current = current.cause;
  }
  return undefined;
}
