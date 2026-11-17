import { buildRoutes, createApp, loadConfig } from './app.js';

const config = loadConfig();
const routes = buildRoutes();
const app = createApp(config, { routes });

app.listen(config.port, () => {
  console.log(`[gateway] listening on :${config.port}`);
  for (const r of routes) console.log(`[gateway]   ${r.prefix}/* → ${r.target}`);
  console.log(`[gateway] JWT: ${config.jwksUrl ? `JWKS ${config.jwksUrl}` : ''}${config.jwtSecret ? ' + HS256 secret' : ''}`);
});
