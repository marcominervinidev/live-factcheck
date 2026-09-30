import { useEffect, useState } from 'react';

import { ClaimCard } from '../components/ClaimCard';
import { LiveTranscript } from '../components/LiveTranscript';
import { RecordPanel } from '../components/RecordPanel';
import { SettingsPage } from '../components/SettingsPage';
import { TextModeForm } from '../components/TextModeForm';
import { ThemeToggle } from '../components/ThemeToggle';
import { Timeline } from '../components/Timeline';
import { t } from '../i18n';
import { useClaims } from '../state/claims';
import type { ConnectionStatus } from '../state/connection';
import { sessionUrl, useConnection } from '../state/connection';
import { useSettings } from '../state/settings';
import { useRuntimeConfig } from './runtime-config';

type View = 'check' | 'settings';

const STATUS_STYLE: Readonly<Record<ConnectionStatus, { icon: string; className: string }>> = {
  idle: { icon: '○', className: 'text-faint' },
  connecting: { icon: '◌', className: 'text-muted' },
  open: { icon: '●', className: 'text-verdict-true' },
  reconnecting: { icon: '◌', className: 'text-muted' },
  unauthorized: { icon: '⊘', className: 'text-verdict-false' },
};

function ConnectionBadge() {
  const status = useConnection((state) => state.status);
  const style = STATUS_STYLE[status];
  return (
    <p
      data-testid="connection-status"
      data-status={status}
      role="status"
      className={`text-sm ${style.className}`}
    >
      <span aria-hidden="true">{style.icon} </span>
      {t(`connection.${status}`)}
    </p>
  );
}

function CheckView({ gatewayUrl }: { gatewayUrl: string }) {
  const order = useClaims((state) => state.order);
  const claims = useClaims((state) => state.claims);
  const token = useSettings((state) => state.token);
  const list = order.flatMap((id) => (claims[id] === undefined ? [] : [claims[id]]));
  return (
    <>
      <Timeline claims={list} />
      {token === null ? (
        <p data-testid="no-token" className="rounded-md bg-lilac-soft p-3 text-muted">
          {t('connection.noToken')}
        </p>
      ) : (
        <RecordPanel gatewayUrl={gatewayUrl} token={token} />
      )}
      <LiveTranscript />
      <TextModeForm gatewayUrl={gatewayUrl} />
      {list.length === 0 ? (
        <p data-testid="claims-empty" className="text-faint">
          {t('app.empty')}
        </p>
      ) : (
        <section data-testid="claims" className="flex flex-col gap-4">
          {list.map((claim) => (
            <ClaimCard key={claim.claimId} claim={claim} />
          ))}
        </section>
      )}
    </>
  );
}

export function App() {
  const state = useRuntimeConfig((store) => store.state);
  const load = useRuntimeConfig((store) => store.load);
  const token = useSettings((store) => store.token);
  const connect = useConnection((store) => store.connect);
  const disconnect = useConnection((store) => store.disconnect);
  const [view, setView] = useState<View>('check');

  useEffect(() => {
    void load();
  }, [load]);

  const gatewayUrl = state.status === 'ready' ? state.config.gatewayUrl : null;
  useEffect(() => {
    if (gatewayUrl === null || token === null) return;
    connect(sessionUrl(gatewayUrl, window.location), token);
    return () => {
      disconnect();
    };
  }, [gatewayUrl, token, connect, disconnect]);

  return (
    <main
      data-testid="app-shell"
      className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink">{t('app.title')}</h1>
            <p className="text-muted">{t('app.tagline')}</p>
          </div>
          <nav className="flex items-center gap-1 text-sm" aria-label={t('app.title')}>
            {(['check', 'settings'] as const).map((item) => (
              <button
                key={item}
                type="button"
                data-testid={`nav-${item}`}
                aria-current={view === item ? 'page' : undefined}
                onClick={() => {
                  setView(item);
                }}
                className={`rounded-md px-3 py-1.5 ${view === item ? 'bg-action text-on-action' : 'text-muted ring-1 ring-line'}`}
              >
                {t(item === 'check' ? 'nav.check' : 'nav.settings')}
              </button>
            ))}
            <ThemeToggle />
          </nav>
        </div>
        <ConnectionBadge />
      </header>

      {state.status === 'error' ? (
        <p
          role="alert"
          data-testid="config-error"
          className="rounded-md bg-verdict-false-soft p-3 text-verdict-false"
        >
          {t('config.error')}
        </p>
      ) : gatewayUrl === null ? (
        <p data-testid="config-loading" className="text-faint">
          {t('config.loading')}
        </p>
      ) : view === 'settings' ? (
        <SettingsPage gatewayUrl={gatewayUrl} />
      ) : (
        <CheckView gatewayUrl={gatewayUrl} />
      )}
    </main>
  );
}
