import type { ProviderStatus } from '@lfc/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchProviderStatus } from '../api';
import { t } from '../i18n';

type Status =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: ProviderStatus };

interface Props {
  gatewayUrl: string;
  token: string;
  onAccept: () => void;
  onCancel: () => void;
  fetchImpl?: typeof fetch;
}

/** One icon + text line inside the "what happens" card. */
function InfoLine({
  icon,
  children,
}: Readonly<{ icon: 'none' | 'cloud'; children: React.ReactNode }>) {
  return (
    <div className="flex gap-3">
      <svg
        viewBox="0 0 22 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-action"
      >
        {icon === 'none' ? (
          <>
            <circle cx="11" cy="11" r="8" />
            <path d="M5.5 5.5l11 11" />
          </>
        ) : (
          <path d="M4 16a5 5 0 0 1 2-9.6A6 6 0 0 1 17.5 8 4 4 0 0 1 18 16H4z" />
        )}
      </svg>
      <div className="min-w-0 leading-relaxed text-ink">{children}</div>
    </div>
  );
}

/**
 * Asked before every recording (brief 11, 15.6): names every active cloud provider from
 * `/api/status`. Without that list there is no recording (fails closed); a failed load can be
 * retried without closing the dialog.
 */
export function ConsentDialog({
  gatewayUrl,
  token,
  onAccept,
  onCancel,
  fetchImpl,
}: Readonly<Props>) {
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);

  const fetchStatus = useCallback(() => {
    void fetchProviderStatus(gatewayUrl, token, fetchImpl).then((result) => {
      if (mounted.current)
        setStatus(result === null ? { state: 'error' } : { state: 'ready', status: result });
    });
  }, [gatewayUrl, token, fetchImpl]);

  useEffect(() => {
    mounted.current = true;
    cancelRef.current?.focus();
    fetchStatus();
    return () => {
      mounted.current = false;
    };
  }, [fetchStatus]);

  const retry = () => {
    setStatus({ state: 'loading' });
    fetchStatus();
  };

  const cloud = status.state === 'ready' ? status.status.providers.filter((p) => p.cloud) : [];
  const jev = cloud.some((p) => p.provider === 'typesafe');

  return (
    <dialog
      open
      aria-labelledby="consent-title"
      data-testid="consent-dialog"
      className="static m-0 flex w-full flex-col gap-4 rounded-2xl bg-surface p-5 text-ink shadow-[0_6px_20px_rgb(19_0_50/0.08)] ring-1 ring-line"
    >
      <h2
        id="consent-title"
        className="text-2xl leading-tight font-extrabold tracking-tight text-balance"
      >
        {t('consent.title')}
      </h2>
      <p className="leading-relaxed text-muted">{t('consent.intro')}</p>

      <div className="flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-line">
        <h3 className="font-bold">{t('consent.what')}</h3>
        <InfoLine icon="none">{t('consent.noRecord')}</InfoLine>
        {status.state === 'loading' && (
          <p className="flex items-center gap-3 text-faint">
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 rounded-full border-2 border-faint border-t-transparent motion-safe:animate-spin"
            />
            {t('consent.loading')}
          </p>
        )}
        {status.state === 'ready' &&
          (cloud.length === 0 ? (
            <p
              data-testid="consent-local"
              className="flex gap-3 rounded-xl bg-verdict-true-soft p-3 font-semibold text-verdict-true"
            >
              <svg
                viewBox="0 0 22 22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0"
              >
                <path d="M4 10l7-6 7 6v8H4z" />
              </svg>
              <span className="min-w-0">{t('consent.local')}</span>
            </p>
          ) : (
            <InfoLine icon="cloud">
              {t('consent.cloud')}
              <ul
                className="mt-1 flex flex-col gap-1 font-semibold"
                data-testid="consent-providers"
              >
                {cloud.map((p) => (
                  <li key={`${p.service}-${p.role}`} data-testid="consent-provider">
                    {t('consent.provider', {
                      role: t(`role.${p.role}`),
                      provider: p.model === undefined ? p.provider : `${p.provider} (${p.model})`,
                    })}
                  </li>
                ))}
              </ul>
              {jev && (
                <p className="mt-1 text-sm font-normal text-muted">{t('settings.privacy.jev')}</p>
              )}
            </InfoLine>
          ))}
      </div>

      {status.state === 'error' && (
        <div className="flex flex-col gap-3 rounded-xl bg-verdict-false-soft p-4">
          <p role="alert" data-testid="consent-error" className="leading-relaxed text-ink">
            {t('consent.error')}
          </p>
          <button
            type="button"
            data-testid="consent-retry"
            onClick={retry}
            className="self-start rounded-lg border-2 border-ink px-4 py-2 font-bold text-ink"
          >
            {t('consent.retry')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          data-testid="consent-accept"
          disabled={status.state !== 'ready'}
          onClick={onAccept}
          className="flex min-h-15 items-center justify-center gap-3 rounded-xl bg-action px-5 text-lg font-bold text-on-action hover:bg-action-strong disabled:opacity-50"
        >
          <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full bg-live" />
          {t('consent.accept')}
        </button>
        <button
          ref={cancelRef}
          type="button"
          data-testid="consent-cancel"
          onClick={onCancel}
          className="min-h-12 rounded-xl px-5 font-semibold text-muted"
        >
          {t('consent.cancel')}
        </button>
      </div>
    </dialog>
  );
}
