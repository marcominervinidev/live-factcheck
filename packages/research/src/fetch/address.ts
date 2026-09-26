import { BlockList, isIP } from 'node:net';

/**
 * Address and host rules of the SSRF guard (brief 15.5, `.ai/research/research-pipeline.md`).
 * Only globally routable unicast addresses are allowed; everything that could reach our own
 * containers, the Docker host, the LAN or cloud metadata is blocked.
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network", unspecified
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['100::', 64], // discard
  ['2001::', 32], // Teredo (embeds an obfuscated IPv4)
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** Expands an IPv6 address into 8 hextets (numbers). */
function hextets(address: string): number[] {
  let [head = '', tail = ''] = address.split('::');
  // An embedded dotted IPv4 tail (e.g. ::ffff:1.2.3.4) becomes two hextets.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1];
  const convert = (part: string) => {
    if (dotted === undefined || !part.endsWith(dotted)) return part;
    const [a = 0, b = 0, c = 0, d = 0] = dotted.split('.').map(Number);
    return (
      part.slice(0, -dotted.length) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    );
  };
  head = convert(head);
  tail = convert(tail);
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const middle = address.includes('::')
    ? new Array<string>(8 - left.length - right.length).fill('0')
    : [];
  return [...left, ...middle, ...right].map((h) => parseInt(h, 16));
}

const v4FromHextets = (high: number, low: number) =>
  `${String(high >> 8)}.${String(high & 0xff)}.${String(low >> 8)}.${String(low & 0xff)}`;

/**
 * The IPv4 address embedded in IPv4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96) and 6to4
 * (2002::/16) addresses; attackers use these forms to smuggle internal IPv4 targets.
 */
function embeddedV4(address: string): string | undefined {
  const h = hextets(address);
  if (h.length !== 8) return undefined;
  const [h0, h1, h2, h3, h4, h5, h6 = 0, h7 = 0] = h;
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff)
    return v4FromHextets(h6, h7);
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0)
    return v4FromHextets(h6, h7);
  if (h0 === 0x2002) return v4FromHextets(h1 ?? 0, h2 ?? 0);
  return undefined;
}

/** True only for globally routable unicast addresses. Anything unparsable is not public. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return !blocked.check(address, 'ipv4');
  }
  if (version === 6) {
    const v4 = embeddedV4(address.toLowerCase());
    if (v4 !== undefined) {
      return isPublicAddress(v4);
    }
    // Only global unicast 2000::/3 is public; everything else (IPv4-compatible ::/96,
    // IPv4-translated, site-local fec0::/10, local-use NAT64 64:ff9b:1::/48, …) is not
    // (security review finding 5).
    const firstHextet = hextets(address.toLowerCase())[0] ?? 0;
    if (firstHextet < 0x2000 || firstHextet > 0x3fff) {
      return false;
    }
    return !blocked.check(address, 'ipv6');
  }
  return false;
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];

/** Host names that point into our own network: Compose service names, mDNS, Docker host. */
export function isInternalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || !host.includes('.')) {
    return true;
  }
  return INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** What a fetch may connect to. Production uses `PUBLIC_WEB`; tests may allow their fake server. */
export interface NetworkPolicy {
  readonly allowedPorts: ReadonlySet<number>;
  readonly isAllowedAddress: (address: string) => boolean;
}

export const PUBLIC_WEB: NetworkPolicy = {
  allowedPorts: new Set([80, 443]),
  isAllowedAddress: isPublicAddress,
};

export type UrlCheck =
  { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly reason: string };

/**
 * Static URL checks before any connection: scheme, credentials, port, host name and IP literals
 * (IP literals never reach the DNS lookup, so they are checked here).
 */
export function checkUrl(raw: string, policy: NetworkPolicy): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `scheme ${url.protocol} not allowed` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials in URL' };
  }
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!policy.allowedPorts.has(port)) {
    return { ok: false, reason: `port ${String(port)} not allowed` };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) {
    return policy.isAllowedAddress(host)
      ? { ok: true, url }
      : { ok: false, reason: 'address not allowed' };
  }
  if (isInternalHostname(host)) {
    return { ok: false, reason: 'internal host name' };
  }
  return { ok: true, url };
}
