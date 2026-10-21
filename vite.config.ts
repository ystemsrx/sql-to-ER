import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pages 部署到 https://<user>.github.io/sql-to-ER/，资源路径需要带前缀。
// CI 根据仓库名注入 BASE_PATH；本地开发保持 "/".
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // 隐藏式 sourcemap：产物里不写 sourceMappingURL 注释，但 .map 文件会生成，
    // 便于线上报错时本地对照定位；部署工作流不会把 .map 发布出去。
    sourcemap: "hidden",
    // G6 4.x pulls a large @antv graph-rendering stack. It is split into
    // stable vendor chunks below; keep the warning threshold aligned with that
    // known dependency cost so warnings remain actionable.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      input: {
        main: "index.html",
        app: "sql2er.html",
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@antv/g6")) {
            return "vendor-g6";
          }
          if (id.includes("node_modules/@antv/")) return "vendor-antv";
          if (
            id.includes("node_modules/d3-") ||
            id.includes("node_modules/dagre") ||
            id.includes("node_modules/graphlib")
          ) {
            return "vendor-antv";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          if (
            id.includes("node_modules/codemirror") ||
            id.includes("node_modules/@codemirror") ||
            id.includes("node_modules/@lezer")
          ) {
            return "vendor-editor";
          }
          // prismjs/components/* 在模块顶层访问全局 Prism，必须落在独立 chunk
          // 里，等运行时显式 window.Prism = Prism 后再动态加载，否则会和 core 一起
          // 被同步求值并抛 ReferenceError。
          if (
            id.includes("node_modules/prismjs") &&
            !id.includes("node_modules/prismjs/components/")
          ) {
            return "vendor-prism";
          }
        },
      },
    },
  },
});
