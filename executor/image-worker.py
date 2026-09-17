#!/opt/homebrew/bin/python3
"""Execute one deterministic or imgen-backed image node."""

import json
import math
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np
from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageEnhance, ImageFilter, ImageOps


RESAMPLE = Image.Resampling.LANCZOS
IMGEN_TIMEOUT_SECONDS = 300


class ImgenUnavailable(RuntimeError):
    pass


class Worker:
    def __init__(self, request):
        self.request = request
        self.tool_id = request.get("toolId")
        self.inputs = request.get("inputs") or {}
        output_dir = request.get("outputDir")
        if not isinstance(output_dir, str) or not output_dir:
            raise ValueError("request.outputDir is required")
        self.output_dir = Path(output_dir).resolve()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.output_dir / "worker.log"
        self.log_path.write_text("", encoding="utf-8")

    def log(self, message):
        with self.log_path.open("a", encoding="utf-8") as stream:
            stream.write(str(message).rstrip() + "\n")

    def scalar(self, name, default=None):
        return self.inputs.get(name, default)

    def image(self, name, required=True):
        value = self.inputs.get(name)
        path = value.get("path") if isinstance(value, dict) else None
        if not path:
            if required:
                raise ValueError(f"input {name!r} requires a file path")
            return None
        image_path = Path(path)
        if not image_path.is_file():
            raise ValueError(f"input {name!r} does not exist: {image_path}")
        with Image.open(image_path) as source:
            source.load()
            return source.copy()

    def run(self):
        handler_name = self.tool_id.replace(".", "_") if isinstance(self.tool_id, str) else ""
        handler = getattr(self, handler_name, None)
        if not callable(handler):
            raise ValueError(f"unsupported image tool: {self.tool_id}")
        self.log(f"tool: {self.tool_id}")
        outputs = handler()
        manifest = {}
        for port_id, image in outputs.items():
            filename = f"{port_id}.png"
            destination = self.output_dir / filename
            image.save(destination, format="PNG")
            manifest[port_id] = filename
            self.log(f"output: {port_id} -> {filename} ({image.width}x{image.height}, {image.mode})")
        manifest["log"] = "worker.log"
        manifest_path = self.output_dir / "outputs.json"
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.output_dir, delete=False) as stream:
            json.dump(manifest, stream, indent=2, sort_keys=True)
            stream.write("\n")
            temporary_manifest = stream.name
        os.replace(temporary_manifest, manifest_path)
        self.log("completed")
        return manifest

    # Deterministic tools

    def image_procedural(self):
        pattern = str(self.scalar("pattern", "checkerboard"))
        width = positive_int(self.scalar("width", 1024), "width")
        height = positive_int(self.scalar("height", 1024), "height")
        scale = max(1, int(round(float(self.scalar("scale", 8)))))
        seed = int(self.scalar("seed", 0))
        tileable = bool(self.scalar("tileable", True))
        color_a = np.array(ImageColor.getcolor(str(self.scalar("colorA", "#ffffff")), "RGBA"), dtype=np.float32)
        color_b = np.array(ImageColor.getcolor(str(self.scalar("colorB", "#000000")), "RGBA"), dtype=np.float32)

        if pattern == "checkerboard":
            xs = normalized_axis(width, tileable)
            ys = normalized_axis(height, tileable)
            xi = np.floor(xs * scale).astype(np.int64) % scale
            yi = np.floor(ys * scale).astype(np.int64) % scale
            field = ((yi[:, None] + xi[None, :]) & 1).astype(np.float32)
        elif pattern == "grid":
            xs = normalized_axis(width, tileable) * scale
            ys = normalized_axis(height, tileable) * scale
            x_fraction = xs - np.floor(xs)
            y_fraction = ys - np.floor(ys)
            x_distance = np.minimum(x_fraction, 1.0 - x_fraction)
            y_distance = np.minimum(y_fraction, 1.0 - y_fraction)
            relative_line_width = min(0.25, max(0.015, scale / max(width, height)))
            lines = (x_distance[None, :] <= relative_line_width) | (y_distance[:, None] <= relative_line_width)
            field = lines.astype(np.float32)
        elif pattern == "perlin":
            field = periodic_perlin(width, height, scale, seed, tileable)
        elif pattern == "voronoi":
            field = periodic_voronoi(width, height, scale, seed, tileable)
        elif pattern == "gradient":
            x = normalized_axis(width, tileable)
            if tileable:
                x = 0.5 - 0.5 * np.cos(2.0 * math.pi * x)
            field = np.broadcast_to(x[None, :], (height, width)).astype(np.float32)
        else:
            raise ValueError(f"unknown procedural pattern: {pattern}")

        rgba = color_a[None, None, :] * (1.0 - field[:, :, None]) + color_b[None, None, :] * field[:, :, None]
        return {"image": Image.fromarray(np.rint(np.clip(rgba, 0, 255)).astype(np.uint8), "RGBA")}

    def image_resize(self):
        image = self.image("image")
        width = positive_int(self.scalar("width"), "width")
        height = positive_int(self.scalar("height"), "height")
        if bool(self.scalar("keepAspect", True)):
            ratio = min(width / image.width, height / image.height)
            width = max(1, int(round(image.width * ratio)))
            height = max(1, int(round(image.height * ratio)))
        return {"image": image.resize((width, height), RESAMPLE)}

    def image_upscale(self):
        image = self.image("image")
        factor = int(self.scalar("factor", "2"))
        if factor not in (2, 4):
            raise ValueError("factor must be 2 or 4")
        if str(self.scalar("engine", "lanczos")) != "lanczos":
            raise ValueError("only the lanczos upscale engine is supported")
        return {"image": image.resize((image.width * factor, image.height * factor), RESAMPLE)}

    def image_cropManual(self):
        image = self.image("image")
        box = bounded_box(
            self.scalar("left"), self.scalar("top"), self.scalar("right"), self.scalar("bottom"), image.size
        )
        return {"image": image.crop(box)}

    def image_cropAuto(self):
        image = self.image("image")
        supplied_mask = self.image("mask", required=False)
        if supplied_mask is not None:
            mask = mask_channel(supplied_mask)
            if mask.size != image.size:
                mask = mask.resize(image.size, RESAMPLE)
            box = mask.getbbox()
        else:
            rgba = image.convert("RGBA")
            alpha = rgba.getchannel("A")
            if alpha.getextrema() != (255, 255):
                box = alpha.getbbox()
            else:
                background = Image.new("RGBA", rgba.size, rgba.getpixel((0, 0)))
                difference = ImageChops.difference(rgba, background).convert("RGB")
                box = difference.getbbox()
        if box is None:
            box = (0, 0, image.width, image.height)
        padding = max(0, int(round(float(self.scalar("padding", 0)))))
        left = max(0, box[0] - padding)
        top = max(0, box[1] - padding)
        right = min(image.width, box[2] + padding)
        bottom = min(image.height, box[3] + padding)
        region = Image.new("L", image.size, 0)
        ImageDraw.Draw(region).rectangle((left, top, right - 1, bottom - 1), fill=255)
        return {"image": image.crop((left, top, right, bottom)), "region": region}

    def image_pasteCrop(self):
        base = self.image("image").convert("RGBA")
        crop = self.image("crop").convert("RGBA")
        region = mask_channel(self.image("region"))
        box = region.getbbox()
        if box is None:
            return {"image": base}
        left, top, right, bottom = box
        target_width = right - left
        target_height = bottom - top
        crop = crop.resize((target_width, target_height), RESAMPLE)
        clip_left = max(0, left)
        clip_top = max(0, top)
        clip_right = min(base.width, right)
        clip_bottom = min(base.height, bottom)
        if clip_right <= clip_left or clip_bottom <= clip_top:
            return {"image": base}
        source_box = (clip_left - left, clip_top - top, clip_right - left, clip_bottom - top)
        overlay = crop.crop(source_box)
        destination = base.crop((clip_left, clip_top, clip_right, clip_bottom))
        base.paste(Image.alpha_composite(destination, overlay), (clip_left, clip_top))
        return {"image": base}

    def image_splitAlpha(self):
        rgba = self.image("image").convert("RGBA")
        red, green, blue, alpha = rgba.split()
        opaque = Image.new("L", rgba.size, 255)
        return {"color": Image.merge("RGBA", (red, green, blue, opaque)), "alpha": alpha}

    def image_combineAlpha(self):
        color = self.image("color").convert("RGBA")
        alpha = mask_channel(self.image("alpha"))
        if alpha.size != color.size:
            alpha = alpha.resize(color.size, RESAMPLE)
        red, green, blue, _ = color.split()
        return {"image": Image.merge("RGBA", (red, green, blue, alpha))}

    def image_splitChannels(self):
        rgba = self.image("image").convert("RGBA")
        red, green, blue, alpha = rgba.split()
        return {"r": red, "g": green, "b": blue, "a": alpha}

    def image_combineChannels(self):
        red = mask_channel(self.image("r"))
        size = red.size

        def channel(name, default):
            value = self.image(name, required=False)
            if value is None:
                return Image.new("L", size, default)
            result = mask_channel(value)
            return result if result.size == size else result.resize(size, RESAMPLE)

        return {"image": Image.merge("RGBA", (red, channel("g", 0), channel("b", 0), channel("a", 255)))}

    def image_threshold(self):
        source = mask_channel(self.image("image"))
        threshold = int(np.clip(round(float(self.scalar("threshold", 128))), 0, 255))
        array = np.asarray(source, dtype=np.uint8)
        result = np.where(array >= threshold, 255, 0).astype(np.uint8)
        if bool(self.scalar("invert", False)):
            result = 255 - result
        return {"mask": Image.fromarray(result, "L")}

    def image_rectMask(self):
        source = self.image("image")
        box = bounded_box(
            self.scalar("left"), self.scalar("top"), self.scalar("right"), self.scalar("bottom"), source.size
        )
        mask = Image.new("L", source.size, 0)
        ImageDraw.Draw(mask).rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=255)
        return {"mask": mask}

    def image_ellipseMask(self):
        source = self.image("image")
        center_x = float(self.scalar("centerX"))
        center_y = float(self.scalar("centerY"))
        width = float(self.scalar("width"))
        height = float(self.scalar("height"))
        if width <= 0 or height <= 0:
            raise ValueError("ellipse width and height must be positive")
        box = (center_x - width / 2, center_y - height / 2, center_x + width / 2, center_y + height / 2)
        mask = Image.new("L", source.size, 0)
        ImageDraw.Draw(mask).ellipse(box, fill=255)
        return {"mask": mask}

    def image_filter(self):
        source = self.image("image").convert("RGBA")
        alpha = source.getchannel("A")
        rgb = source.convert("RGB")
        filter_name = str(self.scalar("filter"))
        amount = float(np.clip(float(self.scalar("amount", 50)), 0.0, 100.0)) / 100.0
        if filter_name == "blur":
            target = rgb.filter(ImageFilter.GaussianBlur(radius=10.0 * amount))
        elif filter_name == "sharpen":
            target = rgb.filter(ImageFilter.UnsharpMask(radius=2.0, percent=250, threshold=0))
            target = Image.blend(rgb, target, amount)
        elif filter_name == "grayscale":
            gray = ImageOps.grayscale(rgb)
            target = Image.blend(rgb, Image.merge("RGB", (gray, gray, gray)), amount)
        elif filter_name == "invert":
            target = Image.blend(rgb, ImageOps.invert(rgb), amount)
        elif filter_name == "brightness":
            target = ImageEnhance.Brightness(rgb).enhance(1.0 + amount)
        elif filter_name == "contrast":
            target = ImageEnhance.Contrast(rgb).enhance(1.0 + amount)
        elif filter_name == "saturation":
            target = ImageEnhance.Color(rgb).enhance(1.0 + amount)
        elif filter_name == "posterize":
            bits = max(1, min(8, int(round(8.0 - 6.0 * amount))))
            target = ImageOps.posterize(rgb, bits)
        elif filter_name == "edge":
            target = Image.blend(rgb, rgb.filter(ImageFilter.FIND_EDGES), amount)
        else:
            raise ValueError(f"unknown image filter: {filter_name}")
        red, green, blue = target.split()
        return {"image": Image.merge("RGBA", (red, green, blue, alpha))}

    def image_normalFromDepth(self):
        depth = np.asarray(mask_channel(self.image("depth")), dtype=np.float32) / 255.0
        strength = float(self.scalar("strength", 2.0))
        padded = np.pad(depth, 1, mode="edge")
        gx = (
            -padded[:-2, :-2]
            + padded[:-2, 2:]
            - 2.0 * padded[1:-1, :-2]
            + 2.0 * padded[1:-1, 2:]
            - padded[2:, :-2]
            + padded[2:, 2:]
        ) / 8.0
        gy = (
            -padded[:-2, :-2]
            - 2.0 * padded[:-2, 1:-1]
            - padded[:-2, 2:]
            + padded[2:, :-2]
            + 2.0 * padded[2:, 1:-1]
            + padded[2:, 2:]
        ) / 8.0
        normal = np.stack((-gx * strength, gy * strength, np.ones_like(depth)), axis=2)
        normal /= np.linalg.norm(normal, axis=2, keepdims=True)
        encoded = np.rint(np.clip(normal * 127.5 + 127.5, 0, 255)).astype(np.uint8)
        return {"normal": Image.fromarray(encoded, "RGB")}

    def image_normalConvention(self):
        normal = self.image("normal").convert("RGBA")
        array = np.array(normal, dtype=np.uint8, copy=True)
        array[:, :, 1] = 255 - array[:, :, 1]
        return {"normal": Image.fromarray(array, "RGBA")}

    # imgen-backed tools

    def require_imgen(self):
        try:
            result = subprocess.run(
                ["imgen", "health"], capture_output=True, text=True, timeout=20, check=False
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ImgenUnavailable(clean_error(error)) from error
        self.log_process(["imgen", "health"], result)
        if result.returncode != 0:
            detail = clean_error(result.stderr or result.stdout or f"exit {result.returncode}")
            raise ImgenUnavailable(detail)

    def run_imgen(self, arguments):
        self.require_imgen()
        command = ["imgen", *arguments]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=IMGEN_TIMEOUT_SECONDS + 30,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RuntimeError(f"imgen command failed: {clean_error(error)}") from error
        self.log_process(command, result)
        if result.returncode != 0:
            raise RuntimeError(f"imgen command failed: {clean_error(result.stderr or result.stdout or result.returncode)}")
        produced_path = find_imgen_output_path(result.stdout)
        if produced_path is None:
            raise RuntimeError("imgen output did not contain a readable image path")
        with Image.open(produced_path) as generated:
            generated.load()
            return generated.copy()

    def log_process(self, command, result):
        self.log("command: " + " ".join(str(part) for part in command))
        if result.stdout:
            self.log("stdout:\n" + result.stdout.rstrip())
        if result.stderr:
            self.log("stderr:\n" + result.stderr.rstrip())
        self.log(f"exit: {result.returncode}")

    def image_generate_fast(self):
        arguments = [
            "generate",
            str(self.scalar("prompt")),
            "--model",
            "gpt-image-2.5-flare",
            "--quality",
            "low",
            "--aspect-ratio",
            str(self.scalar("aspectRatio", "1:1")),
            "--format",
            "png",
            "--timeout",
            str(IMGEN_TIMEOUT_SECONDS),
        ]
        append_seed(arguments, self.scalar("seed"))
        return {"image": self.run_imgen(arguments)}

    def image_generate(self):
        arguments = [
            "generate",
            str(self.scalar("prompt")),
            "--model",
            str(self.scalar("model")),
            "--quality",
            str(self.scalar("quality", "high")),
            "--aspect-ratio",
            str(self.scalar("aspectRatio", "1:1")),
            "--format",
            "png",
            "--timeout",
            str(IMGEN_TIMEOUT_SECONDS),
        ]
        append_seed(arguments, self.scalar("seed"))
        return {"image": self.run_imgen(arguments)}

    def image_edit(self):
        source_path = input_path(self.inputs, "image")
        arguments = [
            "edit",
            str(self.scalar("prompt")),
            "--source",
            source_path,
            "--format",
            "png",
            "--timeout",
            str(IMGEN_TIMEOUT_SECONDS),
        ]
        model = self.scalar("model")
        if model:
            arguments.extend(("--model", str(model)))
        append_seed(arguments, self.scalar("seed"))
        return {"image": self.run_imgen(arguments)}

    def image_extend(self):
        source = self.image("image").convert("RGBA")
        left = nonnegative_int(self.scalar("left", 0), "left")
        top = nonnegative_int(self.scalar("top", 0), "top")
        right = nonnegative_int(self.scalar("right", 0), "right")
        bottom = nonnegative_int(self.scalar("bottom", 0), "bottom")
        extended = Image.new("RGBA", (source.width + left + right, source.height + top + bottom), (0, 0, 0, 0))
        extended.paste(source, (left, top))
        temporary_path = self.output_dir / ".extend-source.png"
        extended.save(temporary_path, format="PNG")
        user_prompt = str(self.scalar("prompt", "")).strip()
        prompt = (
            "Fill only the transparent regions of this image, seamlessly extending the existing image. "
            "Preserve every existing non-transparent pixel."
        )
        if user_prompt:
            prompt += " " + user_prompt
        arguments = [
            "edit",
            prompt,
            "--source",
            str(temporary_path),
            "--dimensions",
            f"{extended.width}x{extended.height}",
            "--format",
            "png",
            "--timeout",
            str(IMGEN_TIMEOUT_SECONDS),
        ]
        try:
            result = self.run_imgen(arguments)
        finally:
            temporary_path.unlink(missing_ok=True)
        return {"image": result}

    def image_removeBackground(self):
        source_path = input_path(self.inputs, "image")
        prompt = "Remove the background. Preserve the foreground subject exactly and make every background pixel transparent."
        cutout = self.run_imgen(
            [
                "edit",
                prompt,
                "--source",
                source_path,
                "--background",
                "transparent",
                "--format",
                "png",
                "--timeout",
                str(IMGEN_TIMEOUT_SECONDS),
            ]
        ).convert("RGBA")
        return {"cutout": cutout, "mask": cutout.getchannel("A")}


def normalized_axis(length, tileable):
    if length <= 1:
        return np.zeros(length, dtype=np.float32)
    return np.linspace(0.0, 1.0, length, endpoint=tileable, dtype=np.float32)


def periodic_perlin(width, height, frequency, seed, tileable):
    rng = np.random.default_rng(seed)
    grid_size = frequency if tileable else frequency + 1
    angles = rng.random((grid_size, grid_size), dtype=np.float32) * (2.0 * math.pi)
    gradients = np.stack((np.cos(angles), np.sin(angles)), axis=2)
    xs = normalized_axis(width, tileable) * frequency
    ys = normalized_axis(height, tileable) * frequency
    x0 = np.floor(xs).astype(np.int64)
    y0 = np.floor(ys).astype(np.int64)
    xf = xs - np.floor(xs)
    yf = ys - np.floor(ys)

    if tileable:
        x0 %= frequency
        y0 %= frequency
        x1 = (x0 + 1) % frequency
        y1 = (y0 + 1) % frequency
    else:
        x0 = np.clip(x0, 0, frequency - 1)
        y0 = np.clip(y0, 0, frequency - 1)
        x1 = x0 + 1
        y1 = y0 + 1

    gx0 = np.broadcast_to(xf[None, :], (height, width))
    gy0 = np.broadcast_to(yf[:, None], (height, width))
    gx1 = gx0 - 1.0
    gy1 = gy0 - 1.0
    g00 = gradients[y0[:, None], x0[None, :]]
    g10 = gradients[y0[:, None], x1[None, :]]
    g01 = gradients[y1[:, None], x0[None, :]]
    g11 = gradients[y1[:, None], x1[None, :]]
    n00 = g00[:, :, 0] * gx0 + g00[:, :, 1] * gy0
    n10 = g10[:, :, 0] * gx1 + g10[:, :, 1] * gy0
    n01 = g01[:, :, 0] * gx0 + g01[:, :, 1] * gy1
    n11 = g11[:, :, 0] * gx1 + g11[:, :, 1] * gy1
    u = fade(gx0)
    v = fade(gy0)
    nx0 = n00 * (1.0 - u) + n10 * u
    nx1 = n01 * (1.0 - u) + n11 * u
    noise = nx0 * (1.0 - v) + nx1 * v
    return np.clip(noise / math.sqrt(0.5) * 0.5 + 0.5, 0.0, 1.0).astype(np.float32)


def periodic_voronoi(width, height, frequency, seed, tileable):
    rng = np.random.default_rng(seed)
    point_count = max(1, frequency * frequency)
    points = rng.random((point_count, 2), dtype=np.float32)
    xs = normalized_axis(width, tileable)
    ys = normalized_axis(height, tileable)
    x_grid = np.broadcast_to(xs[None, :], (height, width))
    y_grid = np.broadcast_to(ys[:, None], (height, width))
    minimum = np.full((height, width), np.inf, dtype=np.float32)
    for point_x, point_y in points:
        dx = np.abs(x_grid - point_x)
        dy = np.abs(y_grid - point_y)
        if tileable:
            dx = np.minimum(dx, 1.0 - dx)
            dy = np.minimum(dy, 1.0 - dy)
        minimum = np.minimum(minimum, dx * dx + dy * dy)
    distance = np.sqrt(minimum)
    return np.clip(distance * math.sqrt(point_count) * 1.75, 0.0, 1.0).astype(np.float32)


def fade(value):
    return value * value * value * (value * (value * 6.0 - 15.0) + 10.0)


def mask_channel(image):
    if "A" in image.getbands():
        alpha = image.getchannel("A")
        if alpha.getextrema() != (255, 255):
            return alpha
    return image.convert("L")


def positive_int(value, name):
    result = int(round(float(value)))
    if result <= 0:
        raise ValueError(f"{name} must be positive")
    return result


def nonnegative_int(value, name):
    result = int(round(float(value)))
    if result < 0:
        raise ValueError(f"{name} must be non-negative")
    return result


def bounded_box(left, top, right, bottom, size):
    width, height = size
    result = (
        max(0, min(width, int(round(float(left))))),
        max(0, min(height, int(round(float(top))))),
        max(0, min(width, int(round(float(right))))),
        max(0, min(height, int(round(float(bottom))))),
    )
    if result[2] <= result[0] or result[3] <= result[1]:
        raise ValueError("crop or mask bounds are empty")
    return result


def input_path(inputs, name):
    value = inputs.get(name)
    path = value.get("path") if isinstance(value, dict) else None
    if not path or not Path(path).is_file():
        raise ValueError(f"input {name!r} requires an existing file path")
    return str(Path(path).resolve())


def append_seed(arguments, seed):
    if seed is not None and seed != "":
        arguments.extend(("--seed", str(int(float(seed)))))


def clean_error(value):
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or "unknown error"


def find_imgen_output_path(stdout):
    candidates = []
    try:
        payload = json.loads(stdout)
        collect_strings(payload, candidates)
    except json.JSONDecodeError:
        for line in reversed(stdout.splitlines()):
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            collect_strings(payload, candidates)
    candidates.extend(re.findall(r"(?:file://)?(?:/[^\s\"']+)+\.(?:png|jpe?g|webp)", stdout, flags=re.IGNORECASE))
    for candidate in reversed(candidates):
        if not isinstance(candidate, str):
            continue
        if candidate.startswith("file://"):
            candidate = unquote(urlparse(candidate).path)
        path = Path(candidate).expanduser()
        if path.is_file():
            try:
                with Image.open(path) as image:
                    image.verify()
                return path.resolve()
            except (OSError, ValueError):
                continue
    return None


def collect_strings(value, output):
    if isinstance(value, str):
        output.append(value)
    elif isinstance(value, dict):
        for nested in value.values():
            collect_strings(nested, output)
    elif isinstance(value, list):
        for nested in value:
            collect_strings(nested, output)


def load_request(request_path):
    with Path(request_path).open("r", encoding="utf-8") as stream:
        request = json.load(stream)
    if not isinstance(request, dict):
        raise ValueError("request must be a JSON object")
    return request


def main(argv):
    if len(argv) != 2:
        print("usage: image-worker.py <request.json>", file=sys.stderr)
        return 2
    worker = None
    try:
        worker = Worker(load_request(argv[1]))
        worker.run()
        return 0
    except ImgenUnavailable as error:
        if worker is not None:
            worker.log(f"failed: imgen unavailable: {clean_error(error)}")
        print(f"imgen unavailable: {clean_error(error)}", file=sys.stderr)
        return 1
    except Exception as error:
        if worker is not None:
            worker.log(f"failed: {type(error).__name__}: {clean_error(error)}")
        print(f"image worker failed: {clean_error(error)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
