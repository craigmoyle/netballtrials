import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
}

describe('deployment security hardening', () => {
  it('pins production container bases and keeps Dependabot coverage for every Dockerfile directory', () => {
    const dockerfiles = [repoFile('Dockerfile'), repoFile('deploy/vps/Dockerfile.web')];
    for (const dockerfile of dockerfiles) {
      const externalBases = dockerfile.split('\n').filter(line => line.startsWith('FROM ') && !line.startsWith('FROM build '));
      expect(externalBases.length).toBeGreaterThan(0);
      for (const base of externalBases) expect(base).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}(?: AS \S+)?$/);
    }

    const dependabot = repoFile('.github/dependabot.yml');
    expect(dependabot.match(/package-ecosystem: docker/g)).toHaveLength(3);
    for (const directory of ['/', '/docker', '/deploy/vps']) expect(dependabot).toContain(`directory: ${directory}\n`);
  });

  it('exposes admin bootstrap from the repository root', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['admin:bootstrap']).toBe('npm run admin:bootstrap --workspace=@netball-trials/api');
  });
});
