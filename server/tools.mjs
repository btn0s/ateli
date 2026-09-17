// An enum always has a value: the first option unless a default is given, so an untouched dropdown never fails validation.
function param(id, label, type, options = {}) {
  const withDefault = type === 'enum' && options.default === undefined && options.options?.length ? { default: options.options[0] } : {}
  return { id, label, type, required: options.required ?? true, ...options, ...withDefault }
}

const aspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4']
const imageModels = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gemini-3.1-flash-image']
const faceAxes = ['-Y', '+Y', '-X', '+X', '-Z', '+Z']

/** @type {Array<{id: string, version: 1, title: string, category: 'Input'|'Image'|'Mesh'|'Output'|'Utility', runtime: 'none'|'image'|'imgen'|'blender'|'meshy'|'gltf', inputs: object[], outputs: object[]}>} */
export const tools = [
  {
    id: 'input.text', version: 1, title: 'Input Text', category: 'Input', runtime: 'none',
    inputs: [param('value', 'Value', 'text', { multiline: true })],
    outputs: [param('text', 'Text', 'text')],
  },
  {
    id: 'input.number', version: 1, title: 'Input Number', category: 'Input', runtime: 'none',
    inputs: [param('value', 'Value', 'number', { default: 0 })],
    outputs: [param('number', 'Number', 'number')],
  },
  {
    id: 'input.boolean', version: 1, title: 'Input Boolean', category: 'Input', runtime: 'none',
    inputs: [param('value', 'Value', 'boolean', { default: false })],
    outputs: [param('boolean', 'Boolean', 'boolean')],
  },
  {
    id: 'input.image', version: 1, title: 'Input Image', category: 'Input', runtime: 'none',
    inputs: [param('file', 'File', 'image')],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'input.mesh', version: 1, title: 'Input Mesh', category: 'Input', runtime: 'none',
    inputs: [param('file', 'File', 'mesh')],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },
  {
    id: 'input.meshes', version: 1, title: 'Input Meshes', category: 'Input', runtime: 'none',
    inputs: [param('files', 'Files', 'mesh[]')],
    outputs: [param('meshes', 'Meshes', 'mesh[]')],
  },
  {
    id: 'input.images', version: 1, title: 'Input Images', category: 'Input', runtime: 'none',
    inputs: [param('files', 'Files', 'image[]')],
    outputs: [param('images', 'Images', 'image[]')],
  },


  {
    id: 'image.generate.fast', version: 1, title: 'Text → Image (Fast)', category: 'Image', runtime: 'imgen',
    inputs: [
      param('prompt', 'Prompt', 'text'),
      param('aspectRatio', 'Aspect Ratio', 'enum', { options: aspectRatios, default: '1:1' }),
      param('seed', 'Seed', 'number', { advanced: true }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.generate', version: 1, title: 'Text → Image (High Quality)', category: 'Image', runtime: 'imgen',
    inputs: [
      param('prompt', 'Prompt', 'text'),
      param('model', 'Model', 'enum', { options: imageModels }),
      param('aspectRatio', 'Aspect Ratio', 'enum', { options: aspectRatios }),
      param('quality', 'Quality', 'enum', { options: ['medium', 'high', 'max'], default: 'high' }),
      param('seed', 'Seed', 'number', { advanced: true }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.edit', version: 1, title: 'Edit Image with Text', category: 'Image', runtime: 'imgen',
    inputs: [
      param('image', 'Image', 'image'),
      param('prompt', 'Prompt', 'text'),
      param('model', 'Model', 'enum', { options: imageModels, advanced: true }),
      param('seed', 'Seed', 'number', { advanced: true }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.extend', version: 1, title: 'Extend Image', category: 'Image', runtime: 'imgen',
    inputs: [
      param('image', 'Image', 'image'),
      param('prompt', 'Prompt', 'text'),
      param('left', 'Left', 'number', { min: 0, max: 2048, default: 0 }),
      param('top', 'Top', 'number', { min: 0, max: 2048, default: 0 }),
      param('right', 'Right', 'number', { min: 0, max: 2048, default: 0 }),
      param('bottom', 'Bottom', 'number', { min: 0, max: 2048, default: 0 }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.removeBackground', version: 1, title: 'Remove Image Background', category: 'Image', runtime: 'imgen',
    inputs: [param('image', 'Image', 'image')],
    outputs: [param('cutout', 'Cutout', 'image'), param('mask', 'Mask', 'image')],
  },

  {
    id: 'image.procedural', version: 1, title: 'Procedural Image Builder', category: 'Image', runtime: 'image',
    inputs: [
      param('pattern', 'Pattern', 'enum', { options: ['checkerboard', 'grid', 'perlin', 'voronoi', 'gradient'] }),
      param('width', 'Width', 'number', { default: 1024 }),
      param('height', 'Height', 'number', { default: 1024 }),
      param('scale', 'Scale', 'number', { default: 8 }),
      param('seed', 'Seed', 'number', { default: 0 }),
      param('tileable', 'Tileable', 'boolean', { default: true }),
      param('colorA', 'Color A', 'text', { default: '#ffffff' }),
      param('colorB', 'Color B', 'text', { default: '#000000' }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.resize', version: 1, title: 'Simple Image Resize', category: 'Image', runtime: 'image',
    inputs: [
      param('image', 'Image', 'image'),
      param('width', 'Width', 'number'),
      param('height', 'Height', 'number'),
      param('keepAspect', 'Keep Aspect', 'boolean', { default: true }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.upscale', version: 1, title: 'Upscale Image', category: 'Image', runtime: 'image',
    inputs: [
      param('image', 'Image', 'image'),
      param('factor', 'Factor', 'enum', { options: ['2', '4'], default: '2' }),
      param('engine', 'Engine', 'enum', { options: ['lanczos'], advanced: true }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.cropManual', version: 1, title: 'Crop Image Manual', category: 'Image', runtime: 'image',
    inputs: [
      param('image', 'Image', 'image'),
      param('left', 'Left', 'number'), param('top', 'Top', 'number'),
      param('right', 'Right', 'number'), param('bottom', 'Bottom', 'number'),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.cropAuto', version: 1, title: 'Crop Image Auto', category: 'Image', runtime: 'image',
    inputs: [
      param('image', 'Image', 'image'),
      param('mask', 'Mask', 'image', { required: false }),
      param('padding', 'Padding', 'number', { default: 0 }),
    ],
    outputs: [param('image', 'Image', 'image'), param('region', 'Region', 'image')],
  },
  {
    id: 'image.pasteCrop', version: 1, title: 'Paste Crop Into Image', category: 'Image', runtime: 'image',
    inputs: [param('image', 'Image', 'image'), param('crop', 'Crop', 'image'), param('region', 'Region', 'image')],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.splitAlpha', version: 1, title: 'Split Alpha', category: 'Image', runtime: 'image',
    inputs: [param('image', 'Image', 'image')],
    outputs: [param('color', 'Color', 'image'), param('alpha', 'Alpha', 'image')],
  },
  {
    id: 'image.combineAlpha', version: 1, title: 'Combine Alpha', category: 'Image', runtime: 'image',
    inputs: [param('color', 'Color', 'image'), param('alpha', 'Alpha', 'image')],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.splitChannels', version: 1, title: 'Split Image Channels', category: 'Image', runtime: 'image',
    inputs: [param('image', 'Image', 'image')],
    outputs: [param('r', 'R', 'image'), param('g', 'G', 'image'), param('b', 'B', 'image'), param('a', 'A', 'image')],
  },
  {
    id: 'image.combineChannels', version: 1, title: 'Combine Image Channels', category: 'Image', runtime: 'image',
    inputs: [
      param('r', 'R', 'image'),
      param('g', 'G', 'image', { required: false }),
      param('b', 'B', 'image', { required: false }),
      param('a', 'A', 'image', { required: false }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.threshold', version: 1, title: 'Threshold Binary Mask', category: 'Image', runtime: 'image',
    inputs: [
      param('image', 'Image', 'image'),
      param('threshold', 'Threshold', 'number', { min: 0, max: 255, default: 128 }),
      param('invert', 'Invert', 'boolean', { default: false }),
    ],
    outputs: [param('mask', 'Mask', 'image')],
  },
  {
    id: 'image.rectMask', version: 1, title: 'Rect Mask', category: 'Image', runtime: 'image',
    inputs: [
      param('image', 'Image', 'image'),
      param('left', 'Left', 'number'), param('top', 'Top', 'number'),
      param('right', 'Right', 'number'), param('bottom', 'Bottom', 'number'),
    ],
    outputs: [param('mask', 'Mask', 'image')],
  },
  {
    id: 'image.ellipseMask', version: 1, title: 'Ellipse Mask', category: 'Image', runtime: 'image',
    inputs: [
      param('image', 'Image', 'image'),
      param('centerX', 'Center X', 'number'), param('centerY', 'Center Y', 'number'),
      param('width', 'Width', 'number'), param('height', 'Height', 'number'),
    ],
    outputs: [param('mask', 'Mask', 'image')],
  },
  {
    id: 'image.filter', version: 1, title: 'Image Filters', category: 'Image', runtime: 'image',
    inputs: [
      param('image', 'Image', 'image'),
      param('filter', 'Filter', 'enum', { options: ['blur', 'sharpen', 'grayscale', 'invert', 'brightness', 'contrast', 'saturation', 'posterize', 'edge'] }),
      param('amount', 'Amount', 'number', { min: 0, max: 100, default: 50 }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'image.normalFromDepth', version: 1, title: 'Fast Normal from Depth', category: 'Image', runtime: 'image',
    inputs: [
      param('depth', 'Depth', 'image'),
      param('strength', 'Strength', 'number', { min: 0.1, max: 10, default: 2 }),
    ],
    outputs: [param('normal', 'Normal', 'image')],
  },
  {
    id: 'image.normalConvention', version: 1, title: 'Normal Map Convention Convert', category: 'Image', runtime: 'image',
    inputs: [
      param('normal', 'Normal', 'image'),
      param('to', 'To', 'enum', { options: ['opengl', 'directx'] }),
    ],
    outputs: [param('normal', 'Normal', 'image')],
  },

  {
    id: 'mesh.fromImage', version: 1, title: 'Image → 3D', category: 'Mesh', runtime: 'meshy',
    inputs: [
      param('image', 'Image', 'image'),
      param('prompt', 'Prompt', 'text', { required: false }),
      param('model', 'Model', 'enum', { options: ['meshy-7', 'meshy-6'], default: 'meshy-7' }),
      param('pose', 'Pose', 'enum', { options: ['a-pose', 't-pose', 'none'], default: 'a-pose' }),
      param('texture', 'Texture', 'boolean', { default: true }),
      param('textureResolution', 'Texture Resolution', 'enum', { options: ['1k', '2k', '4k'], default: '2k' }),
      param('pbr', 'PBR', 'boolean', { default: false, advanced: true }),
      param('remesh', 'Remesh', 'boolean', { default: false, advanced: true }),
    ],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },
  {
    id: 'mesh.compress', version: 1, title: 'Compress for Web', category: 'Mesh', runtime: 'gltf',
    inputs: [
      param('mesh', 'Mesh', 'mesh'),
      param('geometry', 'Geometry', 'enum', { options: ['meshopt', 'draco', 'none'], default: 'meshopt' }),
      param('textureSize', 'Texture Size', 'enum', { options: ['256', '512', '1024', '2048', 'keep'], default: '1024' }),
      param('textureFormat', 'Texture Format', 'enum', { options: ['webp', 'jpeg', 'png', 'ktx2'], default: 'webp' }),
      param('quality', 'Quality', 'number', { min: 1, max: 100, default: 85, advanced: true }),
      param('quantize', 'Quantize', 'boolean', { default: true, advanced: true }),
      param('simplify', 'Simplify Ratio', 'number', { min: 0, max: 1, default: 0, advanced: true }),
      param('flatten', 'Flatten', 'boolean', { default: true, advanced: true }),
    ],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },


  {
    id: 'mesh.optimize', version: 1, title: 'Optimize Mesh', category: 'Mesh', runtime: 'blender',
    inputs: [
      param('mesh', 'Mesh', 'mesh'),
      param('engine', 'Engine', 'enum', { options: ['quadriflow', 'voxel', 'decimate'], default: 'quadriflow' }),
      param('targetFaces', 'Target Faces', 'number', { min: 4, max: 10000000, default: 80000 }),
      param('topology', 'Topology', 'enum', { options: ['triangle', 'quad'], default: 'triangle', advanced: true }),
      param('voxelSize', 'Voxel Size (0 = auto)', 'number', { min: 0, max: 1, default: 0, step: 0.001, advanced: true }),
      param('preserveUVs', 'Preserve UVs', 'boolean', { default: false, advanced: true }),
      param('smoothAngle', 'Smooth Angle (°, 0 = flat)', 'number', { min: 0, max: 180, default: 60, advanced: true }),
    ],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },
  {
    id: 'mesh.autoTransform', version: 1, title: 'Auto Transform Mesh', category: 'Mesh', runtime: 'blender',
    inputs: [
      param('mesh', 'Mesh', 'mesh'),
      param('targetHeight', 'Target Height', 'number', { default: 1.8 }),
      param('origin', 'Origin', 'enum', { options: ['bottom-center', 'center'], default: 'bottom-center' }),
      param('faceAxis', 'Face Axis', 'enum', { options: faceAxes, default: '-Y' }),
    ],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },
  {
    id: 'mesh.bboxFit', version: 1, title: 'Mesh BBox Fit', category: 'Mesh', runtime: 'blender',
    inputs: [
      param('mesh', 'Mesh', 'mesh'),
      param('width', 'Width', 'number'), param('height', 'Height', 'number'), param('depth', 'Depth', 'number'),
    ],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },
  {
    id: 'mesh.setOrigin', version: 1, title: 'Set Mesh Origin', category: 'Mesh', runtime: 'blender',
    inputs: [
      param('mesh', 'Mesh', 'mesh'),
      param('origin', 'Origin', 'enum', { options: ['bottom-center', 'center', 'top-center', 'min-corner'] }),
    ],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },
  {
    id: 'mesh.rotateToAxis', version: 1, title: 'Rotate Mesh Towards Axis', category: 'Mesh', runtime: 'blender',
    inputs: [param('mesh', 'Mesh', 'mesh'), param('face', 'Face', 'enum', { options: faceAxes })],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },
  {
    id: 'mesh.render', version: 1, title: 'Mesh Multi-View Render', category: 'Mesh', runtime: 'blender',
    inputs: [
      param('mesh', 'Mesh', 'mesh'),
      param('yaw', 'Yaw', 'number', { min: -180, max: 180, default: 35 }),
      param('pitch', 'Pitch', 'number', { min: -89, max: 89, default: 15 }),
      param('size', 'Size', 'number', { default: 1024 }),
      param('shading', 'Shading', 'enum', { options: ['lit', 'unlit'], default: 'lit' }),
    ],
    outputs: [param('image', 'Image', 'image')],
  },
  {
    id: 'mesh.extractTextures', version: 1, title: 'Extract Texture Maps', category: 'Mesh', runtime: 'blender',
    inputs: [param('mesh', 'Mesh', 'mesh')],
    outputs: [
      param('baseColor', 'Base Color', 'image'), param('roughness', 'Roughness', 'image'),
      param('metallic', 'Metallic', 'image'), param('normal', 'Normal', 'image'),
    ],
  },
  {
    id: 'mesh.applyTextures', version: 1, title: 'Apply Textures to Mesh', category: 'Mesh', runtime: 'blender',
    inputs: [
      param('mesh', 'Mesh', 'mesh'),
      param('baseColor', 'Base Color', 'image', { required: false }),
      param('roughness', 'Roughness', 'image', { required: false }),
      param('metallic', 'Metallic', 'image', { required: false }),
      param('normal', 'Normal', 'image', { required: false }),
      param('normalConvention', 'Normal Convention', 'enum', { options: ['opengl', 'directx'], advanced: true }),
    ],
    outputs: [param('mesh', 'Mesh', 'mesh')],
  },
  {
    id: 'mesh.bake', version: 1, title: 'Bake High-Poly to Low-Poly', category: 'Mesh', runtime: 'blender',
    inputs: [
      param('high', 'High', 'mesh'), param('low', 'Low', 'mesh'),
      param('resolution', 'Resolution', 'number', { min: 256, max: 4096, default: 2048 }),
      param('bakeBaseColor', 'Bake Base Color', 'boolean', { default: true }),
      param('bakeRoughness', 'Bake Roughness', 'boolean', { default: true }),
      param('bakeMetallic', 'Bake Metallic', 'boolean', { default: true }),
      param('bakeNormal', 'Bake Normal', 'boolean', { default: true }),
      param('bakeAO', 'Bake AO', 'boolean', { default: true }),
      param('aoSamples', 'AO Samples', 'number', { default: 32, advanced: true }),
      param('margin', 'Margin', 'number', { default: 16, advanced: true }),
      param('rayDistance', 'Ray Distance (m, 0 = auto)', 'number', { min: 0, max: 1, default: 0, step: 0.005, advanced: true }),
      param('lighting', 'Lighting', 'enum', { options: ['none', 'ao', 'studio'], default: 'none', advanced: true }),
    ],
    outputs: [
      param('mesh', 'Mesh', 'mesh'), param('baseColor', 'Base Color', 'image'),
      param('roughness', 'Roughness', 'image'), param('metallic', 'Metallic', 'image'),
      param('normal', 'Normal', 'image'), param('ao', 'AO', 'image'),
    ],
  },

  {
    id: 'list.collectMeshes', version: 1, title: 'Collect Meshes', category: 'Utility', runtime: 'none',
    inputs: [param('item', 'Item', 'mesh')],
    outputs: [param('list', 'List', 'mesh[]')],
  },
  {
    id: 'list.collectImages', version: 1, title: 'Collect Images', category: 'Utility', runtime: 'none',
    inputs: [param('item', 'Item', 'image')],
    outputs: [param('list', 'List', 'image[]')],
  },
  {
    id: 'list.pickMesh', version: 1, title: 'Pick Mesh', category: 'Utility', runtime: 'none',
    inputs: [param('list', 'List', 'mesh[]'), param('index', 'Index', 'number', { default: 0, min: 0 })],
    outputs: [param('item', 'Item', 'mesh')],
  },
  {
    id: 'list.pickImage', version: 1, title: 'Pick Image', category: 'Utility', runtime: 'none',
    inputs: [param('list', 'List', 'image[]'), param('index', 'Index', 'number', { default: 0, min: 0 })],
    outputs: [param('item', 'Item', 'image')],
  },
  {
    id: 'list.countMeshes', version: 1, title: 'Count Meshes', category: 'Utility', runtime: 'none',
    inputs: [param('list', 'List', 'mesh[]')],
    outputs: [param('count', 'Count', 'number')],
  },
  {
    id: 'list.countImages', version: 1, title: 'Count Images', category: 'Utility', runtime: 'none',
    inputs: [param('list', 'List', 'image[]')],
    outputs: [param('count', 'Count', 'number')],
  },

  {
    id: 'output.export', version: 1, title: 'Export to Folder', category: 'Output', runtime: 'none',
    inputs: [
      param('mesh', 'Mesh', 'mesh', { required: false }),
      param('image', 'Image', 'image', { required: false }),
      param('folder', 'Folder', 'enum', { options: [] }),
      param('name', 'Name', 'text'),
    ],
    outputs: [param('path', 'Path', 'text')],
  },
]

export const toolMap = new Map(tools.map(tool => [tool.id, tool]))

export function toolsForExportRoots(labels) {
  const options = [...labels]
  return tools.map(tool => tool.id === 'output.export'
    ? {
        ...tool,
        inputs: tool.inputs.map(input => input.id === 'folder'
          ? { ...input, options, ...(options.length ? { default: options[0] } : {}) }
          : input),
      }
    : tool)
}
