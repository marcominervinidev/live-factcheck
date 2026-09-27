import { z } from 'zod';

import type { SafeFetcher } from '../fetch/safe-fetch.js';
import type { CallOptions, FactCheckHit } from './types.js';

const ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

const Response = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().optional(),
        claimReview: z
          .array(
            z.object({
              publisher: z
                .object({ name: z.string().optional(), site: z.string().optional() })
                .optional(),
              url: z.string(),
              title: z.string().optional(),
              reviewDate: z.string().optional(),
              textualRating: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export interface FactCheckSource {
  search(claim: string, options: CallOptions & { readonly limit: number }): Promise<FactCheckHit[]>;
}

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

/** Trimmed value, or undefined when missing or blank. */
const nonBlank = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

/**
 * Google Fact Check Tools API, tier 1 (brief 9.1; evidence-sources.md). The key goes in the
 * `X-Goog-Api-Key` header, never in the URL (brief 15.5).
 */
export function createFactCheckSource(options: {
  readonly fetcher: SafeFetcher;
  readonly apiKey: string;
  readonly languageCode: string;
}): FactCheckSource {
  return {
    async search(claim, callOptions) {
      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({
        query: claim,
        languageCode: options.languageCode,
        pageSize: String(callOptions.limit),
      }).toString();
      const page = await options.fetcher.fetchText(url.toString(), {
        accept: ['application/json'],
        headers: { 'x-goog-api-key': options.apiKey },
        ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
      });
      const parsed = Response.safeParse(JSON.parse(page.text));
      if (!parsed.success) return [];
      const hits: FactCheckHit[] = [];
      for (const claimEntry of parsed.data.claims ?? []) {
        for (const review of claimEntry.claimReview ?? []) {
          const rating = review.textualRating?.trim() ?? '';
          if (!isHttpUrl(review.url) || rating === '') continue;
          hits.push({
            claimText: nonBlank(claimEntry.text) ?? claim,
            publisher:
              nonBlank(review.publisher?.name) ??
              nonBlank(review.publisher?.site) ??
              new URL(review.url).hostname,
            url: review.url,
            rating,
            ...(review.title === undefined ? {} : { title: review.title }),
            ...(review.reviewDate === undefined ? {} : { reviewDate: review.reviewDate }),
          });
        }
      }
      return hits.slice(0, callOptions.limit);
    },
  };
}
