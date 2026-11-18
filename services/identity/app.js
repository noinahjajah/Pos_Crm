// identity service: login, ผู้ใช้, role, สาขา

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { assertNotDevSecrets, errorHandler, internalAuth, notFoundHandler, requestId, supabaseUrl } from '../shared/index.js';
import { authRoutes, branchRoutes, createLoginGuard, meRoutes, roleRoutes, userRoutes } from './routes.js';
import { createSupabaseAuth, createSupabaseRepo } from './supabase.js';

const env = process.env;

export function loadConfig(overrides = {}) {
  const config = {
    port: Number(env.PORT || env.IDENTITY_PORT || 3001),
    internalKey: env.INTERNAL_KEY,
    usernameEmailDomain: env.USERNAME_EMAIL_DOMAIN || 'pos.local',
    loginMaxAttempts: Number(env.LOGIN_MAX_ATTEMPTS || 5),
    loginLockMinutes: Number(env.LOGIN_LOCK_MINUTES || 15),
    supabaseUrl: supabaseUrl(env.SUPABASE_URL),
    supabaseAnonKey: env.SUPABASE_ANON_KEY?.trim().replace(/^['"]|['"]$/g, ''),
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]|['"]$/g, ''),
    ...overrides,
  };
  const missing = [
    ['internalKey', 'INTERNAL_KEY'],
    ['supabaseUrl', 'SUPABASE_URL'],
    ['supabaseAnonKey', 'SUPABASE_ANON_KEY'],
    ['supabaseServiceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY'],
  ]
    .filter(([key]) => !config[key])
    .map(([, name]) => name);
  if (missing.length) {
    throw new Error(`identity: ขาด environment variable: ${missing.join(', ')} (ดู services/identity/.env.example)`);
  }
  assertNotDevSecrets({ INTERNAL_KEY: config.internalKey });
  return config;
}

// ต่อ Supabase: adminClient (service role) จัดการข้อมูล, anonClient ใช้ login
export function createDeps(config) {
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

// เส้นทางทั้งหมดของ identity
export function createApp({ repo, auth, internalKey, loginGuard = createLoginGuard(), logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'identity', database: repo.kind }));

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
