import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const initialTicket = { id: 7, type: 'feature', module: 'planetary', title: '希望支持方案导出', description: '希望可以导出资源方案并分享给朋友。', contact: '', status: 'pending', author_name: 'atlas123', created_at: '2026-09-08T04:00:00Z', updated_at: '2026-09-08T04:00:00Z', reply_count: 0, comments: [] }

async function fixture(page, { staff = false, createFails = false, listFails = false, total = 1, attachmentFails = false, createDelay = 0 } = {}) {
  await seedAuthenticatedSession(page, { user_id: 23 })
  let tickets = Array.from({ length: total }, (_, i) => ({ ...structuredClone(initialTicket), id: 7 + i }))
  const posts = []
  const commentPosts = []
  const attachmentPosts = []
  const queries = []
  await installApiMock(page, async ({ url, method, body }) => {
    if (!url.pathname.startsWith('/api/feedback/')) return json([])
    if (url.pathname === '/api/feedback/' && method === 'GET') {
      queries.push(url.search)
      if (listFails) return json({ detail: '暂时无法读取反馈' }, 503)
      const offset = (Number(url.searchParams.get('page') || 1) - 1) * 20
      return json({ can_manage: staff, count: url.searchParams.get('status') ? 0 : tickets.length, results: url.searchParams.get('status') ? [] : tickets.slice(offset, offset + 20) })
    }
    if (url.pathname === '/api/feedback/' && method === 'POST') {
      posts.push(body)
      if (createDelay) await new Promise(resolve => setTimeout(resolve, createDelay))
      if (createFails && posts.length === 1) return json({ detail: '提交暂时失败，请重试' }, 503)
      const item = { ...initialTicket, ...body, id: 8, comments: [] }
      tickets.push(item)
      return json(item, 201)
    }
    const id = Number(url.pathname.split('/')[3])
    const item = tickets.find(ticket => ticket.id === id)
    if (!item) return json({ detail: '未找到反馈' }, 404)
    if (method === 'POST' && url.pathname.endsWith('/attachments/')) {
      const filename = body.match(/filename="([^"]+)"/)?.[1]
      const requestId = body.match(/name="request_id"\r\n\r\n([^\r]+)/)?.[1]
      attachmentPosts.push({ filename, requestId })
      if (attachmentFails && attachmentPosts.length === 2) return json({ detail: '模拟上传中断' }, 503)
      const attachment = { id: 12 + attachmentPosts.length, name: filename, size: 6, content_type: 'text/plain', created_at: initialTicket.created_at }
      item.attachments = [...(item.attachments || []), attachment]
      return json(attachment, 201)
    }
    if (method === 'PATCH') item.status = body.status
    if (method === 'POST' && url.pathname.endsWith('/comments/')) {
      commentPosts.push(body)
      item.comments.push({ id: item.comments.length + 1, body: body.body, author_name: 'atlas123', is_staff: staff, created_at: initialTicket.created_at })
      item.reply_count++
    }
    return json(item)
  })
  return { posts, queries, commentPosts, attachmentPosts }
}

test('访客有清晰入口和登录提示，不显示私密反馈', async ({ page }) => {
  await installApiMock(page, async () => json([]))
  await page.goto('/planetary')
  await page.getByRole('link', { name: '需求与反馈', exact: true }).click()
  await expect(page.getByRole('heading', { name: '需求与反馈' })).toBeVisible()
  await expect(page.getByRole('link', { name: '登录后提交反馈' })).toBeVisible()
  await expect(page.getByText('希望支持方案导出', { exact: true })).toHaveCount(0)
})

test('提交失败保留表单，重试沿用请求编号且成功后进入详情', async ({ page }) => {
  const { posts } = await fixture(page, { createFails: true })
  await page.goto('/feedback')
  await page.getByLabel('反馈标题', { exact: true }).fill('希望支持批量导出')
  await page.getByLabel('详细描述', { exact: true }).fill('需要把计算器方案保存成文件。')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('提交暂时失败')
  await expect(page.getByLabel('反馈标题', { exact: true })).toHaveValue('希望支持批量导出')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  await expect(page.getByRole('heading', { name: '希望支持批量导出' })).toBeVisible()
  expect(posts).toHaveLength(2)
  expect(posts[0].request_id).toBe(posts[1].request_id)
  expect(posts[0].request_id).toMatch(/^[a-f0-9-]{36}$/)
})

test('用户可以查看和补充自己的反馈，无管理控件', async ({ page }) => {
  await fixture(page)
  await page.goto('/feedback')
  await page.getByRole('button', { name: /希望支持方案导出/ }).click()
  await expect(page.getByRole('heading', { name: '希望支持方案导出' })).toBeVisible()
  await expect(page.getByRole('button', { name: '全部反馈', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('处理状态', { exact: true })).toHaveCount(0)
  await page.getByLabel('补充说明', { exact: true }).fill('最好支持 CSV 文件。')
  await page.getByRole('button', { name: '发送补充', exact: true }).click()
  await expect(page.getByText('最好支持 CSV 文件。', { exact: true })).toBeVisible()
})

test('管理员由服务端权限启用全部反馈、更新状态和回复', async ({ page }) => {
  const { queries } = await fixture(page, { staff: true })
  await page.goto('/feedback')
  await page.getByRole('button', { name: '全部反馈', exact: true }).click()
  await page.getByRole('button', { name: /希望支持方案导出/ }).click()
  await page.getByLabel('处理状态', { exact: true }).selectOption('processing')
  await page.getByRole('button', { name: '保存状态', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('状态已更新')
  await page.getByLabel('回复内容', { exact: true }).fill('已收到，我们正在评估。')
  await page.getByRole('button', { name: '发送回复', exact: true }).click()
  await expect(page.getByText('已收到，我们正在评估。', { exact: true })).toBeVisible()
  expect(queries.some(query => query.includes('scope=all'))).toBeTruthy()
})

test('筛选空态和宽屏布局正常，列表失败可重试', async ({ page }) => {
  await fixture(page)
  await page.goto('/feedback')
  await page.getByLabel('筛选状态', { exact: true }).selectOption('completed')
  await expect(page.getByText('暂无匹配的反馈', { exact: true })).toBeVisible()
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 960 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await expect(page.getByRole('button', { name: '提交反馈', exact: true })).toBeInViewport()
  }
})

test('读取失败显示错误和重试入口，不冒充空列表', async ({ page }) => {
  await fixture(page, { listFails: true })
  await page.goto('/feedback')
  await expect(page.getByRole('alert')).toContainText('暂时无法读取反馈')
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  await expect(page.getByText('暂无匹配的反馈', { exact: true })).toHaveCount(0)
})

test('私密附件支持上传文件，拒绝未允许的扩展名', async ({ page }) => {
  await fixture(page)
  await page.goto('/feedback')
  await page.getByRole('button', { name: /希望支持方案导出/ }).click()
  await page.getByLabel('选择附件').setInputFiles({ name: '程序.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('binary') })
  await expect(page.getByRole('alert')).toContainText('不支持')
  await page.getByLabel('选择附件').setInputFiles({ name: '说明.txt', mimeType: 'text/plain', buffer: Buffer.from('说明') })
  await page.getByRole('button', { name: '上传附件', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载 说明.txt' })).toBeVisible()
})

test('已成功发送后再次发送同样内容会使用新的请求编号', async ({ page }) => {
  const { commentPosts } = await fixture(page)
  await page.goto('/feedback')
  await page.getByRole('button', { name: /希望支持方案导出/ }).click()
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('补充说明', { exact: true }).fill('再次确认这个问题仍然存在。')
    await page.getByRole('button', { name: '发送补充', exact: true }).click()
    await expect(page.getByLabel('补充说明', { exact: true })).toHaveValue('')
  }
  expect(commentPosts).toHaveLength(2)
  expect(commentPosts[0].request_id).not.toBe(commentPosts[1].request_id)
})

test('分页向服务端请求指定页码', async ({ page }) => {
  const { queries } = await fixture(page, { total: 41 })
  await page.goto('/feedback')
  await expect(page.locator('.feedback-ticket')).toHaveCount(20)
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByText('第 2 / 3 页', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.locator('.feedback-ticket')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled()
  expect(queries.some(query => query.includes('page=3'))).toBeTruthy()
})

test('快速重复点击只创建一次反馈', async ({ page }) => {
  const { posts } = await fixture(page, { createDelay: 400 })
  await page.goto('/feedback')
  await page.getByLabel('反馈标题', { exact: true }).fill('请支持导出')
  await page.getByLabel('详细描述', { exact: true }).fill('希望导出为文件。')
  await page.getByRole('button', { name: '提交反馈', exact: true }).dblclick()
  await expect(page.getByRole('heading', { name: '请支持导出' })).toBeVisible()
  expect(posts).toHaveLength(1)
})

test('附件部分成功后重试只发送剩余文件且保留请求编号', async ({ page }) => {
  const { attachmentPosts } = await fixture(page, { attachmentFails: true })
  await page.goto('/feedback')
  await page.getByRole('button', { name: /希望支持方案导出/ }).click()
  await page.getByLabel('选择附件').setInputFiles(['first.txt', 'second.txt'].map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('example') })))
  await page.getByRole('button', { name: '上传附件', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('模拟上传中断')
  await expect(page.getByRole('button', { name: '下载 first.txt' })).toBeVisible()
  await page.getByRole('button', { name: '上传附件', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载 second.txt' })).toBeVisible()
  expect(attachmentPosts.map(item => item.filename)).toEqual(['first.txt', 'second.txt', 'second.txt'])
  expect(attachmentPosts[1].requestId).toBeTruthy()
  expect(attachmentPosts[1].requestId).toBe(attachmentPosts[2].requestId)
})
