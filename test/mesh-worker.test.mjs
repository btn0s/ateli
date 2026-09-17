import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

const ROOT = path.resolve(import.meta.dirname, '..')
const BLENDER = '/opt/homebrew/bin/blender'
const WORKER = path.join(ROOT, 'executor/mesh-worker.py')
const CANONICAL = '/Users/btnorris/dev/games/last-light/client/public/character-experiments/drifters-light-default/meshy-7-master-raw.glb'
const HAS_BLENDER = existsSync(BLENDER)

async function runWorker(t, toolId, inputs) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `ateli-${toolId.replaceAll('.', '-')}-`))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const requestPath = path.join(directory, 'request.json')
  await writeFile(requestPath, JSON.stringify({
    runId: 'test-run',
    nodeId: `shape:${toolId}`,
    toolId,
    inputs,
    outputDir: directory,
  }))
  const child = spawn(BLENDER, ['--background', '--factory-startup', '--python', WORKER, '--', requestPath], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  assert.equal(code, 0, `Blender exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  const outputs = JSON.parse(await readFile(path.join(directory, 'outputs.json'), 'utf8'))
  return { directory, outputs, stdout, stderr }
}

function parseGlb(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF')
  assert.equal(buffer.readUInt32LE(4), 2)
  let offset = 12
  let json
  let binary
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4E4F534A) json = JSON.parse(data.toString('utf8').trim())
    if (type === 0x004E4942) binary = data
    offset += 8 + length
  }
  assert.ok(json, 'GLB has a JSON chunk')
  assert.ok(binary, 'GLB has a binary chunk')
  return { json, binary }
}

function glbTriangleCount({ json }) {
  let triangles = 0
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      assert.equal(primitive.mode ?? 4, 4, 'primitive is TRIANGLES')
      const accessorIndex = primitive.indices ?? primitive.attributes.POSITION
      const count = json.accessors[accessorIndex].count
      triangles += count / 3
    }
  }
  return triangles
}

function glbPositionBounds({ json }) {
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = json.accessors[primitive.attributes.POSITION]
      assert.ok(accessor.min && accessor.max, 'POSITION accessor exposes bounds')
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis], accessor.min[axis])
        maximum[axis] = Math.max(maximum[axis], accessor.max[axis])
      }
    }
  }
  return { minimum, maximum }
}

const ACCESSOR_COMPONENTS = new Map([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
])

const COMPONENT_BYTES = new Map([
  [5120, 1],
  [5121, 1],
  [5122, 2],
  [5123, 2],
  [5125, 4],
  [5126, 4],
])

function readComponent(view, offset, componentType) {
  if (componentType === 5120) return view.getInt8(offset)
  if (componentType === 5121) return view.getUint8(offset)
  if (componentType === 5122) return view.getInt16(offset, true)
  if (componentType === 5123) return view.getUint16(offset, true)
  if (componentType === 5125) return view.getUint32(offset, true)
  if (componentType === 5126) return view.getFloat32(offset, true)
  assert.fail(`unsupported accessor component type ${componentType}`)
}

function readAccessor(asset, accessorIndex) {
  const accessor = asset.json.accessors[accessorIndex]
  assert.equal(accessor.sparse, undefined, 'sparse accessors are not expected in Blender GLBs')
  const bufferView = asset.json.bufferViews[accessor.bufferView]
  const components = ACCESSOR_COMPONENTS.get(accessor.type)
  const componentBytes = COMPONENT_BYTES.get(accessor.componentType)
  assert.ok(components, `supported accessor type, got ${accessor.type}`)
  assert.ok(componentBytes, `supported component type, got ${accessor.componentType}`)
  const elementBytes = components * componentBytes
  const stride = bufferView.byteStride ?? elementBytes
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const view = new DataView(asset.binary.buffer, asset.binary.byteOffset, asset.binary.byteLength)
  return Array.from({ length: accessor.count }, (_, index) => {
    const elementOffset = start + index * stride
    return Array.from({ length: components }, (_, component) => (
      readComponent(view, elementOffset + component * componentBytes, accessor.componentType)
    ))
  })
}

function angleDegrees(origin, first, second) {
  const a = first.map((value, axis) => value - origin[axis])
  const b = second.map((value, axis) => value - origin[axis])
  const denominator = Math.hypot(...a) * Math.hypot(...b)
  if (denominator <= Number.EPSILON) return 0
  const cosine = a.reduce((sum, value, axis) => sum + value * b[axis], 0) / denominator
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI
}

function glbSliverRatio(asset) {
  let triangles = 0
  let slivers = 0
  for (const mesh of asset.json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      assert.equal(primitive.mode ?? 4, 4, 'primitive is TRIANGLES')
      const positions = readAccessor(asset, primitive.attributes.POSITION)
      const indices = primitive.indices === undefined
        ? Array.from({ length: positions.length }, (_, index) => index)
        : readAccessor(asset, primitive.indices).map(([index]) => index)
      assert.equal(indices.length % 3, 0)
      for (let offset = 0; offset < indices.length; offset += 3) {
        const a = positions[indices[offset]]
        const b = positions[indices[offset + 1]]
        const c = positions[indices[offset + 2]]
        const minimumAngle = Math.min(
          angleDegrees(a, b, c),
          angleDegrees(b, c, a),
          angleDegrees(c, a, b),
        )
        triangles += 1
        if (minimumAngle < 5) slivers += 1
      }
    }
  }
  assert.ok(triangles > 0, 'GLB contains triangles')
  return slivers / triangles
}

function decodePng(buffer) {
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  let offset = 8
  let width
  let height
  let bitDepth
  let colorType
  let interlace
  const compressed = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      compressed.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }
  assert.equal(bitDepth, 8)
  assert.equal(interlace, 0)
  const channels = new Map([[0, 1], [2, 3], [4, 2], [6, 4]]).get(colorType)
  assert.ok(channels, `supported PNG color type, got ${colorType}`)
  const raw = inflateSync(Buffer.concat(compressed))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  let sourceOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset]
    sourceOffset += 1
    const rowOffset = y * stride
    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[sourceOffset + x]
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0
      const up = y > 0 ? pixels[rowOffset - stride + x] : 0
      const upperLeft = y > 0 && x >= channels ? pixels[rowOffset - stride + x - channels] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upperLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upperLeft)
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft
      } else assert.equal(filter, 0, `supported PNG filter, got ${filter}`)
      pixels[rowOffset + x] = (encoded + predictor) & 0xff
    }
    sourceOffset += stride
  }
  return { width, height, channels, pixels }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type)
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  name.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return chunk
}

function solidPng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    rows[row] = 0
    for (let x = 0; x < width; x += 1) Buffer.from(rgba).copy(rows, row + 1 + x * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

let decimateSliverRatio

test('mesh.optimize decimate reaches 20,000 triangles and emits a preview', { skip: !HAS_BLENDER, timeout: 60_000 }, async (t) => {
  const run = await runWorker(t, 'mesh.optimize', {
    mesh: { path: CANONICAL },
    engine: 'decimate',
    topology: 'triangle',
    targetFaces: 20_000,
  })
  const asset = parseGlb(await readFile(path.join(run.directory, run.outputs.mesh)))
  const triangles = glbTriangleCount(asset)
  assert.ok(Math.abs(triangles - 20_000) <= 400, `got ${triangles} triangles`)
  decimateSliverRatio = glbSliverRatio(asset)
  const meta = JSON.parse(await readFile(path.join(run.directory, run.outputs.meta.mesh), 'utf8'))
  assert.equal(meta.engineRequested, 'decimate')
  assert.equal(meta.engineUsed, 'decimate')
  assert.equal(meta.outputTriangles, triangles)
  assert.equal(meta.hasUVs, true)
  const preview = decodePng(await readFile(path.join(run.directory, run.outputs.preview.mesh)))
  assert.deepEqual([preview.width, preview.height], [512, 512])
})

test('mesh.optimize quadriflow avoids sliver triangles at a 20,000 triangle target', { skip: !HAS_BLENDER, timeout: 60_000 }, async (t) => {
  const run = await runWorker(t, 'mesh.optimize', {
    mesh: { path: CANONICAL },
    engine: 'quadriflow',
    topology: 'triangle',
    targetFaces: 20_000,
  })
  const asset = parseGlb(await readFile(path.join(run.directory, run.outputs.mesh)))
  const triangles = glbTriangleCount(asset)
  assert.ok(Math.abs(triangles - 20_000) <= 2_000, `got ${triangles} triangles`)
  assert.deepEqual(run.outputs.meta, { mesh: 'optimize.json' })
  const meta = JSON.parse(await readFile(path.join(run.directory, run.outputs.meta.mesh), 'utf8'))
  assert.equal(meta.engineRequested, 'quadriflow')
  assert.ok(['quadriflow', 'voxel'].includes(meta.engineUsed), `unexpected engineUsed ${meta.engineUsed}`)
  if (meta.engineUsed === 'voxel') {
    const fallback = run.stdout.split('\n').find((line) => line.includes('quadriflow failed'))
    assert.match(fallback ?? '', /quadriflow failed .* falling back to voxel/)
    console.log(`quadriflow fallback: ${fallback}`)
  }
  assert.equal(meta.outputTriangles, triangles)
  assert.equal(meta.hasUVs, false)
  const quadriflowSliverRatio = glbSliverRatio(asset)
  assert.ok(quadriflowSliverRatio < 0.02, `quadriflow sliver ratio was ${(quadriflowSliverRatio * 100).toFixed(3)}%`)
  assert.notEqual(decimateSliverRatio, undefined, 'decimate sliver ratio was measured first')
  console.log(`sliver ratios (minimum angle < 5°): quadriflow=${(quadriflowSliverRatio * 100).toFixed(3)}% decimate=${(decimateSliverRatio * 100).toFixed(3)}%`)
  console.log(`quadriflow optimize.json meta: ${JSON.stringify(meta)}`)
})

test('mesh.optimize voxel reaches 20,000 triangles and discards UVs', { skip: !HAS_BLENDER, timeout: 60_000 }, async (t) => {
  const run = await runWorker(t, 'mesh.optimize', {
    mesh: { path: CANONICAL },
    engine: 'voxel',
    topology: 'triangle',
    targetFaces: 20_000,
    voxelSize: 0.02,
  })
  const asset = parseGlb(await readFile(path.join(run.directory, run.outputs.mesh)))
  const triangles = glbTriangleCount(asset)
  assert.ok(Math.abs(triangles - 20_000) <= 2_000, `got ${triangles} triangles`)
  const meta = JSON.parse(await readFile(path.join(run.directory, run.outputs.meta.mesh), 'utf8'))
  assert.equal(meta.engineRequested, 'voxel')
  assert.equal(meta.engineUsed, 'voxel')
  assert.equal(meta.outputTriangles, triangles)
  assert.equal(meta.hasUVs, false)
  assert.match(run.stdout, /voxel remesh .* produced \d+ triangle\(s\) before decimation/)
})

test('mesh.extractTextures writes four PNG channels with OpenGL normals', { skip: !HAS_BLENDER, timeout: 600_000 }, async (t) => {
  const run = await runWorker(t, 'mesh.extractTextures', { mesh: { path: CANONICAL } })
  for (const channel of ['baseColor', 'roughness', 'metallic', 'normal']) {
    const image = decodePng(await readFile(path.join(run.directory, run.outputs[channel])))
    assert.ok(image.width > 0 && image.height > 0)
  }
  const normal = decodePng(await readFile(path.join(run.directory, run.outputs.normal)))
  assert.ok(normal.channels >= 3)
  let blue = 0
  for (let offset = 2; offset < normal.pixels.length; offset += normal.channels) blue += normal.pixels[offset]
  const meanBlue = blue / (normal.pixels.length / normal.channels)
  assert.ok(meanBlue > 200, `normal mean blue was ${meanBlue}`)
})

test('mesh.applyTextures embeds a supplied base color image', { skip: !HAS_BLENDER, timeout: 600_000 }, async (t) => {
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'ateli-red-texture-'))
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }))
  const red = path.join(fixtureDirectory, 'red.png')
  await writeFile(red, solidPng(8, 8, [255, 0, 0, 255]))
  const run = await runWorker(t, 'mesh.applyTextures', {
    mesh: { path: CANONICAL },
    baseColor: { path: red },
    normalConvention: 'opengl',
  })
  const { json } = parseGlb(await readFile(path.join(run.directory, run.outputs.mesh)))
  assert.ok(json.images?.some((image) => Number.isInteger(image.bufferView)), 'GLB embeds an image bufferView')
})

// Regression: baked images were saved to disk but exported as their GENERATED default (0.8 grey), so the
// GLB carried no detail while the standalone PNG outputs looked right.
test('mesh.bake embeds the baked maps, not the generated defaults', { skip: !HAS_BLENDER, timeout: 900_000 }, async (t) => {
  const low = await runWorker(t, 'mesh.optimize', { mesh: { path: CANONICAL }, engine: 'voxel', targetFaces: 8000, topology: 'triangle', voxelSize: 0.02, preserveUVs: false })
  const run = await runWorker(t, 'mesh.bake', {
    high: { path: CANONICAL },
    low: { path: path.join(low.directory, low.outputs.mesh) },
    resolution: 512, bakeBaseColor: true, bakeRoughness: false, bakeMetallic: false, bakeNormal: true, bakeAO: false, aoSamples: 8, margin: 4,
  })
  const { json, binary } = parseGlb(await readFile(path.join(run.directory, run.outputs.mesh)))
  const material = json.materials[0]
  const embedded = (textureIndex) => {
    const image = json.images[json.textures[textureIndex].source]
    const view = json.bufferViews[image.bufferView]
    return decodePng(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))
  }
  const stats = ({ pixels, channels }) => {
    const sums = [0, 0, 0], squares = [0, 0, 0]
    const count = pixels.length / channels
    for (let i = 0; i < pixels.length; i += channels) for (let c = 0; c < 3; c += 1) { sums[c] += pixels[i + c]; squares[c] += pixels[i + c] ** 2 }
    return sums.map((sum, c) => ({ mean: sum / count, std: Math.sqrt(squares[c] / count - (sum / count) ** 2) }))
  }
  const base = stats(embedded(material.pbrMetallicRoughness.baseColorTexture.index))
  const normal = stats(embedded(material.normalTexture.index))
  const baseOnDisk = stats(decodePng(await readFile(path.join(run.directory, run.outputs.baseColor))))
  assert.ok(Math.abs(base[0].mean - baseOnDisk[0].mean) < 2, `embedded base color mean ${base[0].mean.toFixed(1)} should match the saved PNG ${baseOnDisk[0].mean.toFixed(1)}`)
  assert.ok(base[0].mean < 190, `embedded base color is the generated grey (${base[0].mean.toFixed(1)})`)
  assert.ok(normal[2].std > 5, `embedded normal map is flat (std ${normal[2].std.toFixed(2)})`)
})

test('mesh.render writes a 1024 square PNG', { skip: !HAS_BLENDER, timeout: 600_000 }, async (t) => {
  const run = await runWorker(t, 'mesh.render', {
    mesh: { path: CANONICAL },
    yaw: 35,
    pitch: 15,
    size: 1024,
  })
  const image = decodePng(await readFile(path.join(run.directory, run.outputs.image)))
  assert.deepEqual([image.width, image.height], [1024, 1024])
})

test('mesh.setOrigin bottom-center places the exported bbox floor at zero on the glTF up axis (+Y)', { skip: !HAS_BLENDER, timeout: 600_000 }, async (t) => {
  const run = await runWorker(t, 'mesh.setOrigin', {
    mesh: { path: CANONICAL },
    origin: 'bottom-center',
  })
  const json = parseGlb(await readFile(path.join(run.directory, run.outputs.mesh)))
  const { minimum } = glbPositionBounds(json)
  // glTF is Y-up; Blender converts Z-up back to Y-up on export. A floor at Z=0 here would mean a sideways asset.
  assert.ok(Math.abs(minimum[1]) < 1e-4, `bbox min y was ${minimum[1]}`)
})
