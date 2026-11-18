// จุดเริ่มรัน identity service

import { createApp, createDeps, loadConfig } from './app.js';
import { createLoginGuard } from './routes.js';

const config = loadConfig();
const { repo, auth } = createDeps(config);
const loginGuard = createLoginGuard({ maxAttempts: config.loginMaxAttempts, lockMinutes: config.loginLockMinutes });
const app = createApp({ repo, auth, internalKey: config.internalKey, loginGuard });

app.listen(config.port, () => {
  console.log(`[identity] listening on :${config.port} (Supabase ${config.supabaseUrl})`);
});
