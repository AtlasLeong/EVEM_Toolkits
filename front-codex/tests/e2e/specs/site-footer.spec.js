import { test, expect } from '@playwright/test'

const ICP_NUMBER = '粤ICP备2024264329号'
const ICP_URL = 'https://beian.miit.gov.cn/'

test('all route layouts show the correct ICP filing link', async ({ page }) => {
  for (const route of ['/fraudlist', '/login', '/fraudlogin']) {
    await page.goto(route)

    const footer = page.getByRole('contentinfo')
    const filingLink = footer.getByRole('link', {
      name: ICP_NUMBER,
      exact: true,
    })

    await expect(footer).toBeVisible()
    await expect(filingLink).toHaveAttribute('href', ICP_URL)
    await expect(filingLink).toHaveAttribute('target', '_blank')
    await expect(filingLink).toHaveAttribute('rel', 'noreferrer')
    await expect(
      page.getByText(`${ICP_NUMBER}-1`, { exact: true }),
    ).toHaveCount(0)
  }
})
