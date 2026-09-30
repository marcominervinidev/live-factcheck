import { useEffect, useState } from 'react';

import type { Microphone } from '../audio/microphone';
import { browserMicrophone } from '../audio/microphone';
import { t } from '../i18n';
import { useConnection } from '../state/connection';
import type { RecordingStatus } from '../state/recording';
import { useRecording } from '../state/recording';
import { ConsentDialog } from './ConsentDialog';

interface Props {
  gatewayUrl: string;
  token: string;
  /** Tests pass a fake microphone (system boundary). */
  createMicrophone?: () => Microphone;
  fetchImpl?: typeof fetch;
}

/** Red dot while the microphone is live, a pulsing ring while it starts or stops. */
function StatusDot({ status }: Readonly<{ status: Exclude<RecordingStatus, 'idle'> }>) {
  return status === 'recording' ? (
    <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-live" />
  ) : (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 rounded-full ring-2 ring-faint motion-safe:animate-pulse"
    />
  );
}

/** Start/stop of a live recording with consent first (T6.1, T6.2). */
export function RecordPanel({
  gatewayUrl,
  token,
  createMicrophone = browserMicrophone,
  fetchImpl,
}: Readonly<Props>) {
  const status = useRecording((state) => state.status);
  const lastEnd = useRecording((state) => state.lastEnd);
  const connected = useConnection((state) => state.status === 'open');
  const [asking, setAsking] = useState(false);

  // A recording never continues unseen: locking the screen or switching apps ends it.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') useRecording.getState().stop('background');
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
    };
  }, []);

  const accept = () => {
    setAsking(false);
    // Still inside the user's tap, which Safari needs to start audio.
    void useRecording.getState().start(createMicrophone(), useConnection.getState().send);
  };

  return (
    <section data-testid="record-panel" className="flex flex-col gap-3">
      {status === 'idle' ? (
        <button
          type="button"
          data-testid="record-start"
          disabled={!connected || asking}
          onClick={() => {
            setAsking(true);
          }}
          className="flex min-h-15 items-center justify-center gap-3 rounded-xl bg-action px-5 text-lg font-bold text-on-action hover:bg-action-strong disabled:opacity-50"
        >
          <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full bg-live" />
          {t('recording.start')}
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <output
            data-testid="recording-status"
            data-status={status}
            className={`flex items-center gap-2.5 font-bold ${status === 'recording' ? 'text-ink' : 'text-muted'}`}
          >
            <StatusDot status={status} />
            {t(`recording.status.${status}`)}
          </output>
          <button
            type="button"
            data-testid="record-stop"
            disabled={status === 'stopping'}
            onClick={() => {
              useRecording.getState().stop();
            }}
            className="flex min-h-14 items-center justify-center gap-2.5 rounded-xl border-2 border-ink text-lg font-bold text-ink disabled:opacity-50"
          >
            <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-ink" />
            {t('recording.stop')}
          </button>
        </div>
      )}
      {!connected && status === 'idle' && (
        <p className="text-sm text-faint">{t('recording.needsConnection')}</p>
      )}
      {status === 'idle' && lastEnd !== null && lastEnd !== 'client' && (
        <p role="alert" data-testid="recording-end" data-reason={lastEnd} className="text-muted">
          {t(`recording.end.${lastEnd}`)}
        </p>
      )}
      {asking && (
        <ConsentDialog
          gatewayUrl={gatewayUrl}
          token={token}
          onAccept={accept}
          onCancel={() => {
            setAsking(false);
          }}
          {...(fetchImpl === undefined ? {} : { fetchImpl })}
        />
      )}
    </section>
  );
}
