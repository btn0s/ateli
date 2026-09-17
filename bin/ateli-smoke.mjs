#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import path from 'node:path'
import { createAteliRouter } from '../server/router.mjs'

const sourcePath = '/Users/btnorris/dev/games/last-light/client/public/character-experiments/drifters-light-default/meshy-7-master-raw.glb'
const stagingRoot = '/Users/btnorris/dev/games/last-light/.scratch/ateli'
const blenderPath = '/opt/homebrew/bin/blender'

const router = createAteliRouter({
  blenderPath,
  stagingRoot,
  allowedSourceRoots: [path.dirname(sourcePath)],
})
const server = createServer((request, response) => {
  router.handle(request, response, new URL(request.url, `http://${request.headers.host}`))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const origin = `http://127.0.0.1:${address.port}`

async function jsonRequest(route, { method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : undefined
  if (!response.ok) throw new Error(`${method} ${route} failed (${response.status}): ${payload?.error ?? text}`)
  return payload
}

try {
  const source = await jsonRequest('/ateli/sources', { method: 'POST', body: { path: sourcePath } })
  assert.equal(source.kind, 'mesh')

  const graph = {
    schemaVersion: 1,
    nodes: [
      { id: 'input', toolId: 'input.mesh', toolVersion: 1, parameters: { file: source.sourceId } },
      { id: 'optimize', toolId: 'mesh.optimize', toolVersion: 1, parameters: { topology: 'triangle', targetFaces: 80000 } },
      { id: 'extract', toolId: 'mesh.extractTextures', toolVersion: 1, parameters: {} },
      { id: 'apply', toolId: 'mesh.applyTextures', toolVersion: 1, parameters: { normalConvention: 'opengl' } },
    ],
    edges: [
      { id: 'input-optimize', source: { nodeId: 'input', portId: 'mesh' }, target: { nodeId: 'optimize', portId: 'mesh' } },
      { id: 'optimize-extract', source: { nodeId: 'optimize', portId: 'mesh' }, target: { nodeId: 'extract', portId: 'mesh' } },
      { id: 'optimize-apply', source: { nodeId: 'optimize', portId: 'mesh' }, target: { nodeId: 'apply', portId: 'mesh' } },
      { id: 'base-color', source: { nodeId: 'extract', portId: 'baseColor' }, target: { nodeId: 'apply', portId: 'baseColor' } },
      { id: 'roughness', source: { nodeId: 'extract', portId: 'roughness' }, target: { nodeId: 'apply', portId: 'roughness' } },
      { id: 'metallic', source: { nodeId: 'extract', portId: 'metallic' }, target: { nodeId: 'apply', portId: 'metallic' } },
      { id: 'normal', source: { nodeId: 'extract', portId: 'normal' }, target: { nodeId: 'apply', portId: 'normal' } },
    ],
  }

  const submission = await jsonRequest('/ateli/runs', {
    method: 'POST',
    body: { graph, scope: { kind: 'graph' }, cache: false },
  })
  const deadline = Date.now() + 15 * 60 * 1000
  let run
  while (Date.now() < deadline) {
    run = await jsonRequest(`/ateli/runs/${submission.runId}`)
    if (['completed', 'failed', 'cancelled'].includes(run.status)) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!run || !['completed', 'failed', 'cancelled'].includes(run.status)) throw new Error(`run ${submission.runId} timed out`)
  if (run.status !== 'completed') {
    const errors = Object.entries(run.nodes).filter(([, node]) => node.error).map(([id, node]) => `${id}: ${node.error}`).join('; ')
    throw new Error(`run ${submission.runId} ${run.status}${errors ? ` — ${errors}` : ''}`)
  }
  for (const [nodeId, node] of Object.entries(run.nodes)) assert.equal(node.status, 'succeeded', `${nodeId} did not succeed`)

  const meshPreviews = {}
  for (const nodeId of ['optimize', 'apply']) {
    const resultId = run.nodes[nodeId].outputs.mesh
    assert.ok(resultId, `${nodeId} did not produce a mesh result`)
    const result = await jsonRequest(`/ateli/results/${resultId}`)
    assert.equal(result.kind, 'mesh')
    assert.ok(result.previewUrl, `${nodeId} mesh has no preview`)
    const preview = await fetch(`${origin}${result.previewUrl}`)
    assert.equal(preview.status, 200)
    assert.equal(preview.headers.get('content-type'), 'image/png')
    const bytes = (await preview.arrayBuffer()).byteLength
    assert.ok(bytes > 0, `${nodeId} preview is empty`)
    meshPreviews[nodeId] = { resultId, bytes, previewUrl: result.previewUrl }
  }

  console.log(JSON.stringify({
    runId: run.runId,
    status: run.status,
    progress: run.progress,
    nodes: Object.fromEntries(Object.entries(run.nodes).map(([id, node]) => [id, node.status])),
    meshPreviews,
  }, null, 2))
} finally {
  await router.close()
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
}
