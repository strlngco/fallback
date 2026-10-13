import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  dts: false,
  clean: true,
  sourcemap: false,
  // The workspace packages are private, so they ship inside the bundle rather
  // than as registry dependencies.
  noExternal: [/^@strlngco\/fallback-/],
  define: {
    __FALLBACK_VERSION__: JSON.stringify(version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
