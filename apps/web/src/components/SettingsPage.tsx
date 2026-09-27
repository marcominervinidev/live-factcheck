import type { ProviderStatus } from '@lfc/contracts';
import { useEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';

import { fetchProviderStatus } from '../api';
import { t } from '../i18n';
import { useSettings } from '../state/settings';

type Status =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: ProviderStatus };

function Providers({ gatewayUrl, token }: { gatewayUrl: string; token: string }) {
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    void fetchProviderStatus(gatewayUrl, token).then((result) => {
      if (active)
        setStatus(result === null ? { state: 'error' } : { state: 'ready', status: result });
    });
    return () => {
      active = false;
    };
  }, [gatewayUrl, token]);

  if (status.state === 'loading')
    return <p className="text-slate-500">{t('settings.providers.loading')}</p>;
  if (status.state === 'error') return <p role="alert">{t('settings.providers.error')}</p>;
  const { privacyMode, providers } = status.status;
  const jev = providers.some((p) => p.provider === 'typesafe');
  return (
    <div className="flex flex-col gap-3" data-testid="providers">
      <p data-testid="privacy-mode" className="text-slate-700">
        {t(privacyMode === 'local' ? 'settings.privacy.local' : 'settings.privacy.cloud')}
      </p>
      <ul className="divide-y divide-slate-200 rounded-lg bg-white ring-1 ring-slate-200">
        {providers.map((p) => (
          <li
            key={`${p.service}-${p.role}`}
            data-testid="provider"
            className="flex flex-wrap justify-between gap-2 p-3 text-sm"
          >
            <span>
              <strong>{t(`role.${p.role}`)}</strong> ({p.service}): {p.provider}
              {p.model === undefined ? '' : ` · ${p.model}`}
            </span>
            <span className={p.cloud ? 'text-amber-800' : 'text-emerald-800'}>
              <span aria-hidden="true">{p.cloud ? '☁ ' : '⌂ '}</span>
              {t(p.cloud ? 'settings.providers.cloud' : 'settings.providers.local')}
            </span>
          </li>
        ))}
      </ul>
      {jev && (
        <p data-testid="jev-notice" className="text-sm text-slate-600">
          {t('settings.privacy.jev')}
        </p>
      )}
      <p className="text-sm text-slate-500">{t('settings.providers.help')}</p>
    </div>
  );
}

/** Token entry and a read-only view of the active providers (brief 11, 15.6; ADR 0011). */
export function SettingsPage({ gatewayUrl }: { gatewayUrl: string }) {
  const token = useSettings((state) => state.token);
  const setToken = useSettings((state) => state.setToken);
  const clearToken = useSettings((state) => state.clearToken);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  const save = (event: SyntheticEvent) => {
    event.preventDefault();
    if (draft.trim() === '') return;
    setToken(draft);
    setDraft('');
    setSaved(true);
  };

  return (
    <section className="flex flex-col gap-6" data-testid="settings">
      <h2 className="text-xl font-semibold text-slate-900">{t('settings.title')}</h2>
      <form onSubmit={save} className="flex flex-col gap-2">
        <label htmlFor="token-input" className="text-sm font-medium text-slate-700">
          {t('settings.token.label')}
        </label>
        <input
          id="token-input"
          data-testid="token-input"
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaved(false);
          }}
          className="rounded-lg border border-slate-300 bg-white p-3 text-base"
        />
        <p className="text-sm text-slate-500">{t('settings.token.help')}</p>
        <div className="flex gap-2">
          <button
            type="submit"
            data-testid="token-save"
            className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
          >
            {t('settings.token.save')}
          </button>
          {token !== null && (
            <button
              type="button"
              data-testid="token-clear"
              onClick={clearToken}
              className="rounded-lg px-4 py-2 text-slate-700 ring-1 ring-slate-300"
            >
              {t('settings.token.clear')}
            </button>
          )}
        </div>
        {saved && (
          <p role="status" className="text-sm text-emerald-800">
            {t('settings.token.saved')}
          </p>
        )}
      </form>
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold text-slate-900">{t('settings.providers.title')}</h3>
        {token === null ? (
          <p className="text-slate-500">{t('connection.noToken')}</p>
        ) : (
          <Providers gatewayUrl={gatewayUrl} token={token} />
        )}
      </section>
    </section>
  );
}
