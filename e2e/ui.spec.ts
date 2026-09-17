import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
const screenshots = path.join(repoRoot, 'e2e', 'screenshots');

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
  await page.screenshot({ path: path.join(screenshots, 'overview-light.png') });
});

test('system data shows the unmeasured bucket', async ({ page }) => {
  await waitForScan(page);
  await page.evaluate(() => {
    window.location.hash = '#/system-data';
  });
  await expect(page.getByText('Unmeasured (protected / needs root)').first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'system-data-light.png') });
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
  await page.screenshot({ path: path.join(screenshots, 'apps-dark.png') });

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

  const clean = page.getByRole('button', { name: /^Clean / });
  await expect(clean).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(clean).toBeHidden();
});

test('mock mode renders with a token', async ({ page }) => {
  await page.goto(`${baseUrl}?mock#t=${tokenFromUrl(tokenUrl)}`);
  await expect(page.getByTestId('reclaimable-headline')).toHaveText('38.4 GB');
});

test('settings dark theme sets data-theme on the html element', async ({ page }) => {
  await page.goto(tokenUrl);
  await page.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
