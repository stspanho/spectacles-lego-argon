import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5188,
    strictPort: true,
    // Cloudflare quick tunnels serve the app from *.trycloudflare.com.
    allowedHosts: [".trycloudflare.com"],
    proxy: { "/api": "http://127.0.0.1:8797" },
  },
});
