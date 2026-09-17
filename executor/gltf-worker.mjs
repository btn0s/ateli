#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access, appendFile, copyFile, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NodeIO, Primitive } from '@gltf-transform/core'
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
  EXTTextureWebP,
  KHRDracoMeshCompression,
  KHRTextureBasisu,
} from '@gltf-transform/extensions'
import {
  dedup,
  draco,
  flatten,
  getGLPrimitiveCount,
  getTextureColorSpace,
  join,
  meshopt,
  prune,
  quantize,
  resample,
  simplify,
  textureCompress,
} from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const BLENDER = process.env.ATELI_BLENDER_PATH || '/opt/homebrew/bin/blender'
const MESH_WORKER = path.resolve('executor/mesh-worker.py')
const GEOMETRY_OPTIONS = new Set(['meshopt', 'draco', 'none'])
const TEXTURE_SIZE_OPTIONS = new Set(['256', '512', '1024', '2048', 'keep'])
const TEST_PREVIEW = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8dKAAAAAElFTkSuQmCC', 'base64')
const TEXTURE_FORMAT_OPTIONS = new Set(['webp', 'jpeg', 'png', 'ktx2'])
const TRIANGLE_MODES = new Set([Primitive.Mode.TRIANGLES, Primitive.Mode.TRIANGLE_STRIP, Primitive.Mode.TRIANGLE_FAN])
const GLTF_EXTENSIONS = [...new Set([
  ...ALL_EXTENSIONS,
  EXTMeshoptCompression,
  KHRDracoMeshCompression,
  EXTTextureWebP,
  KHRTextureBasisu,
])]

let logPath

function enumInput(inputs, name, fallback, options) {
  const value = inputs[name] ?? fallback
  if (!options.has(value)) throw new Error(`input '${name}' must be one of ${[...options].join(', ')}`)
  return value
}

function numberInput(inputs, name, fallback, minimum, maximum) {
  const value = inputs[name] ?? fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`input '${name}' must be a number from ${minimum} to ${maximum}`)
  }
  return value
}

function booleanInput(inputs, name, fallback) {
  const value = inputs[name] ?? fallback
  if (typeof value !== 'boolean') throw new Error(`input '${name}' must be boolean`)
  return value
}

async function log(message) {
  await appendFile(logPath, `${String(message).replace(/\s+$/, '')}\n`)
}

function run(command, args, { label, stdio = 'pipe' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : stdio })
    const stdout = []
    const stderr = []
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr?.on('data', chunk => stderr.push(chunk))
    child.once('error', error => {
      if (error.code === 'ENOENT' && command === 'ktx') {
        reject(new Error("textureFormat 'ktx2' requires the 'ktx' CLI on PATH"))
      } else {
        reject(new Error(`${label || command} failed to start: ${error.message}`))
      }
    })
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })
        return
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim() || Buffer.concat(stdout).toString('utf8').trim()
      reject(new Error(`${label || command} failed${signal ? ` (${signal})` : ` with exit code ${code}`}${detail ? `: ${detail}` : ''}`))
    })
  })
}

async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
  const [dracoDecoder, dracoEncoder] = await Promise.all([
    draco3d.createDecoderModule(),
    draco3d.createEncoderModule(),
  ])
  return new NodeIO()
    .registerExtensions(GLTF_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
      'draco3d.decoder': dracoDecoder,
      'draco3d.encoder': dracoEncoder,
    })
}

async function stage(io, document, name, transform) {
  if (transform) await document.transform(transform)
  const bytes = await io.writeBinary(document)
  await log(`${name}: ${bytes.byteLength} bytes`)
  return bytes
}

function targetMimeType(format) {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function compressStandardTextures(document, textureFormat, textureSize, quality) {
  const resize = textureSize === 'keep' ? undefined : [Number(textureSize), Number(textureSize)]
  const mimeType = targetMimeType(textureFormat)
  const formats = textureSize === 'keep' ? new RegExp(`^(?!${escapedRegExp(mimeType)}$)`) : undefined
  await document.transform(textureCompress({
    encoder: sharp,
    targetFormat: textureFormat,
    resize,
    formats,
    quality,
  }))
}

async function compressKTX2Textures(document, textureSize, quality) {
  await run('ktx', ['--version'], { label: 'ktx availability check' })
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'ateli-ktx2-'))
  const previewImages = new Map()
  try {
    const limit = textureSize === 'keep' ? undefined : Number(textureSize)
    const qlevel = Math.round(1 + ((quality - 1) / 99) * 254)
    const textures = document.getRoot().listTextures()
    for (let index = 0; index < textures.length; index += 1) {
      const texture = textures[index]
      const image = texture.getImage()
      if (!image) continue
      const sourcePath = path.join(temporary, `${index}.png`)
      const outputPath = path.join(temporary, `${index}.ktx2`)
      let pipeline = sharp(image)
      if (limit) pipeline = pipeline.resize({ width: limit, height: limit, fit: 'inside', withoutEnlargement: true })
      await pipeline.ensureAlpha().png().toFile(sourcePath)
      previewImages.set(texture, await readFile(sourcePath))
      const colorSpace = getTextureColorSpace(texture) === 'srgb' ? 'SRGB' : 'UNORM'
      await run('ktx', [
        'create', '--format', `R8G8B8A8_${colorSpace}`, '--encode', 'basis-lz', '--qlevel', String(qlevel),
        sourcePath, outputPath,
      ], { label: `KTX2 compression for texture ${texture.getName() || index + 1}` })
      texture.setImage(await readFile(outputPath)).setMimeType('image/ktx2').setURI(`${texture.getName() || `texture-${index + 1}`}.ktx2`)
    }
    document.createExtension(KHRTextureBasisu).setRequired(true)
    return previewImages
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function createKTX2PreviewBytes(io, document, previewImages) {
  const states = [...previewImages].map(([texture, image]) => ({
    texture,
    image,
    ktx2Image: texture.getImage(),
    ktx2URI: texture.getURI(),
  }))
  const basisu = document.getRoot().listExtensionsUsed().find(extension => extension.extensionName === 'KHR_texture_basisu')
  basisu?.dispose()
  try {
    for (const { texture, image } of states) {
      texture.setImage(image).setMimeType('image/png').setURI(`${texture.getName() || 'texture'}.png`)
    }
    return await io.writeBinary(document)
  } finally {
    for (const { texture, ktx2Image, ktx2URI } of states) {
      texture.setImage(ktx2Image).setMimeType('image/ktx2').setURI(ktx2URI)
    }
    document.createExtension(KHRTextureBasisu).setRequired(true)
  }
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

function textureMetadata(document) {
  return document.getRoot().listTextures().map((texture, index) => {
    const image = texture.getImage()
    const [width, height] = texture.getSize() ?? [0, 0]
    return {
      name: texture.getName() || path.basename(texture.getURI() || `texture-${index + 1}`),
      width,
      height,
      format: texture.getMimeType().replace(/^image\//, ''),
      bytes: image?.byteLength ?? 0,
    }
  })
}

async function renderPreview(outputDir, meshBytes) {
  if (process.env.ATELI_SKIP_MESH_PREVIEW === '1') {
    await writeFile(path.join(outputDir, 'mesh.preview.png'), TEST_PREVIEW)
    return
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'ateli-gltf-preview-'))
  try {
    const previewMeshPath = path.join(temporary, 'mesh.glb')
    const requestPath = path.join(temporary, 'request.json')
    await writeFile(previewMeshPath, meshBytes)
    await writeFile(requestPath, `${JSON.stringify({
      runId: 'gltf-preview',
      nodeId: 'gltf-preview',
      toolId: 'mesh.render',
      inputs: { mesh: { path: previewMeshPath }, yaw: 35, pitch: 15, size: 512 },
      outputDir: temporary,
    }, null, 2)}\n`)
    const logHandle = await open(logPath, 'a')
    try {
      await run(BLENDER, ['--background', '--factory-startup', '--python', MESH_WORKER, '--', requestPath], {
        label: 'Blender preview render',
        stdio: ['ignore', logHandle.fd, logHandle.fd],
      })
    } finally {
      await logHandle.close()
    }
    await copyFile(path.join(temporary, 'image.png'), path.join(outputDir, 'mesh.preview.png'))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function absoluteMeshPath(input, name) {
  const filePath = input?.path
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error(`input '${name}' requires an absolute file path`)
  if (!['.glb', '.gltf'].includes(path.extname(filePath).toLowerCase())) throw new Error(`input '${name}' requires a GLB or glTF file`)
  return filePath
}

function nodeIndex(document) {
  const byName = new Map()
  for (const node of document.getRoot().listNodes()) {
    const name = node.getName()
    if (!name) continue
    if (byName.has(name)) throw new Error(`base mesh has duplicate node name '${name}'`)
    byName.set(name, node)
  }
  return byName
}

function cloneAccessor(document, buffer, accessor) {
  const source = accessor.getArray()
  if (!source) throw new Error('animation accessor has no data')
  return document.createAccessor(accessor.getName())
    .setType(accessor.getType())
    .setNormalized(accessor.getNormalized())
    .setArray(new source.constructor(source))
    .setBuffer(buffer)
}

async function mergeAnimations(io, basePath, clipPaths, outputDir) {
  const document = await io.read(basePath)
  const nodes = nodeIndex(document)
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer('animation-buffer')
  for (const animation of document.getRoot().listAnimations()) animation.dispose()
  const names = []
  for (const clipPath of clipPaths) {
    const clip = await io.read(clipPath)
    for (const [animationIndex, sourceAnimation] of clip.getRoot().listAnimations().entries()) {
      const name = sourceAnimation.getName() || `${path.parse(clipPath).name}${animationIndex ? `-${animationIndex + 1}` : ''}`
      const animation = document.createAnimation(name).setExtras({ ...sourceAnimation.getExtras() })
      names.push(name)
      for (const sourceChannel of sourceAnimation.listChannels()) {
        const targetName = sourceChannel.getTargetNode()?.getName()
        const target = nodes.get(targetName)
        if (!target) throw new Error(`clip '${path.basename(clipPath)}' targets unknown joint '${targetName || '<unnamed>'}'`)
        const sourceSampler = sourceChannel.getSampler()
        const sampler = document.createAnimationSampler()
          .setInterpolation(sourceSampler.getInterpolation())
          .setInput(cloneAccessor(document, buffer, sourceSampler.getInput()))
          .setOutput(cloneAccessor(document, buffer, sourceSampler.getOutput()))
        const channel = document.createAnimationChannel()
          .setSampler(sampler)
          .setTargetNode(target)
          .setTargetPath(sourceChannel.getTargetPath())
        animation.addSampler(sampler).addChannel(channel)
      }
    }
  }
  const bytes = await io.writeBinary(document)
  await writeFile(path.join(outputDir, 'mesh.glb'), bytes)
  await writeFile(path.join(outputDir, 'merge.json'), `${JSON.stringify({ animations: names }, null, 2)}\n`)
  await renderPreview(outputDir, bytes)
  await writeFile(path.join(outputDir, 'outputs.json'), `${JSON.stringify({
    mesh: 'mesh.glb',
    preview: { mesh: 'mesh.preview.png' },
    meta: { mesh: 'merge.json' },
    log: 'worker.log',
  }, null, 2)}\n`)
  await log(`animations=${names.join(',')}`)
}

async function main() {
  const requestPath = process.argv[2]
  if (!requestPath) throw new Error('usage: gltf-worker.mjs <request.json>')
  const job = JSON.parse(await readFile(requestPath, 'utf8'))
  if (!['mesh.compress', 'mesh.mergeAnimations'].includes(job.toolId)) throw new Error(`unsupported glTF tool: ${job.toolId}`)
  if (typeof job.outputDir !== 'string' || !job.outputDir) throw new Error('request.outputDir is required')
  const outputDir = path.resolve(job.outputDir)
  await mkdir(outputDir, { recursive: true })
  logPath = path.join(outputDir, 'worker.log')
  await writeFile(logPath, '')
  await log(`tool=${job.toolId} node=${job.nodeId ?? '<unknown>'}`)
  const io = await createIO()
  const inputs = job.inputs ?? {}

  if (job.toolId === 'mesh.mergeAnimations') {
    const basePath = absoluteMeshPath(inputs.base, 'base')
    if (!Array.isArray(inputs.clips) || inputs.clips.length === 0) throw new Error("input 'clips' requires at least one mesh")
    const clipPaths = inputs.clips.map((input, index) => absoluteMeshPath(input, `clips[${index}]`))
    await Promise.all([basePath, ...clipPaths].map(filePath => access(filePath)))
    await mergeAnimations(io, basePath, clipPaths, outputDir)
    return
  }

  const meshPath = absoluteMeshPath(inputs.mesh, 'mesh')
  await access(meshPath)
  const geometry = enumInput(inputs, 'geometry', 'meshopt', GEOMETRY_OPTIONS)
  const textureSize = enumInput(inputs, 'textureSize', '1024', TEXTURE_SIZE_OPTIONS)
  const textureFormat = enumInput(inputs, 'textureFormat', 'webp', TEXTURE_FORMAT_OPTIONS)
  const quality = numberInput(inputs, 'quality', 85, 1, 100)
  const quantizeEnabled = booleanInput(inputs, 'quantize', true)
  const simplifyRatio = numberInput(inputs, 'simplify', 0, 0, 1)
  const flattenEnabled = booleanInput(inputs, 'flatten', true)
  await log(`options geometry=${geometry} textureSize=${textureSize} textureFormat=${textureFormat} quality=${quality} quantize=${quantizeEnabled} simplify=${simplifyRatio} flatten=${flattenEnabled}`)

  const bytesIn = (await stat(meshPath)).size
  const document = await io.read(meshPath)
  await stage(io, document, 'input')
  await stage(io, document, flattenEnabled ? 'dedup' : 'dedup (skipped)', flattenEnabled ? dedup() : undefined)
  await stage(io, document, flattenEnabled ? 'prune' : 'prune (skipped)', flattenEnabled ? prune() : undefined)
  await stage(io, document, flattenEnabled ? 'flatten' : 'flatten (skipped)', flattenEnabled ? flatten() : undefined)
  await stage(io, document, flattenEnabled ? 'join' : 'join (skipped)', flattenEnabled ? join() : undefined)
  await stage(io, document, 'resample', resample())

  let ktx2PreviewImages
  if (textureFormat === 'ktx2') {
    ktx2PreviewImages = await compressKTX2Textures(document, textureSize, quality)
  } else {
    await compressStandardTextures(document, textureFormat, textureSize, quality)
  }
  await stage(io, document, 'textureCompress')
  await stage(io, document, simplifyRatio === 0 ? 'simplify (skipped)' : 'simplify', simplifyRatio === 0 ? undefined : simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio }))
  const transformedBytes = await stage(io, document, quantizeEnabled ? 'quantize' : 'quantize (skipped)', quantizeEnabled ? quantize() : undefined)
  const previewBytes = ktx2PreviewImages ? await createKTX2PreviewBytes(io, document, ktx2PreviewImages) : transformedBytes
  if (ktx2PreviewImages) await log(`preview source: ${previewBytes.byteLength} bytes`)

  let outputBytes
  if (geometry === 'meshopt') {
    outputBytes = await stage(io, document, 'meshopt', meshopt({ encoder: MeshoptEncoder }))
  } else if (geometry === 'draco') {
    outputBytes = await stage(io, document, 'draco', draco())
  } else {
    outputBytes = await stage(io, document, 'geometry (none)')
  }

  await writeFile(path.join(outputDir, 'mesh.glb'), outputBytes)
  const metadata = {
    bytesIn,
    bytesOut: outputBytes.byteLength,
    triangles: triangleCount(document),
    textures: textureMetadata(document),
    extensionsUsed: document.getRoot().listExtensionsUsed().map(extension => extension.extensionName).sort(),
  }
  await writeFile(path.join(outputDir, 'compress.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  await renderPreview(outputDir, previewBytes)
  await writeFile(path.join(outputDir, 'outputs.json'), `${JSON.stringify({
    mesh: 'mesh.glb',
    preview: { mesh: 'mesh.preview.png' },
    meta: { mesh: 'compress.json' },
    log: 'worker.log',
  }, null, 2)}\n`)
  await log(`completed: ${bytesIn} -> ${outputBytes.byteLength} bytes`)
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (logPath) await appendFile(logPath, `failed: ${message}\n`).catch(() => {})
  console.error(message)
  process.exitCode = 1
}
