#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { access, appendFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { Matrix4 } from 'three'

const DEFAULT_BASE_URL = 'https://uthana.com'
const DEFAULT_POLL_MS = 1_000
const DEFAULT_POLL_MAX_MS = 5_000
const BLENDER = process.env.ATELI_BLENDER_PATH || '/opt/homebrew/bin/blender'
const MESH_WORKER = path.resolve('executor/mesh-worker.py')
const TEST_PREVIEW = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8dKAAAAAElFTkSuQmCC', 'base64')

const SKELETON_OPTIONS = new Set(['uthana', 'als'])
const REST_POSE_PROMPT = 'standing still'
const ALS_TWIST_JOINTS = [
  { name: 'lowerarm_twist_01_l', parent: 'lowerarm_l', child: 'hand_l', fraction: 0.5189963111209241, rotation: [0, 0, 0, 1] },
  { name: 'upperarm_twist_01_l', parent: 'upperarm_l', child: 'lowerarm_l', fraction: 0.016479933563428455, rotation: [0, 0, 0, 1] },
  { name: 'lowerarm_twist_01_r', parent: 'lowerarm_r', child: 'hand_r', fraction: 0.5189943608669755, rotation: [-0.11762712192944452, 0, 0, 0.9930578332537313] },
  { name: 'upperarm_twist_01_r', parent: 'upperarm_r', child: 'lowerarm_r', fraction: 0.01647986746807476, rotation: [-0.17323487496728826, 0, 0, 0.9848805400123753] },
  { name: 'calf_twist_01_l', parent: 'calf_l', child: 'foot_l', fraction: 0.5094145313954959, rotation: [0.0028089456755909735, -0.007612723333847363, 0.001933306983200052, 0.9999652086906538] },
  { name: 'thigh_twist_01_l', parent: 'thigh_l', child: 'calf_l', fraction: 0.5189847504830478, rotation: [-0.0474437925547567, -0.0004911153057425742, -0.000021583159252370263, 0.9988737882675393] },
  { name: 'calf_twist_01_r', parent: 'calf_r', child: 'foot_r', fraction: 0.509416117991404, rotation: [0.002807280260666933, -0.007612532893340088, 0.0019337231729064234, 0.9999652140125558] },
  { name: 'thigh_twist_01_r', parent: 'thigh_r', child: 'calf_r', fraction: 0.5189822008467952, rotation: [-0.047445229054363575, -0.000491178590210262, -0.00002190678356337333, 0.9988737199985113] },
]

let logPath

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function positiveMilliseconds(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
}

function graphqlError(payload, fallback) {
  const messages = payload?.errors?.map(error => error?.message).filter(Boolean)
  return messages?.length ? messages.join('; ') : fallback
}

async function log(message) {
  await appendFile(logPath, `${String(message).replace(/\s+$/, '')}\n`)
}

async function fetchGraphql(url, apiKey, query, variables, operation) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: authHeader(apiKey), 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : {} } catch { payload = null }
  if (!response.ok || !payload?.data || payload.errors?.length) {
    throw new Error(`${operation} failed (${response.status}): ${graphqlError(payload, text || response.statusText)}`)
  }
  return payload.data
}

async function uploadGraphql(url, apiKey, query, variables, variablePath, filePath, operation) {
  const bytes = await readFile(filePath)
  const form = new FormData()
  form.append('operations', JSON.stringify({ query, variables }))
  form.append('map', JSON.stringify({ 0: [variablePath] }))
  form.append('0', new File([bytes], path.basename(filePath), { type: 'application/octet-stream' }))
  const response = await fetch(url, { method: 'POST', headers: { authorization: authHeader(apiKey) }, body: form })
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : {} } catch { payload = null }
  if (!response.ok || !payload?.data || payload.errors?.length) {
    throw new Error(`${operation} failed (${response.status}): ${graphqlError(payload, text || response.statusText)}`)
  }
  return payload.data
}

function run(command, args, { label, stdio = 'pipe' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : stdio })
    const stdout = []
    const stderr = []
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr?.on('data', chunk => stderr.push(chunk))
    child.once('error', error => reject(new Error(`${label || command} failed to start: ${error.message}`)))
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) return resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
      const detail = Buffer.concat(stderr).toString('utf8').trim() || Buffer.concat(stdout).toString('utf8').trim()
      reject(new Error(`${label || command} failed${signal ? ` (${signal})` : ` with exit code ${code}`}${detail ? `: ${detail}` : ''}`))
    })
  })
}

async function renderPreview(outputDir, meshPath) {
  const destination = path.join(outputDir, 'mesh.preview.png')
  if (process.env.ATELI_SKIP_MESH_PREVIEW === '1') {
    await writeFile(destination, TEST_PREVIEW)
    return
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'ateli-uthana-preview-'))
  try {
    const requestPath = path.join(temporary, 'request.json')
    await writeFile(requestPath, `${JSON.stringify({
      runId: 'uthana-preview', nodeId: 'uthana-preview', toolId: 'mesh.render',
      inputs: { mesh: { path: meshPath }, yaw: 35, pitch: 15, size: 512 }, outputDir: temporary,
    }, null, 2)}\n`)
    const handle = await open(logPath, 'a')
    try {
      await run(BLENDER, ['--background', '--factory-startup', '--python', MESH_WORKER, '--', requestPath], {
        label: 'Blender preview render', stdio: ['ignore', handle.fd, handle.fd],
      })
    } finally {
      await handle.close()
    }
    await copyFile(path.join(temporary, 'image.png'), destination)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function motionIdFrom(result) {
  if (!result || typeof result !== 'object') return undefined
  if (typeof result.motion_id === 'string') return result.motion_id
  if (typeof result.motionId === 'string') return result.motionId
  if (typeof result.motion?.id === 'string') return result.motion.id
  if (typeof result.result?.id === 'string') return result.result.id
  if (Array.isArray(result.refined_motion_ids) && typeof result.refined_motion_ids[0] === 'string') return result.refined_motion_ids[0]
  if (Array.isArray(result.motions) && typeof result.motions[0]?.id === 'string') return result.motions[0].id
  if (typeof result.id === 'string') return result.id
  return undefined
}

async function createTextMotion(graphqlUrl, apiKey, prompt, characterId) {
  const query = 'mutation CreateTextMotion($prompt: String!, $characterId: String!) { create_text_to_motion(prompt: $prompt, character_id: $characterId) { motion { id name } } }'
  const data = await fetchGraphql(graphqlUrl, apiKey, query, { prompt, characterId }, 'create text-to-motion')
  const motionId = data.create_text_to_motion?.motion?.id
  if (typeof motionId !== 'string' || !motionId) throw new Error('create text-to-motion returned no motion id')
  return motionId
}

async function pollVideoJob(graphqlUrl, apiKey, jobId) {
  const query = 'query PollJob($jobId: String!) { job(job_id: $jobId) { id status result } }'
  let delay = positiveMilliseconds(process.env.UTHANA_POLL_BASE_MS, DEFAULT_POLL_MS)
  const maximum = positiveMilliseconds(process.env.UTHANA_POLL_MAX_MS, DEFAULT_POLL_MAX_MS)
  for (;;) {
    const data = await fetchGraphql(graphqlUrl, apiKey, query, { jobId }, 'poll video-to-motion job')
    const job = data.job
    if (!job) throw new Error(`video-to-motion job ${jobId} was not found`)
    await log(`job ${jobId}: ${job.status}`)
    if (job.status === 'FAILED') throw new Error(`video-to-motion job ${jobId} failed: ${JSON.stringify(job.result)}`)
    if (job.status === 'FINISHED') {
      const motionId = motionIdFrom(job.result)
      if (!motionId) throw new Error(`video-to-motion job ${jobId} returned no motion id`)
      return motionId
    }
    await sleep(delay)
    delay = Math.min(maximum, Math.ceil(delay * 1.5))
  }
}

async function downloadMotion(baseUrl, apiKey, characterId, motionId, fps, destination) {
  const url = `${baseUrl}/motion/file/motion_viewer/${encodeURIComponent(characterId)}/${encodeURIComponent(motionId)}/glb/motion.glb?fps=${encodeURIComponent(fps)}`
  let delay = positiveMilliseconds(process.env.UTHANA_POLL_BASE_MS, DEFAULT_POLL_MS)
  const maximum = positiveMilliseconds(process.env.UTHANA_POLL_MAX_MS, DEFAULT_POLL_MAX_MS)
  for (;;) {
    const response = await fetch(url, { headers: { authorization: authHeader(apiKey) } })
    if (response.ok) {
      await writeFile(destination, Buffer.from(await response.arrayBuffer()))
      return
    }
    if (response.status >= 400 && response.status < 500 && ![404, 409, 425, 429].includes(response.status)) {
      throw new Error(`motion download failed (${response.status}): ${await response.text()}`)
    }
    await log(`motion ${motionId} download pending (${response.status})`)
    await sleep(delay)
    delay = Math.min(maximum, Math.ceil(delay * 1.5))
  }
}

function rootJoints(document) {
  const roots = new Set()
  for (const skin of document.getRoot().listSkins()) {
    const joints = skin.listJoints()
    const jointSet = new Set(joints)
    if (skin.getSkeleton()) roots.add(skin.getSkeleton())
    for (const joint of joints) if (!jointSet.has(joint.getParentNode())) roots.add(joint)
  }
  return roots
}

function stripRootXZ(document) {
  const roots = rootJoints(document)
  if (!roots.size) throw new Error('motion GLB has no root joint')
  let stripped = 0
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      if (channel.getTargetPath() !== 'translation' || !roots.has(channel.getTargetNode())) continue
      const sampler = channel.getSampler()
      const input = sampler?.getInput()
      const output = sampler?.getOutput()
      const source = output?.getArray()
      if (!input || !output || !source) throw new Error('root translation channel has no keyframe data')
      const values = new source.constructor(source)
      const keyCount = input.getCount()
      const cubic = sampler.getInterpolation() === 'CUBICSPLINE'
      const stride = cubic ? 9 : 3
      const valueOffset = cubic ? 3 : 0
      const constantX = values[valueOffset]
      const constantZ = values[valueOffset + 2]
      for (let key = 0; key < keyCount; key += 1) {
        const offset = key * stride
        values[offset + valueOffset] = constantX
        values[offset + valueOffset + 2] = constantZ
        if (cubic) {
          values[offset] = 0
          values[offset + 2] = 0
          values[offset + 6] = 0
          values[offset + 8] = 0
        }
      }
      output.setArray(values)
      stripped += 1
    }
  }
  if (!stripped) throw new Error('motion GLB has no root translation channel')
}

// Uthana characters walk toward +Z; game convention (and every other Ateli mesh) faces -Z.
function faceNegativeZ(document) {
  const HALF_TURN_Y = [0, 1, 0, 0]
  for (const scene of document.getRoot().listScenes()) {
    for (const node of scene.listChildren()) {
      const [x, y, z, w] = node.getRotation()
      const [qx, qy, qz, qw] = HALF_TURN_Y
      node.setRotation([
        qw * x + qx * w + qy * z - qz * y,
        qw * y - qx * z + qy * w + qz * x,
        qw * z + qx * y - qy * x + qz * w,
        qw * w - qx * x - qy * y - qz * z,
      ])
      const [tx, ty, tz] = node.getTranslation()
      node.setTranslation([-tx, ty, -tz])
    }
  }
}

function nodeByName(document, name) {
  const matches = document.getRoot().listNodes().filter(node => node.getName() === name)
  if (matches.length !== 1) throw new Error(`ALS conformance requires exactly one '${name}' node, found ${matches.length}`)
  return matches[0]
}

function sceneContaining(document, target) {
  for (const scene of document.getRoot().listScenes()) {
    let found = false
    scene.traverse(node => { if (node === target) found = true })
    if (found) return scene
  }
  throw new Error(`node '${target.getName()}' is not attached to a scene`)
}

function inverseBindMatrix(joint, meshNode) {
  const matrix = new Matrix4().fromArray(joint.getWorldMatrix()).invert()
  if (meshNode) matrix.multiply(new Matrix4().fromArray(meshNode.getWorldMatrix()))
  return matrix.elements
}

function appendSkinJoints(document, skin, joints, skeletonRoot) {
  const previousJoints = skin.listJoints()
  const inverseBindMatrices = skin.getInverseBindMatrices()
  const meshNode = document.getRoot().listNodes().find(node => node.getSkin() === skin)
  let values
  if (inverseBindMatrices) {
    if (inverseBindMatrices.getType() !== 'MAT4' || inverseBindMatrices.getCount() !== previousJoints.length) {
      throw new Error(`skin '${skin.getName()}' has invalid inverse bind matrices`)
    }
    values = new Float32Array((previousJoints.length + joints.length) * 16)
    values.set(inverseBindMatrices.getArray())
  } else {
    values = new Float32Array((previousJoints.length + joints.length) * 16)
    previousJoints.forEach((joint, index) => values.set(inverseBindMatrix(joint, meshNode), index * 16))
  }
  joints.forEach((joint, offset) => {
    skin.addJoint(joint)
    values.set(inverseBindMatrix(joint, meshNode), (previousJoints.length + offset) * 16)
  })
  if (inverseBindMatrices) {
    inverseBindMatrices.setArray(values)
  } else {
    const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer()
    skin.setInverseBindMatrices(document.createAccessor('Inverse bind matrices').setType('MAT4').setArray(values).setBuffer(buffer))
  }
  skin.setSkeleton(skeletonRoot)
}

function skinJointNames(document) {
  return [...new Set(document.getRoot().listSkins().flatMap(skin => skin.listJoints().map(joint => joint.getName())))]
}

export function conformAlsSkeleton(document) {
  const skins = document.getRoot().listSkins()
  if (!skins.length) throw new Error('ALS conformance requires a skin')
  const addedNames = ['root', ...ALS_TWIST_JOINTS.map(spec => spec.name), 'ik_foot_root', 'ik_foot_l', 'ik_foot_r', 'ik_hand_root', 'ik_hand_gun', 'ik_hand_l', 'ik_hand_r']
  const existingNames = new Set(document.getRoot().listNodes().map(node => node.getName()))
  const collision = addedNames.find(name => existingNames.has(name))
  if (collision) throw new Error(`ALS conformance cannot inject existing node '${collision}'`)

  const pelvis = nodeByName(document, 'pelvis')
  const scene = sceneContaining(document, pelvis)
  const pelvisWorldMatrix = pelvis.getWorldMatrix().slice()
  const skeletonRoot = document.createNode('root')
  scene.addChild(skeletonRoot)
  skeletonRoot.addChild(pelvis)
  pelvis.setMatrix(pelvisWorldMatrix)

  const addedJoints = [skeletonRoot]
  for (const spec of ALS_TWIST_JOINTS) {
    const parent = nodeByName(document, spec.parent)
    const child = nodeByName(document, spec.child)
    const twist = document.createNode(spec.name)
      .setTranslation(child.getTranslation().map(value => value * spec.fraction))
      .setRotation(spec.rotation)
    parent.addChild(twist)
    addedJoints.push(twist)
  }

  const ikFootRoot = document.createNode('ik_foot_root')
  const ikHandRoot = document.createNode('ik_hand_root')
  skeletonRoot.addChild(ikFootRoot).addChild(ikHandRoot)
  const copyWorldTransform = (name, parent, sourceName) => {
    const sourceMatrix = new Matrix4().fromArray(nodeByName(document, sourceName).getWorldMatrix())
    const parentInverse = new Matrix4().fromArray(parent.getWorldMatrix()).invert()
    const joint = document.createNode(name)
    parent.addChild(joint)
    joint.setMatrix(parentInverse.multiply(sourceMatrix).elements)
    addedJoints.push(joint)
    return joint
  }
  copyWorldTransform('ik_foot_l', ikFootRoot, 'foot_l')
  copyWorldTransform('ik_foot_r', ikFootRoot, 'foot_r')
  const ikHandGun = copyWorldTransform('ik_hand_gun', ikHandRoot, 'hand_r')
  copyWorldTransform('ik_hand_l', ikHandGun, 'hand_l')
  copyWorldTransform('ik_hand_r', ikHandGun, 'hand_r')
  addedJoints.push(ikFootRoot, ikHandRoot)

  for (const skin of skins) appendSkinJoints(document, skin, addedJoints, skeletonRoot)
  return skinJointNames(document)
}

export function prepareRiggedRestPose(document, skeleton) {
  const animations = document.getRoot().listAnimations()
  if (!animations.length) throw new Error('downloaded rest-pose motion has no animation')
  const animationAccessors = new Set(animations.flatMap(animation => animation.listSamplers().flatMap(sampler => [sampler.getInput(), sampler.getOutput()])))
  for (const accessor of animationAccessors) {
    if (accessor && accessor.listParents().every(parent => ['Root', 'AnimationSampler'].includes(parent.propertyType))) accessor.dispose()
  }
  for (const animation of animations) {
    for (const channel of animation.listChannels()) channel.dispose()
    for (const sampler of animation.listSamplers()) sampler.dispose()
    animation.dispose()
  }
  if (skeleton === 'als') conformAlsSkeleton(document)
  faceNegativeZ(document)
  return skinJointNames(document)
}

async function normalizeRiggedRestPose(filePath, skeleton) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const document = await io.read(filePath)
  const joints = prepareRiggedRestPose(document, skeleton)
  await writeFile(filePath, await io.writeBinary(document))
  return joints
}

function applyMatrix(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

// Authored travel speed of the clip in metres per second, measured over the middle 60% of the root
// track so a standing start or stop does not drag it down. Runtimes scale playback by it.
function measureRootSpeed(document, animation) {
  const roots = rootJoints(document)
  for (const channel of animation.listChannels()) {
    if (channel.getTargetPath() !== 'translation' || !roots.has(channel.getTargetNode())) continue
    const sampler = channel.getSampler()
    const times = sampler.getInput().getArray()
    const values = sampler.getOutput().getArray()
    const cubic = sampler.getInterpolation() === 'CUBICSPLINE'
    const stride = cubic ? 9 : 3
    const valueOffset = cubic ? 3 : 0
    const keyCount = times.length
    if (keyCount < 2) return 0
    const parent = channel.getTargetNode().getParentNode()
    const matrix = parent ? parent.getWorldMatrix() : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const at = key => applyMatrix(matrix, [values[key * stride + valueOffset], values[key * stride + valueOffset + 1], values[key * stride + valueOffset + 2]])
    const start = Math.floor(keyCount * 0.2)
    const end = Math.max(start + 1, Math.floor(keyCount * 0.8))
    const a = at(start)
    const b = at(end)
    const seconds = times[end] - times[start]
    return seconds > 0 ? Math.hypot(b[0] - a[0], b[2] - a[2]) / seconds : 0
  }
  return 0
}

async function normalizeMotion(filePath, clipName, inPlace) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const document = await io.read(filePath)
  const animations = document.getRoot().listAnimations()
  if (animations.length !== 1) throw new Error(`expected one animation, found ${animations.length}`)
  const animation = animations[0]
  animation.setName(clipName)
  const rootSpeed = measureRootSpeed(document, animation)
  animation.setExtras({ ...animation.getExtras(), rootSpeed: Number(rootSpeed.toFixed(4)) })
  if (inPlace) stripRootXZ(document)
  faceNegativeZ(document)
  await writeFile(filePath, await io.writeBinary(document))
  return { rootSpeed }
}

function textInput(inputs, name, fallback) {
  const value = inputs[name] ?? fallback
  if (typeof value !== 'string' || !value) throw new Error(`input '${name}' must be non-empty text`)
  return value
}

function booleanInput(inputs, name, fallback) {
  const value = inputs[name] ?? fallback
  if (typeof value !== 'boolean') throw new Error(`input '${name}' must be boolean`)
  return value
}

function numberInput(inputs, name, fallback) {
  const value = inputs[name] ?? fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 120) throw new Error(`input '${name}' must be from 1 to 120`)
  return value
}

function enumInput(inputs, name, fallback, options) {
  const value = inputs[name] ?? fallback
  if (!options.has(value)) throw new Error(`input '${name}' must be one of ${[...options].join(', ')}`)
  return value
}

async function main() {
  const requestPath = process.argv[2]
  if (!requestPath) throw new Error('usage: uthana-worker.mjs <request.json>')
  const job = JSON.parse(await readFile(requestPath, 'utf8'))
  if (!['character.rig', 'motion.fromText', 'motion.fromVideo'].includes(job.toolId)) throw new Error(`unsupported Uthana tool: ${job.toolId}`)
  if (typeof job.outputDir !== 'string' || !job.outputDir) throw new Error('request.outputDir is required')
  const apiKey = process.env.UTHANA_API_KEY?.trim()
  if (!apiKey) throw new Error('UTHANA_API_KEY is required')
  const baseUrl = (process.env.UTHANA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const graphqlUrl = process.env.UTHANA_GRAPHQL_URL || `${baseUrl}/graphql`
  const outputDir = path.resolve(job.outputDir)
  await mkdir(outputDir, { recursive: true })
  logPath = path.join(outputDir, 'worker.log')
  await writeFile(logPath, '')
  await log(`tool=${job.toolId} node=${job.nodeId ?? '<unknown>'}`)
  const inputs = job.inputs ?? {}

  if (job.toolId === 'character.rig') {
    const meshPath = inputs.mesh?.path
    if (typeof meshPath !== 'string' || !path.isAbsolute(meshPath)) throw new Error("input 'mesh' requires an absolute file path")
    await access(meshPath)
    if (path.extname(meshPath).toLowerCase() !== '.glb') throw new Error('character.rig requires a GLB input')
    const skeleton = enumInput(inputs, 'skeleton', 'uthana', SKELETON_OPTIONS)
    const includeFingers = skeleton === 'als' ? true : booleanInput(inputs, 'includeFingers', false)
    const frontFacing = booleanInput(inputs, 'frontFacing', true)
    const query = skeleton === 'als'
      ? 'mutation CreateCharacter($file: Upload!, $name: String!, $includeFingers: Boolean!, $frontFacing: Boolean!, $rerigTarget: String!) { create_character(file: $file, name: $name, auto_rig: true, include_fingers: $includeFingers, auto_rig_front_facing: $frontFacing, rerig_target: $rerigTarget) { character { id name } } }'
      : 'mutation CreateCharacter($file: Upload!, $name: String!, $includeFingers: Boolean!, $frontFacing: Boolean!) { create_character(file: $file, name: $name, auto_rig: true, include_fingers: $includeFingers, auto_rig_front_facing: $frontFacing) { character { id name } } }'
    const variables = { file: null, name: path.parse(meshPath).name, includeFingers, frontFacing }
    if (skeleton === 'als') variables.rerigTarget = 'ue5'
    const data = await uploadGraphql(graphqlUrl, apiKey, query, variables, 'variables.file', meshPath, 'create character')
    const characterId = data.create_character?.character?.id
    if (typeof characterId !== 'string' || !characterId) throw new Error('create character returned no character id')
    const motionId = await createTextMotion(graphqlUrl, apiKey, REST_POSE_PROMPT, characterId)
    const outputMesh = path.join(outputDir, 'mesh.glb')
    await downloadMotion(baseUrl, apiKey, characterId, motionId, 30, outputMesh)
    const joints = await normalizeRiggedRestPose(outputMesh, skeleton)
    await renderPreview(outputDir, outputMesh)
    await writeFile(path.join(outputDir, 'character.json'), `${JSON.stringify(characterId)}\n`)
    await writeFile(path.join(outputDir, 'uthana.json'), `${JSON.stringify({ characterId, motionId, prompt: REST_POSE_PROMPT, skeleton, joints }, null, 2)}\n`)
    await writeFile(path.join(outputDir, 'outputs.json'), `${JSON.stringify({
      character: 'character.json', mesh: 'mesh.glb', preview: { mesh: 'mesh.preview.png' }, meta: { mesh: 'uthana.json' }, log: 'worker.log',
    }, null, 2)}\n`)
    await log(`character=${characterId} motion=${motionId} skeleton=${skeleton}`)
    return
  }

  const characterId = textInput(inputs, 'character')
  const clipName = textInput(inputs, 'clipName', 'clip')
  const inPlace = booleanInput(inputs, 'inPlace', true)
  const fps = numberInput(inputs, 'fps', 30)
  let motionId
  let prompt = null
  if (job.toolId === 'motion.fromText') {
    prompt = textInput(inputs, 'prompt')
    motionId = await createTextMotion(graphqlUrl, apiKey, prompt, characterId)
  } else {
    const videoPath = inputs.video?.path
    if (typeof videoPath !== 'string' || !path.isAbsolute(videoPath)) throw new Error("input 'video' requires an absolute file path")
    await access(videoPath)
    const query = 'mutation CreateVideoMotion($file: Upload!, $motionName: String!, $characterId: String!) { create_video_to_motion(file: $file, motion_name: $motionName, character_id: $characterId, model: "video-to-motion-2.0") { job { id status } } }'
    const data = await uploadGraphql(graphqlUrl, apiKey, query, { file: null, motionName: clipName, characterId }, 'variables.file', videoPath, 'create video-to-motion')
    const videoJobId = data.create_video_to_motion?.job?.id
    if (typeof videoJobId !== 'string' || !videoJobId) throw new Error('create video-to-motion returned no job id')
    motionId = await pollVideoJob(graphqlUrl, apiKey, videoJobId)
  }
  if (typeof motionId !== 'string' || !motionId) throw new Error('motion creation returned no motion id')
  const outputMesh = path.join(outputDir, 'mesh.glb')
  await downloadMotion(baseUrl, apiKey, characterId, motionId, fps, outputMesh)
  const { rootSpeed } = await normalizeMotion(outputMesh, clipName, inPlace)
  await renderPreview(outputDir, outputMesh)
  await writeFile(path.join(outputDir, 'uthana.json'), `${JSON.stringify({ characterId, motionId, prompt, rootSpeed }, null, 2)}\n`)
  await writeFile(path.join(outputDir, 'outputs.json'), `${JSON.stringify({
    mesh: 'mesh.glb', preview: { mesh: 'mesh.preview.png' }, meta: { mesh: 'uthana.json' }, log: 'worker.log',
  }, null, 2)}\n`)
  await log(`character=${characterId} motion=${motionId}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (logPath) await appendFile(logPath, `failed: ${message}\n`).catch(() => {})
    console.error(message)
    process.exitCode = 1
  }
}
