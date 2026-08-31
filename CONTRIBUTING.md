# Contributing

## Adding your plugin to the registry

1. Fork this repo.
2. Add one entry to `registry.json` (keep the array alphabetically sorted).
3. Verify the JSON parses: `node -e 'JSON.parse(require("fs").readFileSync("registry.json"))'`
4. Open a PR with:
   - Link to your plugin repo
   - Screenshot(s) of any workspace view
   - Output of `bahulam plugin install <your-git-url> && bahulam plugin info <your-name>`

## Adding your plugin as a subdirectory here

If your plugin is small and doesn't warrant its own repo, we accept
subdirectory contributions under `plugins/`. Include:

- `plugin.yaml` (manifest)
- `README.md` (one example per tool + screenshots)
- `LICENSE` (or inherit the repo's MIT if you sign the CLA)
- A `selftest.mjs` if your handlers have non-trivial logic

Use the `subdir` field in your `registry.json` entry so the CLI knows to
install only your subdirectory.

## Manifest hygiene

- `apiVersion: bahulam.plugin/1` is the only supported version
- Tool names: `^[A-Za-z_][A-Za-z0-9_-]{0,63}$`, must not shadow built-ins
- Handlers must be pure ESM (`.mjs`), no CommonJS
- Every handler MUST return `{ success: boolean, output: any }` and honor
  `options.signal` for long-running work

## Security policy

- **Never** ship credentials in a handler, manifest, or view
- **Never** exec `curl | sh`, `bash -c`, or anything that fetches remote code
- If your plugin needs network access, document the endpoints in your README
- If your plugin needs a secret, read it from a documented env var — do not
  prompt for it in a view (the browser is not a credential store)

Anything that violates the security policy will be removed from the registry
without notice.
