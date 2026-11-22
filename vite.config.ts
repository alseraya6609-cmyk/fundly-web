import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// نفس إعداد لوحة التحكم: React + Vite، والمسار المختصر @ يشير إلى client.
export default defineConfig({
  server: {
    host: "::",
    port: 8081,
    fs: {
      allow: ["./client", "./public", "index.html"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**"],
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 700,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
    },
  },
});
