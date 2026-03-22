import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DbContributor {
  id: number;
  email: string;
  name: string;
  githubLogin: string | null;
  slackHandle: string | null;
  avatarUrl: string | null;
  lastSeen: number; // unix timestamp
}

export interface DbFile {
  id: number;
  path: string;
  language: string | null;
  lastScanned: number;
  lineCount: number | null;
}

export interface DbCommit {
  id: number;
  hash: string;
  fileId: number;
  contributorId: number;
  committedAt: number;
  message: string | null;
  linesAdded: number;
  linesRemoved: number;
}

export interface DbBlameSegment {
  id: number;
  fileId: number;
  contributorId: number;
  lineStart: number;
  lineEnd: number;
  commitHash: string;
  committedAt: number;
}

export interface DbPRReview {
  id: number;
  fileId: number;
  contributorId: number;
  prNumber: number;
  prTitle: string | null;
  prUrl: string | null;
  reviewedAt: number;
  state: string | null;
}

export interface DbPRComment {
  id: number;
  fileId: number;
  prNumber: number;
  prTitle: string | null;
  prUrl: string | null;
  authorLogin: string | null;
  body: string;
  commentPath: string | null;
  line: number | null;
  createdAt: number;
}

export interface DbExpertiseScore {
  id: number;
  fileId: number;
  contributorId: number;
  score: number;
  commitCount: number;
  blameLines: number;
  reviewCount: number;
  lastEngagement: number | null;
  updatedAt: number;
}

export interface DbBusFactor {
  fileId: number;
  busFactorCount: number;
  riskLevel: 'critical' | 'warning' | 'healthy';
  updatedAt: number;
}

export interface DbScanMetadata {
  id: number;
  lastScan: number | null;
  commitCount: number;
  fileCount: number;
  status: 'idle' | 'running' | 'complete' | 'error';
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contributors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  github_login TEXT,
  slack_handle TEXT,
  avatar_url   TEXT,
  last_seen    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  path         TEXT NOT NULL UNIQUE,
  language     TEXT,
  last_scanned INTEGER NOT NULL,
  line_count   INTEGER
);

CREATE TABLE IF NOT EXISTS commits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hash            TEXT NOT NULL,
  file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  contributor_id  INTEGER NOT NULL REFERENCES contributors(id),
  committed_at    INTEGER NOT NULL,
  message         TEXT,
  lines_added     INTEGER DEFAULT 0,
  lines_removed   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS blame_segments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  contributor_id  INTEGER NOT NULL REFERENCES contributors(id),
  line_start      INTEGER NOT NULL,
  line_end        INTEGER NOT NULL,
  commit_hash     TEXT NOT NULL,
  committed_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_reviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  contributor_id  INTEGER NOT NULL REFERENCES contributors(id),
  pr_number       INTEGER NOT NULL,
  pr_title        TEXT,
  pr_url          TEXT,
  reviewed_at     INTEGER NOT NULL,
  state           TEXT
);

CREATE TABLE IF NOT EXISTS pr_comments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  pr_number       INTEGER NOT NULL,
  pr_title        TEXT,
  pr_url          TEXT,
  author_login    TEXT,
  body            TEXT NOT NULL,
  comment_path    TEXT,
  line            INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expertise_scores (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  contributor_id  INTEGER NOT NULL REFERENCES contributors(id),
  score           REAL NOT NULL,
  commit_count    INTEGER DEFAULT 0,
  blame_lines     INTEGER DEFAULT 0,
  review_count    INTEGER DEFAULT 0,
  last_engagement INTEGER,
  updated_at      INTEGER NOT NULL,
  UNIQUE(file_id, contributor_id)
);

CREATE TABLE IF NOT EXISTS bus_factor (
  file_id           INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  bus_factor_count  INTEGER NOT NULL,
  risk_level        TEXT NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_metadata (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  last_scan    INTEGER,
  commit_count INTEGER DEFAULT 0,
  file_count   INTEGER DEFAULT 0,
  status       TEXT DEFAULT 'idle'
);

INSERT OR IGNORE INTO scan_metadata (id, status) VALUES (1, 'idle');

CREATE INDEX IF NOT EXISTS idx_commits_file       ON commits(file_id);
CREATE INDEX IF NOT EXISTS idx_blame_file         ON blame_segments(file_id);
CREATE INDEX IF NOT EXISTS idx_blame_file_lines   ON blame_segments(file_id, line_start, line_end);
CREATE INDEX IF NOT EXISTS idx_expertise_file     ON expertise_scores(file_id);
CREATE INDEX IF NOT EXISTS idx_expertise_score    ON expertise_scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_file    ON pr_reviews(file_id);
CREATE INDEX IF NOT EXISTS idx_pr_comments_file   ON pr_comments(file_id);
`;

// ─── PulseDatabase ────────────────────────────────────────────────────────────

export class PulseDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(SCHEMA);
    logger.info('Database initialized');
  }

  close(): void {
    this.db.close();
  }

  // ─── Contributors ──────────────────────────────────────────────────────────

  upsertContributor(email: string, name: string, lastSeen: number): number {
    const stmt = this.db.prepare(`
      INSERT INTO contributors (email, name, last_seen)
      VALUES (@email, @name, @lastSeen)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        last_seen = MAX(last_seen, excluded.last_seen)
      RETURNING id
    `);
    const row = stmt.get({ email, name, lastSeen }) as { id: number };
    return row.id;
  }

  updateContributorGitHub(email: string, githubLogin: string, avatarUrl?: string): void {
    this.db.prepare(`
      UPDATE contributors SET github_login = @githubLogin, avatar_url = @avatarUrl
      WHERE email = @email
    `).run({ email, githubLogin, avatarUrl: avatarUrl ?? null });
  }

  getContributorByEmail(email: string): DbContributor | null {
    const row = this.db.prepare('SELECT * FROM contributors WHERE email = ?').get(email) as any;
    if (!row) { return null; }
    return this.mapContributor(row);
  }

  getContributorById(id: number): DbContributor | null {
    const row = this.db.prepare('SELECT * FROM contributors WHERE id = ?').get(id) as any;
    if (!row) { return null; }
    return this.mapContributor(row);
  }

  getAllContributors(): DbContributor[] {
    const rows = this.db.prepare('SELECT * FROM contributors ORDER BY last_seen DESC').all() as any[];
    return rows.map(r => this.mapContributor(r));
  }

  private mapContributor(row: any): DbContributor {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      githubLogin: row.github_login,
      slackHandle: row.slack_handle,
      avatarUrl: row.avatar_url,
      lastSeen: row.last_seen,
    };
  }

  // ─── Files ─────────────────────────────────────────────────────────────────

  upsertFile(filePath: string, language: string | null, lineCount?: number): number {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      INSERT INTO files (path, language, last_scanned, line_count)
      VALUES (@path, @language, @lastScanned, @lineCount)
      ON CONFLICT(path) DO UPDATE SET
        language = excluded.language,
        last_scanned = excluded.last_scanned,
        line_count = excluded.line_count
      RETURNING id
    `);
    const row = stmt.get({ path: filePath, language, lastScanned: now, lineCount: lineCount ?? null }) as { id: number };
    return row.id;
  }

  getFileByPath(filePath: string): DbFile | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath) as any;
    if (!row) { return null; }
    return this.mapFile(row);
  }

  getFileById(id: number): DbFile | null {
    const row = this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
    if (!row) { return null; }
    return this.mapFile(row);
  }

  getAllFiles(): DbFile[] {
    return (this.db.prepare('SELECT * FROM files').all() as any[]).map(r => this.mapFile(r));
  }

  private mapFile(row: any): DbFile {
    return {
      id: row.id,
      path: row.path,
      language: row.language,
      lastScanned: row.last_scanned,
      lineCount: row.line_count,
    };
  }

  // ─── Commits ───────────────────────────────────────────────────────────────

  insertCommit(data: {
    hash: string; fileId: number; contributorId: number;
    committedAt: number; message?: string; linesAdded?: number; linesRemoved?: number;
  }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO commits (hash, file_id, contributor_id, committed_at, message, lines_added, lines_removed)
      VALUES (@hash, @fileId, @contributorId, @committedAt, @message, @linesAdded, @linesRemoved)
    `).run({
      hash: data.hash,
      fileId: data.fileId,
      contributorId: data.contributorId,
      committedAt: data.committedAt,
      message: data.message ?? null,
      linesAdded: data.linesAdded ?? 0,
      linesRemoved: data.linesRemoved ?? 0,
    });
  }

  getCommitCountByFileAndContributor(fileId: number, contributorId: number): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM commits WHERE file_id = ? AND contributor_id = ?'
    ).get(fileId, contributorId) as { count: number };
    return row.count;
  }

  getLastCommitDateByFileAndContributor(fileId: number, contributorId: number): number | null {
    const row = this.db.prepare(
      'SELECT MAX(committed_at) as last FROM commits WHERE file_id = ? AND contributor_id = ?'
    ).get(fileId, contributorId) as { last: number | null };
    return row.last;
  }

  // ─── Blame Segments ────────────────────────────────────────────────────────

  replaceBlameSegments(fileId: number, segments: Array<{
    contributorId: number; lineStart: number; lineEnd: number;
    commitHash: string; committedAt: number;
  }>): void {
    const deleteStmt = this.db.prepare('DELETE FROM blame_segments WHERE file_id = ?');
    const insertStmt = this.db.prepare(`
      INSERT INTO blame_segments (file_id, contributor_id, line_start, line_end, commit_hash, committed_at)
      VALUES (@fileId, @contributorId, @lineStart, @lineEnd, @commitHash, @committedAt)
    `);
    const tx = this.db.transaction(() => {
      deleteStmt.run(fileId);
      for (const seg of segments) {
        insertStmt.run({ fileId, ...seg });
      }
    });
    tx();
  }

  getBlameLineCountByFileAndContributor(fileId: number, contributorId: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(line_end - line_start + 1), 0) as lines
      FROM blame_segments WHERE file_id = ? AND contributor_id = ?
    `).get(fileId, contributorId) as { lines: number };
    return row.lines;
  }

  getTotalLineCountForFile(fileId: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(line_end), 0) as total FROM blame_segments WHERE file_id = ?
    `).get(fileId) as { total: number };
    return row.total;
  }

  getBlameSegmentsNearLine(fileId: number, lineNumber: number, contextLines: number): DbBlameSegment[] {
    const rows = this.db.prepare(`
      SELECT * FROM blame_segments
      WHERE file_id = ? AND line_start <= ? AND line_end >= ?
      LIMIT 10
    `).all(fileId, lineNumber + contextLines, lineNumber - contextLines) as any[];
    return rows.map(r => ({
      id: r.id, fileId: r.file_id, contributorId: r.contributor_id,
      lineStart: r.line_start, lineEnd: r.line_end,
      commitHash: r.commit_hash, committedAt: r.committed_at,
    }));
  }

  // ─── PR Reviews ────────────────────────────────────────────────────────────

  upsertPRReview(data: {
    fileId: number; contributorId: number; prNumber: number;
    prTitle?: string; prUrl?: string; reviewedAt: number; state?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO pr_reviews (file_id, contributor_id, pr_number, pr_title, pr_url, reviewed_at, state)
      VALUES (@fileId, @contributorId, @prNumber, @prTitle, @prUrl, @reviewedAt, @state)
      ON CONFLICT DO NOTHING
    `).run({
      fileId: data.fileId,
      contributorId: data.contributorId,
      prNumber: data.prNumber,
      prTitle: data.prTitle ?? null,
      prUrl: data.prUrl ?? null,
      reviewedAt: data.reviewedAt,
      state: data.state ?? null,
    });
  }

  getReviewCountByFileAndContributor(fileId: number, contributorId: number): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM pr_reviews WHERE file_id = ? AND contributor_id = ?'
    ).get(fileId, contributorId) as { count: number };
    return row.count;
  }

  getRecentPRsForFile(fileId: number, limit = 3): Array<{ prNumber: number; prTitle: string | null; prUrl: string | null; reviewedAt: number; reviewers: string[] }> {
    const prs = this.db.prepare(`
      SELECT DISTINCT pr_number, pr_title, pr_url, MAX(reviewed_at) as reviewed_at
      FROM pr_reviews WHERE file_id = ?
      GROUP BY pr_number ORDER BY reviewed_at DESC LIMIT ?
    `).all(fileId, limit) as any[];

    return prs.map(pr => {
      const reviewers = this.db.prepare(`
        SELECT c.name FROM pr_reviews r
        JOIN contributors c ON c.id = r.contributor_id
        WHERE r.file_id = ? AND r.pr_number = ?
      `).all(fileId, pr.pr_number) as Array<{ name: string }>;
      return {
        prNumber: pr.pr_number,
        prTitle: pr.pr_title,
        prUrl: pr.pr_url,
        reviewedAt: pr.reviewed_at,
        reviewers: reviewers.map(r => r.name),
      };
    });
  }

  // ─── PR Comments ───────────────────────────────────────────────────────────

  upsertPRComment(data: {
    fileId: number; prNumber: number; prTitle?: string; prUrl?: string;
    authorLogin?: string; body: string; commentPath?: string;
    line?: number; createdAt: number;
  }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO pr_comments
        (file_id, pr_number, pr_title, pr_url, author_login, body, comment_path, line, created_at)
      VALUES (@fileId, @prNumber, @prTitle, @prUrl, @authorLogin, @body, @commentPath, @line, @createdAt)
    `).run({
      fileId: data.fileId,
      prNumber: data.prNumber,
      prTitle: data.prTitle ?? null,
      prUrl: data.prUrl ?? null,
      authorLogin: data.authorLogin ?? null,
      body: data.body,
      commentPath: data.commentPath ?? null,
      line: data.line ?? null,
      createdAt: data.createdAt,
    });
  }

  getPRCommentsNearLine(fileId: number, lineNumber: number, contextLines: number): DbPRComment[] {
    const rows = this.db.prepare(`
      SELECT * FROM pr_comments
      WHERE file_id = ?
        AND (line IS NULL OR (line >= ? AND line <= ?))
      ORDER BY created_at DESC LIMIT 10
    `).all(fileId, lineNumber - contextLines, lineNumber + contextLines) as any[];
    return rows.map(r => ({
      id: r.id, fileId: r.file_id, prNumber: r.pr_number,
      prTitle: r.pr_title, prUrl: r.pr_url, authorLogin: r.author_login,
      body: r.body, commentPath: r.comment_path, line: r.line, createdAt: r.created_at,
    }));
  }

  // ─── Expertise Scores ──────────────────────────────────────────────────────

  upsertExpertiseScore(data: {
    fileId: number; contributorId: number; score: number;
    commitCount: number; blameLines: number; reviewCount: number;
    lastEngagement: number | null;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO expertise_scores
        (file_id, contributor_id, score, commit_count, blame_lines, review_count, last_engagement, updated_at)
      VALUES (@fileId, @contributorId, @score, @commitCount, @blameLines, @reviewCount, @lastEngagement, @updatedAt)
      ON CONFLICT(file_id, contributor_id) DO UPDATE SET
        score = excluded.score,
        commit_count = excluded.commit_count,
        blame_lines = excluded.blame_lines,
        review_count = excluded.review_count,
        last_engagement = excluded.last_engagement,
        updated_at = excluded.updated_at
    `).run({ ...data, updatedAt: now });
  }

  getExpertiseScoresForFile(fileId: number, limit = 10): Array<DbExpertiseScore & { contributorName: string; contributorEmail: string }> {
    const rows = this.db.prepare(`
      SELECT e.*, c.name as contributor_name, c.email as contributor_email
      FROM expertise_scores e
      JOIN contributors c ON c.id = e.contributor_id
      WHERE e.file_id = ?
      ORDER BY e.score DESC LIMIT ?
    `).all(fileId, limit) as any[];
    return rows.map(r => ({
      id: r.id, fileId: r.file_id, contributorId: r.contributor_id,
      score: r.score, commitCount: r.commit_count, blameLines: r.blame_lines,
      reviewCount: r.review_count, lastEngagement: r.last_engagement,
      updatedAt: r.updated_at,
      contributorName: r.contributor_name, contributorEmail: r.contributor_email,
    }));
  }

  getContributorIdsForFile(fileId: number): number[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT contributor_id FROM (
        SELECT contributor_id FROM commits WHERE file_id = ?
        UNION
        SELECT contributor_id FROM blame_segments WHERE file_id = ?
        UNION
        SELECT contributor_id FROM pr_reviews WHERE file_id = ?
      )
    `).all(fileId, fileId, fileId) as Array<{ contributor_id: number }>;
    return rows.map(r => r.contributor_id);
  }

  // ─── Bus Factor ────────────────────────────────────────────────────────────

  upsertBusFactor(fileId: number, busFactorCount: number, riskLevel: 'critical' | 'warning' | 'healthy'): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO bus_factor (file_id, bus_factor_count, risk_level, updated_at)
      VALUES (@fileId, @busFactorCount, @riskLevel, @updatedAt)
      ON CONFLICT(file_id) DO UPDATE SET
        bus_factor_count = excluded.bus_factor_count,
        risk_level = excluded.risk_level,
        updated_at = excluded.updated_at
    `).run({ fileId, busFactorCount, riskLevel, updatedAt: now });
  }

  getBusFactorForFile(fileId: number): DbBusFactor | null {
    const row = this.db.prepare('SELECT * FROM bus_factor WHERE file_id = ?').get(fileId) as any;
    if (!row) { return null; }
    return {
      fileId: row.file_id,
      busFactorCount: row.bus_factor_count,
      riskLevel: row.risk_level,
      updatedAt: row.updated_at,
    };
  }

  getAllBusFactors(): DbBusFactor[] {
    const rows = this.db.prepare('SELECT * FROM bus_factor ORDER BY bus_factor_count ASC').all() as any[];
    return rows.map(r => ({
      fileId: r.file_id, busFactorCount: r.bus_factor_count,
      riskLevel: r.risk_level, updatedAt: r.updated_at,
    }));
  }

  getCriticalFiles(limit = 50): Array<DbBusFactor & { filePath: string }> {
    const rows = this.db.prepare(`
      SELECT b.*, f.path as file_path FROM bus_factor b
      JOIN files f ON f.id = b.file_id
      WHERE b.risk_level IN ('critical', 'warning')
      ORDER BY b.bus_factor_count ASC, b.updated_at DESC LIMIT ?
    `).all(limit) as any[];
    return rows.map(r => ({
      fileId: r.file_id, busFactorCount: r.bus_factor_count,
      riskLevel: r.risk_level, updatedAt: r.updated_at, filePath: r.file_path,
    }));
  }

  // ─── Scan Metadata ─────────────────────────────────────────────────────────

  getScanMetadata(): DbScanMetadata {
    const row = this.db.prepare('SELECT * FROM scan_metadata WHERE id = 1').get() as any;
    return {
      id: row.id,
      lastScan: row.last_scan,
      commitCount: row.commit_count,
      fileCount: row.file_count,
      status: row.status,
    };
  }

  setScanStatus(status: DbScanMetadata['status']): void {
    this.db.prepare('UPDATE scan_metadata SET status = ? WHERE id = 1').run(status);
  }

  updateScanComplete(commitCount: number, fileCount: number): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      UPDATE scan_metadata SET last_scan = ?, commit_count = ?, file_count = ?, status = 'complete' WHERE id = 1
    `).run(now, commitCount, fileCount);
  }

  getLastScan(): Date | null {
    const meta = this.getScanMetadata();
    return meta.lastScan ? new Date(meta.lastScan * 1000) : null;
  }

  // ─── Bulk Operations ───────────────────────────────────────────────────────

  /** Run multiple operations in a single transaction */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Clear all data (for clearCache command) */
  clearAll(): void {
    this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM expertise_scores;
        DELETE FROM bus_factor;
        DELETE FROM pr_comments;
        DELETE FROM pr_reviews;
        DELETE FROM blame_segments;
        DELETE FROM commits;
        DELETE FROM files;
        DELETE FROM contributors;
        UPDATE scan_metadata SET last_scan = NULL, commit_count = 0, file_count = 0, status = 'idle' WHERE id = 1;
      `);
    })();
    logger.info('Database cleared');
  }
}
