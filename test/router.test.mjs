import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAteliRouter } from '../server/router.mjs'

function graph(nodes, edges = []) {
  return { schemaVersion: 1, nodes, edges }
}

function inputMesh(sourceId, id = 'input') {
  return { id, toolId: 'input.mesh', toolVersion: 1, parameters: { file: sourceId } }
}

function optimize(id = 'optimize', targetFaces = 80000) {
  return { id, toolId: 'mesh.optimize', toolVersion: 1, parameters: { topology: 'triangle', targetFaces } }
}

function edge(id, sourceNode, sourcePort, targetNode, targetPort) {
  return { id, source: { nodeId: sourceNode, portId: sourcePort }, target: { nodeId: targetNode, portId: targetPort } }
}

async function openRouter(root, workerCommand) {
  const router = createAteliRouter({
    stagingRoot: path.join(root, 'staging'),
    allowedSourceRoots: [path.join(root, 'allowed')],
    workerCommand,
  })
  const server = createServer((request, response) => {
    router.handle(request, response, new URL(request.url, `http://${request.headers.host}`))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    router,
    server,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await router.close()
      server.closeAllConnections?.()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

async function createHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-router-'))
  const allowedRoot = path.join(root, 'allowed')
  const stagingRoot = path.join(root, 'staging')
  await mkdir(allowedRoot, { recursive: true })
  const meshPath = path.join(allowedRoot, 'source.glb')
  const imagePath = path.join(allowedRoot, 'source.png')
  await writeFile(meshPath, 'source-mesh')
  await writeFile(imagePath, 'source-image')
  const callsPath = path.join(root, 'worker-calls.log')
  const imageWorkerPath = path.join(root, 'image-worker.mjs')
  const blenderWorkerPath = path.join(root, 'blender-worker.mjs')

  await writeFile(imageWorkerPath, `
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const request = JSON.parse(await readFile(process.argv[2], 'utf8'))
await appendFile(process.env.ATELI_CALLS, request.toolId + '\\n')
if (request.toolId !== 'image.filter') throw new Error('unexpected image tool ' + request.toolId)
await writeFile(path.join(request.outputDir, 'image.png'), 'filtered:' + request.inputs.filter)
await writeFile(path.join(request.outputDir, 'outputs.json'), JSON.stringify({ image: 'image.png' }))
`)
  await writeFile(blenderWorkerPath, `
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const request = JSON.parse(await readFile(process.argv[2], 'utf8'))
await appendFile(process.env.ATELI_CALLS, request.toolId + '\\n')
if (request.toolId === 'mesh.optimize' && request.inputs.targetFaces === 4) {
  await new Promise(resolve => setTimeout(resolve, 30000))
}
const outputs = {}
if (request.toolId === 'mesh.optimize' || request.toolId === 'mesh.applyTextures') {
  await writeFile(path.join(request.outputDir, 'mesh.glb'), 'mesh:' + request.toolId + ':' + request.inputs.targetFaces)
  await writeFile(path.join(request.outputDir, 'mesh.preview.png'), 'preview:' + request.toolId)
  outputs.mesh = 'mesh.glb'
  outputs.preview = { mesh: 'mesh.preview.png' }
} else if (request.toolId === 'mesh.extractTextures') {
  for (const name of ['baseColor', 'roughness', 'metallic', 'normal']) {
    await writeFile(path.join(request.outputDir, name + '.png'), 'image:' + name)
    outputs[name] = name + '.png'
  }
} else if (request.toolId === 'mesh.render') {
  await writeFile(path.join(request.outputDir, 'image.png'), 'render')
  outputs.image = 'image.png'
} else {
  throw new Error('unexpected blender tool ' + request.toolId)
}
await writeFile(path.join(request.outputDir, 'outputs.json'), JSON.stringify(outputs))
`)

  const workerCommand = ({ runtime, requestPath }) => ({
    executable: process.execPath,
    args: [runtime === 'blender' ? blenderWorkerPath : imageWorkerPath, requestPath],
    env: { ...process.env, ATELI_CALLS: callsPath },
  })
  const opened = await openRouter(root, workerCommand)
  return {
    root,
    allowedRoot,
    stagingRoot,
    meshPath,
    imagePath,
    callsPath,
    workerCommand,
    ...opened,
    async calls() {
      return (await readFile(callsPath, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
    },
    async close({ remove = true } = {}) {
      await opened.close()
      if (remove) await rm(root, { recursive: true, force: true })
    },
  }
}

async function request(origin, route, { method = 'GET', body, headers } = {}) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return {
    status: response.status,
    headers: response.headers,
    body: text && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text,
  }
}

async function addSource(harness, filePath) {
  const response = await request(harness.origin, '/ateli/sources', { method: 'POST', body: { path: filePath } })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return response.body
}

async function submit(harness, runGraph, scope = { kind: 'graph' }, options = {}) {
  return request(harness.origin, '/ateli/runs', {
    method: 'POST',
    body: { graph: runGraph, scope, ...options },
  })
}

async function waitForRun(origin, runId, statuses = ['completed', 'failed', 'cancelled']) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const response = await request(origin, `/ateli/runs/${runId}`)
    assert.equal(response.status, 200, JSON.stringify(response.body))
    if (statuses.includes(response.body.status)) return response.body
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`run ${runId} did not settle`)
}

async function waitForNode(origin, runId, nodeId, status) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const response = await request(origin, `/ateli/runs/${runId}`)
    if (response.body.nodes?.[nodeId]?.status === status) return response.body
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`${nodeId} did not reach ${status}`)
}

test('run validation returns 400 for required inputs, unknown params, ranges, cycles, and duplicate targets', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())

  const cases = [
    {
      name: 'missing required',
      graph: graph([{ id: 'text', toolId: 'input.text', toolVersion: 1, parameters: {} }]),
      error: /missing required input/,
    },
    {
      name: 'unknown parameter',
      graph: graph([{ id: 'number', toolId: 'input.number', toolVersion: 1, parameters: { bogus: 1 } }]),
      error: /unknown parameter key/,
    },
    {
      name: 'out of range',
      graph: graph([
        { id: 'source', toolId: 'input.image', toolVersion: 1, parameters: { file: 'unused' } },
        { id: 'threshold', toolId: 'image.threshold', toolVersion: 1, parameters: { threshold: 256 } },
      ], [edge('range-edge', 'source', 'image', 'threshold', 'image')]),
      error: /out of range/,
    },
    {
      name: 'cycle',
      graph: graph([
        { id: 'a', toolId: 'image.filter', toolVersion: 1, parameters: { filter: 'blur' } },
        { id: 'b', toolId: 'image.filter', toolVersion: 1, parameters: { filter: 'invert' } },
      ], [
        edge('ab', 'a', 'image', 'b', 'image'),
        edge('ba', 'b', 'image', 'a', 'image'),
      ]),
      error: /cycle/,
    },
    {
      name: 'duplicate target',
      graph: graph([
        { id: 'left', toolId: 'input.image', toolVersion: 1, parameters: { file: 'unused-left' } },
        { id: 'right', toolId: 'input.image', toolVersion: 1, parameters: { file: 'unused-right' } },
        { id: 'filter', toolId: 'image.filter', toolVersion: 1, parameters: { filter: 'blur' } },
      ], [
        edge('left-filter', 'left', 'image', 'filter', 'image'),
        edge('right-filter', 'right', 'image', 'filter', 'image'),
      ]),
      error: /duplicate target port/,
    },
  ]

  for (const fixture of cases) {
    const response = await submit(harness, fixture.graph)
    assert.equal(response.status, 400, fixture.name)
    assert.match(response.body.error, fixture.error, fixture.name)
  }
})

test('an Input-only graph applies defaults and resolves without spawning a worker', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const response = await submit(harness, graph([
    { id: 'number', toolId: 'input.number', toolVersion: 1, parameters: {} },
  ]))
  assert.equal(response.status, 202)
  const run = await waitForRun(harness.origin, response.body.runId)
  assert.equal(run.status, 'completed')
  assert.equal(run.progress, 1)
  assert.equal(run.nodes.number.status, 'succeeded')
  assert.deepEqual(await harness.calls(), [])
  const result = await request(harness.origin, `/ateli/results/${run.nodes.number.outputs.number}`)
  assert.equal(result.body.kind, 'number')
  assert.equal(result.body.value, 0)
})

test('node scope executes only the target and its ancestors', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const source = await addSource(harness, harness.meshPath)
  const runGraph = graph([
    inputMesh(source.sourceId),
    optimize(),
    { id: 'render', toolId: 'mesh.render', toolVersion: 1, parameters: {} },
  ], [
    edge('input-optimize', 'input', 'mesh', 'optimize', 'mesh'),
    edge('optimize-render', 'optimize', 'mesh', 'render', 'mesh'),
  ])
  const response = await submit(harness, runGraph, { kind: 'node', nodeId: 'optimize' })
  assert.equal(response.status, 202)
  const run = await waitForRun(harness.origin, response.body.runId)
  assert.deepEqual(Object.keys(run.nodes), ['input', 'optimize'])
  assert.equal(run.nodes.input.status, 'succeeded')
  assert.equal(run.nodes.optimize.status, 'succeeded')
  // The uploaded mesh gets a bridge-arranged preview render; the scoped-out render node never runs.
  assert.deepEqual(await harness.calls(), ['mesh.render', 'mesh.optimize'])
  const inputResult = await request(harness.origin, `/ateli/results/${run.nodes.input.outputs.mesh}`)
  assert.equal(inputResult.body.previewUrl, `/ateli/results/${run.nodes.input.outputs.mesh}/preview`)
})

test('a second identical run uses the per-node cache', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const source = await addSource(harness, harness.meshPath)
  const runGraph = graph([
    inputMesh(source.sourceId),
    optimize(),
  ], [edge('input-optimize', 'input', 'mesh', 'optimize', 'mesh')])

  const firstSubmission = await submit(harness, runGraph)
  const first = await waitForRun(harness.origin, firstSubmission.body.runId)
  assert.equal(first.nodes.optimize.status, 'succeeded')
  const secondSubmission = await submit(harness, runGraph)
  const second = await waitForRun(harness.origin, secondSubmission.body.runId)
  assert.equal(second.nodes.input.status, 'cached')
  assert.equal(second.nodes.optimize.status, 'cached')
  assert.equal(second.progress, 1)
  // One preview render for the upload and one optimize on the first run; the second run is fully cached.
  assert.deepEqual(await harness.calls(), ['mesh.render', 'mesh.optimize'])
})

test('cancelling kills a slow worker and marks current and remaining nodes skipped', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const source = await addSource(harness, harness.meshPath)
  const runGraph = graph([
    inputMesh(source.sourceId),
    optimize('slow', 4),
    { id: 'textures', toolId: 'mesh.extractTextures', toolVersion: 1, parameters: {} },
  ], [
    edge('input-slow', 'input', 'mesh', 'slow', 'mesh'),
    edge('slow-textures', 'slow', 'mesh', 'textures', 'mesh'),
  ])
  const submission = await submit(harness, runGraph, { kind: 'graph' }, { cache: false })
  await waitForNode(harness.origin, submission.body.runId, 'slow', 'running')
  const cancelled = await request(harness.origin, `/ateli/runs/${submission.body.runId}/cancel`, { method: 'POST', body: {} })
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.body.status, 'cancelled')
  const run = await waitForRun(harness.origin, submission.body.runId)
  assert.equal(run.nodes.input.status, 'succeeded')
  assert.equal(run.nodes.slow.status, 'skipped')
  assert.equal(run.nodes.textures.status, 'skipped')
})

test('result metadata, downloads, and mesh and image previews use the declared routes', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const meshSource = await addSource(harness, harness.meshPath)
  const meshGraph = graph([
    inputMesh(meshSource.sourceId),
    optimize(),
  ], [edge('input-optimize', 'input', 'mesh', 'optimize', 'mesh')])
  const meshSubmission = await submit(harness, meshGraph)
  const meshRun = await waitForRun(harness.origin, meshSubmission.body.runId)
  const meshResultId = meshRun.nodes.optimize.outputs.mesh
  const meshMetadata = await request(harness.origin, `/ateli/results/${meshResultId}`)
  assert.equal(meshMetadata.status, 200)
  assert.equal(meshMetadata.body.kind, 'mesh')
  assert.equal(meshMetadata.body.previewUrl, `/ateli/results/${meshResultId}/preview`)
  const meshDownload = await request(harness.origin, meshMetadata.body.downloadUrl)
  assert.match(meshDownload.body, /^mesh:mesh\.optimize:/)
  const meshPreview = await request(harness.origin, meshMetadata.body.previewUrl)
  assert.equal(meshPreview.headers.get('content-type'), 'image/png')
  assert.equal(meshPreview.body, 'preview:mesh.optimize')

  const imageSource = await addSource(harness, harness.imagePath)
  const imageGraph = graph([
    { id: 'image-input', toolId: 'input.image', toolVersion: 1, parameters: { file: imageSource.sourceId } },
    { id: 'filter', toolId: 'image.filter', toolVersion: 1, parameters: { filter: 'invert' } },
  ], [edge('image-filter', 'image-input', 'image', 'filter', 'image')])
  const imageSubmission = await submit(harness, imageGraph)
  const imageRun = await waitForRun(harness.origin, imageSubmission.body.runId)
  const imageResultId = imageRun.nodes.filter.outputs.image
  const imageMetadata = await request(harness.origin, `/ateli/results/${imageResultId}`)
  const imagePreview = await request(harness.origin, imageMetadata.body.previewUrl)
  assert.equal(imagePreview.headers.get('content-type'), 'image/png')
  assert.equal(imagePreview.body, 'filtered:invert')
})

test('completed runs, results, and linked sources rehydrate after a restart', async t => {
  const harness = await createHarness()
  let second
  t.after(async () => {
    await second?.close()
    await rm(harness.root, { recursive: true, force: true })
  })
  const source = await addSource(harness, harness.meshPath)
  const runGraph = graph([inputMesh(source.sourceId), optimize()], [edge('input-optimize', 'input', 'mesh', 'optimize', 'mesh')])
  const submission = await submit(harness, runGraph)
  const original = await waitForRun(harness.origin, submission.body.runId)
  const resultId = original.nodes.optimize.outputs.mesh
  await harness.close({ remove: false })

  second = await openRouter(harness.root, harness.workerCommand)
  const restored = await request(second.origin, `/ateli/runs/${submission.body.runId}`)
  assert.equal(restored.status, 200)
  assert.deepEqual(restored.body, original)
  const result = await request(second.origin, `/ateli/results/${resultId}`)
  assert.equal(result.status, 200)
  const preview = await request(second.origin, result.body.previewUrl)
  assert.equal(preview.body, 'preview:mesh.optimize')
  // A saved document still references the source id; a fresh router must accept it without re-registration.
  const rerun = await submit({ origin: second.origin }, runGraph)
  assert.equal(rerun.status, 202)
  const rerunResult = await waitForRun(second.origin, rerun.body.runId)
  assert.equal(rerunResult.nodes.input.status, 'cached')
})

test('multipart source upload is content-addressed under staging sources', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const bytes = Buffer.from('uploaded-png')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'texture.png')
  const response = await fetch(`${harness.origin}/ateli/sources`, { method: 'POST', body: form })
  assert.equal(response.status, 200)
  const source = await response.json()
  assert.deepEqual(source, {
    sourceId: sha256,
    sha256,
    size: bytes.length,
    name: 'texture.png',
    kind: 'image',
  })
  const storedPath = path.join(harness.stagingRoot, 'sources', `${sha256}.png`)
  await access(storedPath)
  assert.equal((await stat(storedPath)).size, bytes.length)
  assert.deepEqual(await readFile(storedPath), bytes)
})
