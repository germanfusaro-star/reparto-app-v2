import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA con precache del "app shell": el HTML/JS/CSS del build queda cacheado por el
// service worker, así el chofer puede ABRIR la app aunque no tenga señal en ese momento
// (no solo seguir usándola una vez abierta). Los datos en sí los maneja la persistencia
// offline de Firestore (ver src/firebase.js) — esto es lo que le falta a eso: que la app
// cargue de entrada sin conexión.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "RepartoApp 2.0 (prueba) — San Lorenzo Star",
        short_name: "Reparto 2.0",
        description: "Reparto y cobranza para choferes — San Lorenzo Star SRL (versión de prueba con devolución por artículo)",
        theme_color: "#3f1c18",
        background_color: "#f7f3ec",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precachea el app shell. Los datos van por Firestore (ya maneja su propio
        // offline), así que acá solo nos ocupamos de los assets estáticos del build.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
      },
    }),
  ],
  server: { port: 5173 },
});
