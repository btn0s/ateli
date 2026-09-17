import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'

const PYTHON = '/opt/homebrew/bin/python3'
const WORKER = path.resolve('executor/image-worker.py')
const imgenAvailable = spawnSync('imgen', ['health'], { encoding: 'utf8', timeout: 20_000 }).status === 0

async function createFixtures(root) {
  const script = String.raw`
from pathlib import Path
import sys
from PIL import Image, ImageDraw

root = Path(sys.argv[1])
base = Image.new("RGBA", (8, 6), (0, 0, 0, 0))
ImageDraw.Draw(base).rectangle((2, 1, 5, 4), fill=(200, 20, 10, 128))
base.save(root / "base.png")

canvas = Image.new("RGBA", (6, 6), (0, 0, 255, 255))
canvas.save(root / "canvas.png")
Image.new("RGBA", (2, 2), (255, 0, 0, 128)).save(root / "crop.png")

region = Image.new("L", (8, 8), 0)
ImageDraw.Draw(region).rectangle((4, 4, 7, 7), fill=255)
region.save(root / "region-large.png")

mask = Image.new("L", (8, 6), 0)
ImageDraw.Draw(mask).rectangle((2, 1, 5, 4), fill=255)
mask.save(root / "mask.png")

opaque = Image.new("RGBA", (4, 3))
for y in range(3):
    for x in range(4):
        opaque.putpixel((x, y), (10 + x * 30, 20 + y * 40, 30 + (x + y) * 20, 40 + x * 30))
opaque.save(root / "opaque.png")
Image.new("L", (4, 3), 100).save(root / "alpha.png")
Image.new("L", (3, 2), 64).save(root / "r.png")

threshold = Image.new("L", (2, 1))
threshold.putdata((127, 128))
threshold.save(root / "threshold.png")
Image.new("L", (5, 5), 100).save(root / "depth-flat.png")
Image.new("RGB", (1, 1), (10, 20, 30)).save(root / "normal.png")

filtered = Image.new("RGBA", (7, 7), (20, 30, 40, 170))
ImageDraw.Draw(filtered).rectangle((0, 0, 2, 2), fill=(180, 40, 20, 170))
filtered.putpixel((3, 3), (255, 255, 255, 170))
filtered.save(root / "filter.png")
`
  execFileSync(PYTHON, ['-c', script, root], { encoding: 'utf8' })
}

function fileInput(filePath) {
  return { path: filePath }
}

async function runWorker(root, name, toolId, inputs, timeout = 30_000) {
  const outputDir = path.join(root, name)
  await mkdir(outputDir, { recursive: true })
  const requestPath = path.join(outputDir, 'request.json')
  await writeFile(
    requestPath,
    JSON.stringify({ runId: 'test-run', nodeId: `shape:${name}`, toolId, inputs, outputDir }),
  )
  execFileSync(PYTHON, [WORKER, requestPath], { encoding: 'utf8', timeout })
  const manifest = JSON.parse(await readFile(path.join(outputDir, 'outputs.json'), 'utf8'))
  assert.equal(manifest.log, 'worker.log')
  await access(path.join(outputDir, manifest.log))
  for (const [port, filename] of Object.entries(manifest)) {
    if (port === 'log') continue
    assert.match(filename, /\.png$/)
    await access(path.join(outputDir, filename))
  }
  return { manifest, outputDir }
}

function inspectImage(filePath, includePixels = true) {
  const script = String.raw`
import json
import sys
from PIL import Image
with Image.open(sys.argv[1]) as image:
    image.load()
    print(json.dumps({
        "format": image.format,
        "mode": image.mode,
        "size": list(image.size),
        "pixels": [list(pixel) if isinstance(pixel, tuple) else pixel for pixel in image.get_flattened_data()] if sys.argv[2] == "1" else None,
    }))
`
  return JSON.parse(execFileSync(PYTHON, ['-c', script, filePath, includePixels ? '1' : '0'], { encoding: 'utf8' }))
}

function outputPath(run, port) {
  return path.join(run.outputDir, run.manifest[port])
}

function pixel(image, x, y) {
  return image.pixels[y * image.size[0] + x]
}

function assertWrapped(image) {
  const [width, height] = image.size
  for (let y = 0; y < height; y += 1) assert.deepEqual(pixel(image, 0, y), pixel(image, width - 1, y))
  for (let x = 0; x < width; x += 1) assert.deepEqual(pixel(image, x, 0), pixel(image, x, height - 1))
}

test('deterministic image tools produce real PNG results', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-image-worker-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await createFixtures(root)
  const fixture = name => path.join(root, name)

  for (const pattern of ['checkerboard', 'grid', 'perlin', 'voronoi', 'gradient']) {
    const run = await runWorker(root, `procedural-${pattern}`, 'image.procedural', {
      pattern,
      width: 17,
      height: 13,
      scale: 4,
      seed: 73,
      tileable: true,
      colorA: '#ffffff',
      colorB: '#000000',
    })
    const image = inspectImage(outputPath(run, 'image'))
    assert.equal(image.format, 'PNG')
    assert.equal(image.mode, 'RGBA')
    assert.deepEqual(image.size, [17, 13])
    if (pattern === 'checkerboard') assert.deepEqual(pixel(image, 0, 0), [255, 255, 255, 255])
    if (pattern === 'perlin' || pattern === 'voronoi') assertWrapped(image)
  }

  const resized = await runWorker(root, 'resize', 'image.resize', {
    image: fileInput(fixture('base.png')),
    width: 4,
    height: 4,
    keepAspect: true,
  })
  assert.deepEqual(inspectImage(outputPath(resized, 'image')).size, [4, 3])

  const upscaled = await runWorker(root, 'upscale', 'image.upscale', {
    image: fileInput(fixture('base.png')),
    factor: '2',
    engine: 'lanczos',
  })
  assert.deepEqual(inspectImage(outputPath(upscaled, 'image')).size, [16, 12])

  const manual = await runWorker(root, 'crop-manual', 'image.cropManual', {
    image: fileInput(fixture('base.png')),
    left: 2,
    top: 1,
    right: 6,
    bottom: 5,
  })
  const manualImage = inspectImage(outputPath(manual, 'image'))
  assert.deepEqual(manualImage.size, [4, 4])
  assert.deepEqual(pixel(manualImage, 0, 0), [200, 20, 10, 128])

  const automatic = await runWorker(root, 'crop-auto', 'image.cropAuto', {
    image: fileInput(fixture('base.png')),
    mask: fileInput(fixture('mask.png')),
    padding: 0,
  })
  assert.deepEqual(inspectImage(outputPath(automatic, 'image')).size, [4, 4])
  const autoRegion = inspectImage(outputPath(automatic, 'region'))
  assert.deepEqual(autoRegion.size, [8, 6])
  assert.equal(pixel(autoRegion, 2, 1), 255)
  assert.equal(pixel(autoRegion, 5, 4), 255)
  assert.equal(pixel(autoRegion, 1, 1), 0)
  assert.equal(pixel(autoRegion, 6, 4), 0)

  const pasted = await runWorker(root, 'paste-crop', 'image.pasteCrop', {
    image: fileInput(fixture('canvas.png')),
    crop: fileInput(fixture('crop.png')),
    region: fileInput(fixture('region-large.png')),
  })
  const pastedImage = inspectImage(outputPath(pasted, 'image'))
  assert.deepEqual(pastedImage.size, [6, 6])
  assert.deepEqual(pixel(pastedImage, 3, 3), [0, 0, 255, 255])
  assert.deepEqual(pixel(pastedImage, 5, 5), [128, 0, 127, 255])

  const splitAlpha = await runWorker(root, 'split-alpha', 'image.splitAlpha', {
    image: fileInput(fixture('base.png')),
  })
  const splitColor = inspectImage(outputPath(splitAlpha, 'color'))
  const splitMask = inspectImage(outputPath(splitAlpha, 'alpha'))
  assert.deepEqual(pixel(splitColor, 2, 1), [200, 20, 10, 255])
  assert.equal(pixel(splitMask, 2, 1), 128)

  const combinedAlpha = await runWorker(root, 'combine-alpha', 'image.combineAlpha', {
    color: fileInput(fixture('opaque.png')),
    alpha: fileInput(fixture('alpha.png')),
  })
  assert.deepEqual(pixel(inspectImage(outputPath(combinedAlpha, 'image')), 0, 0), [10, 20, 30, 100])

  const splitChannels = await runWorker(root, 'split-channels', 'image.splitChannels', {
    image: fileInput(fixture('opaque.png')),
  })
  assert.equal(pixel(inspectImage(outputPath(splitChannels, 'r')), 0, 0), 10)
  assert.equal(pixel(inspectImage(outputPath(splitChannels, 'g')), 0, 0), 20)
  assert.equal(pixel(inspectImage(outputPath(splitChannels, 'b')), 0, 0), 30)
  assert.equal(pixel(inspectImage(outputPath(splitChannels, 'a')), 0, 0), 40)

  const combinedChannels = await runWorker(root, 'combine-channels', 'image.combineChannels', {
    r: fileInput(fixture('r.png')),
  })
  assert.deepEqual(pixel(inspectImage(outputPath(combinedChannels, 'image')), 0, 0), [64, 0, 0, 255])

  const thresholded = await runWorker(root, 'threshold', 'image.threshold', {
    image: fileInput(fixture('threshold.png')),
    threshold: 128,
    invert: false,
  })
  assert.deepEqual(inspectImage(outputPath(thresholded, 'mask')).pixels, [0, 255])

  const rectangle = await runWorker(root, 'rect-mask', 'image.rectMask', {
    image: fileInput(fixture('base.png')),
    left: 1,
    top: 1,
    right: 4,
    bottom: 3,
  })
  const rectangleMask = inspectImage(outputPath(rectangle, 'mask'))
  assert.equal(pixel(rectangleMask, 1, 1), 255)
  assert.equal(pixel(rectangleMask, 3, 2), 255)
  assert.equal(pixel(rectangleMask, 4, 2), 0)

  const ellipse = await runWorker(root, 'ellipse-mask', 'image.ellipseMask', {
    image: fileInput(fixture('base.png')),
    centerX: 3,
    centerY: 3,
    width: 4,
    height: 4,
  })
  const ellipseMask = inspectImage(outputPath(ellipse, 'mask'))
  assert.equal(pixel(ellipseMask, 3, 3), 255)
  assert.equal(pixel(ellipseMask, 0, 0), 0)

  const originalFilterImage = inspectImage(fixture('filter.png'))
  for (const filter of ['blur', 'sharpen', 'grayscale', 'invert', 'brightness', 'contrast', 'saturation', 'posterize', 'edge']) {
    const run = await runWorker(root, `filter-${filter}`, 'image.filter', {
      image: fileInput(fixture('filter.png')),
      filter,
      amount: 100,
    })
    const filtered = inspectImage(outputPath(run, 'image'))
    assert.deepEqual(filtered.size, originalFilterImage.size)
    assert.notDeepEqual(filtered.pixels, originalFilterImage.pixels, `${filter} must alter pixels at amount 100`)
    assert.ok(filtered.pixels.every(value => value[3] === 170), `${filter} must preserve alpha`)
    if (filter === 'grayscale') assert.ok(filtered.pixels.every(value => value[0] === value[1] && value[1] === value[2]))
    if (filter === 'invert') {
      const before = pixel(originalFilterImage, 0, 0)
      assert.deepEqual(pixel(filtered, 0, 0), [255 - before[0], 255 - before[1], 255 - before[2], before[3]])
    }
    if (filter === 'posterize') {
      assert.ok(filtered.pixels.every(value => value.slice(0, 3).every(channel => channel % 64 === 0)))
    }
  }

  const normals = await runWorker(root, 'normal-from-depth', 'image.normalFromDepth', {
    depth: fileInput(fixture('depth-flat.png')),
    strength: 2,
  })
  const normalImage = inspectImage(outputPath(normals, 'normal'))
  assert.ok(normalImage.pixels.every(value => Math.abs(value[0] - 128) <= 1 && Math.abs(value[1] - 128) <= 1 && value[2] === 255))

  const converted = await runWorker(root, 'normal-convention', 'image.normalConvention', {
    normal: fileInput(fixture('normal.png')),
    to: 'directx',
  })
  assert.deepEqual(pixel(inspectImage(outputPath(converted, 'normal')), 0, 0), [10, 235, 30, 255])
})

test('image.generate.fast writes a PNG when imgen is healthy', { skip: !imgenAvailable }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ateli-image-imgen-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const generated = await runWorker(
    root,
    'generate-fast',
    'image.generate.fast',
    { prompt: 'A single red circle centered on a plain white background.', aspectRatio: '1:1', seed: 7 },
    330_000,
  )
  const image = inspectImage(outputPath(generated, 'image'), false)
  assert.equal(image.format, 'PNG')
  assert.ok(image.size[0] > 0 && image.size[1] > 0)
})
