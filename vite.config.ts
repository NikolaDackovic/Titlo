import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolveModelsDir } from './build/modelsDir.ts'
import { localModelsPlugin } from './build/modelsPlugin.ts'

export default defineConfig({
  plugins: [react(), localModelsPlugin(resolveModelsDir())],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Transformers.js ships its own WASM/ONNX runtime; let it load lazily inside the worker.
    exclude: ['@huggingface/transformers'],
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
