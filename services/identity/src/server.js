import { createApp, createDeps, loadConfig } from './app.js';
import { createLoginGuard } from './routes.js';
import { SEED_USERS } from './memory.js';

const config = loadConfig();
const { repo, auth } = createDeps(config);
const loginGuard = createLoginGuard({ maxAttempts: config.loginMaxAttempts, lockMinutes: config.loginLockMinutes });
const app = createApp({ repo, auth, internalKey: config.internalKey, loginGuard });

app.listen(config.port, () => {
  console.log(`[identity] listening on :${config.port} (DATA_MODE=${config.dataMode})`);
  if (config.dataMode === 'memory') {
    console.log(
      `[identity] ผู้ใช้ทดสอบ: ${SEED_USERS.map((u) => `${u.username} (${u.role})`).join(', ')} · รหัสผ่าน: ${config.mockPassword}`,
    );
  }
});
