import { defineConfig } from 'vitest/config'

/** Real-model tests (slow, need the installed model). Not part of `npm test`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/model/**/*.model.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
