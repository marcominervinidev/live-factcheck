import type { ClaimChecked } from '@lfc/contracts';
import { useEffect, useRef } from 'react';

import { t } from '../i18n';
import { tierLabel, verdictDisplay } from '../lib/format';
import type { ClaimView } from '../state/claims';
import { VerdictIcon } from './VerdictIcon';

interface Props {
  claim: ClaimView;
  checked: ClaimChecked;
  onClose: () => void;
}

/**
 * The "Zeigen" view (T6.5, design board "Zeigen"): one claim, full screen, large enough to hand
 * the phone across the table. Rendered as an overlay so the recording guards in RecordPanel
 * stay mounted underneath.
 */
export function ShowClaim({ claim, checked, onClose }: Readonly<Props>) {
  const display = verdictDisplay(checked);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="show-claim-text"
      data-testid="show-view"
      className="fixed inset-0 z-50 overflow-y-auto bg-surface"
    >
      <div className="mx-auto flex min-h-full max-w-xl flex-col gap-6 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-8">
        <button
          ref={backRef}
          type="button"
          data-testid="show-back"
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
          {t('show.back')}
        </button>

        <p data-testid="show-said" className="text-lg leading-relaxed text-muted">
          {t('show.said', { text: claim.detected?.originalText ?? claim.text })}
        </p>

        <div className="flex grow flex-col justify-center gap-5">
          <p
            data-testid="show-verdict"
            data-verdict={checked.verdict}
            className={`flex items-center gap-4 text-5xl font-extrabold tracking-tight ${display.markClassName}`}
          >
            <VerdictIcon name={display.icon} className="h-16 w-16" />
            {display.label}
          </p>
          <p
            id="show-claim-text"
            data-testid="show-claim"
            className="text-3xl leading-tight font-extrabold tracking-tight text-balance text-ink"
          >
            {checked.claim}
          </p>
          {claim.explained !== undefined && (
            <p className="text-lg leading-relaxed text-muted">{claim.explained.explanation}</p>
          )}
        </div>

        {checked.evidence.length > 0 && (
          <div className="flex flex-col gap-1 rounded-2xl bg-lilac-soft p-4">
            <h2 className="text-sm font-semibold text-muted">{t('show.readAt')}</h2>
            <ul data-testid="show-sources" className="flex flex-col">
              {checked.evidence.slice(0, 3).map((e) => (
                <li key={e.evidenceId}>
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 flex-col justify-center underline-offset-4 hover:underline"
                  >
                    <span className="text-lg leading-snug font-bold text-ink">{e.title}</span>
                    <span className="text-sm text-muted">
                      {e.publisher} · {tierLabel(e.tier)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-sm text-faint">{t('card.disclaimer')}</p>
      </div>
    </div>
  );
}
