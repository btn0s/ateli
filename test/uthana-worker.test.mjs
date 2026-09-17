import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Document, NodeIO } from '@gltf-transform/core'

const WORKER = path.resolve('executor/uthana-worker.mjs')

async function motionGlb(name = 'source') {
  const document = new Document()
  const buffer = document.createBuffer()
  const root = document.createNode('Root')
  document.createScene('Scene').addChild(root)
  document.createSkin('Skin').addJoint(root).setSkeleton(root)
  const input = document.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer)
  const output = document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 2, 1, 3])).setBuffer(buffer)
  const sampler = document.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR')
  const channel = document.createAnimationChannel().setSampler(sampler).setTargetNode(root).setTargetPath('translation')
  document.createAnimation(name).addSampler(sampler).addChannel(channel)
  return new NodeIO().writeBinary(document)
}

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

async function requestFixture(root, toolId, inputs) {
  const outputDir = path.join(root, `${toolId.replace('.', '-')}-${Math.random().toString(16).slice(2)}`)
  await mkdir(outputDir, { recursive: true })
  const requestPath = path.join(outputDir, 'request.json')
  await writeFile(requestPath, JSON.stringify({ runId: 'uthana-test', nodeId: toolId, toolId, inputs, outputDir }))
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

test('Uthana worker sends recorded multipart and JSON request shapes and normalizes motion GLBs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-uthana-worker-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourcePath = path.join(root, 'character.glb')
  const videoPath = path.join(root, 'motion.mp4')
  const glb = await motionGlb()
  await writeFile(sourcePath, glb)
  await writeFile(videoPath, 'recorded-video')
  const requests = []
  let videoPolls = 0
  let stubError
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Basic ${Buffer.from('stub-key:').toString('base64')}`)
      if (request.method === 'POST' && request.url === '/graphql') {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        const type = request.headers['content-type']
        if (type.startsWith('application/json')) {
          const payload = JSON.parse(body.toString('utf8'))
          requests.push({ kind: 'json', payload })
          if (payload.query.includes('create_text_to_motion')) {
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { create_text_to_motion: { motion: { id: 'motion-text', name: 'Idle' } } } }))
          } else {
            videoPolls += 1
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { job: videoPolls === 1
              ? { id: 'job-video', status: 'RUNNING', result: null }
              : { id: 'job-video', status: 'FINISHED', result: { result: { id: 'motion-video' } } } } }))
          }
          return
        }
        const raw = body.toString('latin1')
        requests.push({ kind: 'multipart', raw, type })
        if (raw.includes('create_character')) {
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { create_character: { character: { id: 'character-123', name: 'character' } } } }))
        } else {
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { create_video_to_motion: { job: { id: 'job-video', status: 'PENDING' } } } }))
        }
        return
      }
      if (request.url?.startsWith('/motion/file/motion_viewer/')) {
        response.writeHead(200, { 'content-type': 'model/gltf-binary' }).end(glb)
        return
      }
      response.writeHead(404).end()
    } catch (error) {
      stubError = error
      response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ errors: [{ message: error.message }] }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const env = { UTHANA_API_KEY: 'stub-key', UTHANA_BASE_URL: origin, UTHANA_POLL_BASE_MS: '1', UTHANA_POLL_MAX_MS: '2', ATELI_SKIP_MESH_PREVIEW: '1' }

  const rig = await requestFixture(root, 'character.rig', { mesh: { path: sourcePath }, includeFingers: false, frontFacing: true })
  await runWorker(rig.requestPath, env)
  assert.equal(JSON.parse(await readFile(path.join(rig.outputDir, 'character.json'), 'utf8')), 'character-123')
  assert.deepEqual(await readFile(path.join(rig.outputDir, 'mesh.glb')), Buffer.from(glb))
  const characterRequest = requests.find(item => item.kind === 'multipart' && item.raw.includes('create_character'))
  assert.ok(characterRequest)
  assert.match(characterRequest.raw, /"includeFingers":false/)
  assert.match(characterRequest.raw, /"frontFacing":true/)
  assert.match(characterRequest.raw, /"0":\["variables\.file"\]/)
  assert.match(characterRequest.raw, /auto_rig_front_facing/)

  const text = await requestFixture(root, 'motion.fromText', { character: 'character-123', prompt: 'Stand and breathe.', clipName: 'idle', inPlace: true, fps: 30 })
  await runWorker(text.requestPath, env)
  const textRequest = requests.find(item => item.kind === 'json' && item.payload.query.includes('create_text_to_motion'))
  assert.deepEqual(textRequest.payload.variables, { prompt: 'Stand and breathe.', characterId: 'character-123' })
  const textDocument = await new NodeIO().read(path.join(text.outputDir, 'mesh.glb'))
  assert.deepEqual(textDocument.getRoot().listAnimations().map(animation => animation.getName()), ['idle'])
  assert.deepEqual([...textDocument.getRoot().listAnimations()[0].listSamplers()[0].getOutput().getArray()], [0, 0, 0, 0, 1, 0])
  assert.deepEqual(JSON.parse(await readFile(path.join(text.outputDir, 'uthana.json'), 'utf8')), { characterId: 'character-123', motionId: 'motion-text', prompt: 'Stand and breathe.' })

  const video = await requestFixture(root, 'motion.fromVideo', { character: 'character-123', video: { path: videoPath }, clipName: 'attack', inPlace: true, fps: 30 })
  await runWorker(video.requestPath, env)
  assert.ok(videoPolls >= 2)
  const videoRequest = requests.find(item => item.kind === 'multipart' && item.raw.includes('create_video_to_motion'))
  assert.ok(videoRequest)
  assert.match(videoRequest.raw, /"motionName":"attack"/)
  assert.match(videoRequest.raw, /"characterId":"character-123"/)
  assert.match(videoRequest.raw, /video-to-motion-2\.0/)
  const videoDocument = await new NodeIO().read(path.join(video.outputDir, 'mesh.glb'))
  assert.deepEqual(videoDocument.getRoot().listAnimations().map(animation => animation.getName()), ['attack'])
  assert.ifError(stubError)
})

const liveKey = envValue('UTHANA_API_KEY')
const liveMesh = '/tmp/drifter-30k.glb'
const liveReady = process.env.LIVE === '1' && Boolean(liveKey) && await access(liveMesh).then(() => true, () => false)

test('Uthana worker completes one live rig and text-motion chain', { skip: !liveReady, timeout: 15 * 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-uthana-live-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = { UTHANA_API_KEY: liveKey }
  const rig = await requestFixture(root, 'character.rig', { mesh: { path: liveMesh }, includeFingers: false, frontFacing: true })
  await runWorker(rig.requestPath, env, 9 * 60_000)
  const character = JSON.parse(await readFile(path.join(rig.outputDir, 'character.json'), 'utf8'))
  assert.equal(typeof character, 'string')
  const motion = await requestFixture(root, 'motion.fromText', { character, prompt: 'Stand idle and breathe naturally.', clipName: 'idle', inPlace: true, fps: 30 })
  await runWorker(motion.requestPath, env, 5 * 60_000)
  const document = await new NodeIO().read(path.join(motion.outputDir, 'mesh.glb'))
  assert.deepEqual(document.getRoot().listAnimations().map(animation => animation.getName()), ['idle'])
})
