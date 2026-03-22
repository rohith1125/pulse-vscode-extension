import { computeRecencyBoost } from './comprehensionScorer';

export interface DecayResult {
  fileId: number;
  contributorId: number;
  monthsSinceEngagement: number;
  decayFactor: number; // 0.0–1.0
  isDecayed: boolean;  // true if significant decay detected
}

/**
 * Computes decay factor for a contributor's expertise on a file.
 * isDecayed = true if more than halfLifeMonths since last engagement.
 */
export function computeDecay(
  lastEngagementTimestamp: number | null,
  decayHalfLifeMonths: number,
  fileId: number,
  contributorId: number
): DecayResult {
  const now = Math.floor(Date.now() / 1000);
  const secondsPerMonth = 30.44 * 24 * 3600;

  let monthsSince = 0;
  if (lastEngagementTimestamp) {
    monthsSince = (now - lastEngagementTimestamp) / secondsPerMonth;
  }

  const decayFactor = computeRecencyBoost(lastEngagementTimestamp, now, decayHalfLifeMonths);
  const isDecayed = monthsSince > decayHalfLifeMonths;

  return { fileId, contributorId, monthsSince, decayFactor, isDecayed };
}

/**
 * Returns a human-readable string for how long ago engagement was.
 * e.g. "2 weeks ago", "3 months ago", "1 year ago"
 */
export function formatTimeAgo(timestamp: number | null): string {
  if (!timestamp) { return 'never'; }
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30.44 * day;
  const year = 365.25 * day;

  if (diff < hour) { return 'just now'; }
  if (diff < day) { return `${Math.floor(diff / hour)} hours ago`; }
  if (diff < 2 * week) { return `${Math.floor(diff / day)} days ago`; }
  if (diff < 2 * month) { return `${Math.floor(diff / week)} weeks ago`; }
  if (diff < 2 * year) { return `${Math.floor(diff / month)} months ago`; }
  return `${Math.floor(diff / year)} years ago`;
}
