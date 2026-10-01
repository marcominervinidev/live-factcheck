import type { ClaimChecked } from '@lfc/contracts';

import { t } from '../i18n';
import {
  confidenceLabel,
  confidenceWidth,
  distribution,
  formatDate,
  formatTime,
  tierLabel,
  verdictDisplay,
} from '../lib/format';
import type { ClaimView } from '../state/claims';
import { VerdictIcon } from './VerdictIcon';

function VerdictChip({ checked }: { checked: ClaimChecked }) {
  const display = verdictDisplay(checked);
  return (
    <span
      data-testid="verdict-chip"
      data-verdict={checked.verdict}
      data-uncertain={display.uncertain}
      className={`inline-flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2.5 font-bold ${display.className}`}
    >
      <VerdictIcon name={display.icon} />
      {display.label}
    </span>
  );
}

function Evidence({ checked }: { checked: ClaimChecked }) {
  const best = checked.evidence.find((e) => e.evidenceId === checked.bestEvidenceId);
  return (
    <>
      {best !== undefined && (
        <figure data-testid="best-evidence" className="rounded-xl bg-lilac-soft p-3.5">
          <figcaption className="text-sm font-semibold text-muted">
            {t('card.bestEvidence')}
          </figcaption>
          <blockquote className="mt-1 leading-relaxed text-ink">„{best.snippet}“</blockquote>
          <p className="mt-1 text-sm text-muted">
            {best.publisher}
            {best.publishedAt === undefined ? '' : ` · ${formatDate(best.publishedAt)}`} ·{' '}
            {tierLabel(best.tier)}
          </p>
        </figure>
      )}
      {checked.evidence.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted">{t('card.sources')}</h3>
          <ul data-testid="sources" className="mt-1 space-y-1.5 text-sm">
            {checked.evidence.map((e) => (
              <li key={e.evidenceId}>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-action underline underline-offset-2 hover:text-action-strong"
                >
                  {e.title}
                </a>{' '}
                <span className="text-faint">({tierLabel(e.tier)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * One claim as a card (brief 11). Deliberately neutral: no score per person, medium confidence
 * shown as "unsicher", and every card says it is an automatic assessment.
 */
export function ClaimCard({
  claim,
  onShow,
}: Readonly<{ claim: ClaimView; onShow?: (claimId: string) => void }>) {
  const { checked } = claim;
  const speaker = checked?.speaker ?? claim.detected?.speaker;
  return (
    <article
      id={`claim-${claim.claimId}`}
      data-testid="claim-card"
      data-claim-id={claim.claimId}
      className="flex scroll-mt-24 flex-col gap-3.5 rounded-2xl bg-surface p-5 shadow-[0_6px_20px_rgb(19_0_50/0.06)] ring-1 ring-line"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        {checked === undefined ? (
          <span
            data-testid="verdict-pending"
            className="inline-flex items-center gap-2 rounded-full bg-lilac-soft py-1.5 pr-3.5 pl-2.5 font-bold text-muted"
          >
            <VerdictIcon name="pending" className="h-5 w-5 motion-safe:animate-pulse" />
            {t('verdict.pending')}
          </span>
        ) : (
          <VerdictChip checked={checked} />
        )}
        <p className="text-sm text-faint">
          {speaker !== undefined && `${t('card.speaker', { speaker })}, `}
          <time dateTime={claim.submittedAt}>{formatTime(claim.submittedAt)}</time>
        </p>
      </header>

      <p
        data-testid="claim-text"
        className="text-xl leading-snug font-bold tracking-tight text-balance text-ink"
      >
        {checked?.claim ?? claim.detected?.standaloneText ?? claim.text}
      </p>

      {claim.detected !== undefined &&
        claim.detected.originalText !== claim.detected.standaloneText && (
          <details className="text-sm text-muted">
            <summary>{t('card.original')}</summary>
            <p className="mt-1">„{claim.detected.originalText}“</p>
          </details>
        )}

      {checked !== undefined && (
        <>
          <p data-testid="explanation" className="leading-relaxed text-ink">
            {claim.explained?.explanation ??
              (claim.explanationMissing
                ? t('card.explanationMissing')
                : t('card.explanationPending'))}
          </p>

          <div className="flex flex-wrap gap-2" data-testid="badges">
            {checked.existingFactCheck !== undefined && (
              <span
                data-testid="badge-existing"
                className="rounded-md bg-lilac-soft px-2 py-0.5 text-xs font-medium text-ink ring-1 ring-line"
              >
                {t('badge.existingFactCheck', {
                  publisher: checked.existingFactCheck.publisher,
                  rating: checked.existingFactCheck.rating,
                })}
              </span>
            )}
            {checked.cacheHit !== 'none' && (
              <span
                data-testid="badge-cached"
                className="rounded-md bg-lilac-soft px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-line"
              >
                {t('badge.cached')}
              </span>
            )}
          </div>

          {checked.verdict === 'nicht_pruefbar' && checked.reason !== undefined ? (
            <p data-testid="reason" className="text-sm text-muted">
              {t(`reason.${checked.reason}`)}
            </p>
          ) : (
            <div data-testid="confidence">
              <div className="flex justify-between text-sm text-muted">
                <span>{t('confidence.label')}</span>
                <span>{confidenceLabel(checked.confidenceLevel)}</span>
              </div>
              <div
                className="mt-1 h-2 overflow-hidden rounded-full bg-lilac-soft"
                role="meter"
                aria-label={t('confidence.label')}
                aria-valuenow={Math.round(checked.confidence * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={confidenceLabel(checked.confidenceLevel)}
              >
                <div
                  className="h-full rounded-full bg-action"
                  style={{ width: confidenceWidth(checked.confidence) }}
                />
              </div>
            </div>
          )}

          <details data-testid="distribution" className="text-sm text-muted">
            <summary>{t('card.distribution')}</summary>
            <ul className="mt-1 space-y-0.5">
              {distribution(checked.probabilities).map((row) => (
                <li key={row.verdict} className="flex justify-between">
                  <span>{row.label}</span>
                  <span className="tabular-nums">{row.percent} %</span>
                </li>
              ))}
            </ul>
          </details>

          <Evidence checked={checked} />

          {onShow !== undefined && (
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="card-show"
                onClick={() => {
                  onShow(claim.claimId);
                }}
                className="flex min-h-11 items-center gap-2 rounded-lg bg-action px-4 font-bold text-on-action hover:bg-action-strong"
              >
                {t('show.label')}
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}

      <footer data-testid="disclaimer" className="text-xs text-faint">
        {t('card.disclaimer')}
      </footer>
    </article>
  );
}
