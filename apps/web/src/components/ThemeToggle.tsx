import { t } from '../i18n';
import { useTheme } from '../state/theme';

/** One round button in the header: moon in the light theme, sun in the dark one (T6.5). */
export function ThemeToggle() {
  const theme = useTheme((state) => state.theme);
  const toggle = useTheme((state) => state.toggle);
  const label = t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark');
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme={theme}
      aria-label={label}
      title={label}
      onClick={toggle}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lilac-soft text-ink"
    >
      {theme === 'dark' ? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="4" />
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" />
        </svg>
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M16 12.5A7 7 0 0 1 7.5 4a7 7 0 1 0 8.5 8.5z" />
        </svg>
      )}
    </button>
  );
}
