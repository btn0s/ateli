import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

const WORKER = path.resolve('executor/meshy-worker.mjs')

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, checksum])
}

function smallSubjectPng(size = 128) {
  const stride = 1 + size * 4
  const pixels = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y += 1) {
    pixels[y * stride] = 0
    for (let x = 0; x < size; x += 1) {
      const offset = y * stride + 1 + x * 4
      const head = (x - size * 0.5) ** 2 + (y - size * 0.3) ** 2 < (size * 0.15) ** 2
      const body = y >= size * 0.43 && y <= size * 0.82 && Math.abs(x - size * 0.5) < size * (0.28 - y / size * 0.12)
      const ground = y > size * 0.84 && Math.abs(x - size * 0.5) < size * 0.32
      const subject = head || body || ground
      const shade = Math.max(0, Math.min(40, Math.round((x / size) * 40)))
      pixels[offset] = subject ? 50 + shade : 242
      pixels[offset + 1] = subject ? 90 + shade : 244
      pixels[offset + 2] = subject ? 170 + shade : 248
      pixels[offset + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

async function runWorker(requestPath, env, timeout = 30_000) {
  const child = spawn(process.execPath, [WORKER, requestPath], {
    cwd: path.resolve('.'),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
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

async function writeRequest(root, inputs) {
  const outputDir = path.join(root, 'output')
  await mkdir(outputDir, { recursive: true })
  const imagePath = path.join(root, 'subject.png')
  await writeFile(imagePath, smallSubjectPng())
  const requestPath = path.join(outputDir, 'request.json')
  await writeFile(requestPath, JSON.stringify({
    runId: 'meshy-test-run',
    nodeId: 'from-image',
    toolId: 'mesh.fromImage',
    inputs: { image: { path: imagePath }, ...inputs },
    outputDir,
  }))
  return { outputDir, requestPath }
}

function readRepoApiKey() {
  if (process.env.MESHY_API_KEY?.trim()) return process.env.MESHY_API_KEY.trim()
  try {
    const contents = requireEnvFile()
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*MESHY_API_KEY\s*=(.*)$/)
      if (!match) continue
      let value = match[1].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      return value || undefined
    }
  } catch {}
  return undefined
}

function requireEnvFile() {
  return readFileSync(path.resolve('.env'), 'utf8')
}

test('Meshy worker creates, polls, downloads, and records an image-to-3D task', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-meshy-worker-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let receivedRequest
  let polls = 0
  let stubError
  const server = createServer(async (request, response) => {
    try {
      const origin = `http://127.0.0.1:${server.address().port}`
      if (request.method === 'POST' && request.url === '/openapi/v1/image-to-3d') {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        receivedRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        assert.equal(request.headers.authorization, 'Bearer stub-key')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ result: 'stub-task-1' }))
        return
      }
      if (request.method === 'GET' && request.url === '/openapi/v1/image-to-3d/stub-task-1') {
        polls += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(polls === 1
          ? { id: 'stub-task-1', status: 'PENDING', progress: 0 }
          : {
              id: 'stub-task-1', status: 'SUCCEEDED', progress: 100,
              model_urls: { glb: `${origin}/assets/model.glb` },
              thumbnail_url: `${origin}/assets/preview.png`,
              consumed_credits: 20,
              created_at: Date.parse('2026-09-16T12:00:00.000Z'),
            }))
        return
      }
      if (request.url === '/assets/model.glb') {
        response.writeHead(200, { 'content-type': 'model/gltf-binary' })
        response.end('stub-glb')
        return
      }
      if (request.url === '/assets/preview.png') {
        response.writeHead(200, { 'content-type': 'image/png' })
        response.end('stub-preview')
        return
      }
      response.writeHead(404).end()
    } catch (error) {
      stubError = error
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ message: error.message }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const fixture = await writeRequest(root, {
    prompt: 'weathered blue toy',
    model: 'meshy-7',
    pose: 'none',
    texture: false,
    textureResolution: '2k',
    pbr: false,
    remesh: false,
  })

  await runWorker(fixture.requestPath, {
    MESHY_API_KEY: 'stub-key',
    MESHY_API_BASE_URL: origin,
    MESHY_POLL_BASE_MS: '1',
    MESHY_POLL_MAX_MS: '2',
  })
  assert.ifError(stubError)
  assert.ok(polls >= 2)
  assert.match(receivedRequest.image_url, /^data:image\/png;base64,/)
  assert.deepEqual({ ...receivedRequest, image_url: '<data>' }, {
    image_url: '<data>',
    ai_model: 'meshy-7',
    enable_pbr: false,
    model_type: 'standard',
    pose_mode: '',
    should_remesh: false,
    should_texture: false,
    target_formats: ['glb'],
    texture_resolution: '2k',
    texture_prompt: 'weathered blue toy',
  })
  assert.equal(await readFile(path.join(fixture.outputDir, 'mesh.glb'), 'utf8'), 'stub-glb')
  assert.equal(await readFile(path.join(fixture.outputDir, 'mesh.preview.png'), 'utf8'), 'stub-preview')
  const outputs = JSON.parse(await readFile(path.join(fixture.outputDir, 'outputs.json'), 'utf8'))
  assert.deepEqual(outputs.meta, { mesh: 'meshy.json' })
  const metadata = JSON.parse(await readFile(path.join(fixture.outputDir, 'meshy.json'), 'utf8'))
  assert.equal(metadata.taskId, 'stub-task-1')
  assert.equal(metadata.consumedCredits, 20)
  assert.equal(metadata.createdAt, '2026-09-16T12:00:00.000Z')
  assert.equal(metadata.request.image_url, undefined)
})

const realApiKey = readRepoApiKey()
const runRealApi = Boolean(realApiKey) && process.env.ATELI_RUN_MESHY_REAL === '1'

test('Meshy worker completes one real texture-free image-to-3D task', { skip: !runRealApi, timeout: 20 * 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-meshy-live-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await writeRequest(root, {
    model: 'meshy-7',
    pose: 'none',
    texture: false,
    textureResolution: '2k',
    pbr: false,
    remesh: false,
  })
  await runWorker(fixture.requestPath, {
    MESHY_API_KEY: realApiKey,
    MESHY_API_BASE_URL: 'https://api.meshy.ai',
  }, 19 * 60_000)
  const metadata = JSON.parse(await readFile(path.join(fixture.outputDir, 'meshy.json'), 'utf8'))
  assert.equal(typeof metadata.taskId, 'string')
  assert.ok(metadata.taskId.length > 0)
  assert.equal(typeof metadata.consumedCredits, 'number')
  console.log(`Meshy live task ${metadata.taskId}; credits consumed: ${metadata.consumedCredits}`)
})
