import type { ApiErrorCode } from '@lfc/contracts';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';

import { checkClaim } from '../api';
import type { MessageKey } from '../i18n';
import { t } from '../i18n';
import { useClaims } from '../state/claims';
import { useConnection } from '../state/connection';
import { useSettings } from '../state/settings';

const ERROR_KEYS: Partial<Record<ApiErrorCode, MessageKey>> = {
  rate_limited: 'textmode.error.rate_limited',
  unauthorized: 'textmode.error.unauthorized',
  session_unknown: 'textmode.error.session_unknown',
};

/** Text mode (brief 6.8, 11): type a claim and have it checked. */
export function TextModeForm({ gatewayUrl }: { gatewayUrl: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [sending, setSending] = useState(false);
  const sessionId = useConnection((state) => state.sessionId);
  const token = useSettings((state) => state.token);
  const addSubmitted = useClaims((state) => state.addSubmitted);

  const disabled = sending || sessionId === null || token === null || text.trim() === '';

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (sessionId === null || token === null) return;
    const submitted = text.trim();
    setSending(true);
    setError(null);
    const result = await checkClaim(gatewayUrl, token, sessionId, submitted);
    setSending(false);
    if (result.ok) {
      addSubmitted(result.claimId, submitted, new Date().toISOString());
      // Text typed while the request ran is the next claim: keep it.
      setText((current) => (current.trim() === submitted ? '' : current));
    } else {
      setError(ERROR_KEYS[result.code] ?? 'textmode.error.other');
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-2"
      data-testid="textmode-form"
    >
      <label htmlFor="claim-input" className="text-sm font-medium text-muted">
        {t('textmode.label')}
      </label>
      <textarea
        id="claim-input"
        data-testid="claim-input"
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : 'claim-error'}
        value={text}
        maxLength={1_000}
        rows={2}
        placeholder={t('textmode.placeholder')}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className={`rounded-lg border bg-surface p-3 text-base text-ink placeholder:text-faint focus:ring-2 focus:outline-none ${error === null ? 'border-line focus:border-action focus:ring-line' : 'border-verdict-false focus:border-verdict-false focus:ring-verdict-false-soft'}`}
      />
      <button
        type="submit"
        data-testid="claim-submit"
        disabled={disabled}
        className="self-end rounded-lg bg-action px-5 py-2.5 font-semibold text-on-action disabled:cursor-not-allowed disabled:bg-faint"
      >
        {t('textmode.submit')}
      </button>
      {error !== null && (
        <p
          id="claim-error"
          role="alert"
          data-testid="claim-error"
          className="flex items-center gap-2 text-sm font-semibold text-verdict-false"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className="h-4 w-4 shrink-0"
          >
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6v5M10 14v.1" />
          </svg>
          {t(error)}
        </p>
      )}
    </form>
  );
}
