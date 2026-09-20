import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

// Reference shots go to the test result as artifacts; the tracked PNGs under
// e2e/screenshots are never rewritten by a normal run.

let server: ChildProcess | undefined;
let tokenUrl = '';
let baseUrl = '';

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function tokenFromUrl(url: string): string {
  const match = /#t=([^&]+)/.exec(url);
  if (!match) throw new Error(`server url has no token: ${url}`);
  return match[1] ?? '';
}

test.beforeAll(async () => {
  const child = spawn(process.execPath, [cliEntry, 'ui', '--no-open', '--port', '0'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;

  let output = '';
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ui server printed no url in 30s\n${output}${stderr}`)),
      30_000,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+\/#t=[^\s]+/.exec(stripAnsi(output));
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`ui server exited early (code ${code})\n${output}${stderr}`));
    });
  });

  tokenUrl = url;
  baseUrl = url.split('#')[0] ?? url;
});

test.afterAll(async () => {
  const child = server;
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
});

async function waitForScan(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(tokenUrl);
  await expect(page.getByTestId('reclaimable-headline')).toBeVisible({ timeout: 150_000 });
}

test('a link without a token shows the invalid-link page', async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.getByText("This link isn't valid any more.")).toBeVisible();
});

test('overview eventually shows a reclaimable headline', async ({ page }) => {
  await waitForScan(page);
  await expect(page.getByTestId('reclaimable-headline')).toHaveText(
    /\d+(\.\d+)? (B|KB|MB|GB|TB)/,
  );
  await test.info().attach('overview-light', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('system data shows the unmeasured bucket', async ({ page }) => {
  await waitForScan(page);
  await page.evaluate(() => {
    window.location.hash = '#/system-data';
  });
  await expect(page.getByText('Unmeasured (protected / needs root)').first()).toBeVisible();
  await test.info().attach('system-data-light', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('apps lists at least one app and shows a location group', async ({ page }) => {
  await waitForScan(page);
  await page.evaluate(() => {
    window.location.hash = '#/apps';
  });

  const rows = page.getByTestId('app-row');
  await expect(rows.first()).toBeVisible({ timeout: 150_000 });
  expect(await rows.count()).toBeGreaterThan(0);

  // At least one app icon must render as an <img>: macOS app icons arrive as
  // PNG bytes from /api/apps/<bundleId>/icon.
  await expect(page.locator('[data-testid="app-row"] img').first()).toBeVisible({
    timeout: 30_000,
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await test.info().attach('apps-dark', { body: await page.screenshot(), contentType: 'image/png' });

  await rows.first().click();
  await expect(page.getByTestId('app-location-group').first()).toBeVisible();
});

test('cleanup opens the review sheet and can be cancelled', async ({ page }) => {
  await waitForScan(page);
  await page.evaluate(() => {
    window.location.hash = '#/cleanup';
  });

  const checkbox = page.getByRole('checkbox').first();
  await expect(checkbox).toBeVisible();
  await checkbox.click();

  const review = page.getByRole('button', { name: 'Review plan…' });
  await expect(review).toBeEnabled();
  await review.click();

  // The sheet is a modal dialog and takes focus when it opens.
  const dialog = page.getByRole('dialog', { name: 'Review plan' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();

  const clean = page.getByRole('button', { name: /^Clean / });
  await expect(clean).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(clean).toBeHidden();
});

test('reduced motion removes animations and transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(tokenUrl);

  const computed = await page.evaluate(() => {
    // Probed with inline styles so the assertion exercises the stylesheet's
    // prefers-reduced-motion block rather than any component's own classes.
    const probe = document.createElement('div');
    probe.style.transition = 'opacity 1s linear';
    probe.style.animation = 'skel 1s linear infinite';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const result = {
      transition: style.transitionProperty,
      animation: style.animationName,
      running: document.getAnimations().length,
    };
    probe.remove();
    return result;
  });

  expect(computed.transition).toBe('none');
  expect(computed.animation).toBe('none');
  expect(computed.running).toBe(0);
});

test('mock mode renders with a token', async ({ page }) => {
  await page.goto(`${baseUrl}?mock#t=${tokenFromUrl(tokenUrl)}`);
  await expect(page.getByTestId('reclaimable-headline')).toHaveText('38.4 GB');
});

test('mock orphan app separates cleanable caches from Trash-confirmed app data', async ({
  page,
}) => {
  await page.goto(`${baseUrl}?mock#t=${tokenFromUrl(tokenUrl)}`);
  await page.evaluate(() => {
    window.location.hash = '#/apps';
  });

  const orphanRow = page
    .getByTestId('app-row')
    .filter({ hasText: 'com.tinyspeck.old-app' });
  await expect(orphanRow).toBeVisible();
  await orphanRow.click();

  // The cache button must carry only cleanable bytes (caches + logs), never the app data.
  const clean = page.getByRole('button', { name: /Clean caches ·/ });
  await expect(clean).toBeVisible();
  await expect(clean).toHaveText(/Clean caches · 528 MB/);

  // The distinct Trash flow requires the typed confirmation before it enables.
  await page.getByTestId('app-trash-data').click();
  const confirm = page.getByRole('button', { name: /Move to Trash/ });
  await expect(page.getByRole('dialog', { name: 'Review plan' })).toBeVisible();
  await expect(page.getByText('Moved to Trash (you can undo)')).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Type app\.orphan\.appdata/).fill('app.orphan.appdata');
  await expect(confirm).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('app-trash-data')).toBeVisible();
});

test('settings dark theme sets data-theme on the html element', async ({ page }) => {
  await page.goto(tokenUrl);
  await page.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
