import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "github-pages"),
  base: "/FDF-To-Excel-Rate/",
  publicDir: path.resolve(__dirname, "public"),
  define: {
    "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify("/FDF-To-Excel-Rate"),
  },
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "docs"),
    emptyOutDir: true,
  },
});
