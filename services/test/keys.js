// คู่กุญแจ ES256 สำหรับเทสต์ (แบบเดียวกับ Supabase) · gateway ตรวจด้วย public key, ตัวแทน Supabase เซ็นด้วย private key

import { createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

export async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}
