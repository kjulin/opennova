import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const isCloudBuild = process.env.BUILD_TARGET === "cloud";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: isCloudBuild ? "/" : "/web/console/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "https://localhost:3838",
        secure: false,
      },
    },
  },
});
