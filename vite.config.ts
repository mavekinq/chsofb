import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  server: {
    host: true,
    port: 8080,
    strictPort: true,

    // 🔥 NGROK ÇÖZÜMÜ
    allowedHosts: [
      ".ngrok-free.dev", // tüm ngrok domainlerini açar
    ],

    origin: "http://localhost:8080",

    hmr: {
      overlay: false,
    },
  },

  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "robots.txt", "celebi-logo.png"],
      manifest: {
        name: "Wheelie Watch Pro",
        short_name: "Wheelie Watch",
        description: "Tekerlekli sandalye operasyon ve hizmet takip uygulaması.",
        theme_color: "#0f766e",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/celebi-logo.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/celebi-logo.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
    mode === "development" && componentTagger()
  ].filter(Boolean),

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
      "framer-motion"
    ],
  },
}));