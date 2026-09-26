// SSRF attack cases first (plan T3.1, brief 15.5): every address and host name an attacker could
// put into a search result to reach something internal.
import { describe, expect, it } from 'vitest';

import { checkUrl, isInternalHostname, isPublicAddress } from './address.js';

describe('isPublicAddress', () => {
  it.each([
    ['loopback v4', '127.0.0.1'],
    ['loopback v4 range', '127.8.9.10'],
    ['unspecified v4', '0.0.0.0'],
    ['"this network"', '0.1.2.3'],
    ['RFC 1918 10/8', '10.0.0.5'],
    ['RFC 1918 172.16/12', '172.20.0.3'],
    ['RFC 1918 192.168/16', '192.168.1.1'],
    ['CGNAT', '100.64.0.1'],
    ['link-local', '169.254.1.1'],
    ['cloud metadata', '169.254.169.254'],
    ['IETF protocol assignments', '192.0.0.8'],
    ['TEST-NET-1', '192.0.2.10'],
    ['benchmarking', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    ['reserved / broadcast', '255.255.255.255'],
    ['loopback v6', '::1'],
    ['unspecified v6', '::'],
    ['unique local v6', 'fd00::1'],
    ['link-local v6', 'fe80::1'],
    ['multicast v6', 'ff02::1'],
    ['documentation v6', '2001:db8::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped metadata', '::ffff:169.254.169.254'],
    ['IPv4-mapped private (hex form)', '::ffff:a00:1'],
    ['NAT64 of a private address', '64:ff9b::a00:1'],
    ['6to4 of loopback', '2002:7f00:1::1'],
    ['not an IP at all', 'redis'],
  ])('blocks %s (%s)', (_label, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ['public v4', '8.8.8.8'],
    ['public v4 next to a private range', '172.32.0.1'],
    ['public v6', '2a00:1450:4001:80b::200e'],
    ['IPv4-mapped public', '::ffff:8.8.8.8'],
  ])('allows %s (%s)', (_label, address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('isInternalHostname', () => {
  it.each([
    'localhost',
    'LOCALHOST.',
    'foo.localhost',
    'redis',
    'postgres',
    'searxng',
    'gateway',
    'host.docker.internal',
    'metadata.google.internal',
    'printer.local',
    'router.home.arpa',
  ])('treats %s as internal', (host) => {
    expect(isInternalHostname(host)).toBe(true);
  });

  it.each(['de.wikipedia.org', 'www.destatis.de', 'correctiv.org'])(
    'treats %s as external',
    (host) => {
      expect(isInternalHostname(host)).toBe(false);
    },
  );
});

describe('checkUrl', () => {
  const policy = { allowedPorts: new Set([80, 443]), isAllowedAddress: isPublicAddress };

  it.each([
    ['file scheme', 'file:///etc/passwd'],
    ['gopher scheme', 'gopher://example.org/'],
    ['data URL', 'data:text/html,<script>alert(1)</script>'],
    ['credentials in the URL', 'https://user:pw@example.org/'],
    ['internal host name', 'http://redis:6379/'],
    ['docker host', 'http://host.docker.internal:1234/v1/models'],
    ['loopback IP literal', 'http://127.0.0.1/'],
    ['metadata IP literal', 'http://169.254.169.254/latest/meta-data/'],
    ['decimal IP literal (WHATWG normalises it)', 'http://2130706433/'],
    ['hex IP literal', 'http://0x7f000001/'],
    ['IPv6 loopback literal', 'http://[::1]/'],
    ['IPv4-mapped IPv6 literal', 'http://[::ffff:127.0.0.1]/'],
    ['non-standard port', 'https://example.org:8443/'],
    ['not a URL', 'nicht eine URL'],
  ])('rejects %s', (_label, url) => {
    expect(checkUrl(url, policy).ok).toBe(false);
  });

  it('accepts a public https URL and returns it normalised', () => {
    expect(checkUrl('https://De.Wikipedia.org/wiki/Zweiter_Weltkrieg', policy)).toEqual({
      ok: true,
      url: new URL('https://de.wikipedia.org/wiki/Zweiter_Weltkrieg'),
    });
  });
});
