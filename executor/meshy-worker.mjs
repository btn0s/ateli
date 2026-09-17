#!/usr/bin/env node
import { createWriteStream } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const DEFAULT_API_BASE_URL = 'https://api.meshy.ai'
const DEFAULT_POLL_BASE_MS = 1_000
const DEFAULT_POLL_MAX_MS = 5_000
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED'])

function lastMessage(payload, fallback) {
  if (typeof payload?.message === 'string' && payload.message) return payload.message
  if (typeof payload?.error?.message === 'string' && payload.error.message) return payload.error.message
  if (typeof payload?.task_error?.message === 'string' && payload.task_error.message) return payload.task_error.message
  return fallback
}

async function fetchJson(url, options, operation) {
  let response
  try {
    response = await fetch(url, options)
  } catch (error) {
    throw new Error(`${operation} failed: ${error.message}`)
  }
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw new Error(`${operation} failed (${response.status}): ${lastMessage(payload, text || response.statusText)}`)
  }
  if (!payload || typeof payload !== 'object') throw new Error(`${operation} returned invalid JSON`)
  return payload
}

async function download(url, destination, label) {
  let response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(`${label} download failed: ${error.message}`)
  }
  if (!response.ok || !response.body) {
    throw new Error(`${label} download failed (${response.status}): ${response.statusText}`)
  }
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx' }))
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {})
    throw new Error(`${label} download failed: ${error.message}`)
  }
}

function imageMimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    default: throw new Error('mesh.fromImage requires a PNG or JPEG image')
  }
}

function positiveMilliseconds(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function main() {
  const requestPath = process.argv[2]
  if (!requestPath) throw new Error('usage: meshy-worker.mjs <request.json>')
  const job = JSON.parse(await readFile(requestPath, 'utf8'))
  if (job.toolId !== 'mesh.fromImage') throw new Error(`unsupported Meshy tool: ${job.toolId}`)
  if (typeof job.outputDir !== 'string' || !job.outputDir) throw new Error('request.outputDir is required')

  const outputDir = path.resolve(job.outputDir)
  await mkdir(outputDir, { recursive: true })
  const logPath = path.join(outputDir, 'worker.log')
  await writeFile(logPath, '')
  const log = message => appendFile(logPath, `${String(message).replace(/\s+$/, '')}\n`)

  const apiKey = process.env.MESHY_API_KEY?.trim()
  if (!apiKey) throw new Error('meshy unavailable: MESHY_API_KEY not set (put it in .env)')

  const imagePath = job.inputs?.image?.path
  if (typeof imagePath !== 'string' || !imagePath) throw new Error("input 'image' requires a file path")
  const mimeType = imageMimeType(imagePath)
  const image = await readFile(imagePath)
  const inputs = job.inputs ?? {}
  const request = {
    ai_model: inputs.model ?? 'meshy-7',
    enable_pbr: inputs.pbr ?? false,
    model_type: 'standard',
    pose_mode: inputs.pose === 'none' ? '' : (inputs.pose ?? 'a-pose'),
    should_remesh: inputs.remesh ?? false,
    should_texture: inputs.texture ?? true,
    target_formats: ['glb'],
    texture_resolution: inputs.textureResolution ?? '2k',
  }
  if (typeof inputs.prompt === 'string' && inputs.prompt.trim()) request.texture_prompt = inputs.prompt.trim()

  const apiBaseUrl = (process.env.MESHY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')
  const endpoint = `${apiBaseUrl}/openapi/v1/image-to-3d`
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
  await log(`creating Meshy task (${request.ai_model}, texture=${request.should_texture})`)
  const created = await fetchJson(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image_url: `data:${mimeType};base64,${image.toString('base64')}`, ...request }),
  }, 'Meshy task creation')
  const taskId = created.result
  if (typeof taskId !== 'string' || !taskId) throw new Error('Meshy task creation returned no task id')
  await log(`task: ${taskId}`)

  const pollBaseMs = positiveMilliseconds(process.env.MESHY_POLL_BASE_MS, DEFAULT_POLL_BASE_MS)
  const pollMaxMs = positiveMilliseconds(process.env.MESHY_POLL_MAX_MS, DEFAULT_POLL_MAX_MS)
  let delay = Math.min(pollBaseMs, pollMaxMs)
  let task
  for (;;) {
    task = await fetchJson(`${endpoint}/${encodeURIComponent(taskId)}`, { headers: { authorization: `Bearer ${apiKey}` } }, 'Meshy task polling')
    await log(`status: ${task.status ?? 'UNKNOWN'}${Number.isFinite(task.progress) ? ` (${task.progress}%)` : ''}`)
    if (TERMINAL_STATUSES.has(task.status)) break
    await sleep(delay)
    delay = Math.min(pollMaxMs, delay * 2)
  }
  if (task.status !== 'SUCCEEDED') {
    throw new Error(`Meshy task ${task.status ?? 'failed'}: ${lastMessage(task, 'unknown error')}`)
  }

  const modelUrl = task.model_urls?.glb
  if (typeof modelUrl !== 'string' || !modelUrl) throw new Error('Meshy task succeeded without a GLB URL')
  if (typeof task.thumbnail_url !== 'string' || !task.thumbnail_url) {
    throw new Error('Meshy task succeeded without a thumbnail URL')
  }

  const meshPath = path.join(outputDir, 'mesh.glb')
  const previewPath = path.join(outputDir, 'mesh.preview.png')
  await Promise.all([
    download(modelUrl, meshPath, 'Meshy GLB'),
    download(task.thumbnail_url, previewPath, 'Meshy thumbnail'),
  ])

  const createdAt = Number.isFinite(task.created_at) ? new Date(task.created_at).toISOString() : new Date().toISOString()
  const metadata = {
    taskId,
    request,
    ...(Number.isFinite(task.consumed_credits) ? { consumedCredits: task.consumed_credits } : {}),
    createdAt,
  }
  await writeFile(path.join(outputDir, 'meshy.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  await writeFile(path.join(outputDir, 'outputs.json'), `${JSON.stringify({
    mesh: 'mesh.glb',
    preview: { mesh: 'mesh.preview.png' },
    meta: { mesh: 'meshy.json' },
    log: 'worker.log',
  }, null, 2)}\n`)
  await log('completed')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
