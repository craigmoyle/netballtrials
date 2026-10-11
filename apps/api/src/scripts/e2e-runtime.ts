export function e2eBindHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.E2E_BIND_HOST || '127.0.0.1';
}
