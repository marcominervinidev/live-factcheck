import { t } from '../i18n';
import { formatTime, verdictDisplay } from '../lib/format';
import type { ClaimView } from '../state/claims';

/**
 * One dot per claim, oldest left, in the colour of its verdict (brief 11), with icon and label
 * for screen readers. A tap jumps to the card.
 */
export function Timeline({ claims }: { claims: readonly ClaimView[] }) {
  if (claims.length === 0) return null;
  return (
    <nav
      aria-label={t('timeline.label')}
      data-testid="timeline"
      className="sticky top-0 z-10 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur"
    >
      <ol className="flex flex-wrap gap-1.5">
        {[...claims].reverse().map((claim) => {
          const display = claim.checked === undefined ? undefined : verdictDisplay(claim.checked);
          const label = t('timeline.item', {
            time: formatTime(claim.submittedAt),
            verdict: display?.label ?? t('verdict.pending'),
          });
          return (
            <li key={claim.claimId}>
              <a
                href={`#claim-${claim.claimId}`}
                data-testid="timeline-dot"
                title={label}
                aria-label={label}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-1 ${display?.className ?? 'animate-pulse bg-slate-100 text-slate-500 ring-slate-300'}`}
              >
                <span aria-hidden="true">{display?.icon ?? '⋯'}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
