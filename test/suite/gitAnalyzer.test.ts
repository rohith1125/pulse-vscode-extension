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

// Test git log fixture parsing (mirrors gitAnalyzer's getFileCommits parsing logic)
suite('Git Log Fixture Parsing', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');

  test('mockGitLog.txt has at least 10 entries with 3 contributors', () => {
    const fixturePath = path.join(fixturesDir, 'mockGitLog.txt');
    const content = fs.readFileSync(fixturePath, 'utf8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    assert.ok(lines.length >= 10, `expected >= 10 entries, got ${lines.length}`);

    const contributors = new Set<string>();
    for (const line of lines) {
      const parts = line.split('|');
      assert.ok(parts.length >= 5, `line should have >= 5 pipe-delimited fields: ${line}`);
      const [hash, email, name, timestamp, ...subjectParts] = parts;
      assert.ok(/^[0-9a-f]{40}$/.test(hash.trim()), `hash should be 40 hex chars: ${hash}`);
      assert.ok(email.includes('@'), `email should contain @: ${email}`);
      assert.ok(name.trim().length > 0, 'name should not be empty');
      assert.ok(!isNaN(parseInt(timestamp.trim(), 10)), `timestamp should be numeric: ${timestamp}`);
      assert.ok(subjectParts.join('|').trim().length > 0, 'subject should not be empty');
      contributors.add(email.trim());
    }

    assert.ok(contributors.size >= 3, `expected >= 3 contributors, got ${contributors.size}`);
  });
});

// Test blame fixture parsing (mirrors gitAnalyzer's parsePorcelainBlame logic)
suite('Git Blame Fixture Parsing', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');

  function parsePorcelainBlame(output: string) {
    interface PorcelainEntry {
      hash: string;
      lineNum: number;
      authorEmail: string;
      authorName: string;
      authorTime: number;
    }

    const entries: PorcelainEntry[] = [];
    const lines = output.split('\n');
    let i = 0;

    while (i < lines.length) {
      const headerMatch = lines[i]?.match(/^([0-9a-f]{40}) \d+ (\d+)/);
      if (!headerMatch) { i++; continue; }

      const hash = headerMatch[1];
      const lineNum = parseInt(headerMatch[2], 10);
      let authorEmail = '';
      let authorName = '';
      let authorTime = 0;

      i++;
      while (i < lines.length && !lines[i].startsWith('\t')) {
        const infoLine = lines[i];
        if (infoLine.startsWith('author ')) {
          authorName = infoLine.slice(7).trim();
        } else if (infoLine.startsWith('author-mail ')) {
          authorEmail = infoLine.slice(12).trim().replace(/^<|>$/g, '');
        } else if (infoLine.startsWith('author-time ')) {
          authorTime = parseInt(infoLine.slice(12).trim(), 10);
        }
        i++;
      }
      i++; // skip content line

      entries.push({ hash, lineNum, authorEmail, authorName, authorTime });
    }

    if (entries.length === 0) { return []; }

    interface BlameSegment {
      authorEmail: string;
      authorName: string;
      commitHash: string;
      committedAt: number;
      lineStart: number;
      lineEnd: number;
    }

    const segments: BlameSegment[] = [];
    let segStart = entries[0].lineNum;
    let current = entries[0];

    for (let j = 1; j < entries.length; j++) {
      const entry = entries[j];
      if (entry.hash === current.hash && entry.lineNum === entries[j - 1].lineNum + 1) {
        continue;
      }
      segments.push({
        authorEmail: current.authorEmail,
        authorName: current.authorName,
        commitHash: current.hash,
        committedAt: current.authorTime,
        lineStart: segStart,
        lineEnd: entries[j - 1].lineNum,
      });
      segStart = entry.lineNum;
      current = entry;
    }

    const last = entries[entries.length - 1];
    segments.push({
      authorEmail: current.authorEmail,
      authorName: current.authorName,
      commitHash: current.hash,
      committedAt: current.authorTime,
      lineStart: segStart,
      lineEnd: last.lineNum,
    });

    return segments;
  }

  test('parses mockBlame.txt into correct number of segments', () => {
    const fixturePath = path.join(fixturesDir, 'mockBlame.txt');
    const content = fs.readFileSync(fixturePath, 'utf8');
    const segments = parsePorcelainBlame(content);

    // The fixture has these consecutive groups:
    // Alice lines 1-5, Bob lines 6-9, Carol lines 10-15, Alice lines 16-18, Bob lines 19-20, Carol lines 21-22, Alice line 23
    assert.strictEqual(segments.length, 7, `expected 7 segments, got ${segments.length}`);
  });

  test('verifies contributor attribution is correct', () => {
    const fixturePath = path.join(fixturesDir, 'mockBlame.txt');
    const content = fs.readFileSync(fixturePath, 'utf8');
    const segments = parsePorcelainBlame(content);

    // Collect unique contributors
    const contributors = new Set(segments.map(s => s.authorEmail));
    assert.ok(contributors.has('alice@example.com'), 'should have Alice');
    assert.ok(contributors.has('bob@example.com'), 'should have Bob');
    assert.ok(contributors.has('carol@example.com'), 'should have Carol');
    assert.strictEqual(contributors.size, 3, 'should have exactly 3 contributors');

    // Verify first segment is Alice, lines 1-5
    assert.strictEqual(segments[0].authorName, 'Alice Chen');
    assert.strictEqual(segments[0].lineStart, 1);
    assert.strictEqual(segments[0].lineEnd, 5);

    // Verify second segment is Bob, lines 6-9
    assert.strictEqual(segments[1].authorName, 'Bob Smith');
    assert.strictEqual(segments[1].lineStart, 6);
    assert.strictEqual(segments[1].lineEnd, 9);

    // Verify third segment is Carol, lines 10-15
    assert.strictEqual(segments[2].authorName, 'Carol Davis');
    assert.strictEqual(segments[2].lineStart, 10);
    assert.strictEqual(segments[2].lineEnd, 15);
  });

  test('all blame entries have at least 20 attributed lines', () => {
    const fixturePath = path.join(fixturesDir, 'mockBlame.txt');
    const content = fs.readFileSync(fixturePath, 'utf8');

    // Count header lines (lines starting with a 40-char hex hash)
    const headerCount = content.split('\n')
      .filter(line => /^[0-9a-f]{40} \d+ \d+/.test(line))
      .length;

    assert.ok(headerCount >= 20, `expected >= 20 blame-attributed lines, got ${headerCount}`);
  });
});
