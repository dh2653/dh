import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/cutout": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cutout/, "/cutout"),
      },
      "/api/segment": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/segment/, "/segment"),
      },
      "/api/health": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: () => "/health",
      },
      "/api/views": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/views/, "/views"),
      },
      "/api/depth": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/depth/, "/depth"),
      },
    },
  },
});


