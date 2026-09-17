import array
import json
import math
import os
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


CHANNELS = ("baseColor", "roughness", "metallic", "normal")
PRINCIPLED_INPUTS = {
    "baseColor": "Base Color",
    "roughness": "Roughness",
    "metallic": "Metallic",
    "normal": "Normal",
}
SOLID_DEFAULTS = {
    "baseColor": (0.8, 0.8, 0.8, 1.0),
    "roughness": (0.5, 0.5, 0.5, 1.0),
    "metallic": (0.0, 0.0, 0.0, 1.0),
    "normal": (0.5, 0.5, 1.0, 1.0),
    "ao": (1.0, 1.0, 1.0, 1.0),
}


class Worker:
    def __init__(self, request_path):
        self.request_path = os.path.abspath(request_path)
        with open(self.request_path, "r", encoding="utf-8") as handle:
            self.request = json.load(handle)
        self.tool_id = self.request.get("toolId", "")
        self.inputs = self.request.get("inputs") or {}
        self.output_dir = os.path.abspath(self.request.get("outputDir") or os.path.dirname(self.request_path))
        os.makedirs(self.output_dir, exist_ok=True)
        self.log_path = os.path.join(self.output_dir, "worker.log")
        self.log_handle = open(self.log_path, "w", encoding="utf-8")

    def log(self, message):
        line = str(message)
        self.log_handle.write(line + "\n")
        self.log_handle.flush()
        print(line, flush=True)

    def close(self):
        self.log_handle.close()

    def path_input(self, name, required=True):
        value = self.inputs.get(name)
        if value is None and not required:
            return None
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            raise RuntimeError("input '%s' must be a file object with an absolute path" % name)
        path = os.path.abspath(value["path"])
        if not os.path.isfile(path):
            raise RuntimeError("input '%s' does not exist: %s" % (name, path))
        return path

    def scalar(self, name, default=None):
        return self.inputs.get(name, default)

    def run(self):
        handlers = {
            "mesh.optimize": self.optimize,
            "mesh.autoTransform": self.auto_transform,
            "mesh.bboxFit": self.bbox_fit,
            "mesh.setOrigin": self.set_origin,
            "mesh.rotateToAxis": self.rotate_to_axis,
            "mesh.render": self.render,
            "mesh.extractTextures": self.extract_textures,
            "mesh.applyTextures": self.apply_textures,
            "mesh.bake": self.bake,
        }
        handler = handlers.get(self.tool_id)
        if handler is None:
            raise RuntimeError("unsupported Blender tool: %s" % (self.tool_id or "<missing>"))
        self.log("tool=%s node=%s" % (self.tool_id, self.request.get("nodeId", "<unknown>")))
        outputs = handler()
        outputs["log"] = "worker.log"
        destination = os.path.join(self.output_dir, "outputs.json")
        temporary = destination + ".tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(outputs, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, destination)
        self.log("wrote outputs.json")
        return outputs

    def import_mesh(self, name="mesh"):
        source = self.path_input(name)
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        before = set(bpy.data.objects)
        self.log("importing %s from %s" % (name, source))
        bpy.ops.import_scene.gltf(filepath=source)
        objects = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
        if not objects:
            objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        if not objects:
            raise RuntimeError("input '%s' contains no mesh objects" % name)
        for obj in objects:
            if obj.data.users > 1:
                obj.data = obj.data.copy()
        self.log("imported %d mesh object(s), %d triangle(s)" % (len(objects), triangle_count(objects)))
        return objects

    def export_mesh(self, objects, filename="mesh.glb"):
        bake_world_transforms(objects)
        output = os.path.join(self.output_dir, filename)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.hide_render = False
            obj.hide_set(False)
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        kwargs = {
            "filepath": output,
            "export_format": "GLB",
            "use_selection": True,
            "export_materials": "EXPORT",
            "export_texcoords": True,
            "export_normals": True,
            "export_animations": False,
        }
        try:
            bpy.ops.export_scene.gltf(export_tangents=True, **kwargs)
        except (TypeError, RuntimeError):
            bpy.ops.export_scene.gltf(**kwargs)
        finally:
            bpy.ops.object.select_all(action="DESELECT")
        if not os.path.isfile(output) or os.path.getsize(output) == 0:
            raise RuntimeError("GLB export did not create a non-empty file")
        self.log("exported %s (%d bytes, %d triangles)" % (filename, os.path.getsize(output), triangle_count(objects)))
        return filename

    def finish_mesh(self, objects):
        mesh_name = self.export_mesh(objects)
        preview_name = "mesh.preview.png"
        render_mesh(objects, os.path.join(self.output_dir, preview_name), 512, 35.0, 15.0)
        self.log("rendered %s" % preview_name)
        return {"mesh": mesh_name, "preview": {"mesh": preview_name}}

    def optimize(self):
        objects = self.import_mesh()
        engine_requested = str(self.scalar("engine", "quadriflow"))
        topology = str(self.scalar("topology", "triangle"))
        target = int(self.scalar("targetFaces", 80000))
        voxel_size = float(self.scalar("voxelSize", 0.0))
        preserve_uvs = bool(self.scalar("preserveUVs", False))
        if engine_requested not in {"quadriflow", "voxel", "decimate"}:
            raise RuntimeError("invalid optimize engine: %s" % engine_requested)
        if topology not in {"triangle", "quad"}:
            raise RuntimeError("invalid optimize topology: %s" % topology)
        if target < 4 or target > 10000000:
            raise RuntimeError("targetFaces must be between 4 and 10000000")
        if engine_requested in {"quadriflow", "voxel"} and (not math.isfinite(voxel_size) or voxel_size < 0.0 or voxel_size > 1.0):
            raise RuntimeError("voxelSize must be 0 (auto) or between 0.001 and 1")

        input_triangles = triangle_count(objects)
        engine_used = engine_requested
        if engine_requested == "decimate":
            if topology == "quad":
                self.log("decimate does not produce quad topology; triangulating output")
            self.log("decimate retains UV data; preserveUVs=%s" % preserve_uvs)
            objects = decimate_to_target(objects, target, self.log)
        else:
            objects = join_mesh_objects(objects, self.log)
            obj = objects[0]
            if engine_requested == "voxel":
                voxel_remesh_to_target(obj, voxel_size, target, self.log)
            else:
                backup = obj.data.copy()
                quad_target = target if topology == "quad" else max(4, int(round(target / 2.0)))
                self.log("quadriflow remesh target=%d %s face(s)" % (quad_target, "quad" if topology == "quad" else "quad before triangulation"))
                try:
                    select_only(obj)
                    result = bpy.ops.object.quadriflow_remesh(
                        target_faces=quad_target,
                        use_mesh_symmetry=False,
                        use_preserve_sharp=True,
                        use_preserve_boundary=True,
                        smooth_normals=True,
                    )
                    if "FINISHED" not in result:
                        raise RuntimeError("operator returned %s" % sorted(result))
                except Exception as exc:
                    failed_data = obj.data
                    obj.data = backup
                    if failed_data != backup and failed_data.users == 0:
                        bpy.data.meshes.remove(failed_data)
                    engine_used = "voxel"
                    self.log("quadriflow failed (%s); falling back to voxel" % exc)
                    voxel_remesh_to_target(obj, voxel_size, target, self.log)
                else:
                    bpy.data.meshes.remove(backup)
                    clear_uvs(objects)
                    self.log("quadriflow remesh produced %d triangle(s) before topology conversion" % triangle_count(objects))
                    if topology == "triangle":
                        triangulate(objects)
                        remeshed_triangles = triangle_count(objects)
                        if remeshed_triangles > target * 1.05:
                            self.log("quadriflow result is more than 5%% over target; applying light decimate pass")
                            objects = decimate_to_target(objects, target, self.log)

            clear_uvs(objects)
            self.log("%s remesh output has no UVs; use mesh.bake to transfer textures" % engine_used)

        output_triangles = triangle_count(objects)
        output_has_uvs = has_uvs(objects)
        self.log(
            "optimize engineRequested=%s engineUsed=%s inputTriangles=%d outputTriangles=%d hasUVs=%s"
            % (engine_requested, engine_used, input_triangles, output_triangles, output_has_uvs)
        )
        metadata = {
            "engineRequested": engine_requested,
            "engineUsed": engine_used,
            "inputTriangles": input_triangles,
            "outputTriangles": output_triangles,
            "hasUVs": output_has_uvs,
        }
        with open(os.path.join(self.output_dir, "optimize.json"), "w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2, sort_keys=True)
            handle.write("\n")
        result = self.finish_mesh(objects)
        result["meta"] = {"mesh": "optimize.json"}
        return result

    def auto_transform(self):
        objects = self.import_mesh()
        target_height = float(self.scalar("targetHeight", 1.8))
        if not math.isfinite(target_height) or target_height <= 0.0:
            raise RuntimeError("targetHeight must be positive")
        minimum, maximum = bounds(objects)
        height = maximum.z - minimum.z
        if height <= 1e-12:
            raise RuntimeError("cannot scale a zero-height mesh")
        scale_around(objects, Vector((1.0, 1.0, 1.0)) * (target_height / height), (minimum + maximum) * 0.5)
        move_origin(objects, str(self.scalar("origin", "bottom-center")))
        rotate_objects(objects, str(self.scalar("faceAxis", "-Y")))
        self.log("auto transformed to height %.6f, origin %s, face %s" % (target_height, self.scalar("origin", "bottom-center"), self.scalar("faceAxis", "-Y")))
        return self.finish_mesh(objects)

    def bbox_fit(self):
        objects = self.import_mesh()
        requested = Vector((float(self.scalar("width")), float(self.scalar("depth")), float(self.scalar("height"))))
        if any(not math.isfinite(value) or value <= 0.0 for value in requested):
            raise RuntimeError("width, height, and depth must be positive")
        minimum, maximum = bounds(objects)
        current = maximum - minimum
        if min(current) <= 1e-12:
            raise RuntimeError("cannot bbox-fit a mesh with a zero-size dimension")
        factors = Vector((requested.x / current.x, requested.y / current.y, requested.z / current.z))
        scale_around(objects, factors, (minimum + maximum) * 0.5)
        result_minimum, result_maximum = bounds(objects)
        result = result_maximum - result_minimum
        self.log("bbox fit result width=%.6f height=%.6f depth=%.6f" % (result.x, result.z, result.y))
        return self.finish_mesh(objects)

    def set_origin(self):
        objects = self.import_mesh()
        origin = str(self.scalar("origin", "bottom-center"))
        move_origin(objects, origin)
        self.log("set origin to %s" % origin)
        return self.finish_mesh(objects)

    def rotate_to_axis(self):
        objects = self.import_mesh()
        face = str(self.scalar("face", "-Y"))
        rotate_objects(objects, face)
        self.log("rotated source -Y face toward %s" % face)
        return self.finish_mesh(objects)

    def render(self):
        objects = self.import_mesh()
        size = int(self.scalar("size", 1024))
        if size < 1 or size > 16384:
            raise RuntimeError("size must be between 1 and 16384")
        yaw = float(self.scalar("yaw", 35.0))
        pitch = float(self.scalar("pitch", 15.0))
        output = os.path.join(self.output_dir, "image.png")
        render_mesh(objects, output, size, yaw, pitch)
        self.log("rendered image.png at %dx%d yaw=%.3f pitch=%.3f" % (size, size, yaw, pitch))
        return {"image": "image.png"}

    def extract_textures(self):
        objects = self.import_mesh()
        materials = ordered_materials(objects)
        outputs = {}
        for channel in CHANNELS:
            selected = None
            for material in materials:
                principled = find_principled(material)
                image = image_for_principled_input(principled, PRINCIPLED_INPUTS[channel]) if principled else None
                if image is not None:
                    selected = (material, principled, image)
                    break
            filename = channel + ".png"
            destination = os.path.join(self.output_dir, filename)
            if selected is not None:
                material, _, image = selected
                save_image_as_png(image, destination)
                self.log("%s: chose texture '%s' from material '%s'" % (channel, image.name, material.name))
            else:
                material = materials[0] if materials else None
                principled = find_principled(material) if material else None
                color = constant_for_channel(principled, channel)
                save_solid_png(destination, color, 1024, "sRGB" if channel == "baseColor" else "Non-Color")
                self.log("%s: wrote constant %s from material '%s'" % (channel, tuple(round(v, 6) for v in color), material.name if material else "<none>"))
            outputs[channel] = filename
        return outputs

    def apply_textures(self):
        objects = self.import_mesh()
        supplied = {}
        for channel in CHANNELS:
            source = self.path_input(channel, required=False)
            if source:
                image = bpy.data.images.load(source, check_existing=False)
                image.name = "Ateli %s" % channel
                set_colorspace(image, "sRGB" if channel == "baseColor" else "Non-Color")
                if channel == "normal" and str(self.scalar("normalConvention", "opengl")) == "directx":
                    image = invert_green(image, "Ateli normal OpenGL")
                    self.log("normal: inverted green channel from DirectX to OpenGL")
                materialized = os.path.join(self.output_dir, ".applied-%s.png" % channel)
                save_image_as_png(image, materialized)
                image.filepath = materialized
                try:
                    image.pack()
                except RuntimeError:
                    pass
                supplied[channel] = image
        if not supplied:
            self.log("no texture channels supplied; exporting mesh unchanged")
        apply_images_to_materials(objects, supplied, self.log)
        return self.finish_mesh(objects)

    def bake(self):
        high = self.import_mesh("high")
        create_collection_for(high, "Ateli High")
        low_source = self.path_input("low")
        before = set(bpy.data.objects)
        self.log("importing low from %s" % low_source)
        bpy.ops.import_scene.gltf(filepath=low_source)
        low = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
        if not low:
            raise RuntimeError("input 'low' contains no mesh objects")
        create_collection_for(low, "Ateli Low")
        resolution = int(self.scalar("resolution", 2048))
        margin = int(self.scalar("margin", 16))
        ao_samples = int(self.scalar("aoSamples", 32))
        if resolution < 256 or resolution > 4096:
            raise RuntimeError("resolution must be between 256 and 4096")
        if margin < 0:
            raise RuntimeError("margin must be non-negative")
        ensure_uvs(low, self.log, resolution)
        ensure_materials(low)
        enabled = {
            "baseColor": bool(self.scalar("bakeBaseColor", True)),
            "roughness": bool(self.scalar("bakeRoughness", True)),
            "metallic": bool(self.scalar("bakeMetallic", True)),
            "normal": bool(self.scalar("bakeNormal", True)),
            "ao": bool(self.scalar("bakeAO", True)),
        }
        set_cycles_engine()
        if hasattr(bpy.context.scene, "cycles"):
            bpy.context.scene.cycles.samples = max(1, ao_samples)
        minimum, maximum = bounds(high + low)
        # How far outside the low surface rays start. Auto suits a low derived from this high; a low from a
        # different model (a hand-made base) needs a few centimetres to reach past the mismatch.
        cage = float(self.scalar("rayDistance", 0.0))
        if cage <= 0.0:
            cage = max((maximum - minimum).length * 0.005, 0.001)
        self.log("bake cage extrusion %.4f" % cage)
        # A hand-made low pokes outside the high in places (fingertips, chin, kneecaps); rays from there hit nothing
        # and bake black. For the colour channels the low's vertices are shrinkwrapped onto the high surface so every
        # ray lands. Normal and AO describe the low's own geometry, so they bake against the real surface — a tangent
        # normal map baked on the conformed shape and applied to the restored one is simply wrong.
        colour_channels = ("baseColor", "roughness", "metallic")
        restore = conform_low_for_bake(low, high, self.log)
        conformed = True
        baked = {}
        for channel, is_enabled in enabled.items():
            if not is_enabled:
                self.log("%s bake disabled" % channel)
                continue
            if conformed and channel not in colour_channels:
                restore()
                conformed = False
                self.log("low geometry restored before %s bake" % channel)
            image = bpy.data.images.new("Ateli baked %s" % channel, width=resolution, height=resolution, alpha=False, float_buffer=False)
            image.generated_color = SOLID_DEFAULTS[channel]
            set_colorspace(image, "sRGB" if channel == "baseColor" else "Non-Color")
            target_nodes = attach_bake_target(low, image)
            try:
                bake_channel(high, low, channel, image, margin, cage)
            finally:
                remove_bake_targets(target_nodes)
            filename = channel + ".png"
            destination = os.path.join(self.output_dir, filename)
            save_image_as_png(image, destination)
            # A GENERATED image exports as its generated_color, not its baked pixels: rebind it to the saved
            # file and pack it so the glTF exporter embeds what was actually baked.
            image.filepath = destination
            image.source = "FILE"
            image.reload()
            set_colorspace(image, "sRGB" if channel == "baseColor" else "Non-Color")
            try:
                image.pack()
            except RuntimeError:
                pass
            baked[channel] = image
            self.log("baked %s at %d with margin %d" % (channel, resolution, margin))
        restore()
        material_channels = dict(baked)
        apply_images_to_materials(low, material_channels, self.log)
        result = self.finish_mesh(low)
        for channel in enabled:
            if channel in baked:
                result[channel] = channel + ".png"
        return result


def select_only(obj):
    if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def create_collection_for(objects, name):
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    for obj in objects:
        for current in list(obj.users_collection):
            current.objects.unlink(obj)
        collection.objects.link(obj)
    return collection


def triangle_count(objects):
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def triangulate(objects):
    for obj in objects:
        if not obj.data.polygons:
            continue
        select_only(obj)
        modifier = obj.modifiers.new("Ateli Triangulate", "TRIANGULATE")
        modifier.quad_method = "BEAUTY"
        modifier.ngon_method = "BEAUTY"
        bpy.ops.object.modifier_apply(modifier=modifier.name)



def join_mesh_objects(objects, logger):
    bake_world_transforms(objects)
    if len(objects) == 1:
        select_only(objects[0])
        return objects
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    logger("joined %d mesh objects for remeshing" % len(objects))
    return [objects[0]]


def has_uvs(objects):
    return any(len(obj.data.uv_layers) > 0 for obj in objects)


def clear_uvs(objects):
    for obj in objects:
        while obj.data.uv_layers:
            obj.data.uv_layers.remove(obj.data.uv_layers[0])


def decimate_to_target(objects, target, logger):
    triangulate(objects)
    before = triangle_count(objects)
    if before <= target:
        return objects
    ratio = max(0.0, min(1.0, target / float(before)))
    logger("decimating %d triangles toward %d (ratio %.8f)" % (before, target, ratio))
    for obj in objects:
        if not obj.data.polygons:
            continue
        select_only(obj)
        modifier = obj.modifiers.new("Ateli Collapse Decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        if hasattr(modifier, "use_collapse_triangulate"):
            modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    triangulate(objects)
    after = triangle_count(objects)
    tolerance = max(1, int(math.ceil(target * 0.02)))
    if abs(after - target) > tolerance:
        raise RuntimeError("collapse decimation produced %d triangles; target %d requires ±%d" % (after, target, tolerance))
    logger("decimate result=%d target=%d tolerance=%d" % (after, target, tolerance))
    return objects


def voxel_size_for_target(obj, target):
    # A voxel surface yields roughly 2.5 triangles per voxel-area of surface; aim a little above the target so the
    # decimate pass only trims, instead of smoothing a far denser mesh into a blob.
    scale = obj.matrix_world.to_scale()
    area = sum(polygon.area for polygon in obj.data.polygons) * abs(scale.x * scale.y)
    if area <= 0.0:
        return 0.01
    size = math.sqrt(2.5 * area / (target * 1.5))
    return min(1.0, max(0.001, size))


def voxel_remesh_to_target(obj, voxel_size, target, logger):
    select_only(obj)
    if voxel_size <= 0.0:
        voxel_size = voxel_size_for_target(obj, target)
        logger("voxel size auto: %.4f for target %d" % (voxel_size, target))
    obj.data.remesh_voxel_size = voxel_size
    obj.data.remesh_voxel_adaptivity = 0.0
    result = bpy.ops.object.voxel_remesh()
    if "FINISHED" not in result:
        raise RuntimeError("voxel remesh returned %s" % sorted(result))
    clear_uvs([obj])
    logger("voxel remesh at size %.6f produced %d triangle(s) before decimation" % (voxel_size, triangle_count([obj])))
    decimate_to_target([obj], target, logger)

def bounds(objects):
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for index in range(3):
                minimum[index] = min(minimum[index], point[index])
                maximum[index] = max(maximum[index], point[index])
            found = True
    if not found:
        raise RuntimeError("mesh has no bounds")
    return minimum, maximum


def transform_objects(objects, matrix):
    for obj in objects:
        obj.matrix_world = matrix @ obj.matrix_world


def scale_around(objects, factors, center):
    matrix = Matrix.Translation(center) @ Matrix.Diagonal((factors.x, factors.y, factors.z, 1.0)) @ Matrix.Translation(-center)
    transform_objects(objects, matrix)


def origin_point(objects, origin):
    minimum, maximum = bounds(objects)
    center = (minimum + maximum) * 0.5
    points = {
        "bottom-center": Vector((center.x, center.y, minimum.z)),
        "center": center,
        "top-center": Vector((center.x, center.y, maximum.z)),
        "min-corner": minimum,
    }
    if origin not in points:
        raise RuntimeError("invalid origin: %s" % origin)
    return points[origin]


def move_origin(objects, origin):
    transform_objects(objects, Matrix.Translation(-origin_point(objects, origin)))


def rotate_objects(objects, face):
    rotations = {
        "-Y": Matrix.Identity(4),
        "+Y": Matrix.Rotation(math.pi, 4, "Z"),
        "-X": Matrix.Rotation(-math.pi / 2.0, 4, "Z"),
        "+X": Matrix.Rotation(math.pi / 2.0, 4, "Z"),
        "-Z": Matrix.Rotation(math.pi / 2.0, 4, "X"),
        "+Z": Matrix.Rotation(-math.pi / 2.0, 4, "X"),
    }
    rotation = rotations.get(face)
    if rotation is None:
        raise RuntimeError("invalid face axis: %s" % face)
    transform_objects(objects, rotation)


def bake_world_transforms(objects):
    for obj in objects:
        obj.data.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
        obj.data.update()


def ordered_materials(objects):
    result = []
    seen = set()
    for obj in objects:
        for material in obj.data.materials:
            if material is not None and material.as_pointer() not in seen:
                seen.add(material.as_pointer())
                result.append(material)
    return result


def find_principled(material):
    if material is None:
        return None
    if not material.use_nodes:
        material.use_nodes = True
    return next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)


def upstream_image(socket, visited=None):
    if socket is None:
        return None
    visited = visited or set()
    for link in socket.links:
        node = link.from_node
        pointer = node.as_pointer()
        if pointer in visited:
            continue
        visited.add(pointer)
        if node.type == "TEX_IMAGE" and node.image is not None:
            return node.image
        for input_socket in node.inputs:
            image = upstream_image(input_socket, visited)
            if image is not None:
                return image
    return None


def image_for_principled_input(principled, input_name):
    if principled is None:
        return None
    return upstream_image(principled.inputs.get(input_name))


def constant_for_channel(principled, channel):
    if principled is None:
        return SOLID_DEFAULTS[channel]
    socket = principled.inputs.get(PRINCIPLED_INPUTS[channel])
    if socket is None or socket.is_linked:
        return SOLID_DEFAULTS[channel]
    value = socket.default_value
    if channel == "baseColor" and hasattr(value, "__len__"):
        return tuple(float(value[index]) for index in range(4))
    if channel in {"roughness", "metallic"}:
        scalar = float(value)
        return (scalar, scalar, scalar, 1.0)
    return SOLID_DEFAULTS[channel]


def set_colorspace(image, name):
    try:
        image.colorspace_settings.name = name
    except (TypeError, AttributeError):
        pass


def save_image_as_png(image, destination):
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    scene = bpy.context.scene
    previous_format = scene.render.image_settings.file_format
    previous_mode = scene.render.image_settings.color_mode
    previous_depth = scene.render.image_settings.color_depth
    try:
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "8"
        image.save_render(destination, scene=scene)
    finally:
        scene.render.image_settings.file_format = previous_format
        scene.render.image_settings.color_mode = previous_mode
        scene.render.image_settings.color_depth = previous_depth
    if not os.path.isfile(destination) or os.path.getsize(destination) == 0:
        raise RuntimeError("failed to write PNG: %s" % destination)


def save_solid_png(destination, color, size, colorspace):
    image = bpy.data.images.new(Path(destination).stem, width=size, height=size, alpha=True, float_buffer=False)
    image.generated_type = "BLANK"
    image.generated_color = color
    set_colorspace(image, colorspace)
    save_image_as_png(image, destination)
    bpy.data.images.remove(image)


def invert_green(source, name):
    width, height = int(source.size[0]), int(source.size[1])
    if width < 1 or height < 1:
        raise RuntimeError("normal image has no pixels")
    result = bpy.data.images.new(name, width=width, height=height, alpha=True, float_buffer=source.is_float)
    pixels = array.array("f", [0.0]) * (width * height * 4)
    source.pixels.foreach_get(pixels)
    for index in range(1, len(pixels), 4):
        pixels[index] = 1.0 - pixels[index]
    result.pixels.foreach_set(pixels)
    result.update()
    set_colorspace(result, "Non-Color")
    return result


def ensure_materials(objects):
    for obj in objects:
        if len(obj.data.materials) == 0:
            material = bpy.data.materials.new("Ateli Material")
            material.use_nodes = True
            obj.data.materials.append(material)

def gltf_occlusion_input(nodes):
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketColor")
    group_node = next((node for node in nodes if node.type == "GROUP" and node.node_tree == group), None)
    if group_node is None:
        group_node = nodes.new("ShaderNodeGroup")
        group_node.name = "glTF Material Output"
        group_node.label = "glTF Material Output"
        group_node.node_tree = group
    return group_node.inputs.get("Occlusion")



def apply_images_to_materials(objects, images, logger):
    if not images:
        return
    ensure_materials(objects)
    for material in ordered_materials(objects):
        principled = find_principled(material)
        if principled is None:
            principled = material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
            output = next((node for node in material.node_tree.nodes if node.type == "OUTPUT_MATERIAL"), None)
            if output is None:
                output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
            material.node_tree.links.new(principled.outputs.get("BSDF"), output.inputs.get("Surface"))
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        for channel, image in images.items():
            texture = nodes.new("ShaderNodeTexImage")
            texture.name = "Ateli %s" % channel
            texture.label = "Ateli %s" % channel
            texture.image = image
            texture.interpolation = "Linear"
            if channel == "ao":
                links.new(texture.outputs.get("Color"), gltf_occlusion_input(nodes))
            elif channel == "normal":
                normal = nodes.new("ShaderNodeNormalMap")
                normal.name = "Ateli Normal"
                normal.label = "Ateli Normal"
                normal.space = "TANGENT"
                links.new(texture.outputs.get("Color"), normal.inputs.get("Color"))
                links.new(normal.outputs.get("Normal"), principled.inputs.get("Normal"))
            else:
                links.new(texture.outputs.get("Color"), principled.inputs.get(PRINCIPLED_INPUTS[channel]))
            logger("%s: applied to material '%s'" % (channel, material.name))


def ensure_uvs(objects, logger, resolution=2048):
    for obj in objects:
        if len(obj.data.uv_layers) > 0:
            continue
        if unwrap_with_xatlas(obj, logger, resolution):
            continue
        select_only(obj)
        bpy.ops.object.mode_set(mode="EDIT")
        try:
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.0, scale_to_bounds=True)
        finally:
            bpy.ops.object.mode_set(mode="OBJECT")
        logger("low mesh '%s' had no UVs; Smart UV Project fallback (install xatlas into Blender's Python for better atlases)" % obj.name)


def unwrap_with_xatlas(obj, logger, resolution):
    # xatlas charts by curvature and packs tightly: on a remeshed character it gives ~220 charts at ~57% coverage
    # where Smart UV Project gives 400-650 shards at ~40-48%. It rebuilds the vertex list (seam vertices are split),
    # so the mesh is replaced with xatlas's output; the input is already triangulated by every optimize engine.
    try:
        import numpy as np
        import xatlas
    except ImportError:
        return False
    mesh = obj.data
    mesh.calc_loop_triangles()
    vertices = np.array([v.co[:] for v in mesh.vertices], dtype=np.float32)
    triangles = np.array([t.vertices[:] for t in mesh.loop_triangles], dtype=np.uint32)
    normals = np.array([v.normal[:] for v in mesh.vertices], dtype=np.float32)
    if len(triangles) == 0:
        return False
    material_index = np.array([t.material_index for t in mesh.loop_triangles], dtype=np.int32)
    atlas = xatlas.Atlas()
    atlas.add_mesh(vertices, triangles, normals)
    chart = xatlas.ChartOptions()
    chart.max_iterations = 4
    pack = xatlas.PackOptions()
    pack.resolution = int(resolution)
    pack.padding = 4
    pack.bilinear = True
    atlas.generate(chart_options=chart, pack_options=pack)
    vertex_map, indices, uvs = atlas[0]
    rebuilt = bpy.data.meshes.new(mesh.name + ".xatlas")
    rebuilt.from_pydata([tuple(v) for v in vertices[vertex_map]], [], [tuple(int(i) for i in tri) for tri in indices])
    for material in mesh.materials:
        rebuilt.materials.append(material)
    for polygon, source_index in zip(rebuilt.polygons, material_index):
        polygon.material_index = int(source_index)
    uv_layer = rebuilt.uv_layers.new(name="UVMap")
    flat = uvs[indices.reshape(-1)]
    uv_layer.data.foreach_set("uv", flat.astype(np.float32).reshape(-1).tolist())
    rebuilt.update()
    old = obj.data
    obj.data = rebuilt
    if old.users == 0:
        bpy.data.meshes.remove(old)
    logger("low mesh '%s' had no UVs; xatlas unwrapped into %d chart(s), %.0f%% utilization" % (obj.name, atlas.chart_count, atlas.utilization * 100.0))
    return True

def attach_bake_target(objects, image):
    targets = []
    for material in ordered_materials(objects):
        nodes = material.node_tree.nodes
        for node in nodes:
            node.select = False
        target = nodes.new("ShaderNodeTexImage")
        target.name = "Ateli Bake Target"
        target.label = "Ateli Bake Target"
        target.image = image
        target.select = True
        nodes.active = target
        targets.append((material, target))
    return targets


def remove_bake_targets(targets):
    for material, node in targets:
        if node.name in material.node_tree.nodes:
            material.node_tree.nodes.remove(node)


def set_cycles_engine():
    try:
        bpy.context.scene.render.engine = "CYCLES"
    except TypeError as exc:
        raise RuntimeError("Cycles is required for mesh.bake: %s" % exc)


def configure_high_metallic_emission(high):
    changes = []
    for material in ordered_materials(high):
        principled = find_principled(material)
        if principled is None:
            continue
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL" and node.is_active_output), None)
        if output is None:
            output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL"), None)
        if output is None:
            continue
        surface = output.inputs.get("Surface")
        original = surface.links[0].from_socket if surface and surface.links else None
        emission = nodes.new("ShaderNodeEmission")
        metallic = principled.inputs.get("Metallic")
        if metallic and metallic.links:
            links.new(metallic.links[0].from_socket, emission.inputs.get("Color"))
        else:
            value = float(metallic.default_value) if metallic else 0.0
            emission.inputs.get("Color").default_value = (value, value, value, 1.0)
        links.new(emission.outputs.get("Emission"), surface)
        changes.append((material, output, original, emission))
    return changes


def restore_high_emission(changes):
    for material, output, original, emission in changes:
        links = material.node_tree.links
        surface = output.inputs.get("Surface")
        if original is not None:
            links.new(original, surface)
        material.node_tree.nodes.remove(emission)


def conform_low_for_bake(low, high, logger):
    if not high:
        return lambda: None
    target = high[0]
    joined = None
    if len(high) > 1:
        copies = []
        for obj in high:
            copy = obj.copy()
            copy.data = obj.data.copy()
            bpy.context.scene.collection.objects.link(copy)
            copies.append(copy)
        select_only(copies[0])
        for copy in copies[1:]:
            copy.select_set(True)
        bpy.ops.object.join()
        joined = target = copies[0]
    saved = []
    for low_object in low:
        coords = array.array("f", [0.0]) * (len(low_object.data.vertices) * 3)
        low_object.data.vertices.foreach_get("co", coords)
        saved.append((low_object, coords))
        modifier = low_object.modifiers.new("ateli-conform", "SHRINKWRAP")
        modifier.target = target
        modifier.wrap_method = "NEAREST_SURFACEPOINT"
        modifier.wrap_mode = "ON_SURFACE"
        select_only(low_object)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        logger("low '%s' conformed to the high surface for baking" % low_object.name)

    def restore():
        for low_object, coords in saved:
            low_object.data.vertices.foreach_set("co", coords)
            low_object.data.update()
        if joined is not None:
            data = joined.data
            bpy.data.objects.remove(joined)
            if data.users == 0:
                bpy.data.meshes.remove(data)
    return restore


def bake_channel(high, low, channel, image, margin, cage):
    changes = configure_high_metallic_emission(high) if channel == "metallic" else []
    bake_types = {
        "baseColor": "DIFFUSE",
        "roughness": "ROUGHNESS",
        "metallic": "EMIT",
        "normal": "NORMAL",
        "ao": "AO",
    }
    first = True
    try:
        for low_object in low:
            bpy.ops.object.select_all(action="DESELECT")
            for high_object in high:
                high_object.hide_render = False
                high_object.select_set(True)
            low_object.hide_render = False
            low_object.select_set(True)
            bpy.context.view_layer.objects.active = low_object
            kwargs = {
                "type": bake_types[channel],
                "use_selected_to_active": True,
                "cage_extrusion": cage,
                "margin": margin,
                "use_clear": first,
            }
            if channel == "baseColor":
                kwargs["pass_filter"] = {"COLOR"}
            if channel == "normal":
                kwargs["normal_space"] = "TANGENT"
            bpy.ops.object.bake(**kwargs)
            first = False
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        if changes:
            restore_high_emission(changes)


def set_eevee_engine(scene):
    current = scene.render.engine
    if "EEVEE" in current:
        return
    for identifier in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = identifier
            return
        except TypeError:
            continue
    raise RuntimeError("EEVEE render engine is unavailable")


def linear_srgb(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def render_mesh(objects, destination, size, yaw, pitch):
    scene = bpy.context.scene
    set_eevee_engine(scene)
    scene.render.resolution_x = int(size)
    scene.render.resolution_y = int(size)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.filepath = destination
    scene.render.use_file_extension = True
    scene.render.image_settings.color_depth = "8"
    view_transforms = {item.identifier for item in scene.view_settings.bl_rna.properties["view_transform"].enum_items}
    if "Standard" in view_transforms:
        scene.view_settings.view_transform = "Standard"
    looks = {item.identifier for item in scene.view_settings.bl_rna.properties["look"].enum_items}
    if "None" in looks:
        scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    world = bpy.data.worlds.new("Ateli Preview World")
    world.use_nodes = True
    background = next((node for node in world.node_tree.nodes if node.type == "BACKGROUND"), None)
    value = linear_srgb(0x1A / 255.0)
    background.inputs.get("Color").default_value = (value, value, value, 1.0)
    background.inputs.get("Strength").default_value = 1.0
    scene.world = world
    minimum, maximum = bounds(objects)
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    radius = max(extent.length * 0.5, 0.1)
    yaw_radians = math.radians(yaw)
    pitch_radians = math.radians(max(-89.0, min(89.0, pitch)))
    direction = Vector((
        math.sin(yaw_radians) * math.cos(pitch_radians),
        -math.cos(yaw_radians) * math.cos(pitch_radians),
        math.sin(pitch_radians),
    ))
    camera_data = bpy.data.cameras.new("Ateli Camera")
    camera = bpy.data.objects.new("Ateli Camera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera.location = center + direction * (radius * 4.0)
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.ortho_scale = max(extent.length * 1.15, 0.2)
    camera_data.clip_start = max(radius / 1000.0, 0.001)
    camera_data.clip_end = max(radius * 20.0, 100.0)
    scene.camera = camera
    light_specs = (
        ("Key", Vector((-1.8, -2.2, 2.5)), 900.0, 4.0),
        ("Fill", Vector((2.4, -1.0, 1.0)), 450.0, 5.0),
        ("Rim", Vector((0.5, 2.5, 2.2)), 700.0, 3.0),
    )
    energy_scale = max(radius * radius, 0.25)
    for name, offset, energy, area_size in light_specs:
        light_data = bpy.data.lights.new("Ateli %s" % name, type="AREA")
        light_data.energy = energy * energy_scale
        light_data.shape = "DISK"
        light_data.size = max(radius * area_size, 0.5)
        light = bpy.data.objects.new("Ateli %s" % name, light_data)
        scene.collection.objects.link(light)
        light.location = center + offset.normalized() * radius * 3.5
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
    for obj in scene.objects:
        if obj.type == "MESH":
            obj.hide_render = obj not in objects
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(destination) or os.path.getsize(destination) == 0:
        raise RuntimeError("render did not create %s" % destination)


def main():
    if "--" not in sys.argv or sys.argv.index("--") + 1 >= len(sys.argv):
        print("mesh-worker failed: expected request.json after --", file=sys.stderr, flush=True)
        return 2
    worker = None
    try:
        worker = Worker(sys.argv[sys.argv.index("--") + 1])
        worker.run()
        return 0
    except Exception as exc:
        if worker is not None:
            worker.log("ERROR: %s" % exc)
        traceback.print_exc(file=sys.stderr)
        print("mesh-worker failed: %s" % exc, file=sys.stderr, flush=True)
        return 1
    finally:
        if worker is not None:
            worker.close()


if __name__ == "__main__":
    sys.exit(main())
