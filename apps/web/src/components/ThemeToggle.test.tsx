import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTheme } from '../state/theme';

import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle (T6.5)', () => {
  beforeEach(() => {
    useTheme.getState().setPreference('light');
  });
  afterEach(() => {
    cleanup();
    useTheme.getState().setPreference('system');
  });

  it('names the theme it switches to and flips the attribute the stylesheet keys on', () => {
    render(<ThemeToggle />);
    const button = screen.getByTestId('theme-toggle');
    expect(button.getAttribute('aria-label')).toBe('Dunkles Design');

    fireEvent.click(button);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(button.getAttribute('aria-label')).toBe('Helles Design');

    fireEvent.click(button);
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});
