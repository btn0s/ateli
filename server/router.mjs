import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tools, toolsForExportRoots } from './tools.mjs'

const LAST_LIGHT_ROOT = '/Users/btnorris/dev/games/last-light'
const DEFAULT_STAGING_ROOT = path.join(LAST_LIGHT_ROOT, '.scratch/ateli')
const DEFAULT_SOURCE_ROOT = path.join(LAST_LIGHT_ROOT, 'client/public/character-experiments')
const IMAGE_WORKER = fileURLToPath(new URL('../executor/image-worker.py', import.meta.url))
const MESH_WORKER = fileURLToPath(new URL('../executor/mesh-worker.py', import.meta.url))
const MESHY_WORKER = fileURLToPath(new URL('../executor/meshy-worker.mjs', import.meta.url))
const MAX_JSON_BYTES = 1024 * 1024
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024
const MAX_PARAMETER_BYTES = 64 * 1024
const STDERR_TAIL_BYTES = 16 * 1024
const SAFE_ID = /^[A-Za-z0-9_:-]{1,160}$/
const FILE_TYPES = new Set(['image', 'mesh'])
const SCALAR_TYPES = new Set(['text', 'number', 'boolean', 'enum'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'])
const MESH_EXTENSIONS = new Set(['.glb', '.gltf', '.fbx', '.obj'])

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function fileDigest(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function sendJson(response, status, value) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

function mimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.glb': return 'model/gltf-binary'
    case '.gltf': return 'model/gltf+json'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.tif':
    case '.tiff': return 'image/tiff'
    case '.json': return 'application/json; charset=utf-8'
    case '.txt':
    case '.log': return 'text/plain; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

function sourceKind(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (MESH_EXTENSIONS.has(extension)) return 'mesh'
  throw new Error(`unsupported source type ${extension || '(none)'}`)
}

function validateScalar(parameter, value) {
  if (parameter.type === 'text') {
    if (typeof value !== 'string') throw new Error(`type mismatch for ${parameter.id}`)
    if (Buffer.byteLength(value) > MAX_PARAMETER_BYTES) throw new Error(`parameter too large ${parameter.id}`)
    return
  }
  if (parameter.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`type mismatch for ${parameter.id}`)
    if ((parameter.min !== undefined && value < parameter.min) || (parameter.max !== undefined && value > parameter.max)) {
      throw new Error(`scalar out of range ${parameter.id}`)
    }
    return
  }
  if (parameter.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`type mismatch for ${parameter.id}`)
    return
  }
  if (parameter.type === 'enum') {
    if (typeof value !== 'string' || !parameter.options?.includes(value)) throw new Error(`type mismatch for ${parameter.id}`)
  }
}

function topologicalOrder(graph) {
  const nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]))
  const indegree = new Map(graph.nodes.map(node => [node.id, 0]))
  const adjacency = new Map(graph.nodes.map(node => [node.id, []]))
  for (const edge of graph.edges) {
    indegree.set(edge.target.nodeId, indegree.get(edge.target.nodeId) + 1)
    adjacency.get(edge.source.nodeId).push(edge.target.nodeId)
  }
  const queue = graph.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id)
  const ordered = []
  while (queue.length > 0) {
    queue.sort((left, right) => nodeIndex.get(left) - nodeIndex.get(right))
    const nodeId = queue.shift()
    ordered.push(nodeId)
    for (const targetId of adjacency.get(nodeId)) {
      const next = indegree.get(targetId) - 1
      indegree.set(targetId, next)
      if (next === 0) queue.push(targetId)
    }
  }
  if (ordered.length !== graph.nodes.length) throw new Error('graph contains cycle')
  return ordered
}

export function validateGraph(graph, catalog = tools) {
  if (!isPlainObject(graph) || (graph.schemaVersion !== undefined && graph.schemaVersion !== 1) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length === 0) {
    throw new Error('invalid graph schema')
  }

  const catalogMap = new Map(catalog.map(tool => [tool.id, tool]))
  const normalizedNodes = []
  const nodesById = new Map()
  for (const node of graph.nodes) {
    if (!isPlainObject(node) || typeof node.id !== 'string' || !SAFE_ID.test(node.id) || nodesById.has(node.id)) {
      throw new Error(`invalid node ${node?.id ?? ''}`)
    }
    const tool = catalogMap.get(node.toolId)
    if (!tool) throw new Error(`unknown tool ${node.toolId ?? ''}`)
    if (node.toolVersion !== tool.version) throw new Error(`unknown tool version ${node.toolId}`)
    if (!isPlainObject(node.parameters)) throw new Error(`invalid parameters for ${node.id}`)
    const inputIds = new Set(tool.inputs.map(input => input.id))
    for (const key of Object.keys(node.parameters)) {
      if (!inputIds.has(key)) throw new Error(`unknown parameter key ${node.id}.${key}`)
    }
    const normalized = {
      id: node.id,
      toolId: node.toolId,
      toolVersion: node.toolVersion,
      parameters: { ...node.parameters },
    }
    normalizedNodes.push(normalized)
    nodesById.set(node.id, normalized)
  }

  const edgeIds = new Set()
  const occupiedTargets = new Set()
  const normalizedEdges = []
  for (const edge of graph.edges) {
    if (!isPlainObject(edge) || typeof edge.id !== 'string' || !SAFE_ID.test(edge.id) || edgeIds.has(edge.id)) throw new Error('invalid edge')
    const sourceNode = nodesById.get(edge.source?.nodeId)
    const targetNode = nodesById.get(edge.target?.nodeId)
    if (!sourceNode || !targetNode) throw new Error('invalid edge node')
    const sourcePort = catalogMap.get(sourceNode.toolId).outputs.find(output => output.id === edge.source?.portId)
    const targetPort = catalogMap.get(targetNode.toolId).inputs.find(input => input.id === edge.target?.portId)
    if (!sourcePort || !targetPort || sourcePort.type !== targetPort.type) throw new Error('type mismatch on edge')
    const targetKey = `${targetNode.id}\0${targetPort.id}`
    if (occupiedTargets.has(targetKey)) throw new Error(`duplicate target port ${targetNode.id}.${targetPort.id}`)
    edgeIds.add(edge.id)
    occupiedTargets.add(targetKey)
    normalizedEdges.push({
      id: edge.id,
      source: { nodeId: sourceNode.id, portId: sourcePort.id },
      target: { nodeId: targetNode.id, portId: targetPort.id },
    })
  }

  for (const node of normalizedNodes) {
    const tool = catalogMap.get(node.toolId)
    for (const input of tool.inputs) {
      const connected = occupiedTargets.has(`${node.id}\0${input.id}`)
      const supplied = Object.hasOwn(node.parameters, input.id)
      if (supplied) {
        const value = node.parameters[input.id]
        if (SCALAR_TYPES.has(input.type)) validateScalar(input, value)
        else if (tool.category === 'Input' && FILE_TYPES.has(input.type)) {
          if (typeof value !== 'string' || !value) throw new Error(`type mismatch for ${node.id}.${input.id}`)
        } else {
          throw new Error(`type mismatch for ${node.id}.${input.id}`)
        }
      }
      if (connected) continue
      if (!supplied && Object.hasOwn(input, 'default')) node.parameters[input.id] = structuredClone(input.default)
      else if (!supplied && input.required !== false) throw new Error(`missing required input ${node.id}.${input.id}`)
    }
    if (tool.id === 'output.export') {
      const connectedFiles = ['mesh', 'image'].filter(inputId => occupiedTargets.has(`${node.id}\0${inputId}`))
      if (connectedFiles.length !== 1) throw new Error(`${node.id} requires exactly one of mesh or image`)
      const name = node.parameters.name
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
        throw new Error(`invalid export name ${node.id}.name`)
      }
    }
  }

  const normalized = { schemaVersion: 1, nodes: normalizedNodes, edges: normalizedEdges }
  topologicalOrder(normalized)
  return normalized
}

function ancestorsOf(graph, selected) {
  let changed = true
  while (changed) {
    changed = false
    for (const edge of graph.edges) {
      if (selected.has(edge.target.nodeId) && !selected.has(edge.source.nodeId)) {
        selected.add(edge.source.nodeId)
        changed = true
      }
    }
  }
  return selected
}

function scopeGraph(graph, scope) {
  if (!isPlainObject(scope) || !['graph', 'node', 'downstream'].includes(scope.kind)) throw new Error('invalid scope')
  if (scope.kind === 'graph') return graph
  if (typeof scope.nodeId !== 'string' || !graph.nodes.some(node => node.id === scope.nodeId)) throw new Error('invalid scope nodeId')
  const selected = new Set([scope.nodeId])
  if (scope.kind === 'downstream') {
    let changed = true
    while (changed) {
      changed = false
      for (const edge of graph.edges) {
        if (selected.has(edge.source.nodeId) && !selected.has(edge.target.nodeId)) {
          selected.add(edge.target.nodeId)
          changed = true
        }
      }
    }
  }
  ancestorsOf(graph, selected)
  return {
    schemaVersion: 1,
    nodes: graph.nodes.filter(node => selected.has(node.id)),
    edges: graph.edges.filter(edge => selected.has(edge.source.nodeId) && selected.has(edge.target.nodeId)),
  }
}

async function canonicalRoots(roots) {
  return Promise.all(roots.map(root => realpath(root).catch(() => path.resolve(root))))
}

async function allowedRealPath(candidate, roots) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return null
  const resolved = await realpath(candidate).catch(() => null)
  return resolved && roots.some(root => isInside(resolved, root)) ? resolved : null
}

async function readRequestBuffer(request, maximumBytes) {
  const declaredLength = Number(request.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error('request body too large')
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = error => {
      if (settled) return
      settled = true
      reject(error)
    }
    request.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > maximumBytes) {
        chunks.length = 0
        fail(new Error('request body too large'))
      } else chunks.push(chunk)
    })
    request.once('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    request.once('error', fail)
    request.once('aborted', () => fail(new Error('request aborted')))
  })
}

async function readJsonBody(request) {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new Error('application/json required')
  const body = await readRequestBuffer(request, MAX_JSON_BYTES)
  try {
    return JSON.parse(body.toString('utf8') || '{}')
  } catch {
    throw new Error('invalid JSON')
  }
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`)
  const headerSeparator = Buffer.from('\r\n\r\n')
  let cursor = 0
  while (true) {
    const boundaryStart = body.indexOf(delimiter, cursor)
    if (boundaryStart < 0) break
    let partStart = boundaryStart + delimiter.length
    if (body.subarray(partStart, partStart + 2).equals(Buffer.from('--'))) break
    if (!body.subarray(partStart, partStart + 2).equals(Buffer.from('\r\n'))) throw new Error('invalid multipart body')
    partStart += 2
    const headersEnd = body.indexOf(headerSeparator, partStart)
    if (headersEnd < 0) throw new Error('invalid multipart body')
    const headers = body.subarray(partStart, headersEnd).toString('utf8')
    const disposition = headers.split('\r\n').find(line => /^content-disposition:/i.test(line))
    const name = disposition?.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1]
    const fileName = disposition?.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1]
    const dataStart = headersEnd + headerSeparator.length
    const nextBoundary = body.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart)
    if (nextBoundary < 0) throw new Error('invalid multipart body')
    if (name === 'file' && fileName) {
      return { fileName: path.basename(fileName.replaceAll('\\', '/')), data: body.subarray(dataStart, nextBoundary) }
    }
    cursor = nextBoundary + 2
  }
  throw new Error('multipart file field required')
}

function publicRun(run) {
  return {
    runId: run.runId,
    status: run.status,
    progress: run.progress,
    nodes: Object.fromEntries(Object.entries(run.nodes).map(([nodeId, node]) => [nodeId, {
      status: node.status,
      ...(node.error ? { error: node.error } : {}),
      outputs: { ...node.outputs },
    }])),
  }
}

export function createAteliRouter(options = {}) {
  const exportRoots = options.exportRoots ?? {}
  if (!isPlainObject(exportRoots)) throw new Error('exportRoots must be a label-to-path map')
  for (const [label, root] of Object.entries(exportRoots)) {
    if (!label || typeof root !== 'string' || !path.isAbsolute(root)) throw new Error(`invalid export root ${label}`)
  }
  const config = {
    stagingRoot: path.resolve(options.stagingRoot ?? DEFAULT_STAGING_ROOT),
    allowedSourceRoots: options.allowedSourceRoots ?? [DEFAULT_SOURCE_ROOT],
    blenderPath: options.blenderPath ?? '/opt/homebrew/bin/blender',
    pythonPath: options.pythonPath ?? 'python3',
    imageWorkerPath: options.imageWorkerPath ?? IMAGE_WORKER,
    meshWorkerPath: options.meshWorkerPath ?? MESH_WORKER,
    nodePath: options.nodePath ?? process.execPath,
    meshyWorkerPath: options.meshyWorkerPath ?? MESHY_WORKER,
    exportRoots: { ...exportRoots },
    workerCommand: options.workerCommand,
    maxUploadBytes: options.maxUploadBytes ?? MAX_UPLOAD_BYTES,
  }
  const configuredTools = toolsForExportRoots(Object.keys(config.exportRoots))
  const configuredToolMap = new Map(configuredTools.map(tool => [tool.id, tool]))
  const runs = new Map()
  const results = new Map()
  const sources = new Map()
  const executions = new Set()
  const sourceRootsPromise = canonicalRoots(config.allowedSourceRoots)
  let closing = false

  function serializeResult(result) {
    return {
      resultId: result.resultId,
      runId: result.runId,
      nodeId: result.nodeId,
      portId: result.portId,
      kind: result.kind,
      name: result.name,
      size: result.size,
      sha256: result.sha256,
      ...(result.value !== undefined ? { value: result.value } : {}),
      ...(result.meta !== undefined ? { meta: result.meta } : {}),
      relativePath: result.relativePath,
      ...(result.previewRelativePath ? { previewRelativePath: result.previewRelativePath } : {}),
    }
  }

  function persistedRun(run) {
    return {
      runId: run.runId,
      status: run.status,
      progress: run.progress,
      graph: run.graph,
      scope: run.scope,
      cache: run.cache,
      nodes: run.nodes,
      cacheKeys: run.cacheKeys,
      inputHashes: run.inputHashes,
      results: Object.values(run.resultRecords).map(serializeResult),
    }
  }

  async function persistRun(run) {
    const temporaryPath = path.join(run.directory, `run.json.${process.pid}.${randomUUID()}.tmp`)
    await writeFile(temporaryPath, `${JSON.stringify(persistedRun(run), null, 2)}\n`)
    await rename(temporaryPath, path.join(run.directory, 'run.json'))
  }

  async function pathForRelative(root, relativePath) {
    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) throw new Error('invalid output path')
    const absolutePath = path.resolve(root, relativePath)
    if (!isInside(absolutePath, root) || absolutePath === root) throw new Error('output escaped node directory')
    const info = await stat(absolutePath).catch(() => null)
    if (!info?.isFile()) throw new Error(`missing output file ${relativePath}`)
    return { absolutePath, info }
  }

  function addResult(run, record) {
    const absolutePath = path.resolve(run.directory, record.relativePath)
    if (!isInside(absolutePath, run.directory) || absolutePath === run.directory) throw new Error('result escaped run directory')
    let previewPath
    if (record.previewRelativePath) {
      previewPath = path.resolve(run.directory, record.previewRelativePath)
      if (!isInside(previewPath, run.directory) || previewPath === run.directory) throw new Error('preview escaped run directory')
    }
    const result = { ...record, absolutePath, previewPath }
    results.set(result.resultId, result)
    run.resultRecords[result.resultId] = result
    run.artifacts[result.nodeId] ??= {}
    run.artifacts[result.nodeId][result.portId] = result
    return result
  }

  async function registerNodeOutputs(run, node, tool, nodeDirectory, outputDocument) {
    if (!isPlainObject(outputDocument)) throw new Error('invalid outputs.json')
    const preview = isPlainObject(outputDocument.preview) ? outputDocument.preview : {}
    const metadata = isPlainObject(outputDocument.meta) ? outputDocument.meta : {}
    const outputIds = {}
    for (const output of tool.outputs) {
      const relativeOutput = outputDocument[output.id]
      const outputFile = await pathForRelative(nodeDirectory, relativeOutput)
      let previewRelativePath
      if (output.type === 'mesh' && (tool.runtime !== 'none' || preview[output.id])) {
        const previewFile = await pathForRelative(nodeDirectory, preview[output.id])
        previewRelativePath = path.relative(run.directory, previewFile.absolutePath)
      } else if (output.type === 'image') {
        previewRelativePath = path.relative(run.directory, outputFile.absolutePath)
      }
      let value
      if (SCALAR_TYPES.has(output.type)) {
        try {
          value = JSON.parse(await readFile(outputFile.absolutePath, 'utf8'))
        } catch {
          throw new Error(`invalid scalar output ${output.id}`)
        }
        validateScalar(output, value)
      }
      let meta
      if (Object.hasOwn(metadata, output.id)) {
        const metaFile = await pathForRelative(nodeDirectory, metadata[output.id])
        try {
          meta = JSON.parse(await readFile(metaFile.absolutePath, 'utf8'))
        } catch {
          throw new Error(`invalid result metadata ${output.id}`)
        }
        if (!isPlainObject(meta)) throw new Error(`invalid result metadata ${output.id}`)
      }
      const resultId = digest(`${run.runId}\0${node.id}\0${output.id}`).slice(0, 32)
      const relativePath = path.relative(run.directory, outputFile.absolutePath)
      const result = addResult(run, {
        resultId,
        runId: run.runId,
        nodeId: node.id,
        portId: output.id,
        kind: output.type,
        name: path.basename(outputFile.absolutePath),
        size: outputFile.info.size,
        sha256: await fileDigest(outputFile.absolutePath),
        ...(value !== undefined ? { value } : {}),
        ...(meta !== undefined ? { meta } : {}),
        relativePath,
        ...(previewRelativePath ? { previewRelativePath } : {}),
      })
      outputIds[output.id] = result.resultId
    }
    run.nodes[node.id].outputs = outputIds
  }

  async function copyOutputSet(sourceDirectory, targetDirectory, outputDocument, tool) {
    const relativePaths = new Set(['outputs.json'])
    for (const output of tool.outputs) relativePaths.add(outputDocument[output.id])
    if (isPlainObject(outputDocument.preview)) {
      for (const output of tool.outputs) if (outputDocument.preview[output.id]) relativePaths.add(outputDocument.preview[output.id])
    }
    if (isPlainObject(outputDocument.meta)) {
      for (const output of tool.outputs) if (outputDocument.meta[output.id]) relativePaths.add(outputDocument.meta[output.id])
    }
    if (typeof outputDocument.log === 'string') relativePaths.add(outputDocument.log)
    for (const relativePath of relativePaths) {
      const source = await pathForRelative(sourceDirectory, relativePath)
      const target = path.resolve(targetDirectory, relativePath)
      if (!isInside(target, targetDirectory) || target === targetDirectory) throw new Error('cache output escaped directory')
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(source.absolutePath, target)
    }
  }

  async function readOutputs(nodeDirectory) {
    try {
      return JSON.parse(await readFile(path.join(nodeDirectory, 'outputs.json'), 'utf8'))
    } catch {
      throw new Error('missing or invalid outputs.json')
    }
  }

  async function resolveInputs(run, node, tool) {
    const inputs = {}
    const hashableInputs = {}
    const inputHashes = {}
    for (const input of tool.inputs) {
      const edge = run.graph.edges.find(candidate => candidate.target.nodeId === node.id && candidate.target.portId === input.id)
      if (edge) {
        const upstream = run.artifacts[edge.source.nodeId]?.[edge.source.portId]
        if (!upstream) throw new Error(`missing upstream output ${edge.source.nodeId}.${edge.source.portId}`)
        inputHashes[input.id] = upstream.sha256
        if (FILE_TYPES.has(input.type)) {
          inputs[input.id] = { path: upstream.absolutePath }
          hashableInputs[input.id] = upstream.sha256
        } else {
          inputs[input.id] = upstream.value
          hashableInputs[input.id] = upstream.value
        }
        continue
      }
      if (!Object.hasOwn(node.parameters, input.id)) continue
      const value = node.parameters[input.id]
      if (FILE_TYPES.has(input.type)) {
        const source = sources.get(value)
        if (!source) throw new Error(`unknown source ${value}`)
        const info = await stat(source.path).catch(() => null)
        if (!info?.isFile()) throw new Error(`source is unavailable ${value}`)
        const currentHash = await fileDigest(source.path)
        if (currentHash !== source.sha256) throw new Error(`source changed ${value}`)
        inputs[input.id] = { path: source.path }
        hashableInputs[input.id] = source.sha256
        inputHashes[input.id] = source.sha256
      } else {
        inputs[input.id] = value
        hashableInputs[input.id] = value
      }
    }
    return { inputs, hashableInputs, inputHashes }
  }

  async function resolveInputNode(run, node, tool, nodeDirectory, inputs) {
    const input = tool.inputs[0]
    const output = tool.outputs[0]
    const outputDocument = {}
    if (FILE_TYPES.has(input.type)) {
      const extension = path.extname(inputs[input.id].path).toLowerCase()
      const outputName = `${output.id}${extension}`
      const outputPath = path.join(nodeDirectory, outputName)
      await copyFile(inputs[input.id].path, outputPath)
      outputDocument[output.id] = outputName
      // An uploaded mesh is the one node whose preview the bridge must arrange itself: render it through mesh.render.
      if (output.type === 'mesh') {
        const preview = await renderMeshPreview(run, node, nodeDirectory, outputPath)
        if (preview) outputDocument.preview = { [output.id]: preview }
      }
    } else {
      const outputName = `${output.id}.json`
      await writeFile(path.join(nodeDirectory, outputName), `${JSON.stringify(inputs[input.id])}\n`)
      outputDocument[output.id] = outputName
    }
    await writeFile(path.join(nodeDirectory, 'outputs.json'), `${JSON.stringify(outputDocument, null, 2)}\n`)
    return outputDocument
  }

  async function installExport(sourcePath, destinationPath) {
    const existing = await lstat(destinationPath).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (existing) {
      if (!existing.isFile() || await fileDigest(destinationPath) !== await fileDigest(sourcePath)) {
        throw new Error(`export target exists with different contents: ${destinationPath}`)
      }
      return
    }
    try {
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const raced = await lstat(destinationPath)
      if (!raced.isFile() || await fileDigest(destinationPath) !== await fileDigest(sourcePath)) {
        throw new Error(`export target exists with different contents: ${destinationPath}`)
      }
    }
  }

  function exportAncestors(run, node) {
    const ancestorIds = ancestorsOf(run.graph, new Set([node.id]))
    ancestorIds.delete(node.id)
    return topologicalOrder(run.graph)
      .filter(nodeId => ancestorIds.has(nodeId))
      .map(nodeId => {
        const upstreamNode = run.graph.nodes.find(candidate => candidate.id === nodeId)
        return {
          nodeId,
          toolId: upstreamNode.toolId,
          parameters: structuredClone(upstreamNode.parameters),
          inputHashes: { ...(run.inputHashes[nodeId] ?? {}) },
        }
      })
  }

  function exportMetadata(run, upstream) {
    const metadata = []
    for (const ancestor of upstream) {
      for (const result of Object.values(run.artifacts[ancestor.nodeId] ?? {})) {
        if (isPlainObject(result.meta)) metadata.push(result.meta)
      }
    }
    return metadata.length ? Object.assign({}, ...metadata) : null
  }

  async function resolveExportNode(run, node, nodeDirectory, inputs) {
    const inputPort = inputs.mesh ? 'mesh' : 'image'
    const edge = run.graph.edges.find(candidate => candidate.target.nodeId === node.id && candidate.target.portId === inputPort)
    const source = edge && run.artifacts[edge.source.nodeId]?.[edge.source.portId]
    if (!source) throw new Error(`missing export input ${node.id}.${inputPort}`)
    const root = config.exportRoots[inputs.folder]
    const rootInfo = root && await stat(root).catch(() => null)
    if (!rootInfo?.isDirectory()) throw new Error(`export root is unavailable: ${inputs.folder}`)
    const name = inputs.name
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('invalid export name')
    const extension = path.extname(source.absolutePath).toLowerCase()
    if (!extension) throw new Error('export input has no file extension')
    const destinationPath = path.join(root, `${name}${extension}`)
    await installExport(source.absolutePath, destinationPath)

    const upstream = exportAncestors(run, node)
    const provenance = {
      sha256: source.sha256,
      size: source.size,
      exportedAt: new Date().toISOString(),
      runId: run.runId,
      nodeId: node.id,
      upstream,
      meta: exportMetadata(run, upstream),
    }
    const provenancePath = path.join(root, `${name}.provenance.json`)
    const temporaryPath = `${provenancePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(provenance, null, 2)}\n`)
    await rename(temporaryPath, provenancePath)

    const outputDocument = { path: 'path.json' }
    await writeFile(path.join(nodeDirectory, outputDocument.path), `${JSON.stringify(destinationPath)}\n`)
    await writeFile(path.join(nodeDirectory, 'outputs.json'), `${JSON.stringify(outputDocument, null, 2)}\n`)
    return outputDocument
  }

  async function resolveInProcessNode(run, node, tool, nodeDirectory, inputs) {
    if (tool.id === 'output.export') return resolveExportNode(run, node, nodeDirectory, inputs)
    if (tool.category === 'Input') return resolveInputNode(run, node, tool, nodeDirectory, inputs)
    throw new Error(`unsupported in-process tool: ${tool.id}`)
  }

  // Best effort: a failed preview leaves the mesh usable and is recorded in the node log.
  async function renderMeshPreview(run, node, nodeDirectory, meshPath) {
    const renderTool = configuredToolMap.get('mesh.render')
    const previewDirectory = path.join(nodeDirectory, 'preview')
    await mkdir(previewDirectory, { recursive: true })
    const requestPath = path.join(previewDirectory, 'request.json')
    await writeFile(requestPath, `${JSON.stringify({
      runId: run.runId,
      nodeId: node.id,
      toolId: renderTool.id,
      inputs: { mesh: { path: meshPath }, yaw: 35, pitch: 15, size: 512 },
      outputDir: previewDirectory,
    }, null, 2)}\n`)
    try {
      await spawnWorker(run, node, renderTool, previewDirectory, requestPath)
      const rendered = await readOutputs(previewDirectory)
      if (typeof rendered.image !== 'string') throw new Error('preview worker wrote no image')
      return path.posix.join('preview', rendered.image)
    } catch (error) {
      await appendFile(path.join(nodeDirectory, 'worker.log'), `preview render failed: ${error.message}\n`)
      return undefined
    }
  }

  function workerCommand(runtime, context) {
    const override = config.workerCommand
    if (typeof override === 'function') return override({ runtime, ...context })
    if (isPlainObject(override) && override[runtime]) {
      return typeof override[runtime] === 'function' ? override[runtime](context) : override[runtime]
    }
    if (runtime === 'blender') {
      return { executable: config.blenderPath, args: ['--background', '--factory-startup', '--python', config.meshWorkerPath, '--', context.requestPath] }
    }
    if (runtime === 'meshy') return { executable: config.nodePath, args: [config.meshyWorkerPath, context.requestPath] }
    if (runtime === 'image' || runtime === 'imgen') {
      return { executable: config.pythonPath, args: [config.imageWorkerPath, context.requestPath] }
    }
    throw new Error(`unsupported worker runtime ${runtime}`)
  }

  async function spawnWorker(run, node, tool, nodeDirectory, requestPath) {
    const command = workerCommand(tool.runtime, { runId: run.runId, nodeId: node.id, nodeDirectory, requestPath, tool })
    if (!command?.executable || !Array.isArray(command.args)) throw new Error(`invalid worker command for ${tool.runtime}`)
    const logPath = path.join(nodeDirectory, 'worker.log')
    const logStream = createWriteStream(logPath)
    let stderrTail = ''
    const child = spawn(command.executable, command.args, {
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(command.cwd ? { cwd: command.cwd } : {}),
      env: { ...process.env, ...(command.env ?? {}) },
    })
    run.current = { child, nodeId: node.id, processGroup: child.pid ? -child.pid : undefined }
    child.stdout.pipe(logStream, { end: false })
    child.stderr.on('data', chunk => {
      stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-STDERR_TAIL_BYTES)
    })
    child.stderr.pipe(logStream, { end: false })
    const exit = await new Promise(resolve => {
      let settled = false
      const finish = value => {
        if (settled) return
        settled = true
        resolve(value)
      }
      child.once('error', error => finish({ code: null, signal: null, error }))
      child.once('exit', (code, signal) => finish({ code, signal }))
    })
    await new Promise(resolve => logStream.end(resolve))
    run.current = null
    if (run.cancelRequested) throw new Error('run cancelled')
    if (exit.error) throw new Error(exit.error.message)
    if (exit.code !== 0) {
      const fallback = `worker exited with code ${exit.code ?? 'none'}${exit.signal ? ` (${exit.signal})` : ''}`
      throw new Error(stderrTail.trim() || fallback)
    }
  }

  async function writeCache(cacheKey, nodeDirectory, outputDocument, tool) {
    const cacheRoot = path.join(config.stagingRoot, 'cache')
    const target = path.join(cacheRoot, cacheKey)
    if ((await stat(target).catch(() => null))?.isDirectory()) return
    const temporary = path.join(cacheRoot, `.${cacheKey}.${randomUUID()}.tmp`)
    await mkdir(temporary, { recursive: true })
    try {
      await copyOutputSet(nodeDirectory, temporary, outputDocument, tool)
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      if (!(await stat(target).catch(() => null))?.isDirectory()) throw error
    }
  }

  async function executeNode(run, node) {
    const tool = configuredToolMap.get(node.toolId)
    const nodeDirectory = path.join(run.directory, 'nodes', node.id)
    await mkdir(nodeDirectory, { recursive: true })
    const { inputs, hashableInputs, inputHashes } = await resolveInputs(run, node, tool)
    run.inputHashes[node.id] = inputHashes
    const requestPath = path.join(nodeDirectory, 'request.json')
    await writeFile(requestPath, `${JSON.stringify({
      runId: run.runId,
      nodeId: node.id,
      toolId: tool.id,
      inputs,
      outputDir: nodeDirectory,
    }, null, 2)}\n`)
    const cacheKey = digest(`${tool.id}${tool.version}${canonicalJson(hashableInputs)}`)
    run.cacheKeys[node.id] = cacheKey
    const cacheable = tool.id !== 'output.export'
    const cacheDirectory = path.join(config.stagingRoot, 'cache', cacheKey)
    if (run.cache && cacheable && (await stat(cacheDirectory).catch(() => null))?.isDirectory()) {
      try {
        const cachedOutputs = await readOutputs(cacheDirectory)
        await copyOutputSet(cacheDirectory, nodeDirectory, cachedOutputs, tool)
        await registerNodeOutputs(run, node, tool, nodeDirectory, cachedOutputs)
        return 'cached'
      } catch {
        await rm(cacheDirectory, { recursive: true, force: true })
      }
    }

    const outputDocument = tool.runtime === 'none'
      ? await resolveInProcessNode(run, node, tool, nodeDirectory, inputs)
      : (await spawnWorker(run, node, tool, nodeDirectory, requestPath), await readOutputs(nodeDirectory))
    await registerNodeOutputs(run, node, tool, nodeDirectory, outputDocument)
    if (run.cache && cacheable) await writeCache(cacheKey, nodeDirectory, outputDocument, tool)
    return 'succeeded'
  }

  function updateProgress(run) {
    const completed = Object.values(run.nodes).filter(node => node.status === 'succeeded' || node.status === 'cached').length
    run.progress = run.graph.nodes.length === 0 ? 1 : completed / run.graph.nodes.length
  }

  function skipQueuedNodes(run) {
    for (const state of Object.values(run.nodes)) if (state.status === 'queued' || state.status === 'running') state.status = 'skipped'
  }

  async function executeRun(run) {
    run.status = 'running'
    await persistRun(run)
    try {
      for (const nodeId of topologicalOrder(run.graph)) {
        if (run.cancelRequested) break
        const node = run.graph.nodes.find(candidate => candidate.id === nodeId)
        run.nodes[nodeId].status = 'running'
        await persistRun(run)
        try {
          const status = await executeNode(run, node)
          if (run.cancelRequested) break
          run.nodes[nodeId].status = status
          updateProgress(run)
          await persistRun(run)
        } catch (error) {
          if (run.cancelRequested) break
          run.nodes[nodeId].status = 'failed'
          run.nodes[nodeId].error = error.message
          skipQueuedNodes(run)
          run.status = 'failed'
          updateProgress(run)
          await persistRun(run)
          return
        }
      }
      if (run.cancelRequested) {
        skipQueuedNodes(run)
        run.status = 'cancelled'
      } else {
        run.status = 'completed'
        run.progress = 1
      }
      await persistRun(run)
    } finally {
      run.current = null
    }
  }

  function launchRun(run) {
    const execution = executeRun(run).catch(async error => {
      if (run.cancelRequested) {
        skipQueuedNodes(run)
        run.status = 'cancelled'
      } else {
        skipQueuedNodes(run)
        run.status = 'failed'
        const runningNode = Object.values(run.nodes).find(node => node.status === 'running')
        if (runningNode) {
          runningNode.status = 'failed'
          runningNode.error = error.message
        }
      }
      updateProgress(run)
      await persistRun(run).catch(() => {})
    }).finally(() => executions.delete(execution))
    executions.add(execution)
  }

  // Path-form sources reference files outside staging, so their registry is persisted; uploads are content-addressed on disk.
  const sourceIndexPath = () => path.join(config.stagingRoot, 'sources', 'index.json')
  async function persistSourceIndex() {
    const linked = [...sources.values()].filter(source => !isInside(source.path, path.join(config.stagingRoot, 'sources')))
    const temporary = `${sourceIndexPath()}.${randomUUID()}`
    await writeFile(temporary, `${JSON.stringify(linked, null, 2)}\n`)
    await rename(temporary, sourceIndexPath())
  }

  async function registerSource(sourcePath, name = path.basename(sourcePath)) {
    const info = await stat(sourcePath)
    if (!info.isFile()) throw new Error('source path is not a file')
    const kind = sourceKind(name)
    const sha256 = await fileDigest(sourcePath)
    const sourceId = sha256
    const source = { sourceId, sha256, size: info.size, name, kind, path: sourcePath }
    sources.set(sourceId, source)
    await persistSourceIndex()
    return source
  }

  async function createSource(request) {
    const contentType = String(request.headers['content-type'] ?? '')
    if (/^application\/json(?:\s*;|$)/i.test(contentType)) {
      const payload = await readJsonBody(request)
      if (!isPlainObject(payload) || typeof payload.path !== 'string') throw new Error('path is required')
      const sourceRoots = await sourceRootsPromise
      const sourcePath = await allowedRealPath(payload.path, sourceRoots)
      if (!sourcePath) throw new Error('source path is not allowlisted')
      return registerSource(sourcePath)
    }
    const boundary = contentType.match(/^multipart\/form-data\s*;[^]*\bboundary=(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean)
    if (!boundary) throw new Error('application/json or multipart/form-data required')
    const body = await readRequestBuffer(request, config.maxUploadBytes)
    const upload = parseMultipart(body, boundary)
    const kind = sourceKind(upload.fileName)
    const extension = path.extname(upload.fileName).toLowerCase()
    const sha256 = digest(upload.data)
    const sourceDirectory = path.join(config.stagingRoot, 'sources')
    await mkdir(sourceDirectory, { recursive: true })
    const sourcePath = path.join(sourceDirectory, `${sha256}${extension}`)
    await writeFile(sourcePath, upload.data)
    const source = { sourceId: sha256, sha256, size: upload.data.length, name: upload.fileName, kind, path: sourcePath }
    sources.set(source.sourceId, source)
    return source
  }

  function sourceResponse(source) {
    return {
      sourceId: source.sourceId,
      sha256: source.sha256,
      size: source.size,
      name: source.name,
      kind: source.kind,
    }
  }

  async function streamResult(response, run, filePath, contentType) {
    const realRunDirectory = await realpath(run.directory).catch(() => null)
    const realFilePath = await realpath(filePath).catch(() => null)
    if (!realRunDirectory || !realFilePath || !isInside(realFilePath, realRunDirectory)) throw new Error('result path is outside run directory')
    const info = await stat(realFilePath)
    if (!info.isFile()) throw new Error('result file is missing')
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
    })
    createReadStream(realFilePath).pipe(response)
  }

  async function rehydrateSources() {
    const directory = path.join(config.stagingRoot, 'sources')
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = entry.name.match(/^([a-f0-9]{64})(\.[A-Za-z0-9]+)$/)
      if (!match) continue
      try {
        const sourcePath = path.join(directory, entry.name)
        const info = await stat(sourcePath)
        const kind = sourceKind(entry.name)
        sources.set(match[1], { sourceId: match[1], sha256: match[1], size: info.size, name: entry.name, kind, path: sourcePath })
      } catch {}
    }
    const linked = JSON.parse(await readFile(sourceIndexPath(), 'utf8').catch(() => '[]'))
    const allowedRoots = await sourceRootsPromise
    for (const source of Array.isArray(linked) ? linked : []) {
      // Re-check the allowlist and existence: the file may have moved or the roots may have changed since it was linked.
      if (!(await allowedRealPath(source.path, allowedRoots))) continue
      if (!(await stat(source.path).catch(() => null))?.isFile()) continue
      sources.set(source.sourceId, source)
    }
  }

  async function rehydrateRuns() {
    const entries = await readdir(config.stagingRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'cache' || entry.name === 'sources') continue
      const directory = path.join(config.stagingRoot, entry.name)
      let stored
      try {
        stored = JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8'))
        stored.graph = validateGraph(stored.graph, configuredTools)
      } catch {
        continue
      }
      const run = {
        runId: stored.runId,
        status: stored.status,
        progress: stored.progress,
        graph: stored.graph,
        scope: stored.scope,
        cache: stored.cache !== false,
        nodes: stored.nodes,
        cacheKeys: stored.cacheKeys ?? {},
        inputHashes: stored.inputHashes ?? {},
        resultRecords: {},
        artifacts: {},
        directory,
        current: null,
        cancelRequested: false,
      }
      let invalid = false
      for (const record of stored.results ?? []) {
        try {
          const output = await pathForRelative(directory, record.relativePath)
          if (record.previewRelativePath) await pathForRelative(directory, record.previewRelativePath)
          addResult(run, { ...record, size: output.info.size })
        } catch {
          invalid = true
          break
        }
      }
      if (invalid) continue
      if (run.status === 'queued' || run.status === 'running') {
        const running = Object.values(run.nodes).find(node => node.status === 'running')
        if (running) {
          running.status = 'failed'
          running.error = 'router restarted during execution'
        }
        skipQueuedNodes(run)
        run.status = 'failed'
        updateProgress(run)
        await persistRun(run)
      }
      runs.set(run.runId, run)
    }
  }

  async function initialize() {
    await mkdir(config.stagingRoot, { recursive: true })
    await mkdir(path.join(config.stagingRoot, 'cache'), { recursive: true })
    await mkdir(path.join(config.stagingRoot, 'sources'), { recursive: true })
    await rehydrateSources()
    await rehydrateRuns()
  }

  const ready = initialize()

  async function cancelRun(run) {
    if (!['queued', 'running'].includes(run.status)) return
    run.cancelRequested = true
    run.status = 'cancelled'
    skipQueuedNodes(run)
    const processGroup = run.current?.processGroup
    if (processGroup) {
      try { process.kill(processGroup, 'SIGTERM') } catch {}
      const child = run.current.child
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { process.kill(processGroup, 'SIGKILL') } catch {}
        }
      }, 1000).unref()
    }
    updateProgress(run)
    await persistRun(run)
  }

  async function clearNodeCache(nodeId) {
    const keys = new Set()
    for (const run of runs.values()) if (run.cacheKeys[nodeId]) keys.add(run.cacheKeys[nodeId])
    for (const key of keys) await rm(path.join(config.stagingRoot, 'cache', key), { recursive: true, force: true })
    return keys.size
  }

  async function handle(request, response, url) {
    if (!url.pathname.startsWith('/ateli')) return false
    try {
      await ready
      if (request.method === 'GET' && url.pathname === '/ateli/tools') {
        sendJson(response, 200, toolsForExportRoots(Object.keys(config.exportRoots)))
        return true
      }
      if (request.method === 'POST' && url.pathname === '/ateli/sources') {
        const source = await createSource(request)
        sendJson(response, 200, sourceResponse(source))
        return true
      }
      if (request.method === 'POST' && url.pathname === '/ateli/runs') {
        if (closing) throw new Error('router is closing')
        const payload = await readJsonBody(request)
        const validatedGraph = validateGraph(payload.graph, configuredTools)
        const graph = scopeGraph(validatedGraph, payload.scope)
        for (const node of graph.nodes) {
          const tool = configuredToolMap.get(node.toolId)
          for (const input of tool.inputs) {
            if (tool.category === 'Input' && FILE_TYPES.has(input.type) && !sources.has(node.parameters[input.id])) {
              throw new Error(`unknown source ${node.parameters[input.id]}`)
            }
          }
        }
        if (payload.cache !== undefined && typeof payload.cache !== 'boolean') throw new Error('cache must be boolean')
        const runId = randomUUID()
        const directory = path.join(config.stagingRoot, runId)
        await mkdir(path.join(directory, 'nodes'), { recursive: true })
        const run = {
          runId,
          status: 'queued',
          progress: 0,
          graph,
          scope: payload.scope,
          cache: payload.cache !== false,
          nodes: Object.fromEntries(graph.nodes.map(node => [node.id, { status: 'queued', outputs: {} }])),
          cacheKeys: {},
          inputHashes: {},
          resultRecords: {},
          artifacts: {},
          directory,
          current: null,
          cancelRequested: false,
        }
        runs.set(runId, run)
        await persistRun(run)
        launchRun(run)
        sendJson(response, 202, { runId, status: 'queued' })
        return true
      }

      const runMatch = url.pathname.match(/^\/ateli\/runs\/([^/]+)(?:\/(cancel))?$/)
      if (runMatch) {
        const run = runs.get(decodeURIComponent(runMatch[1]))
        if (!run) {
          sendJson(response, 404, { error: 'unknown run' })
          return true
        }
        if (request.method === 'GET' && !runMatch[2]) {
          sendJson(response, 200, publicRun(run))
          return true
        }
        if (request.method === 'POST' && runMatch[2] === 'cancel') {
          await cancelRun(run)
          sendJson(response, 200, publicRun(run))
          return true
        }
      }

      const cacheMatch = url.pathname.match(/^\/ateli\/cache\/([^/]+)$/)
      if (request.method === 'DELETE' && cacheMatch) {
        const nodeId = decodeURIComponent(cacheMatch[1])
        sendJson(response, 200, { nodeId, deleted: await clearNodeCache(nodeId) })
        return true
      }

      const resultMatch = url.pathname.match(/^\/ateli\/results\/([^/]+)(?:\/(preview))?$/)
      if (request.method === 'GET' && resultMatch) {
        const result = results.get(decodeURIComponent(resultMatch[1]))
        if (!result) {
          sendJson(response, 404, { error: 'unknown result' })
          return true
        }
        const run = runs.get(result.runId)
        if (!run) throw new Error('result run is unavailable')
        if (resultMatch[2] === 'preview') {
          const previewPath = result.kind === 'image' ? result.absolutePath : result.previewPath
          if (!previewPath) {
            sendJson(response, 404, { error: 'result has no preview' })
            return true
          }
          await streamResult(response, run, previewPath, result.kind === 'image' ? mimeType(previewPath) : 'image/png')
          return true
        }
        if (url.searchParams.get('download') === '1') {
          await streamResult(response, run, result.absolutePath, mimeType(result.absolutePath))
          return true
        }
        sendJson(response, 200, {
          resultId: result.resultId,
          kind: result.kind,
          name: result.name,
          size: result.size,
          sha256: result.sha256,
          ...(result.value !== undefined ? { value: result.value } : {}),
          ...(result.meta !== undefined ? { meta: result.meta } : {}),
          downloadUrl: `/ateli/results/${result.resultId}?download=1`,
          previewUrl: result.kind === 'image' || result.previewPath ? `/ateli/results/${result.resultId}/preview` : null,
        })
        return true
      }

      sendJson(response, 404, { error: 'not found' })
      return true
    } catch (error) {
      sendJson(response, 400, { error: error.message })
      return true
    }
  }

  async function close() {
    closing = true
    await ready
    await Promise.all([...runs.values()].map(run => cancelRun(run)))
    await Promise.allSettled([...executions])
  }

  return {
    handle,
    close,
    health: async () => {
      await ready
      return {
        runs: runs.size,
        results: results.size,
        activeRuns: [...runs.values()].filter(run => run.status === 'queued' || run.status === 'running').length,
      }
    },
  }
}
