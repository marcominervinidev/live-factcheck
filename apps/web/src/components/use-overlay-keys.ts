import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Keyboard contract of a full-screen overlay: Escape closes, and because aria-modal promises
 * a focus trap, Tab cycles through the overlay's focusables instead of leaving it. Shared by
 * ShowClaim and SummaryView, so the trap exists exactly once.
 */
export function useOverlayKeys(
  rootRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && rootRef.current !== null) {
        const focusables = rootRef.current.querySelectorAll<HTMLElement>('a[href], button');
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (first === undefined || last === undefined) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [rootRef, onClose]);
}
