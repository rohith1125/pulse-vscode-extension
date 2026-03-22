import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { parseGitHubRemoteUrl } from '../../src/data/githubClient';

// We test parseGitHubRemoteUrl which has no external deps
suite('GitHubClient - parseRemoteUrl', () => {
  test('parses HTTPS remote URL', () => {
    const result = parseGitHubRemoteUrl('https://github.com/owner/repo.git');
    assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
  });

  test('parses HTTPS remote URL without .git', () => {
    const result = parseGitHubRemoteUrl('https://github.com/owner/my-repo');
    assert.deepStrictEqual(result, { owner: 'owner', repo: 'my-repo' });
  });

  test('parses SSH remote URL', () => {
    const result = parseGitHubRemoteUrl('git@github.com:owner/repo.git');
    assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo' });
  });

  test('returns null for non-GitHub URL', () => {
    const result = parseGitHubRemoteUrl('https://gitlab.com/owner/repo.git');
    assert.strictEqual(result, null);
  });

  test('returns null for invalid URL', () => {
    const result = parseGitHubRemoteUrl('not-a-url');
    assert.strictEqual(result, null);
  });
});

// Test fixture file loading
suite('Test Fixtures', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');

  test('mockGitLog.txt fixture exists and has content', () => {
    const fixturePath = path.join(fixturesDir, 'mockGitLog.txt');
    assert.ok(fs.existsSync(fixturePath), 'mockGitLog.txt should exist');
    const content = fs.readFileSync(fixturePath, 'utf8');
    assert.ok(content.trim().length > 0, 'fixture should not be empty');
    // Should have pipe-separated format
    assert.ok(content.includes('|'), 'should have pipe-separated fields');
  });

  test('mockBlame.txt fixture exists and has porcelain format', () => {
    const fixturePath = path.join(fixturesDir, 'mockBlame.txt');
    assert.ok(fs.existsSync(fixturePath), 'mockBlame.txt should exist');
    const content = fs.readFileSync(fixturePath, 'utf8');
    assert.ok(content.includes('author-mail'), 'should have porcelain format');
  });
});
