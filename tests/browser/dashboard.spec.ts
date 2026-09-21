import { test, expect } from '@playwright/test';
import { Application } from '../../packages/application';
import { ImportSource } from '../../packages/adapters/import';
import { segment } from '../../packages/workflow-engine/sessions';
import { messageSchema } from '../../packages/domain/protocol';
import { demoSessions } from '../../samples/demo';
import type { Intent } from '../../packages/domain';
test('Copilot review is unavailable in browser preview and opt-in is explicit', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Privacy', exact: true }).click();
  const optIn = page.getByRole('checkbox', { name: 'Review workflow suitability with Copilot' });
  await expect(optIn).not.toBeChecked();
  await expect(optIn).toBeDisabled();
  await expect(
    page.getByText('This is not local-only and consumes your Copilot quota.', { exact: false }),
  ).toBeVisible();
});
test('Copilot opinion remains separate from local recommendation and can be disabled', async ({
  page,
}) => {
  const app = new Application();
  app.handle({ type: 'discoverDemo' });
  const candidate = app.state.candidates[0];
  const localRecommendation = candidate.recommendation;
  let enabled = true;
  await page.exposeFunction('skilldnaCopilotHost', async (input: unknown) => {
    const message = messageSchema.parse(input);
    if (message.type === 'copilotConsent') {
      enabled = message.enabled;
      app.view = 'Privacy';
    } else if (message.type !== 'ready') app.handle(message);
    await page.evaluate((snapshot) => window.postMessage({ type: 'snapshot', snapshot }, '*'), {
      ...app.snapshot(),
      copilot: {
        enabled,
        model: enabled ? 'Test model' : undefined,
        notice: enabled ? 'Advisory review' : 'Copilot review is off.',
        reviews: enabled
          ? {
              [candidate.id]: {
                status: 'complete' as const,
                assessment: {
                  recommendation: 'Keep manual' as const,
                  rationale: 'Human judgment is required.',
                  missingEvidence: ['Confirmed outcomes'],
                  risks: ['Review sensitive checkpoints'],
                },
              },
            }
          : {},
      },
    });
  });
  await page.addInitScript(() =>
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) =>
          (
            window as unknown as { skilldnaCopilotHost(message: unknown): void }
          ).skilldnaCopilotHost(message),
      }),
    }),
  );
  await page.goto('/');
  const review = page.getByRole('region', { name: 'Copilot suitability review' });
  await expect(review).toContainText('AI opinion: Keep manual');
  await expect(review).toContainText(`Local recommendation: ${localRecommendation}`);
  await expect(review).toContainText('Confirmed outcomes');
  await page.getByRole('navigation').getByRole('button', { name: 'Privacy', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Review workflow suitability with Copilot' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Review workflow suitability with Copilot' }),
  ).not.toBeChecked();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Workflows/ })
    .click();
  await expect(review).toContainText('Off. Local recommendations remain available.');
  expect(candidate.recommendation).toBe(localRecommendation);
});
test('deletes all imported sessions after confirmation', async ({ page }) => {
  const app = new Application();
  const events = await new ImportSource(
    JSON.stringify({ requests: [{ message: { text: 'identify root cause' } }] }),
  ).read();
  app.state.sessions = segment(
    events.map((event) => ({ event })),
    30,
  ).map((session) => ({ ...session, approved: true }));
  app.view = 'Sessions';
  await page.exposeFunction('skilldnaDeleteHost', async (input: unknown) => {
    app.handle(messageSchema.parse(input));
    await page.evaluate(
      (snapshot) => window.postMessage({ type: 'snapshot', snapshot }, '*'),
      app.snapshot(),
    );
  });
  await page.addInitScript(() => {
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) =>
          (window as unknown as { skilldnaDeleteHost(message: unknown): void }).skilldnaDeleteHost(
            message,
          ),
      }),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Imported session summary' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete all imported sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Delete imported', exact: true }).click();
  expect(app.state.sessions).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Imported session summary' })).toHaveCount(0);
});
for (const width of [1440, 390])
  test(`combined workflow review and draft at ${width}px`, async ({ page }) => {
    const app = new Application();
    const base = demoSessions()[0];
    const core: Intent[] = [
      'review-issue-context',
      'analyze-diagnostic-data',
      'identify-changes',
      'generate-rca',
    ];
    const branches: Intent[][] = [
      [
        'search-evidence',
        'compare-configuration',
        'validate-authentication',
        'draft-customer-update',
      ],
      ['review-failing-test', 'resolve-test-failure', 'run-tests', 'update-documentation'],
    ];
    app.state.sessions = branches.flatMap((branch, variant) =>
      Array.from({ length: 3 }, (_, index) => ({
        ...base,
        id: `variant-${variant}-${index}`,
        events: [...core, ...branch].map((intent, eventIndex) => ({
          ...base.events[0],
          id: `event-${variant}-${index}-${eventIndex}`,
          intent,
          action: 'inspect' as const,
          outcome: 'success' as const,
        })),
      })),
    );
    app.handle({ type: 'analyze' });
    await page.exposeFunction('skilldnaCombinationHost', async (input: unknown) => {
      app.handle(messageSchema.parse(input));
      await page.evaluate(
        (snapshot) => window.postMessage({ type: 'snapshot', snapshot }, '*'),
        app.snapshot(),
      );
    });
    await page.addInitScript(() =>
      Object.assign(window, {
        acquireVsCodeApi: () => ({
          postMessage: (message: unknown) =>
            (
              window as unknown as { skilldnaCombinationHost(message: unknown): void }
            ).skilldnaCombinationHost(message),
        }),
      }),
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const combinations = page.getByRole('region', { name: 'Potential combinations' });
    await expect(combinations).toContainText('6 sessions across 2 variants');
    await combinations.getByRole('button').click();
    await expect(page.getByRole('region', { name: 'Combination evidence' })).toContainText(
      'not a verified end-to-end workflow',
    );
    await expect(
      page.getByRole('region', { name: 'Combination evidence' }).getByRole('button'),
    ).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/combinations-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Generate skill draft', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Skill review', exact: true })).toBeVisible();
    expect(app.state.drafts[0].candidateId).toMatch(/^combined-/);
    expect(app.state.drafts[0].files['SKILL.md']).toContain('not combined executions');
    app.handle({ type: 'validate', id: app.state.drafts[0].id });
    expect(app.validation?.errors).toEqual([]);
  });
test('extension bridge previews imported sessions before approval and discovery', async ({
  page,
}) => {
  const app = new Application();
  app.handle({ type: 'demo' });
  app.view = 'Overview';
  const source = new ImportSource(JSON.stringify({ sessions: demoSessions().slice(0, 12) }));
  const pending = segment(
    (await source.read()).map((event) => ({ event })),
    30,
  );
  await page.exposeFunction('skilldnaTestHost', async (input: unknown) => {
    const message = messageSchema.parse(input);
    if (message.type === 'importPrevious') {
      app.handle({ type: 'consent', mode: 'user-imported-content' });
      app.pending = pending;
      app.view = 'Sessions';
    } else app.handle(message);
    await page.evaluate(
      (snapshot) => window.postMessage({ type: 'snapshot', snapshot }, '*'),
      app.snapshot(),
    );
  });
  await page.addInitScript(() => {
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) =>
          (window as unknown as { skilldnaTestHost(message: unknown): void }).skilldnaTestHost(
            message,
          ),
      }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import previous sessions', exact: true }).click();
  await expect(page.getByText('Found 12 sessions · pending review')).toBeVisible();
  expect(app.state.sessions).toHaveLength(25);
  expect(app.state.candidates).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Demo sessions', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Imported sessions', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Imported session review', exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator('aside[aria-label="Sessions by source"] > section')
      .evaluateAll((sections) => sections.map((section) => section.getAttribute('aria-label'))),
  ).toEqual(['Demo sessions', 'Imported sessions']);
  const demoGroup = page.getByRole('region', { name: 'Demo sessions', exact: true });
  const importedGroup = page.getByRole('region', { name: 'Imported sessions', exact: true });
  await demoGroup.locator('summary').click();
  await expect(demoGroup.locator('details')).not.toHaveAttribute('open');
  await expect(demoGroup.locator('details')).toHaveCSS('border-top-width', '0px');
  await expect(demoGroup.locator('details')).toHaveCSS('margin-top', '0px');
  await expect(demoGroup.locator('details')).toHaveCSS('padding-top', '0px');
  await expect(demoGroup.locator('.session-row').first()).toBeHidden();
  await expect(importedGroup.locator('.session-row').first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'Include session 12', exact: true }).uncheck();
  await importedGroup.locator('summary').click();
  await expect(importedGroup.locator('.session-row').first()).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Imported session review', exact: true }),
  ).toBeVisible();
  await importedGroup.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('checkbox', { name: 'Include session 12', exact: true }),
  ).not.toBeChecked();
  await demoGroup.locator('summary').focus();
  await page.keyboard.press('Space');
  await expect(demoGroup.locator('.session-row').first()).toBeVisible();
  expect(app.state.sessions).toHaveLength(25);
  expect(app.pending).toHaveLength(12);
  await page.getByRole('button', { name: 'Approve and discover', exact: true }).click();
  const results = page.getByRole('region', { name: 'Discovery results' });
  await expect(
    results.getByRole('heading', { name: '36 approved sessions analyzed' }),
  ).toBeVisible();
  await expect(results.getByText('25 synthetic · 11 imported · 0 observed')).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Workflow sources' })
      .getByRole('button', { name: 'Imported', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    results.getByRole('heading', { name: 'Imported results', exact: true }),
  ).toBeVisible();
  await expect(results.getByRole('listitem').first()).toContainText('Imported');
  expect(app.pending).toHaveLength(0);
  expect(app.state.sessions).toHaveLength(36);
  expect(app.state.sessions.every((session) => session.approved)).toBe(true);
  expect(app.state.consent.paused).toBe(true);
  await expect(results.getByRole('button').first()).toBeVisible();
  await results.getByRole('button').first().click();
  expect(app.state.drafts[0].candidateId).toMatch(/^workflow-real-/);
});
for (const width of [1440, 390])
  test(`text-only imported session review at ${width}px`, async ({ page }) => {
    const app = new Application();
    const events = await new ImportSource(
      JSON.stringify({
        requests: [
          { message: { text: 'validate authentication C:\\private\\case.log' } },
          { message: { text: 'identify root cause' } },
          { message: { text: 'compare configuration' } },
        ],
      }),
    ).read();
    app.pending = segment(
      events.map((event) => ({ event })),
      30,
    );
    app.view = 'Sessions';
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(
      (snapshot) => window.postMessage({ type: 'snapshot', snapshot }, '*'),
      app.snapshot(),
    );
    await expect(
      page.getByRole('heading', { name: 'Imported session review', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Recorded resource', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Suggested from intent, not confirmed execution', { exact: true }),
    ).toHaveCount(3);
    await expect(page.getByRole('cell', { name: /validate.*Suggested from intent/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Not confirmed', exact: true })).toHaveCount(3);
    await expect(
      page.getByText('Keyword inference · 65% heuristic, not measured accuracy', { exact: true }),
    ).toHaveCount(3);
    await expect(page.getByRole('cell', { name: /Removed: path/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Imported session summary' })).toContainText(
      '3 events · 3 with an identified intent',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/imported-review-${width}.png`, fullPage: true });
    app.handle({
      type: 'approveSessions',
      ids: app.pending.map((session) => session.id),
      analyze: true,
    });
    await page.evaluate(
      (snapshot) => window.postMessage({ type: 'snapshot', snapshot }, '*'),
      app.snapshot(),
    );
    await expect(page.locator('.candidate-list .candidate').first()).toContainText(
      'Actions or results are not confirmed.',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
test('unrecognized import reports missing evidence without claiming discovery', async ({
  page,
}) => {
  const app = new Application();
  const events = await new ImportSource(
    JSON.stringify({ requests: [{ message: { text: 'Hello there' } }] }),
  ).read();
  app.pending = segment(
    events.map((event) => ({ event })),
    30,
  );
  app.view = 'Sessions';
  await page.goto('/');
  await page.evaluate(
    (snapshot) => window.postMessage({ type: 'snapshot', snapshot }, '*'),
    app.snapshot(),
  );
  await expect(page.getByRole('status').filter({ hasText: 'Imported successfully' })).toHaveText(
    'Imported successfully, but no recognizable workflow steps were found.',
  );
  await expect(page.getByRole('heading', { name: 'Insufficient workflow evidence' })).toBeVisible();
  await expect(
    page.getByText('Missing metadata is missing evidence, not evidence of low risk.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('combobox').locator('option:checked')).toHaveText(
    'No recognizable workflow step',
  );
  app.handle({
    type: 'approveSessions',
    ids: app.pending.map((session) => session.id),
    analyze: true,
  });
  await page.evaluate(
    (snapshot) => window.postMessage({ type: 'snapshot', snapshot }, '*'),
    app.snapshot(),
  );
  const results = page.getByRole('region', { name: 'Discovery results' });
  await expect(results).toContainText(
    'Imported successfully, but no recognizable workflow steps were found.',
  );
  await expect(results).toContainText('0 workflow candidates · 0 recommended skills');
  await expect(page.getByRole('region', { name: 'Potential combinations' })).toContainText(
    '0 workflow families available',
  );
});
test('onboarding discovers labeled synthetic workflows in one action', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Import previous sessions', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Try discovery demo', exact: true }).click();
  const results = page.getByRole('region', { name: 'Discovery results' });
  await expect(
    results.getByRole('heading', { name: '25 approved sessions analyzed' }),
  ).toBeVisible();
  await expect(results.getByText('25 synthetic · 0 imported · 0 observed')).toBeVisible();
  await expect(results.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Analyze again', exact: true }).click();
  const combinations = page.getByRole('region', { name: 'Potential combinations' });
  await expect(combinations.getByRole('status')).toContainText(
    'No compatible workflow combinations were found for this source using the current rules.',
  );
  await expect(combinations).toContainText(
    '3 workflow families available in this view; 3 have at least three supporting sessions.',
  );
  const detected = results
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Detected workflows' }) });
  await detected.locator('summary').click();
  await expect(results.getByRole('listitem').first()).toBeHidden();
  await detected.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(results.getByRole('listitem').first()).toBeVisible();
  const cards = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Workflow cards' }) });
  await cards.locator('summary').click();
  await expect(page.locator('.candidate-list')).toBeHidden();
  await expect(page.locator('.workflow-detail')).toBeVisible();
  await cards.locator('summary').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.candidate-list')).toBeVisible();
  await results
    .getByRole('button', { name: 'Generate Evidence-Based Case Investigation', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Skill review', exact: true })).toBeVisible();
  await expect(page.getByText('Observation off', { exact: true })).toBeVisible();
});
test('browser consent exposes only supported modes and stays in Privacy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  const mode = page.getByRole('combobox', { name: 'Data source', exact: true });
  await expect(mode.locator('option')).toHaveText([
    'Off',
    'Sample data only',
    'VS Code activity (requires VS Code)',
    'user-imported-content (requires VS Code)',
  ]);
  await expect(mode).toHaveAccessibleDescription(/No new activity is collected/);
  await expect(mode.locator('option[value="skilldna-interactions"]')).toHaveCount(0);
  for (const value of ['metadata-only', 'user-imported-content']) {
    await expect(mode.locator(`option[value="${value}"]`)).toHaveJSProperty('disabled', true);
  }
  for (const value of ['demo-only', 'off']) {
    await mode.selectOption(value);
    await expect(mode).toHaveValue(value);
    await expect(mode).toHaveAccessibleDescription(
      value === 'demo-only' ? /fictional example sessions/ : /No new activity is collected/,
    );
    await expect(page.getByRole('heading', { name: 'Privacy center', exact: true })).toBeVisible();
    for (const name of ['Resume observation', 'Start session', 'Stop session']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});
test('demo, review, validation, approval and edit invalidation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Observation off', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load synthetic demo', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze workflows', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Evidence-Based Case Investigation', exact: true, level: 2 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Generate skill draft', exact: true }).click();
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'errors (0)', exact: true })).toBeVisible();
  const exportButton = page.getByRole('button', { name: 'Export skill', exact: true });
  await expect(exportButton).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve draft', exact: true }).click();
  await expect(exportButton).toBeEnabled();
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Use when reviewing synthetic evidence. Do not use for autonomous changes.');
  await expect(exportButton).toBeDisabled();
});
for (const width of [1440, 390])
  test(`dashboard and workflow layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `docs/screenshots/overview-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Load synthetic demo', exact: true }).click();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Analyze workflows', exact: true }).click();
    await expect(page.locator('.step')).toHaveCount(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `docs/screenshots/workflows-${width}.png`, fullPage: true });
  });
