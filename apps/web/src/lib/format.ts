import type { ClaimChecked, ConfidenceLevel, SourceTier, Verdict } from '@lfc/contracts';

import { t } from '../i18n';

/** Names of the icons in `components/VerdictIcon.tsx`; one per verdict, plus uncertain. */
export type VerdictIconName = 'true' | 'mostly' | 'exaggerated' | 'false' | 'open' | 'uncertain';

interface VerdictStyle {
  readonly icon: VerdictIconName;
  /** Soft background, strong text and ring: chips and transcript marks. */
  readonly className: string;
  /** Full colour: the timeline bars. */
  readonly solidClassName: string;
  /** Underline and label colour: claims marked in the live transcript. */
  readonly markClassName: string;
}

const TRUE_STYLE = {
  className: 'bg-verdict-true-soft text-verdict-true ring-verdict-true',
  solidClassName: 'bg-verdict-true text-surface',
  markClassName: 'decoration-verdict-true text-verdict-true',
} as const;
const FALSE_STYLE = {
  className: 'bg-verdict-false-soft text-verdict-false ring-verdict-false',
  solidClassName: 'bg-verdict-false text-surface',
  markClassName: 'decoration-verdict-false text-verdict-false',
} as const;
const OPEN_STYLE = {
  className: 'bg-verdict-open-soft text-verdict-open ring-verdict-open',
  solidClassName: 'bg-line text-ink',
  markClassName: 'decoration-verdict-open text-verdict-open',
} as const;

/** Icon and colour per verdict. Colour is never the only signal (brief 11): icon and text too. */
const VERDICT_STYLE: Readonly<Record<Verdict, VerdictStyle>> = {
  stimmt: { icon: 'true', ...TRUE_STYLE },
  groesstenteils_richtig: { icon: 'mostly', ...TRUE_STYLE },
  uebertrieben: { icon: 'exaggerated', ...FALSE_STYLE },
  falsch: { icon: 'false', ...FALSE_STYLE },
  nicht_pruefbar: { icon: 'open', ...OPEN_STYLE },
};

/** Medium confidence is shown as "unsicher" in a neutral colour, never red or green (brief 11). */
const UNCERTAIN_STYLE: VerdictStyle = { icon: 'uncertain', ...OPEN_STYLE };

export interface VerdictDisplay extends VerdictStyle {
  readonly label: string;
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
