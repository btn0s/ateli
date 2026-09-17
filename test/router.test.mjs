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

function inputMeshes(sourceIds, id = 'inputs') {
  return { id, toolId: 'input.meshes', toolVersion: 1, parameters: { files: sourceIds } }
}

function optimize(id = 'optimize', targetFaces = 80000) {
  return { id, toolId: 'mesh.optimize', toolVersion: 1, parameters: { topology: 'triangle', targetFaces } }
}

function edge(id, sourceNode, sourcePort, targetNode, targetPort) {
  return { id, source: { nodeId: sourceNode, portId: sourcePort }, target: { nodeId: targetNode, portId: targetPort } }
}

async function openRouter(root, workerCommand, exportRoots = {}) {
  const router = createAteliRouter({
    stagingRoot: path.join(root, 'staging'),
    allowedSourceRoots: [path.join(root, 'allowed')],
    exportRoots,
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
  const exportRoot = path.join(root, 'exports')
  await Promise.all([mkdir(allowedRoot, { recursive: true }), mkdir(exportRoot, { recursive: true })])
  const meshPath = path.join(allowedRoot, 'source.glb')
  const imagePath = path.join(allowedRoot, 'source.png')
  await writeFile(meshPath, 'source-mesh')
  await writeFile(imagePath, 'source-image')
  const callsPath = path.join(root, 'worker-calls.log')
  const imageWorkerPath = path.join(root, 'image-worker.mjs')
  const blenderWorkerPath = path.join(root, 'blender-worker.mjs')
  const meshyWorkerPath = path.join(root, 'meshy-worker.mjs')
  const gltfWorkerPath = path.join(root, 'gltf-worker.mjs')

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
  await writeFile(path.join(request.outputDir, 'mesh.glb'), 'mesh:' + request.toolId + ':' + request.inputs.targetFaces + (request.index === undefined ? '' : ':' + request.index))
  await writeFile(path.join(request.outputDir, 'mesh.preview.png'), 'preview:' + request.toolId)
  outputs.mesh = 'mesh.glb'
  outputs.preview = { mesh: 'mesh.preview.png' }
} else if (request.toolId === 'mesh.extractTextures') {
  for (const name of ['baseColor', 'roughness', 'metallic', 'normal']) {
    await writeFile(path.join(request.outputDir, name + '.png'), 'image:' + name)
    outputs[name] = name + '.png'
  }
} else if (request.toolId === 'mesh.bake') {
  // Mirrors the real worker: a channel switched off produces no file at all.
  await writeFile(path.join(request.outputDir, 'mesh.glb'), 'mesh:bake')
  await writeFile(path.join(request.outputDir, 'mesh.preview.png'), 'preview:bake')
  outputs.mesh = 'mesh.glb'
  outputs.preview = { mesh: 'mesh.preview.png' }
  for (const [channel, flag] of [['baseColor', 'bakeBaseColor'], ['roughness', 'bakeRoughness'], ['metallic', 'bakeMetallic'], ['normal', 'bakeNormal'], ['ao', 'bakeAO']]) {
    if (request.inputs[flag] === false) continue
    await writeFile(path.join(request.outputDir, channel + '.png'), 'image:' + channel)
    outputs[channel] = channel + '.png'
  }
} else if (request.toolId === 'mesh.render') {
  await writeFile(path.join(request.outputDir, 'image.png'), 'render')
  outputs.image = 'image.png'
} else {
  throw new Error('unexpected blender tool ' + request.toolId)
}
await writeFile(path.join(request.outputDir, 'outputs.json'), JSON.stringify(outputs))
`)
  await writeFile(meshyWorkerPath, `
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const request = JSON.parse(await readFile(process.argv[2], 'utf8'))
await appendFile(process.env.ATELI_CALLS, request.toolId + '\\n')
if (request.toolId !== 'mesh.fromImage') throw new Error('unexpected Meshy tool ' + request.toolId)
await writeFile(path.join(request.outputDir, 'mesh.glb'), 'meshy-mesh')
await writeFile(path.join(request.outputDir, 'mesh.preview.png'), 'meshy-preview')
await writeFile(path.join(request.outputDir, 'meshy.json'), JSON.stringify({
  taskId: 'fake-meshy-task',
  request: { ai_model: request.inputs.model, should_texture: request.inputs.texture },
  consumedCredits: 30,
  createdAt: '2026-09-16T00:00:00.000Z',
}))
await writeFile(path.join(request.outputDir, 'outputs.json'), JSON.stringify({
  mesh: 'mesh.glb',
  preview: { mesh: 'mesh.preview.png' },
  meta: { mesh: 'meshy.json' },
}))
`)
  await writeFile(gltfWorkerPath, `
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const request = JSON.parse(await readFile(process.argv[2], 'utf8'))
await appendFile(process.env.ATELI_CALLS, request.toolId + '\\n')
if (request.toolId !== 'mesh.compress') throw new Error('unexpected glTF tool ' + request.toolId)
await writeFile(path.join(request.outputDir, 'mesh.glb'), 'compressed-mesh')
await writeFile(path.join(request.outputDir, 'mesh.preview.png'), 'compressed-preview')
await writeFile(path.join(request.outputDir, 'compress.json'), JSON.stringify({
  bytesIn: 1000,
  bytesOut: 200,
  triangles: 12,
  textures: [],
  extensionsUsed: ['EXT_meshopt_compression'],
}))
await writeFile(path.join(request.outputDir, 'outputs.json'), JSON.stringify({
  mesh: 'mesh.glb',
  preview: { mesh: 'mesh.preview.png' },
  meta: { mesh: 'compress.json' },
}))
`)


  const workerCommand = ({ runtime, requestPath }) => ({
    executable: process.execPath,
    args: [runtime === 'blender' ? blenderWorkerPath : runtime === 'meshy' ? meshyWorkerPath : runtime === 'gltf' ? gltfWorkerPath : imageWorkerPath, requestPath],
    env: { ...process.env, ATELI_CALLS: callsPath },
  })
  const opened = await openRouter(root, workerCommand, { test: exportRoot })
  return {
    root,
    allowedRoot,
    stagingRoot,
    exportRoot,
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

async function addMeshSources(harness, names = ['alpha.glb', 'beta.glb', 'gamma.glb']) {
  const sourceIds = []
  for (const [index, name] of names.entries()) {
    const filePath = path.join(harness.allowedRoot, name)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `source-mesh-${index}`)
    sourceIds.push((await addSource(harness, filePath)).sourceId)
  }
  return sourceIds
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

test('an unfinished node outside the scope does not block the run', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const source = await addSource(harness, harness.meshPath)
  // A Bake left dangling on the board with nothing wired to its required inputs.
  const runGraph = graph([
    inputMesh(source.sourceId),
    optimize(),
    { id: 'bake', toolId: 'mesh.bake', toolVersion: 1, parameters: {} },
  ], [edge('input-optimize', 'input', 'mesh', 'optimize', 'mesh')])
  const scoped = await submit(harness, runGraph, { kind: 'downstream', nodeId: 'input' })
  assert.equal(scoped.status, 202)
  const run = await waitForRun(harness.origin, scoped.body.runId)
  assert.equal(run.status, 'completed')
  assert.deepEqual(Object.keys(run.nodes), ['input', 'optimize'])
  // Running the whole board still asks for the Bake's inputs.
  const whole = await submit(harness, runGraph)
  assert.equal(whole.status, 400)
  assert.match(whole.body.error, /missing required input bake\.high/)
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

test('mesh.fromImage exposes Meshy task metadata on its mesh result', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const source = await addSource(harness, harness.imagePath)
  const runGraph = graph([
    { id: 'image-input', toolId: 'input.image', toolVersion: 1, parameters: { file: source.sourceId } },
    { id: 'from-image', toolId: 'mesh.fromImage', toolVersion: 1, parameters: {} },
  ], [edge('image-to-mesh', 'image-input', 'image', 'from-image', 'image')])

  const submission = await submit(harness, runGraph)
  assert.equal(submission.status, 202)
  const run = await waitForRun(harness.origin, submission.body.runId)
  assert.equal(run.status, 'completed')
  const result = await request(harness.origin, `/ateli/results/${run.nodes['from-image'].outputs.mesh}`)
  assert.equal(result.status, 200)
  assert.equal(result.body.meta.taskId, 'fake-meshy-task')
  assert.equal(result.body.meta.consumedCredits, 30)
  assert.equal(result.body.previewUrl, `/ateli/results/${result.body.resultId}/preview`)
})
test('mesh.compress runs through the glTF worker and exposes compression metadata', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const source = await addSource(harness, harness.meshPath)
  const runGraph = graph([
    inputMesh(source.sourceId),
    { id: 'compress', toolId: 'mesh.compress', toolVersion: 1, parameters: {} },
  ], [edge('mesh-to-compress', 'input', 'mesh', 'compress', 'mesh')])

  const submission = await submit(harness, runGraph)
  assert.equal(submission.status, 202)
  const run = await waitForRun(harness.origin, submission.body.runId)
  assert.equal(run.status, 'completed')
  const result = await request(harness.origin, `/ateli/results/${run.nodes.compress.outputs.mesh}`)
  assert.equal(result.status, 200)
  assert.equal(result.body.meta.bytesOut, 200)
  assert.equal(result.body.previewUrl, `/ateli/results/${result.body.resultId}/preview`)
  assert.deepEqual(await harness.calls(), ['mesh.render', 'mesh.compress'])
})


test('output.export validation requires one file input and rejects unsafe names', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const catalog = await request(harness.origin, '/ateli/tools')
  const exportTool = catalog.body.find(tool => tool.id === 'output.export')
  assert.deepEqual(exportTool.inputs.find(input => input.id === 'folder').options, ['test'])

  const cases = [
    {
      name: 'neither input',
      graph: graph([
        { id: 'export', toolId: 'output.export', toolVersion: 1, parameters: { folder: 'test', name: 'asset' } },
      ]),
      error: /requires exactly one of mesh or image/,
    },
    {
      name: 'both inputs',
      graph: graph([
        { id: 'mesh-input', toolId: 'input.mesh', toolVersion: 1, parameters: { file: 'unused-mesh' } },
        { id: 'image-input', toolId: 'input.image', toolVersion: 1, parameters: { file: 'unused-image' } },
        { id: 'export', toolId: 'output.export', toolVersion: 1, parameters: { folder: 'test', name: 'asset' } },
      ], [
        edge('mesh-export', 'mesh-input', 'mesh', 'export', 'mesh'),
        edge('image-export', 'image-input', 'image', 'export', 'image'),
      ]),
      error: /requires exactly one of mesh or image/,
    },
    {
      name: 'path traversal',
      graph: graph([
        { id: 'mesh-input', toolId: 'input.mesh', toolVersion: 1, parameters: { file: 'unused-mesh' } },
        { id: 'export', toolId: 'output.export', toolVersion: 1, parameters: { folder: 'test', name: '../x' } },
      ], [edge('mesh-export', 'mesh-input', 'mesh', 'export', 'mesh')]),
      error: /invalid export name/,
    },
  ]

  for (const fixture of cases) {
    const response = await submit(harness, fixture.graph)
    assert.equal(response.status, 400, fixture.name)
    assert.match(response.body.error, fixture.error, fixture.name)
  }
})

test('output.export writes the artifact and full ancestor provenance and enforces safe overwrite', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const imageSource = await addSource(harness, harness.imagePath)
  const runGraph = graph([
    { id: 'image-input', toolId: 'input.image', toolVersion: 1, parameters: { file: imageSource.sourceId } },
    { id: 'from-image', toolId: 'mesh.fromImage', toolVersion: 1, parameters: {} },
    optimize(),
    { id: 'export', toolId: 'output.export', toolVersion: 1, parameters: { folder: 'test', name: 'hero' } },
  ], [
    edge('image-from-image', 'image-input', 'image', 'from-image', 'image'),
    edge('from-image-optimize', 'from-image', 'mesh', 'optimize', 'mesh'),
    edge('optimize-export', 'optimize', 'mesh', 'export', 'mesh'),
  ])

  const submission = await submit(harness, runGraph)
  const run = await waitForRun(harness.origin, submission.body.runId)
  assert.equal(run.status, 'completed')
  const destination = path.join(harness.exportRoot, 'hero.glb')
  assert.equal(await readFile(destination, 'utf8'), 'mesh:mesh.optimize:80000')
  const pathResult = await request(harness.origin, `/ateli/results/${run.nodes.export.outputs.path}`)
  assert.equal(pathResult.body.value, destination)

  const provenance = JSON.parse(await readFile(path.join(harness.exportRoot, 'hero.provenance.json'), 'utf8'))
  assert.equal(provenance.sha256, createHash('sha256').update('mesh:mesh.optimize:80000').digest('hex'))
  assert.equal(provenance.size, Buffer.byteLength('mesh:mesh.optimize:80000'))
  assert.equal(provenance.runId, submission.body.runId)
  assert.equal(provenance.nodeId, 'export')
  assert.deepEqual(provenance.upstream.map(item => [item.nodeId, item.toolId]), [
    ['image-input', 'input.image'],
    ['from-image', 'mesh.fromImage'],
    ['optimize', 'mesh.optimize'],
  ])
  assert.match(provenance.upstream[0].inputHashes.file, /^[a-f0-9]{64}$/)
  assert.match(provenance.upstream[1].inputHashes.image, /^[a-f0-9]{64}$/)
  assert.match(provenance.upstream[2].inputHashes.mesh, /^[a-f0-9]{64}$/)
  assert.equal(provenance.meta.taskId, 'fake-meshy-task')

  const repeatedSubmission = await submit(harness, runGraph)
  const repeated = await waitForRun(harness.origin, repeatedSubmission.body.runId)
  assert.equal(repeated.status, 'completed')
  assert.equal(repeated.nodes.export.status, 'succeeded')

  const meshSource = await addSource(harness, harness.meshPath)
  await writeFile(path.join(harness.exportRoot, 'conflict.glb'), 'different-mesh')
  const conflictGraph = graph([
    inputMesh(meshSource.sourceId),
    { id: 'export', toolId: 'output.export', toolVersion: 1, parameters: { folder: 'test', name: 'conflict' } },
  ], [edge('input-export', 'input', 'mesh', 'export', 'mesh')])
  const conflictSubmission = await submit(harness, conflictGraph)
  const conflict = await waitForRun(harness.origin, conflictSubmission.body.runId)
  assert.equal(conflict.status, 'failed')
  assert.match(conflict.nodes.export.error, /exists with different contents/)
  assert.equal(await readFile(path.join(harness.exportRoot, 'conflict.glb'), 'utf8'), 'different-mesh')
})

test('a node may omit outputs it was configured not to produce, and the cache honours that', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const source = await addSource(harness, harness.meshPath)
  const bake = { id: 'bake', toolId: 'mesh.bake', toolVersion: 1, parameters: { resolution: 512, bakeBaseColor: true, bakeRoughness: false, bakeMetallic: false, bakeNormal: true, bakeAO: false, aoSamples: 8, margin: 4, rayDistance: 0 } }
  const runGraph = graph([inputMesh(source.sourceId, 'high'), inputMesh(source.sourceId, 'low'), bake], [
    edge('high-bake', 'high', 'mesh', 'bake', 'high'),
    edge('low-bake', 'low', 'mesh', 'bake', 'low'),
  ])
  const first = await waitForRun(harness.origin, (await submit(harness, runGraph)).body.runId)
  assert.equal(first.nodes.bake.status, 'succeeded', JSON.stringify(first.nodes.bake))
  assert.deepEqual(Object.keys(first.nodes.bake.outputs).sort(), ['baseColor', 'mesh', 'normal'])
  const second = await waitForRun(harness.origin, (await submit(harness, runGraph)).body.runId)
  assert.equal(second.nodes.bake.status, 'cached')
  assert.deepEqual(Object.keys(second.nodes.bake.outputs).sort(), ['baseColor', 'mesh', 'normal'])
})

test('fan-out executes each mesh item and caches iterations independently', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const sourceIds = await addMeshSources(harness)
  const runGraph = graph([
    inputMeshes(sourceIds),
    optimize(),
  ], [edge('inputs-optimize', 'inputs', 'meshes', 'optimize', 'mesh')])

  const first = await waitForRun(harness.origin, (await submit(harness, runGraph)).body.runId)
  assert.equal(first.status, 'completed')
  assert.equal(first.nodes.optimize.status, 'succeeded')
  assert.deepEqual(first.nodes.optimize.items, { total: 3, done: 3, failed: 0 })
  const listResult = await request(harness.origin, `/ateli/results/${first.nodes.optimize.outputs.mesh}`)
  assert.equal(listResult.status, 200)
  assert.equal(listResult.body.kind, 'mesh[]')
  assert.equal(listResult.body.items.length, 3)
  assert.equal(new Set(listResult.body.items.map(item => item.resultId)).size, 3)
  const downloads = await Promise.all(listResult.body.items.map(item => request(harness.origin, item.downloadUrl)))
  assert.deepEqual(downloads.map(result => result.body), [
    'mesh:mesh.optimize:80000:0',
    'mesh:mesh.optimize:80000:1',
    'mesh:mesh.optimize:80000:2',
  ])
  const preview = await request(harness.origin, `/ateli/results/${listResult.body.resultId}/preview`)
  assert.equal(preview.body, 'preview:mesh.optimize')
  assert.equal((await harness.calls()).filter(toolId => toolId === 'mesh.optimize').length, 3)

  const second = await waitForRun(harness.origin, (await submit(harness, runGraph)).body.runId)
  assert.equal(second.nodes.optimize.status, 'cached')
  assert.deepEqual(second.nodes.optimize.items, { total: 3, done: 3, failed: 0 })
  assert.equal((await harness.calls()).filter(toolId => toolId === 'mesh.optimize').length, 3)
})

test('fan-out rejects mismatched input list lengths', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const meshSourceIds = await addMeshSources(harness)
  const imageSourceIds = []
  for (const [index, name] of ['albedo-a.png', 'albedo-b.png'].entries()) {
    const filePath = path.join(harness.allowedRoot, name)
    await writeFile(filePath, `source-image-${index}`)
    imageSourceIds.push((await addSource(harness, filePath)).sourceId)
  }
  const runGraph = graph([
    inputMeshes(meshSourceIds, 'meshes'),
    { id: 'images', toolId: 'input.images', toolVersion: 1, parameters: { files: imageSourceIds } },
    { id: 'apply', toolId: 'mesh.applyTextures', toolVersion: 1, parameters: {} },
  ], [
    edge('meshes-apply', 'meshes', 'meshes', 'apply', 'mesh'),
    edge('images-apply', 'images', 'images', 'apply', 'baseColor'),
  ])

  const run = await waitForRun(harness.origin, (await submit(harness, runGraph)).body.runId)
  assert.equal(run.status, 'failed')
  assert.equal(run.nodes.apply.status, 'failed')
  assert.match(run.nodes.apply.error, /fan-out lengths differ: mesh=3, baseColor=2/)
  assert.equal((await harness.calls()).filter(toolId => toolId === 'mesh.applyTextures').length, 0)
})

test('cancelling fan-out kills the current iteration and skips the remainder', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const sourceIds = await addMeshSources(harness)
  const runGraph = graph([
    inputMeshes(sourceIds),
    optimize('slow-batch', 4),
  ], [edge('inputs-slow', 'inputs', 'meshes', 'slow-batch', 'mesh')])
  const submission = await submit(harness, runGraph, { kind: 'graph' }, { cache: false })
  await waitForNode(harness.origin, submission.body.runId, 'slow-batch', 'running')
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !(await harness.calls()).includes('mesh.optimize')) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  const cancelled = await request(harness.origin, `/ateli/runs/${submission.body.runId}/cancel`, { method: 'POST', body: {} })
  assert.equal(cancelled.status, 200)
  const run = await waitForRun(harness.origin, submission.body.runId)
  assert.equal(run.status, 'cancelled')
  assert.equal(run.nodes['slow-batch'].status, 'skipped')
  assert.deepEqual(run.nodes['slow-batch'].items, { total: 3, done: 0, failed: 0 })
  assert.equal((await harness.calls()).filter(toolId => toolId === 'mesh.optimize').length, 1)
})

test('export fan-out expands item name, dir, index and ordinal templates', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  // A catalogue of same-named files: only the parent directory tells them apart.
  const sourceIds = await addMeshSources(harness, ['alpha/master.glb', 'beta/master.glb', 'gamma/master.glb'])
  const runGraph = graph([
    inputMeshes(sourceIds),
    { id: 'export', toolId: 'output.export', toolVersion: 1, parameters: { folder: 'test', name: '{dir}-{name}-{index}-{n}' } },
  ], [edge('inputs-export', 'inputs', 'meshes', 'export', 'mesh')])

  const run = await waitForRun(harness.origin, (await submit(harness, runGraph)).body.runId)
  assert.equal(run.status, 'completed')
  assert.deepEqual(run.nodes.export.items, { total: 3, done: 3, failed: 0 })
  const expectedPaths = ['alpha-master-0-1.glb', 'beta-master-1-2.glb', 'gamma-master-2-3.glb'].map(name => path.join(harness.exportRoot, name))
  assert.deepEqual(await Promise.all(expectedPaths.map(filePath => readFile(filePath, 'utf8'))), [
    'source-mesh-0',
    'source-mesh-1',
    'source-mesh-2',
  ])
  const pathResult = await request(harness.origin, `/ateli/results/${run.nodes.export.outputs.path}`)
  assert.equal(pathResult.body.kind, 'text[]')
  assert.deepEqual(pathResult.body.items.map(item => item.value), expectedPaths)
})

test('list utilities collect pick and count without subprocesses', async t => {
  const harness = await createHarness()
  t.after(() => harness.close())
  const catalog = await request(harness.origin, '/ateli/tools')
  assert.equal(catalog.status, 200)
  const utilityIds = catalog.body.filter(tool => tool.category === 'Utility').map(tool => tool.id)
  assert.deepEqual(utilityIds, [
    'list.collectMeshes',
    'list.collectImages',
    'list.pickMesh',
    'list.pickImage',
    'list.countMeshes',
    'list.countImages',
  ])
  assert.equal(catalog.body.find(tool => tool.id === 'input.meshes').outputs[0].type, 'mesh[]')
  assert.equal(catalog.body.find(tool => tool.id === 'list.pickImage').inputs[0].type, 'image[]')

  const sourceIds = await addMeshSources(harness)
  const runGraph = graph([
    inputMeshes(sourceIds),
    { id: 'collect', toolId: 'list.collectMeshes', toolVersion: 1, parameters: {} },
    { id: 'pick', toolId: 'list.pickMesh', toolVersion: 1, parameters: { index: 1 } },
    { id: 'count', toolId: 'list.countMeshes', toolVersion: 1, parameters: {} },
  ], [
    edge('inputs-collect', 'inputs', 'meshes', 'collect', 'item'),
    edge('collect-pick', 'collect', 'list', 'pick', 'list'),
    edge('collect-count', 'collect', 'list', 'count', 'list'),
  ])

  const run = await waitForRun(harness.origin, (await submit(harness, runGraph)).body.runId)
  assert.equal(run.status, 'completed')
  const collected = await request(harness.origin, `/ateli/results/${run.nodes.collect.outputs.list}`)
  assert.equal(collected.body.kind, 'mesh[]')
  assert.equal(collected.body.items.length, 3)
  const picked = await request(harness.origin, `/ateli/results/${run.nodes.pick.outputs.item}`)
  assert.equal((await request(harness.origin, picked.body.downloadUrl)).body, 'source-mesh-1')
  const count = await request(harness.origin, `/ateli/results/${run.nodes.count.outputs.count}`)
  assert.equal(count.body.value, 3)
  assert.equal((await harness.calls()).filter(toolId => toolId !== 'mesh.render').length, 0)
})
