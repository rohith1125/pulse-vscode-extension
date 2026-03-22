import { PulseDatabase } from '../data/database';
import { logger } from '../utils/logger';
import { computeDecay } from './decayCalculator';
import {
  SCORE_WEIGHT_COMMITS,
  SCORE_WEIGHT_BLAME,
  SCORE_WEIGHT_REVIEWS,
  SCORE_WEIGHT_RECENCY,
} from '../constants';

export interface ScoredContributor {
  contributorId: number;
  score: number;           // 0.0–1.0 normalized
  commitCount: number;
  blameLines: number;
  reviewCount: number;
  lastEngagement: number | null; // unix timestamp
  decayWarning: boolean;
}

/**
 * Computes expertise scores for all contributors of a given file.
 * Returns array sorted by score descending.
 */
export function computeFileExpertise(
  db: PulseDatabase,
  fileId: number,
  decayHalfLifeMonths: number
): ScoredContributor[] {
  const contributorIds = db.getContributorIdsForFile(fileId);
  if (contributorIds.length === 0) { return []; }

  const totalLines = db.getTotalLineCountForFile(fileId) || 1;
  const now = Math.floor(Date.now() / 1000);

  // Gather raw signals for all contributors
  const raw = contributorIds.map(contributorId => {
    const commitCount = db.getCommitCountByFileAndContributor(fileId, contributorId);
    const blameLines = db.getBlameLineCountByFileAndContributor(fileId, contributorId);
    const reviewCount = db.getReviewCountByFileAndContributor(fileId, contributorId);

    // lastEngagement = max of last commit OR last review
    const lastCommit = db.getLastCommitDateByFileAndContributor(fileId, contributorId);
    const lastReview = db.getLastReviewDateByFileAndContributor(fileId, contributorId);
    const lastEngagement = Math.max(lastCommit || 0, lastReview || 0) || null;

    return { contributorId, commitCount, blameLines, reviewCount, lastEngagement };
  });

  // Normalize commits and reviews
  const maxCommits = Math.max(...raw.map(r => r.commitCount), 1);
  const maxReviews = Math.max(...raw.map(r => r.reviewCount), 1);

  // Compute raw scores
  const scored = raw.map(r => {
    const normalizedCommits = r.commitCount / maxCommits;
    const blameRatio = r.blameLines / totalLines;
    const normalizedReviews = r.reviewCount / maxReviews;
    const recency = computeRecencyBoost(r.lastEngagement, now, decayHalfLifeMonths);

    const rawScore =
      SCORE_WEIGHT_COMMITS * normalizedCommits +
      SCORE_WEIGHT_BLAME * blameRatio +
      SCORE_WEIGHT_REVIEWS * normalizedReviews +
      SCORE_WEIGHT_RECENCY * recency;

    return { ...r, rawScore };
  });

  // Normalize so max score = 1.0
  const maxScore = Math.max(...scored.map(s => s.rawScore), 1e-10);
  return scored
    .map(s => {
      const decay = computeDecay(s.lastEngagement, decayHalfLifeMonths, fileId, s.contributorId);
      return {
        contributorId: s.contributorId,
        score: s.rawScore / maxScore,
        commitCount: s.commitCount,
        blameLines: s.blameLines,
        reviewCount: s.reviewCount,
        lastEngagement: s.lastEngagement,
        decayWarning: decay.isDecayed,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Computes recency boost using exponential decay.
 * Returns 1.0 if never engaged (unknown), decays toward 0 over time.
 */
export function computeRecencyBoost(
  lastEngagementTimestamp: number | null,
  nowTimestamp: number,
  halfLifeMonths: number
): number {
  if (!lastEngagementTimestamp) { return 0.1; } // unknown → small boost
  const secondsPerMonth = 30.44 * 24 * 3600;
  const monthsSince = (nowTimestamp - lastEngagementTimestamp) / secondsPerMonth;
  if (monthsSince < 0) { return 1.0; }
  const lambda = Math.LN2 / halfLifeMonths;
  return Math.exp(-lambda * monthsSince);
}

/**
 * Persists computed expertise scores to the database.
 */
export function saveExpertiseScores(
  db: PulseDatabase,
  fileId: number,
  scores: ScoredContributor[]
): void {
  for (const s of scores) {
    try {
      db.upsertExpertiseScore({
        fileId,
        contributorId: s.contributorId,
        score: s.score,
        commitCount: s.commitCount,
        blameLines: s.blameLines,
        reviewCount: s.reviewCount,
        lastEngagement: s.lastEngagement,
      });
    } catch (err) {
      logger.error(`Failed to save expertise score for contributor ${s.contributorId}`, err);
    }
  }
}
