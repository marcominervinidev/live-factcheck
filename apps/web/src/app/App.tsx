import { useEffect } from 'react';

import { t } from '../i18n';
import { useRuntimeConfig } from './runtime-config';

export function App() {
  const state = useRuntimeConfig((store) => store.state);
  const load = useRuntimeConfig((store) => store.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main
      data-testid="app-shell"
      className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6"
    >
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{t('app.title')}</h1>
        <p className="text-slate-600">{t('app.tagline')}</p>
      </header>

      {state.status === 'error' ? (
        <p
          role="alert"
          data-testid="config-error"
          className="rounded-md bg-red-50 p-3 text-red-800"
        >
          {t('config.error')}
        </p>
      ) : state.status === 'ready' ? (
        <p data-testid="claims-empty" className="text-slate-500">
          {t('app.empty')}
        </p>
      ) : (
        <p data-testid="config-loading" className="text-slate-500">
          {t('config.loading')}
        </p>
      )}
    </main>
  );
}
