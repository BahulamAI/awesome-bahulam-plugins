# Three.js Scene Capabilities & Best Practices

## CDN & Imports
- Use ES module imports from `https://unpkg.com/three@0.170.0/build/three.module.js`
- Addons: `https://unpkg.com/three@0.170.0/examples/jsm/`
- Preferred pattern: importmap in HTML head, then `import * as THREE from 'three'`
- Include OrbitControls for explorable scenes: `from 'three/addons/controls/OrbitControls.js'`

## Scene Boilerplate (always include)
- `Scene`, `PerspectiveCamera(45, w/h, 0.1, 1000)`, `WebGLRenderer({ antialias: true })`
- Resize handler: update `camera.aspect` + `renderer.setSize(w, h)`
- `requestAnimationFrame` loop with `controls.update()` + `renderer.render()`
- Ambient + Directional lights (scene without lights = black)
- `renderer.toneMapping = THREE.ACESFilmicToneMapping` for modern look
- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` — cap for performance

## Feature Catalog

### Core 3D
| Feature | Three.js API |
|---------|-------------|
| Basic shapes | `BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `TorusGeometry`, `TorusKnotGeometry`, `PlaneGeometry`, `CircleGeometry` |
| Curves & extrusion | `CatmullRomCurve3`, `TubeGeometry`, `ExtrudeGeometry`, `LatheGeometry` |
| Text | `TextGeometry` (needs FontLoader + font JSON) |
| Custom geometry | `BufferGeometry` with position/normal/uv attributes |
| Materials | `MeshStandardMaterial` (PBR), `MeshPhongMaterial`, `MeshLambertMaterial`, `MeshNormalMaterial`, `MeshBasicMaterial`, `ShaderMaterial`, `PointsMaterial` |
| Lights | `AmbientLight`, `DirectionalLight` (castShadow), `PointLight`, `SpotLight`, `HemisphereLight`, `RectAreaLight` |
| Helpers | `GridHelper`, `AxesHelper`, `ArrowHelper`, `CameraHelper`, `DirectionalLightHelper` |

### Interaction & Controls
- `OrbitControls` — default for exploration (enableDamping, dampingFactor 0.08, autoRotate)
- `DragControls` — draggable objects
- `TransformControls` — translate/rotate/scale
- `Raycaster` — click/touch picking, hover detection
- CSS2DRenderer / CSS2DObject — overlay labels that follow 3D positions

### Animation
- `requestAnimationFrame` loop with delta-time-based updates
- GSAP integration via CDN: `https://unpkg.com/gsap`
- Morph targets on geometries for shape transitions
- Skeletal animation for character rigs
- Property tweens: position, rotation, scale, material opacity/color, morphTargetInfluences

### Post-Processing
- `EffectComposer` + `RenderPass` + effect passes:
  - `UnrealBloomPass` — bloom/glow
  - `SMAAPass` — anti-aliasing
  - `SSAOPass` — ambient occlusion
  - `OutlinePass` — edge highlighting
  - `FilmPass` — grain/noise
  - `VignetteShader` — vignette overlay

### Loaders
- `GLTFLoader` — glTF/glb models (industry standard)
- `OBJLoader` / `MTLLoader` — Wavefront OBJ
- `FBXLoader` — Autodesk FBX
- `TextureLoader` — JPEG/PNG textures
- `RGBELoader` — HDR environment maps
- `FontLoader` — Typeface JSON for TextGeometry
- `DRACOLoader` — Draco-compressed glTF

### Physics
- Simple verlet integration (no dep) for springs, particles, cloth
- `cannon-es` (CDN) for rigid body physics — boxes, spheres, planes, constraints
- `ammo.js` (CDN) for complex soft-body and vehicle physics

### Data Visualization
- `InstancedMesh` for 1000s of identical objects (bar charts, scatter plots, particle clouds)
- `BufferAttribute` updates for dynamic data (streaming, real-time)
- `Line` / `LineSegments` / `LineLoop` for network graphs, trajectories
- `Sprite` / `CSS2DRenderer` for labels and annotations
- Color mapping via HSL interpolation on material color
- Animated transitions between data states

### Shaders
- `ShaderMaterial` with custom vertex/fragment shaders
- Uniforms for time, mouse position, data values
- `RawShaderMaterial` for full GLSL control
- Post-processing custom shader passes via `ShaderPass`
- Signed Distance Fields (SDF) for procedural shapes

### Particles & Effects
- `Points` + `PointsMaterial` for large particle systems
- `BufferGeometry` with position, color, size attributes
- Sprite textures for particle appearance
- `Sprite` for billboarded elements (labels, icons)

## Performance Guidelines
- Use `InstancedMesh` for >100 identical objects (one draw call vs N)
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` — never higher
- Call `geometry.dispose()` and `material.dispose()` when removing objects
- Use `renderer.compile()` for pre-compilation in complex scenes
- Limit shadow map resolution to 1024 × 1024 per light
- Use LOD (Level of Detail) for far-away objects
- Prefer BufferGeometry over deprecated Geometry API
- Use `Object3D.frustumCulled = false` sparingly (only for always-visible objects)

## Anti-Patterns to Avoid
- ❌ Scene without any lights → result is completely black
- ❌ Camera positioned inside a solid mesh → see nothing
- ❌ No resize handler → canvas breaks on window resize
- ❌ Blocking the event loop with heavy sync computation
- ❌ Not calling `dispose()` on removed geometries/materials/textures → memory leak
- ❌ Using external image/model URLs without approval
- ❌ Hard-coding pixel values for layout (break on HiDPI)
- ❌ Un-debugged shaders — validate on a simple test mesh first