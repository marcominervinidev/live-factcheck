import { z } from 'zod';

import { extractDocument } from '../extract.js';
import type { SafeFetcher } from '../fetch/safe-fetch.js';
import type { TierResolver } from '../tiers.js';
import type { CallOptions, SourceDocument } from './types.js';

const WIKIPEDIA = 'https://de.wikipedia.org';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

const signalOf = (options: CallOptions) =>
  options.signal === undefined ? {} : { signal: options.signal };

const WikipediaSearch = z.object({
  pages: z.array(z.object({ key: z.string(), title: z.string() })),
});

/**
 * German Wikipedia, tier 2 (brief 9.1): REST search, then the page HTML through the same
 * extraction as web pages (evidence-sources.md).
 */
export function createWikipediaSource(options: {
  readonly fetcher: SafeFetcher;
  readonly tiers: TierResolver;
  readonly maxChars: number;
  readonly now: () => Date;
}) {
  return {
    async search(
      query: string,
      callOptions: CallOptions & { readonly limit: number },
    ): Promise<SourceDocument[]> {
      const searchUrl = new URL('/w/rest.php/v1/search/page', WIKIPEDIA);
      searchUrl.search = new URLSearchParams({
        q: query,
        limit: String(callOptions.limit),
      }).toString();
      const found = WikipediaSearch.safeParse(
        JSON.parse(
          (
            await options.fetcher.fetchText(searchUrl.toString(), {
              accept: ['application/json'],
              ...signalOf(callOptions),
            })
          ).text,
        ),
      );
      if (!found.success) return [];
      const documents = await Promise.allSettled(
        found.data.pages.map(async ({ key, title }) => {
          const html = await options.fetcher.fetchText(
            `${WIKIPEDIA}/w/rest.php/v1/page/${encodeURIComponent(key)}/html`,
            {
              accept: ['text/html'],
              ...signalOf(callOptions),
            },
          );
          const url = `${WIKIPEDIA}/wiki/${encodeURIComponent(key)}`;
          const extracted = extractDocument(html.text, url, options.maxChars);
          if (extracted === undefined) return undefined;
          return {
            url,
            title,
            publisher: 'Wikipedia',
            retrievedAt: options.now().toISOString(),
            ...options.tiers(url),
            text: extracted.text,
          } satisfies SourceDocument;
        }),
      );
      return documents.flatMap((result) =>
        result.status === 'fulfilled' && result.value !== undefined ? [result.value] : [],
      );
    },
  };
}

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

/** Wikidata time value (`+1945-09-02T00:00:00Z`, precision 9 year / 10 month / 11 day) in German. */
export function formatWikidataTime(time: string, precision: number): string | undefined {
  const match = /^([+-])(\d{1,16})-(\d{2})-(\d{2})T/.exec(time);
  if (match === null) return undefined;
  const [, sign, year = '', month = '', day = ''] = match;
  const y = `${String(Number(year))}${sign === '-' ? ' v. Chr.' : ''}`;
  const monthName = MONTHS[Number(month) - 1];
  if (precision >= 11 && monthName !== undefined)
    return `${String(Number(day))}. ${monthName} ${y}`;
  if (precision === 10 && monthName !== undefined) return `${monthName} ${y}`;
  if (precision === 9) return y;
  return undefined;
}

/** Only these properties become evidence text: dates and one count (evidence-sources.md). */
const PROPERTIES: Readonly<Record<string, string>> = {
  P569: 'Geburtsdatum',
  P570: 'Sterbedatum',
  P571: 'Gründung',
  P580: 'Beginn',
  P582: 'Ende',
  P1082: 'Einwohnerzahl',
};

const Snak = z.object({
  mainsnak: z.object({
    datavalue: z
      .object({
        type: z.string(),
        value: z.unknown(),
      })
      .optional(),
  }),
});
const WikidataSearch = z.object({ search: z.array(z.object({ id: z.string().regex(/^Q\d+$/) })) });
const WikidataEntities = z.object({
  entities: z.record(
    z.string(),
    z.object({
      labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
      descriptions: z.record(z.string(), z.object({ value: z.string() })).optional(),
      claims: z.record(z.string(), z.array(Snak)).optional(),
    }),
  ),
});
const TimeValue = z.object({ time: z.string(), precision: z.number() });
const QuantityValue = z.object({ amount: z.string() });

function propertyText(values: readonly z.infer<typeof Snak>[]): string | undefined {
  for (const snak of values) {
    const data = snak.mainsnak.datavalue;
    if (data?.type === 'time') {
      const time = TimeValue.safeParse(data.value);
      if (time.success) return formatWikidataTime(time.data.time, time.data.precision);
    }
    if (data?.type === 'quantity') {
      const quantity = QuantityValue.safeParse(data.value);
      if (quantity.success) {
        const amount = Number(quantity.data.amount);
        if (Number.isFinite(amount)) return amount.toLocaleString('de-DE');
      }
    }
  }
  return undefined;
}

/** Wikidata, tier 2 (brief 9.1): labels, descriptions and a few date/number properties as German text. */
export function createWikidataSource(options: {
  readonly fetcher: SafeFetcher;
  readonly tiers: TierResolver;
  readonly now: () => Date;
}) {
  const api = async (params: Record<string, string>, callOptions: CallOptions) => {
    const url = new URL(WIKIDATA_API);
    url.search = new URLSearchParams({ ...params, format: 'json' }).toString();
    return JSON.parse(
      (
        await options.fetcher.fetchText(url.toString(), {
          accept: ['application/json'],
          ...signalOf(callOptions),
        })
      ).text,
    ) as unknown;
  };
  return {
    async search(
      query: string,
      callOptions: CallOptions & { readonly limit: number },
    ): Promise<SourceDocument[]> {
      const found = WikidataSearch.safeParse(
        await api(
          {
            action: 'wbsearchentities',
            search: query,
            language: 'de',
            uselang: 'de',
            limit: String(callOptions.limit),
          },
          callOptions,
        ),
      );
      if (!found.success || found.data.search.length === 0) return [];
      const ids = found.data.search.map((entry) => entry.id);
      const entities = WikidataEntities.safeParse(
        await api(
          {
            action: 'wbgetentities',
            ids: ids.join('|'),
            props: 'labels|descriptions|claims',
            languages: 'de',
          },
          callOptions,
        ),
      );
      if (!entities.success) return [];
      return ids.flatMap((id) => {
        const entity = entities.data.entities[id];
        const label = entity?.labels?.['de']?.value;
        if (entity === undefined || label === undefined) return [];
        const facts = Object.entries(PROPERTIES).flatMap(([property, name]) => {
          const value = propertyText(entity.claims?.[property] ?? []);
          return value === undefined ? [] : [`${name}: ${value}.`];
        });
        const description = entity.descriptions?.['de']?.value;
        const text = [
          description === undefined ? `${label}.` : `${label}: ${description}.`,
          ...facts,
        ].join(' ');
        const url = `https://www.wikidata.org/wiki/${id}`;
        return [
          {
            url,
            title: label,
            publisher: 'Wikidata',
            retrievedAt: options.now().toISOString(),
            ...options.tiers(url),
            text,
          },
        ];
      });
    },
  };
}
