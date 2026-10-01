import { useEffect, useRef } from 'react';

import { t } from '../i18n';
import { verdictDisplay } from '../lib/format';
import type { ClaimView } from '../state/claims';
import { VerdictIcon } from './VerdictIcon';

interface Props {
  claims: readonly ClaimView[];
  onShow: (claimId: string) => void;
  onNewTalk: () => void;
  onClose: () => void;
  /** After returning from Zeigen: focus this claim's row instead of the back button. */
  focusClaimId?: string | null;
}

/**
 * The after-the-talk summary (T6.5, design board "Danach"): every claim as a colour bar with
 * its verdict and correction, no scores per person (brief 11). Rendered as an overlay like
 * ShowClaim, so the recording guards underneath stay mounted.
 */
export function SummaryView({
  claims,
  onShow,
  onNewTalk,
  onClose,
  focusClaimId = null,
}: Readonly<Props>) {
  const backRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusClaimId !== null) {
      const row = rootRef.current?.querySelector<HTMLElement>(`[data-claim-id="${focusClaimId}"]`);
      if (row !== null && row !== undefined) {
        row.focus();
        return;
      }
    }
    backRef.current?.focus();
    // Mount-only on purpose: re-renders must not steal the focus (ShowClaim precedent).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only focus; re-renders must not steal it (ShowClaim precedent)
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && rootRef.current !== null) {
        const focusables = rootRef.current.querySelectorAll<HTMLElement>('button');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (first === undefined || last === undefined) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const checkedClaims = claims.filter(
    (claim): claim is ClaimView & { checked: NonNullable<ClaimView['checked']> } =>
      claim.checked !== undefined,
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-title"
      data-testid="summary-view"
      className="fixed inset-0 z-50 overflow-y-auto bg-ground"
    >
      <div className="mx-auto flex min-h-full max-w-xl flex-col gap-6 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-8">
        <button
          ref={backRef}
          type="button"
          data-testid="summary-close"
          onClick={onClose}
          className="flex min-h-11 items-center gap-2 self-start font-semibold text-muted"
        >
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
            <path d="M13 8H3M7 4L3 8l4 4" />
          </svg>
          {t('summary.back')}
        </button>

        <header className="flex flex-col gap-2">
          <h2
            id="summary-title"
            className="text-3xl leading-tight font-extrabold tracking-tight text-balance text-ink"
          >
            {checkedClaims.length === 1
              ? t('summary.titleOne')
              : t('summary.title', { count: String(checkedClaims.length) })}
          </h2>
          <p className="leading-relaxed text-muted">{t('summary.subtitle')}</p>
        </header>

        <ul className="flex flex-col gap-2.5">
          {checkedClaims.map((claim) => {
            const display = verdictDisplay(claim.checked);
            return (
              <li key={claim.claimId}>
                <button
                  type="button"
                  data-testid="summary-item"
                  data-claim-id={claim.claimId}
                  data-verdict={claim.checked.verdict}
                  onClick={() => {
                    onShow(claim.claimId);
                  }}
                  className="flex w-full items-start gap-3.5 rounded-2xl bg-surface p-4 text-left ring-1 ring-line"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 h-11 w-2.5 shrink-0 rounded-md ${display.solidClassName}`}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={`flex items-center gap-1.5 text-sm font-extrabold ${display.markClassName}`}
                    >
                      <VerdictIcon name={display.icon} className="h-4 w-4" />
                      {display.label}
                    </span>
                    <span className="leading-snug text-ink">{claim.checked.claim}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">{t('summary.noScores')}</p>
          <button
            type="button"
            data-testid="summary-new"
            onClick={onNewTalk}
            className="flex min-h-14 items-center justify-center rounded-xl bg-action px-5 text-lg font-bold text-on-action hover:bg-action-strong"
          >
            {t('summary.newTalk')}
          </button>
        </div>
      </div>
    </div>
  );
}
