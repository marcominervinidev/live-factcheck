import { SourceTier } from '@lfc/contracts';
import { parse } from 'yaml';
import { z } from 'zod';

/** Source tiers (brief 9.1), shared with the Evidence contract. */
export const SOURCE_TIERS = SourceTier.options;

// Lower-case host names without scheme, port or path, e.g. `bund.de`.
const Domain = z
  .string()
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/,
    'Expected a domain like "bund.de"',
  );

const Tier = z.strictObject({
  weight: z.number().gt(0).max(1),
  domains: z.array(Domain),
});

export const SourceTiersFile = z
  .strictObject({
    schemaVersion: z.literal(1),
    tiers: z.strictObject(
      Object.fromEntries(SOURCE_TIERS.map((tier) => [tier, Tier])) as Record<
        SourceTier,
        typeof Tier
      >,
    ),
  })
  .superRefine((file, ctx) => {
    const seen = new Map<string, SourceTier>();
    for (const tier of SOURCE_TIERS) {
      for (const domain of file.tiers[tier].domains) {
        const first = seen.get(domain);
        if (first !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['tiers', tier, 'domains'],
            message: `${domain} is already listed in ${first}`,
          });
        }
        seen.set(domain, tier);
      }
    }
    if (file.tiers.sonstige.domains.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['tiers', 'sonstige', 'domains'],
        message: 'sonstige is the fallback for unlisted domains and lists none',
      });
    }
  });

export type SourceTiersFile = z.infer<typeof SourceTiersFile>;

/** Invalid source-tier data. Messages name the path, so startup fails with a clear reason. */
export class SourceTiersError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid source tiers:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'SourceTiersError';
  }
}

/** Parses and validates the YAML text of `config/source-tiers.yaml` (fail fast). */
export function parseSourceTiers(yamlText: string): SourceTiersFile {
  let data: unknown;
  try {
    data = parse(yamlText);
  } catch (error) {
    throw new SourceTiersError([`not valid YAML: ${(error as Error).message}`]);
  }
  const result = SourceTiersFile.safeParse(data);
  if (!result.success) {
    throw new SourceTiersError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
