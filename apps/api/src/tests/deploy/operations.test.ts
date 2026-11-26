import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deployScript = readFileSync(new URL('../../../../../deploy/vps/deploy.sh', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../../../../../deploy/vps/compose.yaml', import.meta.url), 'utf8');
const remindersService = readFileSync(new URL('../../../../../deploy/vps/systemd/netball-trials-reminders.service', import.meta.url), 'utf8');
const retentionService = readFileSync(new URL('../../../../../deploy/vps/systemd/netball-trials-retention.service', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

function serviceBlock(name: string) {
  const match = compose.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z0-9-]+:|^networks:)`, 'm'));
  expect(match).not.toBeNull();
  return match?.[0] ?? '';
}

describe('Trials VPS operations', () => {
  it('preflights the environment and running platform before deployment', () => {
    expect(deployScript).toMatch(/read_env_value/);
    expect(deployScript).toContain('NETBALL_PLATFORM_COMPOSE_FILE');
    expect(deployScript).toMatch(/docker network inspect/);
    expect(deployScript).toMatch(/pg_isready/);
    expect(deployScript).toContain('MUTATION_STARTED');
    expect(deployScript).toContain('0:600');
    expect(deployScript).toContain('[:xdigit:]');
    expect(deployScript).toMatch(/ps -q edge/);
    expect(deployScript).toContain('--header="Host: $TRIALS_DOMAIN"');
    expect(deployScript).toContain('308');
    expect(deployScript).toContain('http://trials-web:8080/api/health');
    expect(deployScript).toContain('PLATFORM_TRIALS_DB_PASSWORD');
    expect(deployScript).toContain('PLATFORM_TRIALS_RUNTIME_DB_PASSWORD');
    expect(deployScript).toContain('PLATFORM_TRIALS_DOMAIN');
    expect(deployScript).toContain('./upgrade-trials-runtime-role.sh');
  });

  it('serializes migration and timer jobs with one lock', () => {
    expect(deployScript).toContain('/run/lock/netball-trials-operations.lock');
    expect(remindersService).toContain('/run/lock/netball-trials-operations.lock');
    expect(retentionService).toContain('/run/lock/netball-trials-operations.lock');
  });

  it('waits for healthy services before enabling and verifying both timers', () => {
    expect(deployScript).toMatch(/up -d --no-deps --wait/);
    expect(deployScript).toMatch(/systemctl enable --now.*netball-trials-reminders\.timer.*netball-trials-retention\.timer/s);
    expect(deployScript).toContain('systemctl is-enabled --quiet');
    expect(deployScript).toContain('systemctl is-active --quiet');
  });

  it('defines a distinct healthcheck for the static web container', () => {
    const web = serviceBlock('trials-web');
    expect(web).toContain('http://127.0.0.1:8080/web-health');
  });

  it('runs the privileged migration job as an unprivileged user', () => {
    expect(serviceBlock('trials-migrate')).toContain('user: "1000:1000"');
  });

  it('dry-runs the scheduler when hosted TEST integrations are fake', () => {
    expect(serviceBlock('trials-reminders')).toContain('ENABLE_TEST_INTEGRATIONS');
    expect(serviceBlock('trials-reminders')).toContain('--dry-run');
  });

  it.each(['trials-migrate', 'trials-seed-test'])('keeps %s off the general egress network', (service) => {
    expect(serviceBlock(service)).not.toContain('trials_egress');
  });

  it('validates deployment configuration and images in CI', () => {
    expect(workflow).toContain('docker compose --env-file');
    expect(workflow).toContain('target api-runtime');
    expect(workflow).toContain('deploy/vps/Dockerfile.web');
    expect(workflow).toMatch(/--entrypoint caddy[\s\S]*validate --config/);
  });
});
