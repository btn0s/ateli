#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const IMAGE_MODELS = new Set(['fal-ai/nano-banana-2/edit', 'openai/gpt-image-2/edit'])
const VIDEO_MODELS = new Set(['fal-ai/kling-video/v3/pro/image-to-video', 'bytedance/seedance-2.0/us/image-to-video'])
let logPath

async function log(message) {
  await appendFile(logPath, `${String(message).replace(/\s+$/, '')}\n`)
}

function inputFile(inputs, name) {
  const filePath = inputs[name]?.path
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error(`input '${name}' requires an absolute file path`)
  return filePath
}

function textInput(inputs, name) {
  const value = inputs[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`input '${name}' must be non-empty text`)
  return value
}

function enumInput(inputs, name, allowed) {
  const value = inputs[name]
  if (!allowed.has(value)) throw new Error(`input '${name}' is not supported: ${value}`)
  return value
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.mp4': return 'video/mp4'
    case '.webm': return 'video/webm'
    case '.mov': return 'video/quicktime'
    default: return 'application/octet-stream'
  }
}

function reportedMetadata(result) {
  const candidates = [result, result?.data]
  const meta = { requestId: result?.requestId ?? result?.request_id }
  for (const source of candidates) {
    if (!source || typeof source !== 'object') continue
    for (const key of ['cost', 'timings', 'metrics']) if (source[key] !== undefined) meta[key] = source[key]
  }
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined))
}

function extensionForImage(response, url) {
  const type = response.headers.get('content-type')?.split(';', 1)[0]
  if (type === 'image/jpeg') return '.jpg'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/png') return '.png'
  const extension = path.extname(new URL(url).pathname).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(extension) ? extension : '.png'
}

async function download(url, outputDir, kind) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Fal output download failed (${response.status}): ${await response.text()}`)
  const extension = kind === 'video' ? '.mp4' : extensionForImage(response, url)
  const name = `${kind}${extension}`
  await writeFile(path.join(outputDir, name), Buffer.from(await response.arrayBuffer()))
  return name
}

async function loadFal() {
  const moduleName = process.env.ATELI_FAL_CLIENT_MODULE
  const imported = await import(moduleName ? pathToFileURL(path.resolve(moduleName)).href : '@fal-ai/client')
  if (!imported.fal?.storage?.upload || !imported.fal?.subscribe) throw new Error('Fal client module does not export fal.storage.upload and fal.subscribe')
  return imported.fal
}

async function main() {
  const requestPath = process.argv[2]
  if (!requestPath) throw new Error('usage: fal-worker.mjs <request.json>')
  const job = JSON.parse(await readFile(requestPath, 'utf8'))
  if (!['image.edit', 'video.fromImage'].includes(job.toolId)) throw new Error(`unsupported Fal tool: ${job.toolId}`)
  if (typeof job.outputDir !== 'string' || !job.outputDir) throw new Error('request.outputDir is required')
  const apiKey = process.env.FAL_KEY?.trim()
  if (!apiKey) throw new Error('FAL_KEY is required')
  const outputDir = path.resolve(job.outputDir)
  await mkdir(outputDir, { recursive: true })
  logPath = path.join(outputDir, 'worker.log')
  await writeFile(logPath, '')
  const inputs = job.inputs ?? {}
  const imagePath = inputFile(inputs, 'image')
  const prompt = textInput(inputs, 'prompt')
  const fal = await loadFal()
  fal.config?.({ credentials: apiKey })
  const bytes = await readFile(imagePath)
  const upload = new File([bytes], path.basename(imagePath), { type: contentType(imagePath) })
  const imageUrl = await fal.storage.upload(upload)
  await log(`tool=${job.toolId} model=${inputs.model}`)

  let model
  let request
  let kind
  if (job.toolId === 'image.edit') {
    model = enumInput(inputs, 'model', IMAGE_MODELS)
    request = { prompt, image_urls: [imageUrl] }
    kind = 'image'
  } else {
    model = enumInput(inputs, 'model', VIDEO_MODELS)
    const duration = enumInput(inputs, 'duration', new Set(['5', '10']))
    request = model.startsWith('fal-ai/kling-video/')
      ? { prompt, start_image_url: imageUrl, duration, generate_audio: false }
      : { prompt, image_url: imageUrl, duration }
    kind = 'video'
  }

  const result = await fal.subscribe(model, {
    input: request,
    logs: true,
    onQueueUpdate(update) {
      for (const entry of update?.logs ?? []) void log(entry?.message ?? entry)
    },
  })
  const url = kind === 'image' ? result?.data?.images?.[0]?.url : result?.data?.video?.url
  if (typeof url !== 'string' || !url) throw new Error(`Fal ${kind} response contained no output URL`)
  const output = await download(url, outputDir, kind)
  const reported = reportedMetadata(result)
  const metadata = { model, request, ...reported }
  await writeFile(path.join(outputDir, 'fal.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  await writeFile(path.join(outputDir, 'outputs.json'), `${JSON.stringify({
    [kind]: output, meta: { [kind]: 'fal.json' }, log: 'worker.log',
  }, null, 2)}\n`)
  await log(`request=${reported.requestId ?? '<not reported>'}`)
}

try {
  await main()
} catch (error) {
  const detail = error && typeof error === 'object' && 'body' in error ? `: ${JSON.stringify(error.body)}` : ''
  const message = `${error instanceof Error ? error.message : String(error)}${detail}`
  if (logPath) await appendFile(logPath, `failed: ${message}\n`).catch(() => {})
  console.error(message)
  process.exitCode = 1
}
