import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  define: {
    __FALLBACK_VERSION__: JSON.stringify(version),
  },
  test: {
    server: {
      deps: {
        inline: ['clipanion'],
      },
    },
  },
});
