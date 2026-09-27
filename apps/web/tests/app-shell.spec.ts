import { expect, test } from './fixtures';

test.describe('app shell', () => {
  test('shows the German title and the empty feed once the runtime config is loaded', async ({
    app,
    a11yViolations,
  }) => {
    await app.open();

    await expect(app.title).toHaveText('Live-Faktencheck');
    await expect(app.emptyFeed).toHaveText('Noch keine Behauptungen geprüft.');
    expect(await a11yViolations()).toEqual([]);
  });

  test('fits the viewport without horizontal scrolling', async ({ app }) => {
    await app.open();
    await expect(app.shell).toBeVisible();

    expect(await app.hasHorizontalOverflow()).toBe(false);
  });
});

test.describe('app shell without runtime config', () => {
  test.use({ runtimeConfig: { status: 500, body: {} } });

  test('shows an accessible error when /config.json fails', async ({ app, a11yViolations }) => {
    await app.open();

    await expect(app.configError).toBeVisible();
    await expect(app.configError).toHaveAttribute('role', 'alert');
    expect(await a11yViolations()).toEqual([]);
  });
});
