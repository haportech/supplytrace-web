import { expect, test, type Page } from '@playwright/test'

import type { ScanResultResponse } from '../src/shared/contracts'
import { scanResult } from '../test/helpers/scan-result'

const scanId = '11111111-1111-4111-8111-111111111111'
const resultPath = `/scans/${scanId}`

async function mockResults(
  page: Page,
  results: ScanResultResponse[],
): Promise<() => number> {
  let calls = 0
  await page.route(/\/api\/scans\/[0-9a-f-]{36}$/i, async (route) => {
    const result = results[Math.min(calls, results.length - 1)]
    calls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })
  return () => calls
}

test('shows work in progress and stops asking after the check is done', async ({
  page,
}) => {
  const fetching = scanResult({
    status: 'fetching',
    statusMessage: 'Reading the package list from GitHub.',
    completedAt: null,
    packages: [],
    edges: [],
    findings: [],
    packageCount: 0,
    findingCount: 0,
  })
  const calls = await mockResults(page, [fetching, fetching, scanResult()])

  await page.goto(resultPath)
  await expect(
    page.getByRole('heading', { name: 'Reading the package list' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check done' })).toBeVisible({
    timeout: 8_000,
  })
  const finishedCalls = calls()
  await page.waitForTimeout(1_800)
  expect(calls()).toBe(finishedCalls)
})

test('uses the map, link table, filters, details, and full report wording', async ({
  page,
}) => {
  await mockResults(page, [scanResult()])
  await page.goto(resultPath)

  await expect(page.getByText('Danger score')).toBeVisible()
  await expect(page.getByText('28', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: /package map/i })).toBeVisible()

  await page.getByRole('button', { name: 'Link table' }).click()
  await expect(page.getByRole('table', { name: 'Package links' })).toBeVisible()

  await page.getByRole('button', { name: 'Show medium only' }).click()
  const mediumProblem = page.getByRole('button', {
    name: 'Open GHSA-test-two details',
  })
  await expect(mediumProblem).toBeVisible()
  await expect(page.getByRole('heading', { name: 'GHSA-test-two' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'GHSA-test-one' })).toHaveCount(0)
  await mediumProblem.click()

  const detail = page.getByRole('complementary', { name: 'GHSA-test-two' })
  await expect(detail.getByText('No safer version was listed.')).toBeVisible()
  await expect(detail.getByText('A crafted value can make the app stop.')).toBeHidden()
  await detail.getByText("Show the report's words").click()
  await expect(detail.getByText('A crafted value can make the app stop.')).toBeVisible()
  await expect(detail.getByRole('link', { name: 'Open report 1' })).toHaveAttribute(
    'href',
    'https://osv.dev/vulnerability/GHSA-test-two',
  )
})

test('shows an empty result without claiming the project is fully safe', async ({
  page,
}) => {
  await mockResults(page, [
    scanResult({
      riskScore: 0,
      kevCount: 0,
      findingCount: 0,
      vulnerablePackageCount: 0,
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0,
      },
      findings: [],
    }),
  ])

  await page.goto(resultPath)
  await expect(page.getByRole('heading', { name: 'No known problems found' })).toBeVisible()
  await expect(page.getByText(/may still have other problems/i)).toBeVisible()
})

test('shows why part of a result was skipped', async ({ page }) => {
  await mockResults(page, [
    scanResult({
      status: 'partial',
      statusMessage: 'Check done with some parts skipped.',
      partial: true,
      partialReason: 'Two package versions were unclear, so they were not checked.',
    }),
  ])

  await page.goto(resultPath)
  await expect(page.getByRole('heading', { name: 'Some parts were skipped' })).toBeVisible()
  await expect(
    page.getByText('Two package versions were unclear, so they were not checked.'),
  ).toBeVisible()
})

test('shows a failed check and a way back', async ({ page }) => {
  await mockResults(page, [
    scanResult({
      status: 'failed',
      statusMessage: 'GitHub is busy. Try again in a few minutes.',
      completedAt: null,
    }),
  ])

  await page.goto(resultPath)
  await expect(page.getByRole('heading', { name: 'The check stopped' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Check another project' })).toHaveAttribute(
    'href',
    '/',
  )
})

test('shows a simple message for an unknown check', async ({ page }) => {
  await page.route(/\/api\/scans\/[0-9a-f-]{36}$/i, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'SCAN_NOT_FOUND',
          message: 'We could not find that check.',
        },
      }),
    })
  })

  await page.goto(resultPath)
  await expect(
    page.getByRole('heading', { name: 'We could not load this check' }),
  ).toBeVisible()
  await expect(page.getByText('We could not find that check.')).toBeVisible()
})

test('keeps the result inside a 320 pixel phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await mockResults(page, [scanResult()])
  await page.goto(resultPath)
  await expect(page.getByRole('heading', { name: 'Check done' })).toBeVisible()

  const layout = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    smallTargets: Array.from(
      document.querySelectorAll<HTMLElement>('a, button, summary, input'),
    ).filter((item) => {
      const box = item.getBoundingClientRect()
      const style = getComputedStyle(item)
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        box.width > 0 &&
        box.height > 0
      return visible && (box.width < 44 || box.height < 44)
    }).length,
  }))

  expect(layout.scroll).toBe(layout.client)
  expect(layout.smallTargets).toBe(0)
})
