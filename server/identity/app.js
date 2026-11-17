// identity service: login, ผู้ใช้, role, สาขา

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { assertNotDevSecrets, errorHandler, internalAuth, notFoundHandler, requestId } from '../shared.js';
import { authRoutes, branchRoutes, createLoginGuard, meRoutes, roleRoutes, userRoutes } from './routes.js';
import { createMemoryAuth, createMemoryRepo, SEED_USERS } from './memory.js';
import { createSupabaseAuth, createSupabaseRepo } from './supabase.js';

const env = process.env;

export function loadConfig(overrides = {}) {
  const config = {
    port: Number(env.PORT || env.IDENTITY_PORT || 3001),
    dataMode: env.DATA_MODE || 'memory',
    internalKey: env.INTERNAL_KEY,
    usernameEmailDomain: env.USERNAME_EMAIL_DOMAIN || 'pos.local',
    jwtSecret: env.JWT_SECRET,
    accessTokenTtlSec: Number(env.ACCESS_TOKEN_TTL_SEC || 900),
    refreshTokenTtlSec: Number(env.REFRESH_TOKEN_TTL_SEC || 60 * 60 * 24 * 7),
    mockPassword: env.MOCK_PASSWORD || 'password123',
    loginMaxAttempts: Number(env.LOGIN_MAX_ATTEMPTS || 5),
    loginLockMinutes: Number(env.LOGIN_LOCK_MINUTES || 15),
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    ...overrides,
  };

  const missing = [];
  if (!config.internalKey) missing.push('INTERNAL_KEY');
  if (config.dataMode === 'memory' && !config.jwtSecret) missing.push('JWT_SECRET');
  if (config.dataMode === 'supabase') {
    for (const [key, name] of [
      ['supabaseUrl', 'SUPABASE_URL'],
      ['supabaseAnonKey', 'SUPABASE_ANON_KEY'],
      ['supabaseServiceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY'],
    ]) {
      if (!config[key]) missing.push(name);
    }
  }
  if (!['memory', 'supabase'].includes(config.dataMode)) {
    throw new Error(`DATA_MODE ต้องเป็น memory หรือ supabase (ได้ "${config.dataMode}")`);
  }
  if (missing.length) {
    throw new Error(`identity: ขาด environment variable: ${missing.join(', ')}`);
  }
  assertNotDevSecrets({
    INTERNAL_KEY: config.internalKey,
    ...(config.dataMode === 'memory' ? { JWT_SECRET: config.jwtSecret } : {}),
  });
  return config;
}

// เลือกที่เก็บข้อมูลตาม DATA_MODE: memory (ทดสอบ) หรือ supabase (จริง)
export function createDeps(config) {
  if (config.dataMode === 'supabase') {
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const adminClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, opts);
    const anonClient = createClient(config.supabaseUrl, config.supabaseAnonKey, opts);
    const repo = createSupabaseRepo(adminClient);
    const auth = createSupabaseAuth({
      anonClient,
      adminClient,
      repo,
      emailOf: (username) => `${username}@${config.usernameEmailDomain}`,
    });
    return { repo, auth };
  }

  const repo = createMemoryRepo();
  const auth = createMemoryAuth({
    repo,
    jwtSecret: config.jwtSecret,
    accessTokenTtlSec: config.accessTokenTtlSec,
    refreshTokenTtlSec: config.refreshTokenTtlSec,
    seedUserIds: SEED_USERS.map((u) => u.id),
    seedPassword: config.mockPassword,
  });
  return { repo, auth };
}

// เส้นทางทั้งหมดของ identity
export function createApp({ repo, auth, internalKey, loginGuard = createLoginGuard(), logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'identity', data_mode: repo.kind }));

  app.use(requestId());
  app.use(internalAuth({ internalKey }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/auth', authRoutes({ repo, auth, loginGuard }));
  app.use('/me', meRoutes({ repo }));
  app.use('/branches', branchRoutes({ repo }));
  app.use('/roles', roleRoutes({ repo }));
  app.use('/users', userRoutes({ repo, auth, loginGuard }));

  app.use(notFoundHandler);
  app.use(errorHandler({ logger }));
  return app;
}
