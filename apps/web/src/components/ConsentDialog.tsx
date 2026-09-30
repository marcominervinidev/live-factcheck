import type { ProviderStatus } from '@lfc/contracts';
import { useEffect, useRef, useState } from 'react';

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

/**
 * Asked before every recording (brief 11, 15.6): names every active cloud provider from
 * `/api/status`. Without that list there is no recording (fails closed).
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

  useEffect(() => {
    cancelRef.current?.focus();
    let active = true;
    void fetchProviderStatus(gatewayUrl, token, fetchImpl).then((result) => {
      if (active)
        setStatus(result === null ? { state: 'error' } : { state: 'ready', status: result });
    });
    return () => {
      active = false;
    };
  }, [gatewayUrl, token, fetchImpl]);

  const cloud = status.state === 'ready' ? status.status.providers.filter((p) => p.cloud) : [];
  const jev = cloud.some((p) => p.provider === 'typesafe');

  return (
    <dialog
      open
      aria-labelledby="consent-title"
      data-testid="consent-dialog"
      className="static m-0 flex w-full flex-col gap-3 rounded-lg bg-surface p-4 text-ink shadow-lg ring-1 ring-line"
    >
      <h2 id="consent-title" className="text-lg font-semibold text-ink">
        {t('consent.title')}
      </h2>
      <p className="text-muted">{t('consent.intro')}</p>
      {status.state === 'loading' && <p className="text-faint">{t('consent.loading')}</p>}
      {status.state === 'error' && (
        <p role="alert" data-testid="consent-error" className="text-verdict-false">
          {t('consent.error')}
        </p>
      )}
      {status.state === 'ready' &&
        (cloud.length === 0 ? (
          <p data-testid="consent-local" className="text-verdict-true">
            <span aria-hidden="true">⌂ </span>
            {t('consent.local')}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-muted">{t('consent.cloud')}</p>
            <ul className="list-disc pl-5 text-ink" data-testid="consent-providers">
              {cloud.map((p) => (
                <li key={`${p.service}-${p.role}`} data-testid="consent-provider">
                  {t('consent.provider', {
                    role: t(`role.${p.role}`),
                    provider: p.model === undefined ? p.provider : `${p.provider} (${p.model})`,
                  })}
                </li>
              ))}
            </ul>
            {jev && <p className="text-sm text-muted">{t('settings.privacy.jev')}</p>}
          </div>
        ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="consent-accept"
          disabled={status.state !== 'ready'}
          onClick={onAccept}
          className="rounded-md bg-action px-4 py-2 text-on-action disabled:opacity-50"
        >
          {t('consent.accept')}
        </button>
        <button
          ref={cancelRef}
          type="button"
          data-testid="consent-cancel"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-muted ring-1 ring-line"
        >
          {t('consent.cancel')}
        </button>
      </div>
    </dialog>
  );
}
