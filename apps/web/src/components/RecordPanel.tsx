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

const STATUS_ICON: Readonly<Record<Exclude<RecordingStatus, 'idle'>, string>> = {
  starting: '◌',
  recording: '●',
  stopping: '◌',
};

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
          className="rounded-full bg-red-700 px-5 py-3 font-medium text-white disabled:opacity-50"
        >
          <span aria-hidden="true">● </span>
          {t('recording.start')}
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <output
            data-testid="recording-status"
            data-status={status}
            className={status === 'recording' ? 'font-medium text-red-800' : 'text-slate-600'}
          >
            <span aria-hidden="true">{STATUS_ICON[status]} </span>
            {t(`recording.status.${status}`)}
          </output>
          <button
            type="button"
            data-testid="record-stop"
            disabled={status === 'stopping'}
            onClick={() => {
              useRecording.getState().stop();
            }}
            className="rounded-full bg-slate-900 px-5 py-3 font-medium text-white disabled:opacity-50"
          >
            <span aria-hidden="true">■ </span>
            {t('recording.stop')}
          </button>
        </div>
      )}
      {!connected && status === 'idle' && (
        <p className="text-sm text-slate-500">{t('recording.needsConnection')}</p>
      )}
      {status === 'idle' && lastEnd !== null && lastEnd !== 'client' && (
        <p
          role="alert"
          data-testid="recording-end"
          data-reason={lastEnd}
          className="text-amber-900"
        >
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
