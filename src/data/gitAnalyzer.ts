import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { GIT_BLAME_TIMEOUT_MS } from '../constants';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawCommit {
  hash: string;
  authorEmail: string;
  authorName: string;
  committedAt: number; // unix timestamp
  subject: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface BlameSegment {
  authorEmail: string;
  authorName: string;
  commitHash: string;
  committedAt: number; // unix timestamp
  lineStart: number;
  lineEnd: number;
}

export interface RawContributor {
  name: string;
  email: string;
  commitCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function git(
  args: string[],
  cwd: string,
  timeoutMs?: number
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 50 * 1024 * 1024, // 50MB
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & { killed?: boolean };
    if (error.killed) {
      throw new Error(`git ${args[0]} timed out after ${timeoutMs}ms`);
    }
    if (error.code === 'ENOENT') {
      throw new Error('git not found in PATH. Pulse requires git to be installed.');
    }
    // git exits non-zero for empty repos / no history — return empty string
    logger.debug(`git ${args.join(' ')} exited with: ${error.message}`);
    return '';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns all files tracked by git in the repo (respects .gitignore).
 * Uses git ls-files.
 */
export async function getTrackedFiles(repoRoot: string): Promise<string[]> {
  const output = await git(['ls-files', '--full-name', '-z'], repoRoot);
  if (!output.trim()) { return []; }
  return output
    .split('\0')
    .map(f => f.trim())
    .filter(f => f.length > 0);
}

/**
 * Returns all commits that touched a file, following renames.
 * Uses git log --follow.
 * Format: hash|author-email|author-name|unix-timestamp|subject|+lines|-lines
 */
export async function getFileCommits(repoRoot: string, filePath: string): Promise<RawCommit[]> {
  // First pass: get commit hashes + metadata
  const logOutput = await git(
    ['log', '--follow', '--format=%H|%ae|%an|%at|%s', '--', filePath],
    repoRoot
  );
  if (!logOutput.trim()) { return []; }

  // Second pass: get numstat for line counts
  const numstatOutput = await git(
    ['log', '--follow', '--numstat', '--format=%H', '--', filePath],
    repoRoot
  );

  // Parse numstat: lines look like "5\t3\tfilepath" after a commit hash line
  const lineCountsByHash = parseNumstat(numstatOutput);

  return logOutput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const parts = line.split('|');
      if (parts.length < 5) { return null; }
      const [hash, authorEmail, authorName, timestampStr, ...subjectParts] = parts;
      const subject = subjectParts.join('|');
      const counts = lineCountsByHash.get(hash) ?? { added: 0, removed: 0 };
      return {
        hash: hash.trim(),
        authorEmail: authorEmail.trim(),
        authorName: authorName.trim(),
        committedAt: parseInt(timestampStr.trim(), 10),
        subject: subject.trim(),
        linesAdded: counts.added,
        linesRemoved: counts.removed,
      } satisfies RawCommit;
    })
    .filter((c): c is RawCommit => c !== null);
}

function parseNumstat(output: string): Map<string, { added: number; removed: number }> {
  const result = new Map<string, { added: number; removed: number }>();
  let currentHash = '';
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) { continue; }
    // A commit hash line is 40 hex chars
    if (/^[0-9a-f]{40}$/.test(trimmed)) {
      currentHash = trimmed;
      continue;
    }
    // Numstat line: "5\t3\tfilename" (or "-\t-\t" for binary)
    const match = trimmed.match(/^(\d+|-)\t(\d+|-)\t/);
    if (match && currentHash) {
      const added = match[1] === '-' ? 0 : parseInt(match[1], 10);
      const removed = match[2] === '-' ? 0 : parseInt(match[2], 10);
      const existing = result.get(currentHash) ?? { added: 0, removed: 0 };
      result.set(currentHash, {
        added: existing.added + added,
        removed: existing.removed + removed,
      });
    }
  }
  return result;
}

/**
 * Returns blame segments: contiguous line ranges attributed to the same commit/author.
 * Uses git blame --line-porcelain.
 */
export async function getFileBlame(repoRoot: string, filePath: string): Promise<BlameSegment[]> {
  const output = await git(
    ['blame', '--line-porcelain', '--', filePath],
    repoRoot,
    GIT_BLAME_TIMEOUT_MS
  );
  if (!output.trim()) { return []; }
  return parsePorcelainBlame(output);
}

/**
 * Parses `git blame --line-porcelain` output into BlameSegments.
 * Porcelain format repeats commit info per line but groups consecutive lines to the same commit.
 */
function parsePorcelainBlame(output: string): BlameSegment[] {
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

    // Read commit info lines until we hit the content line (starts with \t)
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
    i++; // skip content line (starts with \t)

    entries.push({ hash, lineNum, authorEmail, authorName, authorTime });
  }

  if (entries.length === 0) { return []; }

  // Merge consecutive lines with same hash into segments
  const segments: BlameSegment[] = [];
  let segStart = entries[0].lineNum;
  let current = entries[0];

  for (let j = 1; j < entries.length; j++) {
    const entry = entries[j];
    if (entry.hash === current.hash && entry.lineNum === entries[j - 1].lineNum + 1) {
      // Same segment, continue
      continue;
    }
    // End current segment
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

  // Push final segment
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

/**
 * Returns all contributors to the repository with commit counts.
 * Uses git shortlog.
 */
export async function getAllContributors(repoRoot: string): Promise<RawContributor[]> {
  const output = await git(['shortlog', '-sne', '--all', 'HEAD'], repoRoot);
  if (!output.trim()) { return []; }

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      // Format: "   N\tName <email>"
      const match = line.match(/^\s*(\d+)\s+(.+?)\s+<(.+?)>\s*$/);
      if (!match) { return null; }
      return {
        commitCount: parseInt(match[1], 10),
        name: match[2].trim(),
        email: match[3].trim(),
      } satisfies RawContributor;
    })
    .filter((c): c is RawContributor => c !== null);
}

/**
 * Returns the remote URL for origin (used to detect GitHub owner/repo).
 */
export async function getRemoteUrl(repoRoot: string): Promise<string | null> {
  const output = await git(['remote', 'get-url', 'origin'], repoRoot);
  return output.trim() || null;
}

/**
 * Returns files changed since a given unix timestamp.
 * Used for incremental scanning.
 */
export async function getFilesChangedSince(repoRoot: string, sinceTimestamp: number): Promise<string[]> {
  const date = new Date(sinceTimestamp * 1000).toISOString();
  const output = await git(
    ['log', '--name-only', '--format=', `--since=${date}`, '--'],
    repoRoot
  );
  if (!output.trim()) { return []; }
  const files = new Set(
    output.split('\n').map(f => f.trim()).filter(f => f.length > 0)
  );
  return [...files];
}

/**
 * Checks if the given directory is a git repository.
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const output = await git(['rev-parse', '--is-inside-work-tree'], dirPath);
    return output.trim() === 'true';
  } catch {
    return false;
  }
}
