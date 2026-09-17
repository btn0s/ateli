import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { Matrix4 } from 'three'
import { prepareRiggedRestPose } from '../executor/uthana-worker.mjs'

const WORKER = path.resolve('executor/uthana-worker.mjs')

async function motionGlb(name = 'source', als = false) {
  const document = new Document()
  const buffer = document.createBuffer()
  const root = document.createNode(als ? 'pelvis' : 'Root')
  document.createScene('Scene').addChild(root)
  const joints = [root]
  if (als) {
    for (const chain of [
      ['thigh_l', 'calf_l', 'foot_l'],
      ['thigh_r', 'calf_r', 'foot_r'],
      ['upperarm_l', 'lowerarm_l', 'hand_l'],
      ['upperarm_r', 'lowerarm_r', 'hand_r'],
    ]) {
      let parent = root
      for (const jointName of chain) {
        const joint = document.createNode(jointName).setTranslation([1, 0, 0])
        parent.addChild(joint)
        joints.push(joint)
        parent = joint
      }
    }
  }
  const skin = document.createSkin('Skin').setSkeleton(root)
  for (const joint of joints) skin.addJoint(joint)
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

function vertexBytes(document) {
  const semantics = ['POSITION', 'JOINTS_0', 'JOINTS_1', 'WEIGHTS_0', 'WEIGHTS_1']
  return document.getRoot().listMeshes().flatMap((mesh, meshIndex) => mesh.listPrimitives().flatMap((primitive, primitiveIndex) => semantics.flatMap(semantic => {
    const accessor = primitive.getAttribute(semantic)
    if (!accessor) return []
    const array = accessor.getArray()
    return [{ key: `${meshIndex}:${primitiveIndex}:${semantic}`, type: array.constructor.name, bytes: Buffer.from(array.buffer, array.byteOffset, array.byteLength) }]
  })))
}

function vectorLength(vector) {
  return Math.hypot(...vector)
}

function assertMatrixClose(actual, expected, message) {
  assert.equal(actual.length, expected.length, message)
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) < 1e-4, `${message} at ${index}: ${actual[index]} != ${expected[index]}`)
  }
}

test('Uthana worker sends recorded multipart and JSON request shapes and normalizes motion GLBs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-uthana-worker-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourcePath = path.join(root, 'character.glb')
  const videoPath = path.join(root, 'motion.mp4')
  const glb = await motionGlb()
  const alsGlb = await motionGlb('als-source', true)
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
          const characterId = raw.includes('"rerigTarget":"ue5"') ? 'character-als' : 'character-123'
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { create_character: { character: { id: characterId, name: 'character' } } } }))
        } else {
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { create_video_to_motion: { job: { id: 'job-video', status: 'PENDING' } } } }))
        }
        return
      }
      if (request.url?.startsWith('/motion/file/motion_viewer/')) {
        const download = request.url.includes('/character-als/') ? alsGlb : glb
        response.writeHead(200, { 'content-type': 'model/gltf-binary' }).end(download)
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
  const rigDocument = await new NodeIO().read(path.join(rig.outputDir, 'mesh.glb'))
  assert.equal(rigDocument.getRoot().listAnimations().length, 0)
  assert.deepEqual(JSON.parse(await readFile(path.join(rig.outputDir, 'uthana.json'), 'utf8')), {
    characterId: 'character-123', motionId: 'motion-text', prompt: 'standing still', skeleton: 'uthana', joints: ['Root'],
  })
  const characterRequest = requests.find(item => item.kind === 'multipart' && item.raw.includes('create_character') && !item.raw.includes('rerigTarget'))
  assert.ok(characterRequest)
  assert.match(characterRequest.raw, /"includeFingers":false/)
  assert.match(characterRequest.raw, /"frontFacing":true/)
  assert.match(characterRequest.raw, /"0":\["variables\.file"\]/)
  assert.match(characterRequest.raw, /auto_rig_front_facing/)

  const alsRig = await requestFixture(root, 'character.rig', { mesh: { path: sourcePath }, skeleton: 'als', includeFingers: false, frontFacing: true })
  await runWorker(alsRig.requestPath, env)
  const alsRequest = requests.find(item => item.kind === 'multipart' && item.raw.includes('"rerigTarget":"ue5"'))
  assert.ok(alsRequest)
  assert.match(alsRequest.raw, /"includeFingers":true/)
  assert.match(alsRequest.raw, /rerig_target: \$rerigTarget/)
  const alsMeta = JSON.parse(await readFile(path.join(alsRig.outputDir, 'uthana.json'), 'utf8'))
  assert.equal(alsMeta.skeleton, 'als')
  assert.ok(alsMeta.joints.includes('root'))
  assert.ok(alsMeta.joints.includes('ik_hand_gun'))
  assert.equal((await new NodeIO().read(path.join(alsRig.outputDir, 'mesh.glb'))).getRoot().listAnimations().length, 0)

  const text = await requestFixture(root, 'motion.fromText', { character: 'character-123', prompt: 'Stand and breathe.', clipName: 'idle', inPlace: true, fps: 30 })
  await runWorker(text.requestPath, env)
  const textRequest = requests.find(item => item.kind === 'json' && item.payload.query.includes('create_text_to_motion') && item.payload.variables.prompt === 'Stand and breathe.')
  assert.deepEqual(textRequest.payload.variables, { prompt: 'Stand and breathe.', characterId: 'character-123' })
  const textDocument = await new NodeIO().read(path.join(text.outputDir, 'mesh.glb'))
  assert.deepEqual(textDocument.getRoot().listAnimations().map(animation => animation.getName()), ['idle'])
  assert.deepEqual([...textDocument.getRoot().listAnimations()[0].listSamplers()[0].getOutput().getArray()], [0, 0, 0, 0, 1, 0])
  const meta = JSON.parse(await readFile(path.join(text.outputDir, 'uthana.json'), 'utf8'))
  assert.deepEqual({ ...meta, rootSpeed: undefined }, { characterId: 'character-123', motionId: 'motion-text', prompt: 'Stand and breathe.', rootSpeed: undefined })
  assert.ok(meta.rootSpeed > 0, 'authored root speed is measured before the root track is flattened')

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

const ALS_REFERENCE = '/Users/btnorris/dev/als-web/public/assets/skm-als.glb'
const UE5_SAMPLE = '/tmp/drifter-ue5-walk.glb'
const conformanceReady = await Promise.all([ALS_REFERENCE, UE5_SAMPLE].map(file => access(file).then(() => true, () => false))).then(results => results.every(Boolean))

test('ALS conformance preserves skinned vertex data and supplies the SK_Als joint set', { skip: !conformanceReady }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-als-conformance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const outputPath = path.join(root, 'drifter-als-rest.glb')
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const reference = await io.read(ALS_REFERENCE)
  const document = await io.read(UE5_SAMPLE)
  const before = vertexBytes(document)
  const sourceNames = new Set(document.getRoot().listSkins()[0].listJoints().map(joint => joint.getName()))

  const joints = prepareRiggedRestPose(document, 'als')
  assert.equal(document.getRoot().listAnimations().length, 0)
  assert.deepEqual(vertexBytes(document), before)
  const resultSkin = document.getRoot().listSkins()[0]
  const resultByName = new Map(resultSkin.listJoints().map(joint => [joint.getName(), joint]))
  const referenceSkin = reference.getRoot().listSkins()[0]
  const referenceByName = new Map(referenceSkin.listJoints().map(joint => [joint.getName(), joint]))
  for (const name of referenceByName.keys()) assert.ok(resultByName.has(name), `missing SK_Als joint '${name}'`)
  assert.equal(joints.length, resultSkin.listJoints().length)

  const injectedNames = [...referenceByName.keys()].filter(name => !sourceNames.has(name))
  for (const name of injectedNames) {
    assert.equal(resultByName.get(name).getParentNode()?.getName() ?? null, referenceByName.get(name).getParentNode()?.getName() ?? null, `${name} parent`)
  }
  for (const [twistName, childName] of [
    ['thigh_twist_01_l', 'calf_l'], ['thigh_twist_01_r', 'calf_r'],
    ['calf_twist_01_l', 'foot_l'], ['calf_twist_01_r', 'foot_r'],
    ['upperarm_twist_01_l', 'lowerarm_l'], ['upperarm_twist_01_r', 'lowerarm_r'],
    ['lowerarm_twist_01_l', 'hand_l'], ['lowerarm_twist_01_r', 'hand_r'],
  ]) {
    const actualFraction = vectorLength(resultByName.get(twistName).getTranslation()) / vectorLength(resultByName.get(childName).getTranslation())
    const referenceFraction = vectorLength(referenceByName.get(twistName).getTranslation()) / vectorLength(referenceByName.get(childName).getTranslation())
    assert.ok(Math.abs(actualFraction - referenceFraction) < 1e-6, `${twistName} limb fraction`)
  }
  for (const [ikName, sourceName] of [
    ['ik_foot_l', 'foot_l'], ['ik_foot_r', 'foot_r'],
    ['ik_hand_l', 'hand_l'], ['ik_hand_r', 'hand_r'], ['ik_hand_gun', 'hand_r'],
  ]) {
    assertMatrixClose(resultByName.get(ikName).getWorldMatrix(), resultByName.get(sourceName).getWorldMatrix(), `${ikName} rest transform`)
  }

  const inverseBindMatrices = resultSkin.getInverseBindMatrices()
  assert.equal(inverseBindMatrices.getCount(), resultSkin.listJoints().length)
  const inverseBindValues = inverseBindMatrices.getArray()
  const meshNode = document.getRoot().listNodes().find(node => node.getSkin() === resultSkin)
  for (const name of injectedNames) {
    const joint = resultByName.get(name)
    const index = resultSkin.listJoints().indexOf(joint)
    const expected = new Matrix4().fromArray(joint.getWorldMatrix()).invert()
      .multiply(new Matrix4().fromArray(meshNode.getWorldMatrix())).elements
    assertMatrixClose(inverseBindValues.slice(index * 16, index * 16 + 16), expected, `${name} inverse bind matrix`)
  }

  await writeFile(outputPath, await io.writeBinary(document))
  const reloaded = await io.read(outputPath)
  assert.deepEqual(vertexBytes(reloaded), before)
  const reloadedNames = new Set(reloaded.getRoot().listSkins()[0].listJoints().map(joint => joint.getName()))
  for (const name of referenceByName.keys()) assert.ok(reloadedNames.has(name), `reloaded GLB missing '${name}'`)
})

const liveKey = envValue('UTHANA_API_KEY')
const liveReady = process.env.LIVE === '1' && Boolean(liveKey)

test('Uthana worker creates live text motion for the existing character', { skip: !liveReady, timeout: 5 * 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-uthana-live-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const motion = await requestFixture(root, 'motion.fromText', {
    character: 'c6HqNKEbkTfu', prompt: 'Stand idle and breathe naturally.', clipName: 'idle', inPlace: true, fps: 30,
  })
  await runWorker(motion.requestPath, { UTHANA_API_KEY: liveKey }, 5 * 60_000)
  const document = await new NodeIO().read(path.join(motion.outputDir, 'mesh.glb'))
  assert.deepEqual(document.getRoot().listAnimations().map(animation => animation.getName()), ['idle'])
})
