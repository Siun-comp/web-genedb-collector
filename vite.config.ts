import { defineConfig } from "vitest/config";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBasePath = repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? process.env.GITHUB_PAGES_BASE ?? pagesBasePath,
  build: {
    outDir: "dist",
    sourcemap: true
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
