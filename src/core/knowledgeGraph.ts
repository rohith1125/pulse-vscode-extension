import * as vscode from 'vscode';
import { PulseDatabase } from '../data/database';
import { formatTimeAgo } from './decayCalculator';
import { computeDecay } from './decayCalculator';
import { MAX_EXPERTS_IN_HOVER, MAX_DECISION_NOTES, HOVER_CONTEXT_LINES } from '../constants';
import { PulseSettings } from '../config/settings';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface Contributor {
  id: number;
  name: string;
  email: string;
  githubLogin: string | null;
  slackHandle: string | null;
  avatarUrl: string | null;
}

export interface ExpertiseResult {
  contributor: Contributor;
  score: number;            // 0.0–1.0
  commitCount: number;
  blameLines: number;
  reviewCount: number;
  lastEngagement: Date | null;
  timeAgo: string;          // e.g. "2 weeks ago"
  decayWarning: boolean;    // true if engagement > halfLifeMonths ago
}

export interface BusFactorResult {
  filePath: string;
  busFactorCount: number;
  riskLevel: 'critical' | 'warning' | 'healthy';
  topExperts: ExpertiseResult[];
}

export interface PullRequestContext {
  prNumber: number;
  prTitle: string | null;
  prUrl: string | null;
  reviewedAt: Date;
  reviewers: string[];
}

export interface DecisionNote {
  prNumber: number;
  prTitle: string | null;
  prUrl: string | null;
  authorLogin: string | null;
  excerpt: string;          // truncated comment body
}

export interface HoverContext {
  filePath: string;
  lineNumber: number;
  symbolName: string | undefined;
  topExperts: ExpertiseResult[];
  busFactorResult: BusFactorResult | null;
  recentPRs: PullRequestContext[];
  decisionNotes: DecisionNote[];
}

export interface DashboardData {
  totalFiles: number;
  totalContributors: number;
  criticalFiles: Array<BusFactorResult & { fileId: number }>;
  warningFiles: Array<BusFactorResult & { fileId: number }>;
  lastScan: Date | null;
  scanStatus: string;
  knowledgeDistribution: Array<{
    contributorName: string;
    fileCount: number;
    percentage: number;
  }>;
}

// ─── KnowledgeGraph ───────────────────────────────────────────────────────────

export class KnowledgeGraph {
  constructor(private db: PulseDatabase) {}

  /**
   * Returns hover context for a given file path and line number.
   */
  async getHoverContext(
    filePath: string,
    lineNumber: number,
    settings: PulseSettings,
    symbolName?: string
  ): Promise<HoverContext | null> {
    const file = this.db.getFileByPath(filePath);
    if (!file) { return null; }

    const expertiseRows = this.db.getExpertiseScoresForFile(file.id, MAX_EXPERTS_IN_HOVER);
    const topExperts = expertiseRows.map(row => this.mapExpertiseResult(row, settings));

    const busFactorRow = this.db.getBusFactorForFile(file.id);
    const busFactorResult: BusFactorResult | null = busFactorRow
      ? {
          filePath,
          busFactorCount: busFactorRow.busFactorCount,
          riskLevel: busFactorRow.riskLevel,
          topExperts,
        }
      : null;

    const recentPRRows = this.db.getRecentPRsForFile(file.id, 3);
    const recentPRs: PullRequestContext[] = recentPRRows.map(pr => ({
      prNumber: pr.prNumber,
      prTitle: pr.prTitle,
      prUrl: pr.prUrl,
      reviewedAt: new Date(pr.reviewedAt * 1000),
      reviewers: pr.reviewers,
    }));

    const commentRows = this.db.getPRCommentsNearLine(file.id, lineNumber, HOVER_CONTEXT_LINES);
    const decisionNotes: DecisionNote[] = commentRows
      .slice(0, MAX_DECISION_NOTES)
      .map(c => ({
        prNumber: c.prNumber,
        prTitle: c.prTitle,
        prUrl: c.prUrl,
        authorLogin: c.authorLogin,
        excerpt: c.body.length > 120 ? c.body.slice(0, 117) + '...' : c.body,
      }));

    return { filePath, lineNumber, symbolName, topExperts, busFactorResult, recentPRs, decisionNotes };
  }

  /**
   * Returns bus factor for a file path.
   */
  getBusFactorForFile(filePath: string): BusFactorResult | null {
    const file = this.db.getFileByPath(filePath);
    if (!file) { return null; }

    const row = this.db.getBusFactorForFile(file.id);
    if (!row) { return null; }

    const settings = { decayHalfLifeMonths: 6, busFactorWarningThreshold: 2, busFactorCriticalThreshold: 1 } as any;
    const expertiseRows = this.db.getExpertiseScoresForFile(file.id, 3);
    const topExperts = expertiseRows.map(r => this.mapExpertiseResult(r, settings));

    return {
      filePath,
      busFactorCount: row.busFactorCount,
      riskLevel: row.riskLevel,
      topExperts,
    };
  }

  /**
   * Returns top experts for a file (for "Ask Team" command).
   */
  getTopExpertsForFile(filePath: string, settings: PulseSettings, limit = 5): ExpertiseResult[] {
    const file = this.db.getFileByPath(filePath);
    if (!file) { return []; }

    const rows = this.db.getExpertiseScoresForFile(file.id, limit);
    return rows.map(r => this.mapExpertiseResult(r, settings));
  }

  /**
   * Returns dashboard data.
   */
  getDashboardData(): DashboardData {
    const allFiles = this.db.getAllFiles();
    const allContributors = this.db.getAllContributors();
    const allBusFactors = this.db.getCriticalFiles(100);
    const meta = this.db.getScanMetadata();

    const criticalFiles = allBusFactors
      .filter(bf => bf.riskLevel === 'critical')
      .map(bf => {
        const row = this.db.getBusFactorForFile(bf.fileId)!;
        return {
          fileId: bf.fileId,
          filePath: bf.filePath,
          busFactorCount: bf.busFactorCount,
          riskLevel: bf.riskLevel as 'critical' | 'warning' | 'healthy',
          topExperts: [],
        };
      });

    const warningFiles = allBusFactors
      .filter(bf => bf.riskLevel === 'warning')
      .map(bf => ({
        fileId: bf.fileId,
        filePath: bf.filePath,
        busFactorCount: bf.busFactorCount,
        riskLevel: bf.riskLevel as 'critical' | 'warning' | 'healthy',
        topExperts: [],
      }));

    // Knowledge distribution: count files where each contributor has highest score
    const distMap = new Map<string, number>();
    for (const file of allFiles) {
      const scores = this.db.getExpertiseScoresForFile(file.id, 1);
      if (scores.length > 0) {
        const name = scores[0].contributorName;
        distMap.set(name, (distMap.get(name) ?? 0) + 1);
      }
    }

    const totalOwned = [...distMap.values()].reduce((a, b) => a + b, 0) || 1;
    const knowledgeDistribution = [...distMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([contributorName, fileCount]) => ({
        contributorName,
        fileCount,
        percentage: Math.round((fileCount / totalOwned) * 100),
      }));

    return {
      totalFiles: allFiles.length,
      totalContributors: allContributors.length,
      criticalFiles,
      warningFiles,
      lastScan: meta.lastScan ? new Date(meta.lastScan * 1000) : null,
      scanStatus: meta.status,
      knowledgeDistribution,
    };
  }

  private mapExpertiseResult(
    row: ReturnType<PulseDatabase['getExpertiseScoresForFile']>[0],
    settings: Pick<PulseSettings, 'decayHalfLifeMonths'>
  ): ExpertiseResult {
    const contributor: Contributor = {
      id: row.contributorId,
      name: row.contributorName,
      email: row.contributorEmail,
      githubLogin: null,
      slackHandle: null,
      avatarUrl: null,
    };

    const decay = computeDecay(
      row.lastEngagement,
      settings.decayHalfLifeMonths,
      row.fileId,
      row.contributorId
    );

    return {
      contributor,
      score: row.score,
      commitCount: row.commitCount,
      blameLines: row.blameLines,
      reviewCount: row.reviewCount,
      lastEngagement: row.lastEngagement ? new Date(row.lastEngagement * 1000) : null,
      timeAgo: formatTimeAgo(row.lastEngagement),
      decayWarning: decay.isDecayed,
    };
  }
}
