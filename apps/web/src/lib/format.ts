import type { ClaimChecked, ConfidenceLevel, SourceTier, Verdict } from '@lfc/contracts';

import { t } from '../i18n';

/** Icon and colour per verdict. Colour is never the only signal (brief 11): icon and text too. */
const VERDICT_STYLE: Readonly<Record<Verdict, { icon: string; className: string }>> = {
  stimmt: { icon: '✓', className: 'bg-emerald-100 text-emerald-900 ring-emerald-600' },
  groesstenteils_richtig: { icon: '◐', className: 'bg-lime-100 text-lime-900 ring-lime-700' },
  uebertrieben: { icon: '!', className: 'bg-amber-100 text-amber-900 ring-amber-600' },
  falsch: { icon: '✗', className: 'bg-red-100 text-red-900 ring-red-600' },
  nicht_pruefbar: { icon: '?', className: 'bg-slate-100 text-slate-800 ring-slate-500' },
};

/** Medium confidence is shown as "unsicher" in a neutral colour, never red or green (brief 11). */
const UNCERTAIN_STYLE = { icon: '~', className: 'bg-slate-100 text-slate-800 ring-slate-500' };

export interface VerdictDisplay {
  readonly label: string;
  readonly icon: string;
  readonly className: string;
  /** True when the level is `mittel`: the UI must not suggest certainty. */
  readonly uncertain: boolean;
}

export function verdictDisplay(
  checked: Pick<ClaimChecked, 'verdict' | 'confidenceLevel'>,
): VerdictDisplay {
  const label = t(`verdict.${checked.verdict}`);
  if (checked.confidenceLevel === 'mittel' && checked.verdict !== 'nicht_pruefbar') {
    return {
      label: t('verdict.uncertain', { verdict: label }),
      ...UNCERTAIN_STYLE,
      uncertain: true,
    };
  }
  return { label, ...VERDICT_STYLE[checked.verdict], uncertain: false };
}

export const confidenceLabel = (level: ConfidenceLevel) => t(`confidence.${level}`);

export const tierLabel = (tier: SourceTier) => t(`tier.${tier}`);

/** Width of the confidence bar in percent; the number itself is not shown (brief 7). */
export const confidenceWidth = (confidence: number) =>
  `${String(Math.round(Math.min(1, Math.max(0, confidence)) * 100))}%`;

const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

/** Probabilities for the detail view, most probable first, as whole percent. */
export function distribution(probabilities: ClaimChecked['probabilities']) {
  return (Object.entries(probabilities) as [Verdict, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([verdict, p]) => ({
      verdict,
      label: t(`verdict.${verdict}`),
      percent: Math.round(p * 100),
    }));
}
