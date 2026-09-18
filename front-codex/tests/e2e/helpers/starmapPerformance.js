import { expect } from '@playwright/test'
import { installApiMock, json } from './api'

// Observe real Canvas operations; always forward to the browser implementation.
// This lives only in the test harness, never in the shipped renderer.
export async function observeMapDrawing(page) {
  await page.addInitScript(() => {
    window.__mapPerf = { frames: [], resizes: 0 }
    for (const property of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property)
      Object.defineProperty(HTMLCanvasElement.prototype, property, {
        ...descriptor,
        set(value) {
          if (this.classList.contains('tactical-map-canvas')) window.__mapPerf.resizes += 1
          descriptor.set.call(this, value)
        },
      })
    }
    for (const name of ['clearRect', 'arc', 'lineTo', 'fillText', 'restore']) {
      const original = CanvasRenderingContext2D.prototype[name]
      CanvasRenderingContext2D.prototype[name] = function (...args) {
        const result = original.apply(this, args)
        if (!this.canvas.classList.contains('tactical-map-canvas')) return result
        const perf = window.__mapPerf
        if (name === 'clearRect') {
          perf.frames.push({ arcs: 0, lines: 0, labels: 0, started: performance.now(), drawMs: 0 })
          if (perf.frames.length > 1000) perf.frames.shift()
        }
        const frame = perf.frames.at(-1)
        if (frame) {
          if (name === 'arc') frame.arcs += 1
          if (name === 'lineTo') frame.lines += 1
          if (name === 'fillText') frame.labels += 1
          if (name === 'restore') frame.drawMs = performance.now() - frame.started
        }
        return result
      }
    }
  })
}

export async function installMapData(page, systems, stargates = []) {
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/boardsystems') return json(systems)
    if (url.pathname === '/api/boardstargate') return json(stargates)
    return json([])
  })
}

export async function waitForMapIdle(page) {
  await expect.poll(() => page.evaluate(() => {
    const last = window.__mapPerf.frames.at(-1)
    return !!last && performance.now() - last.started > 120
  })).toBe(true)
}

export async function locateMapSystem(page, name) {
  await page.getByLabel('搜索并定位星系').fill(name)
  await page.locator('.tactical-map-search .tactical-search-option').first().click()
  await expect(page.locator('.tactical-map-hud')).toContainText('缩放 7.56x')
  await waitForMapIdle(page)
}

export function largeMapData(count = 5428) {
  const systems = Array.from({ length: count }, (_, index) => ({
    system_id: index + 1,
    zh_name: `测试星系-${String(index + 1).padStart(5, '0')}`,
    en_name: `SYSTEM-${index + 1}`,
    x: (index % 100) * 9.461e15,
    y: 0,
    z: Math.floor(index / 100) * 9.461e15,
    security_status: ((index % 15) - 5) / 10,
  }))
  const stargates = []
  for (let index = 0; index < count - 1; index += 1) {
    for (const destination of [index + 1, ...(index % 4 === 0 && index + 100 < count ? [index + 100] : [])]) {
      stargates.push({ system_id: index + 1, destination_system_id: destination + 1 })
      stargates.push({ system_id: destination + 1, destination_system_id: index + 1 })
    }
  }
  return { systems, stargates }
}
