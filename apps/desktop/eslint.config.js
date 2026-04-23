import { config as baseConfig } from "@workspace/eslint-config/base"
import { config as reactInternal } from "@workspace/eslint-config/react-internal"

const nodeFiles = [
  "src/main/**/*.ts",
  "src/preload/**/*.ts",
  "electron.vite.config.ts",
]

const webFiles = ["src/renderer/**/*.{ts,tsx}"]

function withFiles(configs, files) {
  return configs.map((entry) => ({ ...entry, files }))
}

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["out/**", "dist/**", "node_modules/**", ".tsc-out-*/**"] },
  ...withFiles(baseConfig, nodeFiles),
  ...withFiles(reactInternal, webFiles),
]
