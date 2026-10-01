import { t } from '../i18n';
import { formatTime, verdictDisplay } from '../lib/format';
import type { ClaimView } from '../state/claims';
import { VerdictIcon } from './VerdictIcon';

/**
 * One bar per claim, oldest left, in the colour of its verdict with its icon (brief 11), and the
 * label for screen readers. The whole 44 px row is the tap target; a tap jumps to the card.
 */
export function Timeline({ claims }: { claims: readonly ClaimView[] }) {
  if (claims.length === 0) return null;
  return (
    <nav
      aria-label={t('timeline.label')}
      data-testid="timeline"
      className="sticky top-0 z-10 -mx-4 bg-ground/95 px-3 backdrop-blur"
    >
      <ol className="flex flex-wrap gap-x-1">
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
                className="flex h-11 min-w-11 items-center justify-center"
              >
                <span
                  className={`flex h-6 w-10 items-center justify-center rounded-md ${display?.solidClassName ?? 'bg-lilac-soft text-faint motion-safe:animate-pulse'}`}
                >
                  <VerdictIcon name={display?.icon ?? 'pending'} className="h-4 w-4" />
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
