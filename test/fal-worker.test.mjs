import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const WORKER = path.resolve('executor/fal-worker.mjs')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8dKAAAAAElFTkSuQmCC', 'base64')

async function runWorker(requestPath, env, timeout = 30_000) {
  const child = spawn(process.execPath, [WORKER, requestPath], {
    cwd: path.resolve('.'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(timer)
  assert.equal(result.signal, null, `worker terminated by ${result.signal}\n${stderr}`)
  assert.equal(result.code, 0, `worker failed\nstdout: ${stdout}\nstderr: ${stderr}`)
}

async function requestFixture(root, toolId, inputs, imagePath = path.join(root, 'input.png')) {
  const outputDir = path.join(root, toolId.replace('.', '-'))
  await mkdir(outputDir, { recursive: true })
  await writeFile(imagePath, PNG)
  const requestPath = path.join(outputDir, 'request.json')
  await writeFile(requestPath, JSON.stringify({ runId: 'fal-test', nodeId: toolId, toolId, inputs: { image: { path: imagePath }, ...inputs }, outputDir }))
  return { outputDir, requestPath }
}

function envValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim()
  try {
    const contents = readFileSync(path.resolve('.env'), 'utf8')
    const line = contents.split(/\r?\n/).find(candidate => candidate.match(new RegExp(`^\\s*${name}\\s*=`)))
    if (!line) return undefined
    let value = line.slice(line.indexOf('=') + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    return value || undefined
  } catch {
    return undefined
  }
}

test('Fal worker uploads local input and sends recorded image and video request shapes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-fal-worker-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const server = createServer((request, response) => {
    if (request.url === '/image.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
      return
    }
    if (request.url === '/video.mp4') {
      response.writeHead(200, { 'content-type': 'video/mp4' }).end('recorded-mp4')
      return
    }
    response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const modulePath = path.join(root, 'fal-client.mjs')
  await writeFile(modulePath, `
import { writeFile } from 'node:fs/promises'
let configured
export const fal = {
  config(value) { configured = value },
  storage: { async upload(file) {
    await writeFile(process.env.FAL_CAPTURE, JSON.stringify({ configured, upload:{ name:file.name, type:file.type, size:file.size } }))
    return 'https://fal.storage/uploaded-input.png'
  } },
  async subscribe(model, options) {
    const prior = JSON.parse(await (await import('node:fs/promises')).readFile(process.env.FAL_CAPTURE, 'utf8'))
    await writeFile(process.env.FAL_CAPTURE, JSON.stringify({ ...prior, model, options:{ input:options.input, logs:options.logs } }))
    return model.includes('image-to-video')
      ? { data:{ video:{ url:process.env.FAL_ASSET_ORIGIN + '/video.mp4', content_type:'video/mp4' }, timings:{ inference:12.5 } }, requestId:'video-request' }
      : { data:{ images:[{ url:process.env.FAL_ASSET_ORIGIN + '/image.png', content_type:'image/png' }], cost:0.039 }, requestId:'image-request' }
  },
}
`)

  const image = await requestFixture(root, 'image.edit', {
    prompt: 'Turn the coat bright red.', model: 'fal-ai/nano-banana-2/edit',
  })
  const imageCapture = path.join(root, 'image-capture.json')
  await runWorker(image.requestPath, { FAL_KEY: 'stub-key', ATELI_FAL_CLIENT_MODULE: modulePath, FAL_CAPTURE: imageCapture, FAL_ASSET_ORIGIN: origin })
  const recordedImage = JSON.parse(await readFile(imageCapture, 'utf8'))
  assert.deepEqual(recordedImage, {
    configured: { credentials: 'stub-key' }, upload: { name: 'input.png', type: 'image/png', size: PNG.length },
    model: 'fal-ai/nano-banana-2/edit', options: { input: { prompt: 'Turn the coat bright red.', image_urls: ['https://fal.storage/uploaded-input.png'] }, logs: true },
  })
  assert.deepEqual(await readFile(path.join(image.outputDir, 'image.png')), PNG)
  const imageMeta = JSON.parse(await readFile(path.join(image.outputDir, 'fal.json'), 'utf8'))
  assert.equal(imageMeta.requestId, 'image-request')
  assert.equal(imageMeta.cost, 0.039)

  const video = await requestFixture(root, 'video.fromImage', {
    prompt: 'Slow camera push in.', model: 'fal-ai/kling-video/v3/pro/image-to-video', duration: '5',
  })
  const videoCapture = path.join(root, 'video-capture.json')
  await runWorker(video.requestPath, { FAL_KEY: 'stub-key', ATELI_FAL_CLIENT_MODULE: modulePath, FAL_CAPTURE: videoCapture, FAL_ASSET_ORIGIN: origin })
  const recordedVideo = JSON.parse(await readFile(videoCapture, 'utf8'))
  assert.deepEqual(recordedVideo.options.input, {
    prompt: 'Slow camera push in.', start_image_url: 'https://fal.storage/uploaded-input.png', duration: '5', generate_audio: false,
  })
  assert.equal(await readFile(path.join(video.outputDir, 'video.mp4'), 'utf8'), 'recorded-mp4')
  const videoMeta = JSON.parse(await readFile(path.join(video.outputDir, 'fal.json'), 'utf8'))
  assert.equal(videoMeta.requestId, 'video-request')
  assert.deepEqual(videoMeta.timings, { inference: 12.5 })
})

const liveKey = envValue('FAL_KEY')
const liveImage = '/tmp/drifter-front.png'
const liveReady = process.env.LIVE === '1' && Boolean(liveKey) && await access(liveImage).then(() => true, () => false)

test('Fal worker completes one live Nano Banana edit', { skip: !liveReady, timeout: 10 * 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-fal-live-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await requestFixture(root, 'image.edit', {
    prompt: 'Replace the background with a plain light gray studio backdrop.', model: 'fal-ai/nano-banana-2/edit',
  }, liveImage)
  await runWorker(fixture.requestPath, { FAL_KEY: liveKey }, 9 * 60_000)
  const metadata = JSON.parse(await readFile(path.join(fixture.outputDir, 'fal.json'), 'utf8'))
  assert.equal(metadata.model, 'fal-ai/nano-banana-2/edit')
  assert.equal(typeof metadata.requestId, 'string')
})
