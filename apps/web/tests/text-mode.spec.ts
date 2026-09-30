import { TEST_TOKEN } from './mock-backend';
import { expect, test } from './fixtures';

// Stage 2b (brief 13.2): the real app in real browsers against a mocked backend.

test.describe('text mode and result cards (brief 11)', () => {
  test('a typed claim shows "wird geprüft", then the verdict, then the explanation', async ({
    claims,
    a11yViolations,
  }) => {
    await claims.open();
    await expect(claims.connection).toHaveAttribute('data-status', 'open');

    await claims.check('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
    const card = claims.card('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
    await expect(card.getByTestId('verdict-pending')).toBeVisible();

    const chip = card.getByTestId('verdict-chip');
    await expect(chip).toHaveText(/✗\s*Falsch/);
    await expect(card.getByTestId('badge-existing')).toHaveText(
      'Bereits von CORRECTIV geprüft: Falsch',
    );
    await expect(card.getByTestId('best-evidence')).toContainText('2. September 1945');
    await expect(card.getByTestId('sources').getByRole('link')).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await expect(card.getByTestId('explanation')).toHaveText(
      'Der Zweite Weltkrieg endete 1945, also vor über 80 Jahren.',
    );
    await expect(card.getByTestId('disclaimer')).toBeVisible();
    await expect(claims.timelineDots).toHaveCount(1);
    await expect(claims.input).toHaveValue('');

    expect(await a11yViolations()).toEqual([]);
  });

  test('medium confidence is shown as "unsicher" and opinions as not checkable', async ({
    claims,
  }) => {
    await claims.open();
    await expect(claims.connection).toHaveAttribute('data-status', 'open');

    await claims.check('Berlin hat 3,9 Millionen Einwohner.');
    await claims.check('Ich finde, Berlin ist die schönste Stadt.');

    const uncertain = claims
      .card('Berlin hat 3,9 Millionen Einwohner.')
      .getByTestId('verdict-chip');
    await expect(uncertain).toHaveText(/Unsicher: Größtenteils richtig/);
    await expect(uncertain).toHaveAttribute('data-uncertain', 'true');

    const opinion = claims.card('Ich finde, Berlin ist die schönste Stadt.');
    await expect(opinion.getByTestId('verdict-chip')).toHaveText(/Nicht prüfbar/);
    await expect(opinion.getByTestId('reason')).toContainText('Meinung');
    // Newest first.
    await expect(claims.cards.first().getByTestId('claim-text')).toHaveText(
      'Ich finde, Berlin ist die schönste Stadt.',
    );
  });

  test('a missing explanation is reported instead of waiting forever', async ({
    backend,
    claims,
    page,
  }) => {
    backend.sendExplanations = false;
    await page.clock.install();
    await claims.open();
    await expect(claims.connection).toHaveAttribute('data-status', 'open');
    await claims.check('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
    const card = claims.card('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
    await page.clock.runFor(1_000);
    await expect(card.getByTestId('verdict-chip')).toBeVisible();
    await expect(card.getByTestId('explanation')).toHaveText('Erklärung folgt …');
    await page.clock.runFor(31_000);
    await expect(card.getByTestId('explanation')).toHaveText('Keine Erklärung verfügbar.');
  });

  test('reconnects after the server drops the connection', async ({ backend, claims }) => {
    await claims.open();
    await expect(claims.connection).toHaveAttribute('data-status', 'open');
    await backend.dropConnection();
    await expect(claims.connection).toHaveAttribute('data-status', /reconnecting|open/);
    await expect(claims.connection).toHaveAttribute('data-status', 'open');
    expect(backend.sessions).toBe(2);
  });

  test('fits the phone viewport without horizontal scrolling, also with a card', async ({
    claims,
    app,
  }) => {
    await claims.open();
    await claims.check('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
    await expect(
      claims.card('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.').getByTestId('explanation'),
    ).not.toHaveText('Erklärung folgt …');
    expect(await app.hasHorizontalOverflow()).toBe(false);
  });
});

test.describe('without a token', () => {
  test.use({ token: null });

  test('asks for the token, and the settings page stores it and shows the providers', async ({
    claims,
    page,
    a11yViolations,
  }) => {
    await claims.open();
    await expect(claims.noToken).toBeVisible();
    await expect(claims.submit).toBeDisabled();

    await claims.openSettings();
    await claims.saveToken(TEST_TOKEN);
    await expect(page.getByTestId('provider')).toHaveCount(4);
    await expect(page.getByTestId('jev-notice')).toBeVisible();
    await expect(page.getByTestId('provider').first()).toContainText(
      'Daten verlassen das eigene Netzwerk',
    );
    expect(await a11yViolations()).toEqual([]);

    await page.getByTestId('nav-check').click();
    await expect(claims.connection).toHaveAttribute('data-status', 'open');
  });
});

test.describe('with a wrong token', () => {
  test.use({ token: 'wrong-token' });

  test('shows that the token was refused and does not retry', async ({ backend, claims }) => {
    await claims.open();
    await expect(claims.connection).toHaveAttribute('data-status', 'unauthorized');
    await expect(claims.connection).toHaveText(/Zugangstoken fehlt oder ist falsch/);
    expect(backend.sessions).toBe(0);
  });
});
