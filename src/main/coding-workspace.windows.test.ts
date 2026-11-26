import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { ensureTaskWorktree } from './coding-workspace';
import { sddlIsOwnerOnly } from './private-files';

/* Windows PowerShell ships with the OS. Let it initialize its own module
 * paths when the test runner was started by PowerShell 7. */
function grantsUsersRead(file: string): boolean {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    '$acl = Get-Acl -LiteralPath $env:COWORK_TEST_ACL_PATH',
    '$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])',
    '$broad = $rules | Where-Object { $_.IdentityReference.Value -eq "S-1-5-32-545" -and $_.AccessControlType -eq "Allow" -and ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::ReadData) }',
    '[bool]$broad',
  ].join('; ');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: { ...env, COWORK_TEST_ACL_PATH: file }, encoding: 'utf8',
  }).trim();
  if (result !== 'True' && result !== 'False') throw new Error(`Unexpected Windows ACL result: ${result}`);
  return result === 'True';
}

it.skipIf(process.platform !== 'win32')('protects a new project checkout and repairs restored inheritance on reconnect', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-project-acl-'));
  try {
    execFileSync('icacls', [repo, '/grant', '*S-1-5-32-545:(OI)(CI)R']);
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'example.txt'), 'example');
    execFileSync('git', ['add', 'example.txt'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture'], { cwd: repo });
    expect(grantsUsersRead(path.join(repo, 'example.txt'))).toBe(true);

    const container = path.join(repo, '.claude-mindshub');
    const task = await ensureTaskWorktree(repo, 'example');
    const file = path.join(task.path, 'example.txt');
    expect(grantsUsersRead(container)).toBe(false);
    expect(grantsUsersRead(file)).toBe(false);

    execFileSync('icacls', [container, '/reset']);
    expect(grantsUsersRead(container)).toBe(true);
    expect(grantsUsersRead(file)).toBe(true);
    expect((await ensureTaskWorktree(repo, 'example')).isNew).toBe(false);
    expect(grantsUsersRead(container)).toBe(false);
    expect(grantsUsersRead(file)).toBe(false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}, 60_000);

/* The list Cowork applies must read back as owner-only, or every task start
 * would apply it again and rewrite every checkout below. It names the user too. */
it.skipIf(process.platform !== 'win32')('applies a list that reads back as owner-only and names the user', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-project-acl-'));
  const saved = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-acl-test-')), 'acl');
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'example.txt'), 'example');
    execFileSync('git', ['add', 'example.txt'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture'], { cwd: repo });
    await ensureTaskWorktree(repo, 'example');

    const sid = /"(S-1-[0-9-]+)"/.exec(execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }))?.[1] ?? null;
    execFileSync('icacls', [path.join(repo, '.claude-mindshub'), '/save', saved, '/L', '/Q']);
    const sddl = fs.readFileSync(saved).toString('utf16le');
    expect(sid).not.toBeNull();
    expect(sddl).toContain(sid as string);
    expect(sddlIsOwnerOnly(sddl, sid)).toBe(true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(path.dirname(saved), { recursive: true, force: true });
  }
}, 60_000);
