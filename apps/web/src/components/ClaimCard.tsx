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

function VerdictChip({ checked }: { checked: ClaimChecked }) {
  const display = verdictDisplay(checked);
  return (
    <span
      data-testid="verdict-chip"
      data-verdict={checked.verdict}
      data-uncertain={display.uncertain}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ${display.className}`}
    >
      <span aria-hidden="true">{display.icon}</span>
      {display.label}
    </span>
  );
}

function Evidence({ checked }: { checked: ClaimChecked }) {
  const best = checked.evidence.find((e) => e.evidenceId === checked.bestEvidenceId);
  return (
    <>
      {best !== undefined && (
        <figure data-testid="best-evidence" className="border-l-4 border-slate-300 pl-3">
          <figcaption className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {t('card.bestEvidence')}
          </figcaption>
          <blockquote className="mt-1 text-slate-800">„{best.snippet}“</blockquote>
          <p className="mt-1 text-sm text-slate-600">
            {best.publisher}
            {best.publishedAt === undefined ? '' : ` · ${formatDate(best.publishedAt)}`} ·{' '}
            {tierLabel(best.tier)}
          </p>
        </figure>
      )}
      {checked.evidence.length > 0 && (
        <div>
          <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {t('card.sources')}
          </h3>
          <ul data-testid="sources" className="mt-1 space-y-1 text-sm">
            {checked.evidence.map((e) => (
              <li key={e.evidenceId}>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-800 underline underline-offset-2 hover:text-sky-950"
                >
                  {e.title}
                </a>{' '}
                <span className="text-slate-500">({tierLabel(e.tier)})</span>
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
export function ClaimCard({ claim }: { claim: ClaimView }) {
  const { checked } = claim;
  const speaker = checked?.speaker ?? claim.detected?.speaker;
  return (
    <article
      id={`claim-${claim.claimId}`}
      data-testid="claim-card"
      data-claim-id={claim.claimId}
      className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
    >
      <header className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        {checked === undefined ? (
          <span
            data-testid="verdict-pending"
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700"
          >
            <span aria-hidden="true" className="animate-pulse">
              ⋯
            </span>
            {t('verdict.pending')}
          </span>
        ) : (
          <VerdictChip checked={checked} />
        )}
        {speaker !== undefined && <span>{t('card.speaker', { speaker })}</span>}
        <time dateTime={claim.submittedAt}>{formatTime(claim.submittedAt)}</time>
      </header>

      <p data-testid="claim-text" className="text-lg leading-snug text-slate-900">
        {checked?.claim ?? claim.detected?.standaloneText ?? claim.text}
      </p>

      {claim.detected !== undefined &&
        claim.detected.originalText !== claim.detected.standaloneText && (
          <details className="text-sm text-slate-600">
            <summary>{t('card.original')}</summary>
            <p className="mt-1">„{claim.detected.originalText}“</p>
          </details>
        )}

      {checked !== undefined && (
        <>
          <div className="flex flex-wrap gap-2" data-testid="badges">
            {checked.existingFactCheck !== undefined && (
              <span
                data-testid="badge-existing"
                className="rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900 ring-1 ring-sky-200"
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
                className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
              >
                {t('badge.cached')}
              </span>
            )}
          </div>

          {checked.verdict === 'nicht_pruefbar' && checked.reason !== undefined ? (
            <p data-testid="reason" className="text-sm text-slate-700">
              {t(`reason.${checked.reason}`)}
            </p>
          ) : (
            <div data-testid="confidence">
              <div className="flex justify-between text-sm text-slate-600">
                <span>{t('confidence.label')}</span>
                <span>{confidenceLabel(checked.confidenceLevel)}</span>
              </div>
              <div
                className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"
                role="meter"
                aria-label={t('confidence.label')}
                aria-valuenow={Math.round(checked.confidence * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={confidenceLabel(checked.confidenceLevel)}
              >
                <div
                  className="h-full rounded-full bg-slate-600"
                  style={{ width: confidenceWidth(checked.confidence) }}
                />
              </div>
            </div>
          )}

          <details data-testid="distribution" className="text-sm text-slate-600">
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

          <p data-testid="explanation" className="text-slate-800">
            {claim.explained?.explanation ??
              (claim.explanationMissing
                ? t('card.explanationMissing')
                : t('card.explanationPending'))}
          </p>
        </>
      )}

      <footer data-testid="disclaimer" className="text-xs text-slate-500">
        {t('card.disclaimer')}
      </footer>
    </article>
  );
}
