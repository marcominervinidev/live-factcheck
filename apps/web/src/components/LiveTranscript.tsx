import { useEffect, useMemo, useRef } from 'react';

import { t } from '../i18n';
import { verdictDisplay } from '../lib/format';
import type { ClaimView } from '../state/claims';
import { useClaims } from '../state/claims';
import { useTranscript } from '../state/transcript';
import { VerdictIcon } from './VerdictIcon';

/**
 * A detected claim marked in its segment: pending while checked, then in its verdict's colour.
 * The first claim of a segment wraps its text; further claims show only their verdict link, so
 * the text appears once.
 */
function ClaimMark({
  claim,
  text,
  withText,
}: Readonly<{ claim: ClaimView; text: string; withText: boolean }>) {
  const display = claim.checked === undefined ? undefined : verdictDisplay(claim.checked);
  const label = display?.label ?? t('transcript.checking');
  return (
    <a
      href={`#claim-${claim.claimId}`}
      data-testid="transcript-claim"
      data-claim-id={claim.claimId}
      data-state={display === undefined ? 'checking' : 'checked'}
      aria-label={`${text} – ${label}`}
      className={`underline decoration-2 underline-offset-[5px] ${display === undefined ? 'decoration-faint decoration-dotted' : display.markClassName}`}
    >
      {withText && <span className="text-ink">{text}</span>}
      <span
        aria-hidden="true"
        className={`ml-1.5 inline-flex items-center gap-1 align-middle text-sm font-semibold ${display === undefined ? 'text-faint motion-safe:animate-pulse' : ''}`}
      >
        <VerdictIcon name={display?.icon ?? 'pending'} className="h-4 w-4" />
        {label}
      </span>
    </a>
  );
}

/**
 * The live transcript (T6.3): speaker letters, interim text grey, final text black, detected
 * claims underlined and linked to their card. The list follows the newest segment.
 */
export function LiveTranscript() {
  const order = useTranscript((state) => state.order);
  const segments = useTranscript((state) => state.segments);
  const claims = useClaims((state) => state.claims);
  const list = useRef<HTMLOListElement>(null);

  const claimsBySegment = useMemo(() => {
    const map = new Map<string, ClaimView[]>();
    for (const claim of Object.values(claims))
      for (const id of claim.detected?.sourceSegmentIds ?? [])
        map.set(id, [...(map.get(id) ?? []), claim]);
    return map;
  }, [claims]);

  // Only the list scrolls to the newest segment, never the page the user may be reading.
  useEffect(() => {
    const element = list.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [order.length]);

  if (order.length === 0) return null;
  return (
    <section aria-label={t('transcript.label')} data-testid="transcript">
      <ol
        ref={list}
        className="flex max-h-80 flex-col gap-3 overflow-y-auto text-[17px] leading-relaxed"
      >
        {order.map((id) => {
          const segment = segments[id];
          if (segment === undefined) return null;
          const marked = claimsBySegment.get(id) ?? [];
          return (
            <li
              key={id}
              data-testid="transcript-segment"
              data-final={String(segment.isFinal)}
              className="flex gap-2"
            >
              <span className="shrink-0 pt-0.5 text-sm font-semibold text-faint">
                {t('card.speaker', { speaker: segment.speaker })}
              </span>
              <span className={segment.isFinal ? 'text-ink' : 'text-faint italic'}>
                {marked.length === 0
                  ? segment.text
                  : marked.map((claim, index) => (
                      <ClaimMark
                        key={claim.claimId}
                        claim={claim}
                        text={segment.text}
                        withText={index === 0}
                      />
                    ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
