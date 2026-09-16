/**
 * create_node — add a new node (mesh/group/light/helper/instanced/points/line/gltf/sprite)
 * to a scene. Returns { id } of the created node.
 *
 * Args:
 *   slug*         - scene slug
 *   type*         - "mesh" | "group" | "light" | "helper" | "instanced" | "points" | "line" | "gltf" | "sprite"
 *   id            - optional stable id; auto-generated from prefix if omitted
 *   name          - human-readable name (for scripts and lookups)
 *   parent        - parent node id (else attached to scene root)
 *   position/rotation/scale  - [x,y,z]
 *   castShadow/receiveShadow - bool
 *   geometry      - { type, params } (mesh/instanced/points/line)
 *   materialId    - material id (mesh/instanced/points/line/sprite)
 *   light         - { type, color, intensity, ... } (light nodes)
 *   helper        - { type, ... } (helper nodes)
 *   asset         - "assets/model.glb" (gltf nodes)
 *   count / instances - InstancedMesh options
 *   cwd           - base directory
 */
import { loadOrCreate, saveAndSync } from './scene-io.mjs';
import { genId } from './lib.mjs';

const VALID_TYPES = new Set(['mesh', 'group', 'light', 'helper', 'instanced', 'points', 'line', 'gltf', 'sprite', 'text']);

export async function call(args = {}, options = {}) {
  const {
    slug, type, id, name, parent, position, rotation, scale,
    castShadow, receiveShadow, visible,
    geometry, materialId, light, helper, asset, count, instances,
    cwd, title, width, height,
  } = args;

  if (!slug) return { success: false, output: '`slug` required.' };
  if (!type || !VALID_TYPES.has(type)) {
    return { success: false, output: `\`type\` must be one of: ${[...VALID_TYPES].join(', ')}` };
  }
  const scene = await loadOrCreate({ slug, title, width, height, cwd });

  const nodeId = id || genId(scene, type[0]);
  if (scene.nodes?.some(n => n.id === nodeId)) {
    return { success: false, output: `Node id "${nodeId}" already exists.` };
  }

  const node = { id: nodeId, type };
  if (name) node.name = name;
  if (parent) node.parent = parent;
  if (position) node.position = position;
  if (rotation) node.rotation = rotation;
  if (scale) node.scale = scale;
  if (castShadow) node.castShadow = true;
  if (receiveShadow) node.receiveShadow = true;
  if (visible === false) node.visible = false;

  switch (type) {
    case 'mesh':
    case 'points':
    case 'line':
      if (!geometry) return { success: false, output: `\`geometry\` required for ${type}.` };
      node.geometry = geometry;
      if (materialId) node.materialId = materialId;
      break;
    case 'instanced':
      if (!geometry) return { success: false, output: '`geometry` required for instanced.' };
      node.geometry = geometry;
      if (materialId) node.materialId = materialId;
      node.count = count || instances?.length || 1;
      if (instances) node.instances = instances;
      break;
    case 'light':
      if (!light?.type) return { success: false, output: '`light.type` required for light nodes.' };
      node.light = light;
      break;
    case 'helper':
      if (!helper?.type) return { success: false, output: '`helper.type` required for helper nodes.' };
      node.helper = helper;
      break;
    case 'gltf':
      if (!asset) return { success: false, output: '`asset` (path to .glb) required.' };
      node.asset = asset;
      break;
    case 'sprite':
      if (materialId) node.materialId = materialId;
      break;
    case 'group':
      break;
    default:
      // unreachable
  }

  scene.nodes = scene.nodes || [];
  scene.nodes.push(node);

  const paths = await saveAndSync(scene, cwd, options);
  return {
    success: true,
    output: {
      id: nodeId,
      type,
      slug,
      html_path: paths.html,
      dsl_path: paths.json,
    },
  };
}
