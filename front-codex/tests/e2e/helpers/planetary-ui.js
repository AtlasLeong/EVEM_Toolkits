// Existing behavior suites exercise the same choices through the new disclosure UI.
export async function openFilter(disclosure) {
  if (!(await disclosure.evaluate(node => node.open))) {
    await disclosure.locator('summary').click()
  }
}
