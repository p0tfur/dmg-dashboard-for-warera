// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    // Leave empty — overridden at RUNTIME by env vars:
    //   NUXT_WARERA_API_KEY, NUXT_WARERA_BASE_URL
    // (Nuxt auto-maps NUXT_<KEY> → runtimeConfig.<key> on server start,
    //  so Coolify/runtime env vars work without rebuilding the image.)
    wareraApiKey: '',
    wareraBaseUrl: 'https://api2.warera.io/trpc',
  },
  app: {
    head: {
      title: 'WarEra DMG Command Center',
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'WarEra DMG stats — The Federation & Justice' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap',
        },
      ],
    },
  },
})
