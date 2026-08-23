// The API port is assigned per Playwright run so concurrent runners never collide.
// Falls back to the historical fixed port for a plain `npm run start:web`.
const apiPort = process.env['TOKEN_WAREHOUSE_API_PORT'] || '5100';
const target = `http://127.0.0.1:${apiPort}`;

module.exports = {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
  },
  '/health': {
    target,
    secure: false,
    changeOrigin: true,
  },
};
