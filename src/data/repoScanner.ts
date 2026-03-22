import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PulseDatabase } from './database';
import { KnowledgeGraph } from '../core/knowledgeGraph';
import {
  getTrackedFiles, getFileCommits, getFileBlame, getAllContributors,
  getRemoteUrl, getFilesChangedSince, isGitRepo,
} from './gitAnalyzer';
import { GitHubClient, parseGitHubRemoteUrl } from './githubClient';
import { getGitHubSession } from '../auth/githubAuth';
import { computeFileExpertise, saveExpertiseScores } from '../core/comprehensionScorer';
import { computeAndSaveAllBusFactors } from '../core/busFactorCalculator';
import { PulseSettings } from '../config/settings';
import { getWorkspaceRoot, isExcluded, detectLanguage, isFileTooLarge, toAbsolutePath, isBinaryFile, addPulseDbToGitignore } from '../utils/fileUtils';
import { logger } from '../utils/logger';
import {
  SCAN_BATCH_SIZE, MAX_FILES_PER_SCAN, INCREMENTAL_SCAN_DEBOUNCE_MS,
} from '../constants';

export type ScanProgressCallback = (current: number, total: number, currentFile: string) => void;

export class RepoScanner {
  private incrementalScanTimer: NodeJS.Timeout | undefined;
  private isScanning = false;

  constructor(
    private db: PulseDatabase,
    private knowledgeGraph: KnowledgeGraph
  ) {}

  get scanning(): boolean {
    return this.isScanning;
  }

  /**
   * Runs a full repository scan with progress reporting.
   */
  async scan(
    settings: PulseSettings,
    onProgress?: ScanProgressCallback
  ): Promise<void> {
    if (this.isScanning) {
      logger.warn('Scan already in progress, skipping');
      return;
    }

    const repoRoot = getWorkspaceRoot();
    if (!repoRoot) {
      throw new Error('No workspace folder open');
    }

    if (!(await isGitRepo(repoRoot))) {
      logger.warn('Workspace is not a git repository — skipping scan');
      return;
    }

    addPulseDbToGitignore(repoRoot);

    this.isScanning = true;
    this.db.setScanStatus('running');

    try {
      logger.info('Starting full repository scan...');

      // 1. Get all contributors
      const rawContributors = await getAllContributors(repoRoot);
      for (const c of rawContributors) {
        this.db.upsertContributor(c.email, c.name, Math.floor(Date.now() / 1000));
      }
      logger.info(`Found ${rawContributors.length} contributors`);

      // 2. Get tracked files
      let trackedFiles = await getTrackedFiles(repoRoot);
      trackedFiles = trackedFiles.filter(f => !isExcluded(f, settings.excludePatterns));

      // Filter binary files
      trackedFiles = trackedFiles.filter(f => !isBinaryFile(f));

      // Filter by size
      trackedFiles = trackedFiles.filter(f => {
        const abs = path.join(repoRoot, f);
        return !isFileTooLarge(abs, settings.maxFileSizeKb);
      });

      // Cap at max
      if (trackedFiles.length > MAX_FILES_PER_SCAN) {
        logger.warn(`Capping scan at ${MAX_FILES_PER_SCAN} files (repo has ${trackedFiles.length})`);
        trackedFiles = trackedFiles.slice(0, MAX_FILES_PER_SCAN);
      }

      logger.info(`Scanning ${trackedFiles.length} files...`);

      // 3. Scan files in batches
      let processed = 0;
      for (let i = 0; i < trackedFiles.length; i += SCAN_BATCH_SIZE) {
        const batch = trackedFiles.slice(i, i + SCAN_BATCH_SIZE);
        for (const relPath of batch) {
          onProgress?.(processed, trackedFiles.length, relPath);
          await this.scanFile(repoRoot, relPath);
          processed++;
        }
      }

      // 4. GitHub integration (optional)
      if (settings.githubEnabled) {
        await this.fetchGitHubData(repoRoot, trackedFiles, settings);
      }

      // 5. Compute expertise scores for all files
      logger.info('Computing expertise scores...');
      const allFiles = this.db.getAllFiles();
      for (const file of allFiles) {
        const scores = computeFileExpertise(this.db, file.id, settings.decayHalfLifeMonths);
        saveExpertiseScores(this.db, file.id, scores);
      }

      // 6. Compute bus factors
      logger.info('Computing bus factors...');
      computeAndSaveAllBusFactors(
        this.db,
        settings.busFactorWarningThreshold,
        settings.busFactorCriticalThreshold
      );

      // 7. Update metadata
      const totalCommits = this.db.getAllFiles().length; // approximate
      this.db.updateScanMetadata(totalCommits, trackedFiles.length);

      logger.info(`Scan complete. ${trackedFiles.length} files processed.`);
    } catch (err) {
      this.db.setScanStatus('error');
      throw err;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Scans a single file: git log + git blame → upsert to DB.
   */
  private async scanFile(repoRoot: string, relPath: string): Promise<void> {
    try {
      const language = detectLanguage(relPath);
      const absPath = path.join(repoRoot, relPath);

      if (!absPath.startsWith(repoRoot + path.sep) && absPath !== repoRoot) {
        logger.warn(`Skipping file outside workspace: ${relPath}`);
        return;
      }

      // Count lines
      let lineCount: number | undefined;
      try {
        const content = fs.readFileSync(absPath, 'utf8');
        lineCount = content.split('\n').length;
      } catch { /* skip */ }

      const fileId = this.db.upsertFile(relPath, language, lineCount);

      // Git log
      const commits = await getFileCommits(repoRoot, relPath);
      for (const commit of commits) {
        // Ensure contributor exists
        const contributorId = this.db.upsertContributor(
          commit.authorEmail,
          commit.authorName,
          commit.committedAt
        );
        this.db.upsertCommit({
          hash: commit.hash,
          fileId,
          contributorId,
          committedAt: commit.committedAt,
          message: commit.subject,
          linesAdded: commit.linesAdded,
          linesRemoved: commit.linesRemoved,
        });
      }

      // Git blame
      const blameSegments = await getFileBlame(repoRoot, relPath);
      const mappedSegments = [];
      for (const seg of blameSegments) {
        const contributorId = this.db.upsertContributor(
          seg.authorEmail, seg.authorName, seg.committedAt
        );
        mappedSegments.push({
          contributorId,
          lineStart: seg.lineStart,
          lineEnd: seg.lineEnd,
          commitHash: seg.commitHash,
          committedAt: seg.committedAt,
        });
      }
      this.db.upsertBlameSegments(fileId, mappedSegments);

    } catch (err) {
      logger.warn(`Failed to scan file ${relPath}: ${err}`);
    }
  }

  /**
   * Fetches GitHub PR data for tracked files.
   */
  private async fetchGitHubData(
    repoRoot: string,
    trackedFiles: string[],
    settings: PulseSettings
  ): Promise<void> {
    const session = await getGitHubSession();
    if (!session) {
      logger.warn('GitHub not authenticated, skipping PR data fetch');
      return;
    }

    const remoteUrl = await getRemoteUrl(repoRoot);
    if (!remoteUrl) {
      logger.warn('No git remote URL found, skipping GitHub fetch');
      return;
    }

    const repoInfo = parseGitHubRemoteUrl(remoteUrl);
    if (!repoInfo) {
      logger.warn(`Could not parse GitHub remote URL: ${remoteUrl}`);
      return;
    }

    const client = new GitHubClient(session.accessToken);
    logger.info(`Fetching GitHub data for ${repoInfo.owner}/${repoInfo.repo}...`);

    for (const relPath of trackedFiles) {
      const file = this.db.getFileByPath(relPath);
      if (!file) { continue; }

      const prData = await client.getPRDataForFile(
        repoInfo.owner, repoInfo.repo, relPath
      );

      for (const review of prData.reviews) {
        // Try to find contributor by GitHub login, fall back to creating one
        let contributorId: number | null = null;
        const existingByEmail = review.reviewerEmail
          ? this.db.getContributorByEmail(review.reviewerEmail)
          : null;

        if (existingByEmail) {
          contributorId = existingByEmail.id;
          this.db.updateContributorGitHub(existingByEmail.email, review.reviewerLogin);
        } else {
          // Create placeholder contributor for GitHub-only reviewer
          contributorId = this.db.upsertContributor(
            `${review.reviewerLogin}@github.invalid`,
            review.reviewerLogin,
            review.reviewedAt
          );
          this.db.updateContributorGitHub(
            `${review.reviewerLogin}@github.invalid`,
            review.reviewerLogin
          );
        }

        this.db.upsertPRReview({
          fileId: file.id,
          contributorId,
          prNumber: review.prNumber,
          prTitle: review.prTitle,
          prUrl: review.prUrl,
          reviewedAt: review.reviewedAt,
          state: review.state,
        });
      }

      for (const comment of prData.comments) {
        this.db.upsertPRComment({
          fileId: file.id,
          prNumber: comment.prNumber,
          prTitle: comment.prTitle,
          prUrl: comment.prUrl,
          authorLogin: comment.authorLogin,
          body: comment.body,
          commentPath: comment.filePath ?? undefined,
          line: comment.line ?? undefined,
          createdAt: comment.createdAt,
        });
      }
    }

    logger.info('GitHub data fetch complete');
  }

  /**
   * Runs a non-blocking background scan (for auto-scan).
   */
  scanInBackground(settings: PulseSettings): void {
    this.scan(settings).catch(err => {
      logger.error('Background scan failed', err);
    });
  }

  /**
   * Queues an incremental scan (debounced).
   * Only re-scans files modified since last scan.
   */
  queueIncrementalScan(settings: PulseSettings): void {
    if (this.incrementalScanTimer) {
      clearTimeout(this.incrementalScanTimer);
    }
    this.incrementalScanTimer = setTimeout(async () => {
      await this.runIncrementalScan(settings);
    }, INCREMENTAL_SCAN_DEBOUNCE_MS);
  }

  private async runIncrementalScan(settings: PulseSettings): Promise<void> {
    if (this.isScanning) { return; }

    const meta = this.db.getScanMetadata();
    if (!meta.lastScan) {
      // No previous scan — run full scan
      await this.scan(settings);
      return;
    }

    const repoRoot = getWorkspaceRoot();
    if (!repoRoot) { return; }

    const changedFiles = await getFilesChangedSince(repoRoot, meta.lastScan);
    if (changedFiles.length === 0) { return; }

    logger.info(`Incremental scan: ${changedFiles.length} changed files`);
    this.isScanning = true;

    try {
      for (const relPath of changedFiles) {
        if (!isExcluded(relPath, settings.excludePatterns)) {
          await this.scanFile(repoRoot, relPath);
        }
      }

      // Recompute scores for changed files
      for (const relPath of changedFiles) {
        const file = this.db.getFileByPath(relPath);
        if (file) {
          const scores = computeFileExpertise(this.db, file.id, settings.decayHalfLifeMonths);
          saveExpertiseScores(this.db, file.id, scores);
          computeAndSaveAllBusFactors(this.db, settings.busFactorWarningThreshold, settings.busFactorCriticalThreshold);
        }
      }

      this.db.updateScanMetadata(0, changedFiles.length);
    } finally {
      this.isScanning = false;
    }
  }

  dispose(): void {
    if (this.incrementalScanTimer) {
      clearTimeout(this.incrementalScanTimer);
    }
  }
}
