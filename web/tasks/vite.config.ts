import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  server: {
    proxy: {
      "/api": {
        target: "https://localhost:3838",
        secure: false,
      },
    },
  },
});
