import { PulseDatabase } from '../data/database';
import { logger } from '../utils/logger';

export type RiskLevel = 'critical' | 'warning' | 'healthy';

export interface BusFactorResult {
  fileId: number;
  filePath: string;
  busFactorCount: number;
  riskLevel: RiskLevel;
}

/** Minimum score threshold to count as "understanding" a file */
const EXPERTISE_THRESHOLD = 0.3;

/**
 * Computes the bus factor for a single file.
 * Bus factor = number of contributors with score >= EXPERTISE_THRESHOLD.
 */
export function computeBusFactor(
  db: PulseDatabase,
  fileId: number,
  warningThreshold: number,
  criticalThreshold: number
): BusFactorResult {
  const file = db.getFileById(fileId);
  const filePath = file?.path ?? `file_${fileId}`;

  const scores = db.getExpertiseScoresForFile(fileId);
  const expertCount = scores.filter(s => s.score >= EXPERTISE_THRESHOLD).length;

  const riskLevel = getRiskLevel(expertCount, warningThreshold, criticalThreshold);

  return { fileId, filePath, busFactorCount: expertCount, riskLevel };
}

/**
 * Computes and persists bus factor for all files in the database.
 */
export function computeAndSaveAllBusFactors(
  db: PulseDatabase,
  warningThreshold: number,
  criticalThreshold: number
): BusFactorResult[] {
  const files = db.getAllFiles();
  const results: BusFactorResult[] = [];

  for (const file of files) {
    try {
      const result = computeBusFactor(db, file.id, warningThreshold, criticalThreshold);
      db.upsertBusFactor(file.id, result.busFactorCount, result.riskLevel);
      results.push(result);
    } catch (err) {
      logger.error(`Failed to compute bus factor for file ${file.path}`, err);
    }
  }

  return results;
}

export function getRiskLevel(
  expertCount: number,
  warningThreshold: number,
  criticalThreshold: number
): RiskLevel {
  if (expertCount <= criticalThreshold) { return 'critical'; }
  if (expertCount <= warningThreshold) { return 'warning'; }
  return 'healthy';
}
