import { expect, test, type Page } from '@playwright/test'

import { scanResult } from '../test/helpers/scan-result'

const scanId = '11111111-1111-4111-8111-111111111111'
const resultPath = `/scans/${scanId}`

async function mockHealth(page: Page, liveScansEnabled: boolean): Promise<void> {
  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        service: 'supplytrace',
        version: 'test',
        liveScansEnabled,
      }),
    })
  })
}

test.beforeEach(async ({ page }) => {
  await mockHealth(page, true)
})

async function mockFinishedCheck(page: Page): Promise<void> {
  await page.route(/\/api\/scans\/[0-9a-f-]{36}$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scanResult()),
    })
  })
}

test('explains the check and keeps errors beside the link field', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Find known problems in a GitHub project.',
    }),
  ).toBeVisible()
  await expect(page.getByText('These pieces are called packages.')).toBeVisible()

  const field = page.getByLabel('GitHub project link')
  await field.fill('not-a-link')
  await page.getByRole('button', { name: 'Check project' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'Enter a public GitHub project link.',
  )
  await expect(field).toBeFocused()
})

test('starts a check with Enter and opens the finished result', async ({ page }) => {
  await mockFinishedCheck(page)
  await page.route('**/api/scans', async (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({
      repositoryUrl: 'https://github.com/expressjs/express',
    })
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        scanId,
        status: 'queued',
        reused: false,
        resultUrl: resultPath,
      }),
    })
  })

  await page.goto('/')
  await page.getByLabel('GitHub project link').fill(
    'https://github.com/expressjs/express',
  )
  await page.getByLabel('GitHub project link').press('Enter')

  await expect(page).toHaveURL(new RegExp(`${resultPath}$`))
  await expect(page.getByRole('heading', { name: 'Check done' })).toBeVisible()
})

test('shows the free-use limit and lets the user change the link', async ({ page }) => {
  await page.route('**/api/scans', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'HOURLY_LIMIT_REACHED',
          message: 'You have used all your checks for this hour. Try again next hour.',
        },
      }),
    })
  })

  await page.goto('/')
  const field = page.getByLabel('GitHub project link')
  await field.fill('https://github.com/expressjs/express')
  await page.getByRole('button', { name: 'Check project' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'You have used all your checks for this hour. Try again next hour.',
  )
  await expect(field).toBeFocused()
  await expect(field).toBeEditable()
})

test('fits the home page on a 320 pixel phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))

  expect(widths.scroll).toBe(widths.client)
  await expect(page.getByRole('button', { name: 'Check project' })).toBeVisible()
})

test('starts keyboard focus at the skip link', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
})

test('keeps the public demo read-only and opens its built-in example', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.unroute('**/api/health')
  await mockHealth(page, false)
  let scanRequests = 0
  await page.route(/\/api\/scans(?:\/|$)/, async (route) => {
    scanRequests += 1
    await route.abort()
  })

  await page.goto('/')

  await expect(
    page.getByText('Live checks are off on this public demo.'),
  ).toBeVisible()
  await expect(page.getByLabel('GitHub project link')).toHaveCount(0)
  await page.getByRole('link', { name: 'View example result' }).first().click()

  await expect(page).toHaveURL(/\/example$/)
  await expect(
    page.getByText('Example result — no live check was run.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check done' })).toBeVisible()
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBe(widths.client)
  expect(scanRequests).toBe(0)
})
