/**
 * Repository scanner — walk a tree, read real files, extract real imports.
 *
 * This is the evidence layer. Everything downstream (the diagram, the spec
 * doc) is a drawing of what this file actually saw, so it deliberately makes
 * no guesses: it does not call a model, it does not infer an architecture
 * from a folder name. It parses imports and counts.
 *
 * Deterministic: the same tree always produces the same graph, byte for byte.
 * That is what makes an exported diagram diffable against the next scan.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Directories that are never architecture. Skipping them is most of the
 * difference between a diagram and a hairball.
 */
export const DEFAULT_SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'out', 'target', 'coverage', '.nyc_output',
  '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.ruff_cache', '.tox', 'site-packages', 'egg-info',
  '.next', '.nuxt', '.svelte-kit', '.astro', '.cache', '.parcel-cache',
  '.turbo', '.gradle', '.idea', '.vscode', 'Pods', 'DerivedData',
  'tmp', 'temp', '.tmp', 'logs', 'public', 'static', 'assets', 'images',
]);

/** Extension -> language. Anything absent is not source and is not walked. */
export const LANGUAGE_BY_EXT = {
  '.mjs': 'javascript', '.cjs': 'javascript', '.js': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.scala': 'scala',
  '.php': 'php',
  '.swift': 'swift',
  '.cs': 'csharp',
  '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp',
  '.ex': 'elixir', '.exs': 'elixir',
  '.lua': 'lua',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.sql': 'sql',
  '.vue': 'vue', '.svelte': 'svelte',
};

/**
 * Standard-library and platform modules.
 *
 * Without this list the "external dependencies" section is dominated by `os`,
 * `sys` and `node:fs` — which are not dependencies anyone chose. Excluding them
 * is the difference between a useful inventory and noise.
 */
export const BUILTIN_MODULES = new Set([
  // Node
  'fs', 'path', 'os', 'util', 'events', 'stream', 'http', 'https', 'crypto', 'url',
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'dgram',
  'dns', 'domain', 'net', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'string_decoder', 'sys', 'timers', 'tls', 'tty', 'v8', 'vm',
  'worker_threads', 'zlib', 'module', 'async_hooks', 'inspector', 'trace_events',
  'wasi', 'diagnostics_channel', 'test',
  // Python
  'os', 'sys', 're', 'json', 'math', 'datetime', 'time', 'typing', 'pathlib',
  'collections', 'itertools', 'functools', 'subprocess', 'logging', 'random',
  'hashlib', 'sqlite3', 'asyncio', 'dataclasses', 'enum', 'abc', 'io', 'csv',
  'unittest', 'uuid', 'shutil', 'tempfile', 'threading', 'concurrent', 'importlib',
  'inspect', 'textwrap', 'urllib', 'socket', 'base64', 'struct', 'warnings',
  'contextlib', 'copy', 'operator', 'string', 'traceback', 'glob', 'argparse',
  '__future__', 'builtins',
  'configparser', 'pickle', 'secrets', 'statistics', 'decimal', 'fractions',
  'platform', 'signal', 'errno', 'select', 'ssl', 'email', 'mimetypes', 'zipfile',
  'tarfile', 'gzip', 'bz2', 'lzma', 'xml', 'html', 'array', 'bisect', 'heapq',
  'queue', 'calendar', 'locale', 'codecs', 'marshal', 'dis', 'gc', 'mmap', 'ast',
  'keyword', 'token', 'tokenize', 'pprint', 'reprlib', 'types', 'weakref',
  'atexit', 'site', 'stat', 'fnmatch', 'linecache', 'fileinput', 'filecmp',
  'shlex', 'cmd', 'pdb', 'timeit', 'trace', 'tracemalloc', 'gettext', 'graphlib',
  // Go / Java / Rust
  'fmt', 'errors', 'strings', 'strconv', 'sort', 'sync', 'io', 'bufio', 'bytes',
  'context', 'encoding', 'net', 'regexp', 'time', 'math', 'log', 'flag', 'reflect',
  'java', 'javax', 'kotlin', 'scala', 'std', 'core', 'alloc',
]);

export function isBuiltinModule(spec) {
  const value = String(spec || '').trim();
  if (!value) return false;
  if (value.startsWith('node:') || value.startsWith('bun:')) return true;
  if (value.startsWith('github.com/') || value.startsWith('golang.org/')) return false;
  if (BUILTIN_MODULES.has(value)) return true;
  // A dotted or slashed path is builtin when its HEAD is: `urllib.parse`,
  // `concurrent.futures` and `os.path` are all stdlib, and checking only the
  // full string let them through as "external dependencies" — which made the
  // inventory read as though the project had chosen them.
  const head = value.split(/[./]/)[0];
  return head !== value && BUILTIN_MODULES.has(head);
}

/** Files that usually start a program. Used to seed entry-point detection. */
const ENTRY_BASENAMES = new Set([
  'index', 'main', 'cli', 'app', 'server', 'start', 'run', 'bootstrap',
  '__main__', 'manage', 'wsgi', 'asgi', 'application',
]);

/** Resolvable module suffixes, in the order a bundler would try them. */
const RESOLVE_SUFFIXES = [
  '', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts',
  '.json', '.py', '.go', '.rb', '.rs',
];
const RESOLVE_INDEXES = [
  '/index.mjs', '/index.js', '/index.ts', '/index.tsx', '/index.jsx', '/index.cjs',
  '/index.py', '/__init__.py',
];

/**
 * FNV-1a, 32-bit. Used to derive Excalidraw's `seed`/`versionNonce` from a
 * stable string so two exports of the same graph are byte-identical rather
 * than differing by a random number.
 */
export function hash32(input) {
  let h = 0x811c9dc5;
  const str = String(input ?? '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

export function extensionOf(filePath) {
  const base = path.basename(filePath).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

export function languageOf(filePath) {
  return LANGUAGE_BY_EXT[extensionOf(filePath)] || null;
}

/**
 * Extract raw import specifiers from source text.
 *
 * Deliberately regex-based rather than a full parse: the goal is the shape of
 * the dependency graph across a dozen languages, and a per-language parser
 * suite would be a much larger surface for the same architectural answer.
 * It is line-anchored where imports are line-based, so a string that merely
 * contains the word "import" does not become an edge.
 */
export function extractImports(text, language) {
  const found = new Set();
  const src = String(text || '');

  const add = (re, group = 1) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = (m[group] || '').trim();
      if (spec) found.add(spec);
    }
  };

  if (language === 'javascript' || language === 'typescript' || language === 'vue' || language === 'svelte') {
    add(/^[ \t]*import\s+[^'"\n]*?from\s*['"]([^'"]+)['"]/gm);
    add(/^[ \t]*import\s*['"]([^'"]+)['"]/gm);
    add(/^[ \t]*export\s+[^'"\n]*?from\s*['"]([^'"]+)['"]/gm);
    add(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    add(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    return [...found];
  }

  if (language === 'python') {
    add(/^[ \t]*from\s+([A-Za-z_][\w.]*)\s+import\b/gm);
    add(/^[ \t]*import\s+([A-Za-z_][\w.]*)/gm);
    return [...found];
  }

  if (language === 'go') {
    // import ( ... ) blocks, plus the single-line form.
    const block = /\bimport\s*\(([\s\S]*?)\)/g;
    let m;
    while ((m = block.exec(src)) !== null) {
      const inner = m[1];
      const quoted = /"([^"]+)"/g;
      let q;
      while ((q = quoted.exec(inner)) !== null) found.add(q[1]);
    }
    add(/^[ \t]*import\s+(?:[A-Za-z_.][\w.]*\s+)?"([^"]+)"/gm);
    return [...found];
  }

  if (language === 'ruby') {
    add(/^[ \t]*require(?:_relative)?\s+['"]([^'"]+)['"]/gm);
    return [...found];
  }

  if (language === 'rust') {
    add(/^[ \t]*(?:pub\s+)?(?:use|mod)\s+([A-Za-z_][\w:]*)::/gm);
    return [...found];
  }

  if (language === 'java' || language === 'kotlin' || language === 'scala') {
    add(/^[ \t]*import\s+(?:static\s+)?([\w.]+)/gm);
    return [...found];
  }

  if (language === 'php') {
    add(/^[ \t]*(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/gm);
    add(/^[ \t]*use\s+([A-Za-z_][\w\\]*)/gm);
    return [...found];
  }

  return [];
}

/**
 * The package a bare specifier belongs to: `@scope/pkg/sub` -> `@scope/pkg`,
 * `lodash/fp` -> `lodash`, `os.path` -> `os`.
 */
export function packageNameOf(spec, language) {
  const value = String(spec || '');
  if (!value) return '';
  const sep = language === 'python' || language === 'go' || language === 'java'
    || language === 'kotlin' || language === 'scala' ? /[./]/ : /\//;
  const parts = value.split(sep);
  if (value.startsWith('@') && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0] || '';
}

/** Load package.json at the repo root, if there is one. */
function readManifest(rootPath) {
  const result = { entries: [], name: null, dependencies: [] };
  try {
    const raw = fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    if (pkg && typeof pkg === 'object') {
      result.name = pkg.name || null;
      for (const dep of Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })) {
        result.dependencies.push(dep);
      }
      const main = typeof pkg.main === 'string' ? pkg.main : null;
      if (main) result.entries.push(main.replace(/^\.\//, ''));
      if (typeof pkg.module === 'string') result.entries.push(pkg.module.replace(/^\.\//, ''));
      if (pkg.bin && typeof pkg.bin === 'object') {
        for (const v of Object.values(pkg.bin)) if (typeof v === 'string') result.entries.push(v.replace(/^\.\//, ''));
      } else if (typeof pkg.bin === 'string') {
        result.entries.push(pkg.bin.replace(/^\.\//, ''));
      }
    }
  } catch { /* no manifest, or unreadable — the heuristics still apply */ }
  return result;
}

/**
 * Walk a repository and return every source file with its imports already
 * extracted. Returns relative posix paths so the graph is portable.
 *
 * @returns {{files: object[], skipped: number, truncated: boolean, manifest: object}}
 */
export function walkRepository(rootPath, options = {}) {
  const root = path.resolve(String(rootPath));
  const stat = fs.statSync(root); // throws if missing — callers report it
  if (!stat.isDirectory()) {
    throw new Error(`not a directory: ${rootPath}`);
  }

  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(options.exclude || [])]);
  const maxFiles = Number.isFinite(Number(options.maxFiles)) && Number(options.maxFiles) > 0
    ? Math.trunc(Number(options.maxFiles))
    : 20000;

  const files = [];
  let skipped = 0;
  let truncated = false;

  const walk = (dirAbs) => {
    if (truncated) return;
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return; // unreadable directory — not worth failing the whole scan
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) return;
      const abs = path.join(dirAbs, entry.name);
      if (entry.isSymbolicLink()) { skipped += 1; continue; }
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) { skipped += 1; continue; }
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      const language = languageOf(entry.name);
      if (!language) { skipped += 1; continue; }
      if (files.length >= maxFiles) { truncated = true; return; }

      const rel = toPosix(path.relative(root, abs));
      let text = '';
      let bytes = 0;
      try {
        const buf = fs.readFileSync(abs);
        bytes = buf.length;
        text = buf.toString('utf8');
      } catch {
        skipped += 1;
        continue;
      }

      // A NUL byte this early means binary that happens to carry a source
      // extension (a checked-in artefact). Counting its lines would be a lie.
      if (text.slice(0, 4096).includes('\u0000')) { skipped += 1; continue; }

      const lines = text.length ? text.split(/\r\n|\r|\n/).length : 0;
      files.push({
        rel,
        language,
        bytes,
        loc: lines,
        imports: extractImports(text, language),
      });
    }
  };

  walk(root);

  return { files, skipped, truncated, manifest: readManifest(root) };
}

/**
 * Resolve one import specifier to a file inside the repository, or null when
 * it points outside it (a real dependency, or an unresolved alias).
 *
 * @param {string} spec raw specifier
 * @param {string} fromRel repo-relative path of the importing file
 * @param {Set<string>} knownFiles every repo-relative path we walked
 */
export function resolveImport(spec, fromRel, knownFiles, language) {
  const value = String(spec || '').trim();
  if (!value) return null;

  if (value.startsWith('.')) {
    const base = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), value)));
    const candidates = [
      ...RESOLVE_SUFFIXES.map(s => base + s),
      ...RESOLVE_INDEXES.map(s => base + s),
    ];
    for (const candidate of candidates) {
      if (knownFiles.has(candidate)) return candidate;
    }
    return null;
  }

  if (language === 'python') {
    // `from pkg.mod import x` is internal only if pkg/mod.py is actually here.
    const asPosix = value.replace(/\./g, '/');
    for (const candidate of [`${asPosix}.py`, `${asPosix}/__init__.py`]) {
      if (knownFiles.has(candidate)) return candidate;
    }
    return null;
  }

  if (language === 'go') {
    // Module paths are not repo-relative; match on the tail instead.
    const tail = value.split('/').slice(-2).join('/');
    if (!tail) return null;
    for (const known of knownFiles) {
      if (known.endsWith(`${tail}.go`) || known.endsWith(`${tail}/`)) return known;
    }
    return null;
  }

  if (language === 'ruby') {
    for (const candidate of [`${value}.rb`, `lib/${value}.rb`, `app/${value}.rb`]) {
      if (knownFiles.has(candidate)) return candidate;
    }
    return null;
  }

  if (language === 'java' || language === 'kotlin' || language === 'scala') {
    const asPath = value.replace(/\./g, '/');
    for (const ext of ['.java', '.kt', '.scala']) {
      const candidate = `src/main/${asPath}${ext}`;
      if (knownFiles.has(candidate)) return candidate;
    }
    return null;
  }

  // A bare JS/TS specifier can still be internal via a path alias or a
  // monorepo workspace; only claim it if the file really exists.
  for (const candidate of RESOLVE_SUFFIXES.map(s => value + s)) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}
