/**
 * Generates `test/fixture.webm` — a 12-second counting clip used ONLY by the E2E harness, so the
 * player check has a real, seekable video without adding a binary to the repo or an ffmpeg
 * dependency to the machine. Recorded by Chromium itself from a canvas. Run once:
 *   node scripts/make-fixture-video.mjs
 */
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('about:blank')

const b64 = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 180
  c.height = 320
  const ctx = c.getContext('2d')
  const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' })
  const chunks = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  const stopped = new Promise((r) => (rec.onstop = r))
  rec.start()
  const t0 = performance.now()
  await new Promise((done) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000
      ctx.fillStyle = '#101322'
      ctx.fillRect(0, 0, 180, 320)
      ctx.fillStyle = '#7c9cff'
      ctx.font = '28px sans-serif'
      ctx.fillText(`${t.toFixed(1)}s`, 30, 170)
      if (t < 12) requestAnimationFrame(frame)
      else done()
    }
    frame()
  })
  rec.stop()
  await stopped
  const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
  const u = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s)
})

await browser.close()
await writeFile('test/fixture.webm', Buffer.from(b64, 'base64'))
console.log('wrote test/fixture.webm')
