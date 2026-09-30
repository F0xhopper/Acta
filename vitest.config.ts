import { defineConfig } from 'vitest/config';

// The starter and each site under sites/ run their own test suites.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: ['starter/**', 'sites/**', 'node_modules/**'] } });
