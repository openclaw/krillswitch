import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The built SPA is served by the Worker (wrangler assets). This dev server
// exists only for HMR while iterating; API calls proxy to the local Worker.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/admin": "http://localhost:8799",
      "/api": "http://localhost:8799",
      "/v1": "http://localhost:8799",
    },
  },
});
