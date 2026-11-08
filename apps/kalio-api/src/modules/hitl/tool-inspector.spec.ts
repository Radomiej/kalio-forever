import { describe, expect, it } from 'vitest';
import type { HitlApprovalRequest } from './hitl.types';
import { inspectToolOperation } from './tool-inspector';
import { TOOL_INSPECTOR_CATALOG_VERSION } from './tool-inspector.catalog';

function request(command: unknown, args?: unknown): HitlApprovalRequest {
  return { kind: 'tool', sessionId: 'test', name: 'terminal_spawn', args: { command, cwd: 'C:\\workspace', ...(args === undefined ? {} : { args }) } };
}

describe('inspectToolOperation', () => {
  it('exports an audit version and requires explicit cwd', () => {
    expect(TOOL_INSPECTOR_CATALOG_VERSION).toBe('2026-11-08.2');
    expect(inspectToolOperation({ ...request('docker ps'), args: { command: 'docker ps' } })?.status).toBe('manual');
  });
  it.each(['env -i rm x', 'sudo -u root rm x', 'doas -u root rm x', 'nohup rm x', 'nice -n 5 rm x',
    'npm.cmd publish', 'pnpm.cmd publish', 'yarn.cmd publish', 'npm.bat publish', 'git.cmd reset --hard',
  ])('manually reviews opaque wrappers and script launchers: %s', command => {
    expect(inspectToolOperation(request(command))?.status).toBe('manual');
  });
  it.each(['docker -H tcp://remote:2375 ps', 'docker --host=tcp://remote:2375 ps',
    'docker -c remote ps', 'docker --context remote ps'])('reviews explicit host/context: %s', command => {
    expect(inspectToolOperation(request(command))?.status).toBe('manual');
  });
  it('reviews split remote host selection but leaves local ps unmatched', () => {
    expect(inspectToolOperation(request('docker', ['--host', 'tcp://remote:2375', 'ps']))?.status).toBe('manual');
    expect(inspectToolOperation(request('docker', ['ps']))).toBeNull();
  });
  it.each(['rm -rf x', 'del x', 'erase x', 'rmdir x', 'rd x', 'Remove-Item x',
    'bash -lc "rm x"', 'cmd /c del x', 'sudo rm x', 'env X=y rm x',
    '& "C:\\Program Files\\Tools\\RM.EXE" x', 'echo ok; curl example.test',
    ...['curl', 'wget', 'Invoke-WebRequest', 'Invoke-RestMethod', 'scp', 'sftp', 'ftp', 'rsync', 'ssh'].map(x => `${x} target`),
  ])('rejects prohibited execution: %s', command => {
    expect(inspectToolOperation(request(command))).toMatchObject({ status: 'rejected', source: 'rule' });
  });
  it.each([
    ['cmd', ['/c', 'del x']], ['powershell', ['-Command', 'Remove-Item', 'x']],
    ['bash', ['-lc', 'curl example.test']],
  ])('rejects split wrapper %s', (command, args) => {
    expect(inspectToolOperation(request(command, args))?.status).toBe('rejected');
  });
  it.each(['fs_delete', 'vfs_delete'])('rejects %s only for tools', name => {
    expect(inspectToolOperation({ ...request('echo'), name, args: { path: 'x' } })?.status).toBe('rejected');
    expect(inspectToolOperation({ ...request('rm x'), kind: 'raapp_native', name })).toBeNull();
  });
  it.each(['git clean -fd', 'git reset --hard', 'git push', 'npm publish', 'pnpm publish', 'yarn npm publish',
    'node script.js', 'python script.py', 'powershell -File x.ps1', 'pwsh x.ps1', 'bash x.sh', 'sh x.sh', 'wsl ls',
    'rg --pre helper x', 'rg --pre-glob=*.txt x',
    'docker system prune', 'docker volume rm x', 'podman volume prune', 'docker compose down -v',
    'docker compose down --volumes', 'psql -c "DROP DATABASE x"', 'mysql -e "drop table x"',
    'sqlite3 db "TRUNCATE x"', 'sqlcmd -Q "DROP TABLE x"', 'psql -f changes.sql',
    'kubectl apply -f x', 'helm upgrade x y', 'terraform apply',
  ])('requires manual review: %s', command => {
    expect(inspectToolOperation(request(command))).toMatchObject({ status: 'manual', source: 'manual' });
  });
  it.each(['rg needle src', 'rg --files', 'docker ps', 'docker images', 'docker inspect x',
    'git status', 'echo rm', 'echo curl', 'echo DROP TABLE', 'npm test', 'npm.cmd run build', 'pnpm.cmd test',
  ])('returns no catalog decision for control: %s', command => {
    expect(inspectToolOperation(request(command))).toBeNull();
  });
  it('does not inspect source text as executed SQL or a terminal command', () => {
    expect(inspectToolOperation({ ...request('DROP TABLE x'), name: 'fs_write', args: { content: 'psql DROP TABLE x' } })).toBeNull();
  });
  it.each([
    ['docker', ['volume', 'rm', 'x']], ['podman', ['system', 'prune']],
    ['docker', ['compose', 'down', '-v']], ['psql', ['-c', 'DROP TABLE x']],
    ['mysql', ['-e', 'TRUNCATE x']], ['kubectl', ['delete', 'pod', 'x']],
    ['helm', ['install', 'x', 'y']], ['terraform', ['destroy']],
    ['git', ['push']], ['npm', ['publish']], ['rg', ['--pre', 'helper']],
  ])('reviews split invocation %s', (command, args) => {
    expect(inspectToolOperation(request(command, args))?.status).toBe('manual');
  });
  it('handles uppercase command aliases and Windows executable paths', () => {
    expect(inspectToolOperation({ ...request('unused'), args: { CMD: '"C:\\Tools\\CURL.EXE" target', cwd: 'C:\\workspace' } })?.status).toBe('rejected');
    expect(inspectToolOperation(request('"C:\\Tools\\DOCKER.EXE" ps'))).toBeNull();
    expect(inspectToolOperation(request('"C:\\Tools\\PYTHON.EXE" script.py'))?.status).toBe('manual');
  });
  it('validates the runtime argument envelope before invoking the matcher', () => {
    expect(inspectToolOperation({ ...request('echo'), args: null as unknown as Record<string, unknown> })?.status).toBe('manual');
    expect(inspectToolOperation({ ...request('echo'), args: { command: 'echo', cmd: 7 } })?.status).toBe('manual');
    expect(inspectToolOperation(request('echo\0x'))?.status).toBe('manual');
    expect(inspectToolOperation(request('echo', ['x'.repeat(16385)]))?.status).toBe('manual');
  });
  it.each([undefined, null, 1, '', ' ', 'x'.repeat(16385)])('handles malformed command', command => {
    expect(inspectToolOperation(request(command))?.status).toBe('manual');
  });
  it.each([null, 1, {}, [1], Array(257).fill('x')])('handles malformed argv', args => {
    expect(inspectToolOperation(request('echo', args))?.status).toBe('manual');
  });
  it.each([null, 1, '', 'x'.repeat(4097)])('handles malformed cwd', cwd => {
    expect(inspectToolOperation({ ...request('echo'), args: { command: 'echo', cwd } })?.status).toBe('manual');
  });
  it('bounds nested data and does not disclose raw payloads', () => {
    const result = inspectToolOperation(request('curl https://secret.invalid/token=PRIVATE'));
    expect(result?.reason).toMatch(/inspector\./);
    expect(result?.reason).not.toContain('PRIVATE');
    const cycle: Record<string, unknown> = {}; cycle['cycle'] = cycle;
    expect(inspectToolOperation({ ...request('echo'), args: { command: 'echo', cycle } })?.status).toBe('manual');
  });
});
