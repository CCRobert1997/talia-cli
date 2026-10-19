// Bundle the CLI (packages/cli/src/index.ts) + authoring-core into a single
// Node-ready ESM file at dist/talia.js. esbuild transpiles the TS and follows the
// @talia/authoring-core workspace exports; @supabase/supabase-js stays external
// (resolved from node_modules at runtime). Runs on `prepare`, so a bare
// `npm i -g github:CCRobert1997/talia-cli` builds the binary automatically.
import { build } from 'esbuild'
import { chmodSync } from 'node:fs'

await build({
  entryPoints: ['packages/cli/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@supabase/supabase-js'],
  // No banner shebang: packages/cli/src/index.ts already starts with
  // `#!/usr/bin/env node`, and esbuild hoists the entry's shebang to line 1 of the
  // bundle. Adding a banner one too would duplicate it (line-2 shebang = ESM syntax error).
  outfile: 'dist/talia.js',
  logLevel: 'info',
})

chmodSync('dist/talia.js', 0o755)
