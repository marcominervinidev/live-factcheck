// Stage 2b in English (ADR 0020): the UI follows the pinned choice; one full pass over the
// core texts plus axe, so the second catalogue is proven in a real browser.
import { expect, test } from './fixtures';

test.describe('English interface (T6.6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('lfc.language', 'en');
    });
  });

  test('renders the core flows in English and stays accessible', async ({
    app,
    claims,
    a11yViolations,
  }) => {
    await claims.open();
    await expect(app.shell).toContainText('Check claims live');
    await expect(claims.connection).toHaveAttribute('data-status', 'open');
    await expect(claims.connection).toContainText('Connected');

    await claims.check('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
    const card = claims.card('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
    await expect(card.getByTestId('verdict-chip')).toHaveText(/False/);
    await expect(card.getByTestId('disclaimer')).toHaveText(
      'Automatic assessment – it can be wrong.',
    );
    expect(await a11yViolations()).toEqual([]);

    // The settings switch pins German again without a reload.
    await claims.openSettings();
    await expect(claims.settingsView).toContainText('Language');
    await claims.language('de').click();
    await expect(claims.settingsView).toContainText('Zugangstoken');
    await expect(claims.navCheck).toHaveText('Prüfen');
  });

  test('keeps the device default when nothing is pinned', async ({ page, claims }) => {
    // Remove the pin: the Playwright context runs with locale de-DE, so German wins.
    await page.addInitScript(() => {
      window.localStorage.removeItem('lfc.language');
    });
    await claims.open();
    await expect(claims.connection).toHaveAttribute('data-status', 'open');
    await expect(claims.connection).toContainText('Verbunden');
  });
});
