/**
 * search_asset_library — search curated free-asset libraries and return
 * downloadable URLs.
 *
 * v0.2 ships with a small hand-curated catalog covering common queries
 * (chair, table, tree, hdri). Real integration with Poly Haven /
 * Sketchfab search APIs is Phase 3.
 *
 * Args:
 *   query*   - free-text search
 *   limit    - max results (default 5)
 *   kind     - "model" | "texture" | "hdri" (default any)
 */
const CATALOG = [
  { name: 'polyhaven-brown-photostudio-02', kind: 'hdri', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/brown_photostudio_02_2k.hdr', tags: ['studio', 'neutral', 'indoor'] },
  { name: 'polyhaven-kloofendal-partly-cloudy', kind: 'hdri', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_partly_cloudy_puresky_2k.hdr', tags: ['outdoor', 'sky', 'sunset'] },
  { name: 'polyhaven-abandoned-workshop-2k',  kind: 'hdri', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/abandoned_workshop_02_2k.hdr', tags: ['interior', 'moody'] },
  { name: 'khronos-duck', kind: 'model', url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb', tags: ['duck', 'test', 'sample'] },
  { name: 'khronos-damaged-helmet', kind: 'model', url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb', tags: ['helmet', 'pbr', 'sample'] },
  { name: 'khronos-avocado', kind: 'model', url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Avocado/glTF-Binary/Avocado.glb', tags: ['avocado', 'food', 'pbr'] },
];

export async function call(args = {}) {
  const { query, limit = 5, kind } = args;
  if (!query) return { success: false, output: '`query` required.' };
  const q = String(query).toLowerCase();
  const scored = CATALOG
    .filter(item => !kind || item.kind === kind)
    .map(item => {
      const hay = [item.name, ...(item.tags || [])].join(' ').toLowerCase();
      const hits = q.split(/\s+/).filter(w => w && hay.includes(w)).length;
      return { ...item, score: hits };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    success: true,
    output: {
      query,
      count: scored.length,
      results: scored,
      note: 'v0.2 uses a small curated catalog. Poly Haven / Sketchfab live search is planned for Phase 3.',
    },
  };
}
