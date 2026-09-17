import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { NodeIO, Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getGLPrimitiveCount } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'

const WORKER = path.resolve('executor/gltf-worker.mjs')
const FIXTURE = '/Users/btnorris/dev/ateli/.scratch/last-light/character-experiments/ateli-bake-test.glb'
const TRIANGLE_MODES = new Set([Primitive.Mode.TRIANGLES, Primitive.Mode.TRIANGLE_STRIP, Primitive.Mode.TRIANGLE_FAN])
const fixtureMissing = await access(FIXTURE).then(() => false, () => true)
const skip = fixtureMissing ? `fixture missing: ${FIXTURE}` : false

async function createIO() {
  await MeshoptDecoder.ready
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'draco3d.decoder': await draco3d.createDecoderModule(),
    })
}

function triangleCount(document) {
  let triangles = 0
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (TRIANGLE_MODES.has(primitive.getMode())) triangles += getGLPrimitiveCount(primitive)
    }
  }
  return triangles
}

async function runWorker(root, inputs) {
  const outputDir = path.join(root, 'output')
  await mkdir(outputDir, { recursive: true })
  const requestPath = path.join(outputDir, 'request.json')
  await writeFile(requestPath, `${JSON.stringify({
    runId: 'gltf-worker-test',
    nodeId: 'compress',
    toolId: 'mesh.compress',
    inputs: { mesh: { path: FIXTURE }, ...inputs },
    outputDir,
  }, null, 2)}\n`)
  const child = spawn(process.execPath, [WORKER, requestPath], {
    cwd: path.resolve('.'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  assert.equal(result.signal, null, `worker terminated by ${result.signal}\n${stderr}`)
  assert.equal(result.code, 0, `worker failed\nstdout: ${stdout}\nstderr: ${stderr}\nlog:\n${await readFile(path.join(outputDir, 'worker.log'), 'utf8').catch(() => '<missing>')}`)
  return outputDir
}

function textureSizes(document) {
  return document.getRoot().listTextures().map(texture => texture.getImage()?.byteLength ?? 0).sort((left, right) => left - right)
}

test('glTF worker compresses the baked fixture for the web', { skip, timeout: 10 * 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-gltf-worker-default-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const io = await createIO()
  const source = await io.read(FIXTURE)
  const sourceTriangles = triangleCount(source)
  const bytesIn = (await stat(FIXTURE)).size

  const outputDir = await runWorker(root, {})
  const outputPath = path.join(outputDir, 'mesh.glb')
  const bytesOut = (await stat(outputPath)).size
  console.log(`mesh.compress defaults: ${bytesIn} -> ${bytesOut}`)
  assert.ok(bytesOut < bytesIn * 0.25, `expected ${bytesOut} to be less than 25% of ${bytesIn}`)

  const output = await io.read(outputPath)
  const textures = output.getRoot().listTextures()
  assert.ok(textures.length > 0)
  for (const texture of textures) {
    assert.equal(texture.getMimeType(), 'image/webp')
    assert.deepEqual(texture.getSize(), [1024, 1024])
  }
  assert.ok(output.getRoot().listExtensionsUsed().some(extension => extension.extensionName === 'EXT_meshopt_compression'))
  assert.equal(triangleCount(output), sourceTriangles)

  const preview = await sharp(path.join(outputDir, 'mesh.preview.png')).metadata()
  assert.equal(preview.width, 512)
  assert.equal(preview.height, 512)
  const metadata = JSON.parse(await readFile(path.join(outputDir, 'compress.json'), 'utf8'))
  assert.equal(metadata.bytesIn, bytesIn)
  assert.equal(metadata.bytesOut, bytesOut)
  assert.equal(metadata.triangles, sourceTriangles)
  assert.equal(metadata.textures.length, textures.length)
  assert.ok(metadata.extensionsUsed.includes('EXT_meshopt_compression'))
})

test('glTF worker preserves PNG texture payloads when size and geometry are kept', { skip, timeout: 10 * 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-gltf-worker-keep-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const io = await createIO()
  const source = await io.read(FIXTURE)
  const sourceTextureSizes = textureSizes(source)
  const bytesIn = (await stat(FIXTURE)).size

  const outputDir = await runWorker(root, { textureFormat: 'png', textureSize: 'keep', geometry: 'none' })
  const outputPath = path.join(outputDir, 'mesh.glb')
  const bytesOut = (await stat(outputPath)).size
  console.log(`mesh.compress keep PNG: ${bytesIn} -> ${bytesOut}`)
  const output = await io.read(outputPath)
  assert.deepEqual(textureSizes(output), sourceTextureSizes)
  assert.ok(output.getRoot().listTextures().every(texture => texture.getMimeType() === 'image/png'))
  assert.ok(!output.getRoot().listExtensionsUsed().some(extension => extension.extensionName === 'EXT_meshopt_compression'))
  const preview = await sharp(path.join(outputDir, 'mesh.preview.png')).metadata()
  assert.equal(preview.width, 512)
  assert.equal(preview.height, 512)
})
