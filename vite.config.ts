import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const port = Number(env.VITE_DEV_PORT) || 3000;
  const host = env.VITE_DEV_HOST || '0.0.0.0';

  return {
    server: {
      port,
      host,
      hmr: env.VITE_HMR_HOST ? {
        host: env.VITE_HMR_HOST,
        port: Number(env.VITE_HMR_CLIENT_PORT) || port,
      } : undefined,
      proxy: env.VITE_USE_BACKEND === 'true' ? {
        '/api': {
          target: env.VITE_BACKEND_TARGET || 'http://127.0.0.1:3001',
          changeOrigin: true
        }
      } : undefined
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.API_KEY || ""),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.API_KEY || ""),
      'process.env.BILL_COMPAT_V8': JSON.stringify(env.BILL_COMPAT_V8 || "false")
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
