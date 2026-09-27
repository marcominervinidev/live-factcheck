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
    setSending(true);
    setError(null);
    const result = await checkClaim(gatewayUrl, token, sessionId, text.trim());
    setSending(false);
    if (result.ok) {
      addSubmitted(result.claimId, text.trim(), new Date().toISOString());
      setText('');
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
      <label htmlFor="claim-input" className="text-sm font-medium text-slate-700">
        {t('textmode.label')}
      </label>
      <textarea
        id="claim-input"
        data-testid="claim-input"
        value={text}
        maxLength={1_000}
        rows={2}
        placeholder={t('textmode.placeholder')}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className="rounded-lg border border-slate-300 bg-white p-3 text-base text-slate-900 focus:border-sky-600 focus:ring-2 focus:ring-sky-200 focus:outline-none"
      />
      <button
        type="submit"
        data-testid="claim-submit"
        disabled={disabled}
        className="self-end rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {t('textmode.submit')}
      </button>
      {error !== null && (
        <p
          role="alert"
          data-testid="claim-error"
          className="rounded-md bg-amber-50 p-2 text-sm text-amber-900"
        >
          {t(error)}
        </p>
      )}
    </form>
  );
}
