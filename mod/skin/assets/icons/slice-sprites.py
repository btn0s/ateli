"""Slice toolbar-sprites.png (2x7 imgen sheet on #1e1e1e) into toolbar-strip.png: 14 transparent 128px cells."""
from pathlib import Path
import numpy as np
from PIL import Image

here = Path(__file__).parent
CELL, PAD, BG = 128, 10, np.array([0x1E, 0x1E, 0x1E])

src = np.asarray(Image.open(here / 'toolbar-sprites.png').convert('RGB')).astype(int)
diff = np.abs(src - BG).max(axis=2)
mask = diff > 24

def bands(v, min_len=1):
    edges = np.flatnonzero(np.diff(np.concatenate(([0], v.astype(int), [0]))))
    return [(a, b) for a, b in zip(edges[::2], edges[1::2]) if b - a >= min_len]

# Un-key the dark background into alpha so the icons sit on any toolbar colour.
alpha = np.clip((diff - 6) / 40, 0, 1)
fg = BG + (src - BG) / np.maximum(alpha[..., None], 1e-6)
rgba = np.dstack((np.clip(fg, 0, 255), alpha * 255)).astype(np.uint8)
full = Image.fromarray(rgba, 'RGBA')

boxes = []
for r0, r1 in bands(mask.any(axis=1)):
    for c0, c1 in bands(mask[r0:r1].any(axis=0), min_len=20):
        sub = mask[r0:r1, c0:c1]
        rows, cols = np.flatnonzero(sub.any(axis=1)), np.flatnonzero(sub.any(axis=0))
        boxes.append((c0 + cols[0], r0 + rows[0], c0 + cols[-1] + 1, r0 + rows[-1] + 1))
assert len(boxes) == 14, f'expected 14 icons, found {len(boxes)}'

strip = Image.new('RGBA', (CELL * len(boxes), CELL))
for i, box in enumerate(boxes):
    tile = full.crop(box)
    scale = (CELL - 2 * PAD) / max(tile.size)
    tile = tile.resize((max(1, round(tile.width * scale)), max(1, round(tile.height * scale))), Image.LANCZOS)
    strip.paste(tile, (i * CELL + (CELL - tile.width) // 2, (CELL - tile.height) // 2), tile)
strip.save(here / 'toolbar-strip.png', optimize=True)
print(f'wrote {len(boxes)} cells')
