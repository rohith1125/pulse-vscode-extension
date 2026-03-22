import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger';
import { RateLimiter, withBackoff } from '../utils/rateLimit';
import { GITHUB_RATE_LIMIT_PER_HOUR } from '../constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PRReviewData {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  reviewerLogin: string;
  reviewerEmail: string | null;
  reviewedAt: number; // unix timestamp
  state: string;
}

export interface PRCommentData {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  authorLogin: string;
  body: string;
  filePath: string | null;
  line: number | null;
  createdAt: number; // unix timestamp
}

export interface RepoPRData {
  reviews: PRReviewData[];
  comments: PRCommentData[];
}

// ─── Remote URL Parsing ───────────────────────────────────────────────────────

/**
 * Parses a git remote URL into { owner, repo }.
 * Handles:
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo
 *   git@github.com:owner/repo.git
 */
export function parseGitHubRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS format
  const httpsMatch = remoteUrl.match(/https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  // SSH format
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

// ─── GitHubClient ─────────────────────────────────────────────────────────────

export class GitHubClient {
  private octokit: Octokit;
  private rateLimiter: RateLimiter;

  constructor(accessToken: string) {
    this.octokit = new Octokit({ auth: accessToken });
    this.rateLimiter = new RateLimiter(GITHUB_RATE_LIMIT_PER_HOUR);
  }

  /**
   * Fetches all PR reviews for a specific file path in the repository.
   * Goes through recent PRs and finds those that touched the file.
   */
  async getPRDataForFile(
    owner: string,
    repo: string,
    filePath: string,
    since?: Date
  ): Promise<RepoPRData> {
    const reviews: PRReviewData[] = [];
    const comments: PRCommentData[] = [];

    try {
      // Fetch recent closed PRs
      await this.rateLimiter.consume();
      const { data: prs } = await withBackoff(() =>
        this.octokit.pulls.list({
          owner, repo, state: 'closed', per_page: 100,
          sort: 'updated', direction: 'desc',
        })
      );

      for (const pr of prs) {
        if (since && pr.updated_at && new Date(pr.updated_at) < since) { break; }

        // Check if this PR touched our file
        await this.rateLimiter.consume();
        const { data: files } = await withBackoff(() =>
          this.octokit.pulls.listFiles({
            owner, repo, pull_number: pr.number, per_page: 100,
          })
        );

        const touchedFile = files.find(f =>
          f.filename === filePath || f.filename.endsWith('/' + filePath.split('/').pop())
        );
        if (!touchedFile) { continue; }

        // Fetch reviews for this PR
        await this.rateLimiter.consume();
        const { data: prReviews } = await withBackoff(() =>
          this.octokit.pulls.listReviews({
            owner, repo, pull_number: pr.number,
          })
        );

        for (const review of prReviews) {
          if (!review.user || !review.submitted_at) { continue; }
          reviews.push({
            prNumber: pr.number,
            prTitle: pr.title,
            prUrl: pr.html_url,
            reviewerLogin: review.user.login,
            reviewerEmail: null, // not available via this API
            reviewedAt: Math.floor(new Date(review.submitted_at).getTime() / 1000),
            state: review.state,
          });
        }

        // Fetch PR comments (review comments on diff)
        await this.rateLimiter.consume();
        const { data: prComments } = await withBackoff(() =>
          this.octokit.pulls.listReviewComments({
            owner, repo, pull_number: pr.number, per_page: 50,
          })
        );

        for (const comment of prComments) {
          if (!comment.user) { continue; }
          comments.push({
            prNumber: pr.number,
            prTitle: pr.title,
            prUrl: pr.html_url,
            authorLogin: comment.user.login,
            body: comment.body,
            filePath: comment.path ?? null,
            line: comment.line ?? comment.original_line ?? null,
            createdAt: Math.floor(new Date(comment.created_at).getTime() / 1000),
          });
        }

        // Also fetch issue comments (general PR discussion)
        await this.rateLimiter.consume();
        const { data: issueComments } = await withBackoff(() =>
          this.octokit.issues.listComments({
            owner, repo, issue_number: pr.number, per_page: 20,
          })
        );

        for (const comment of issueComments) {
          if (!comment.user) { continue; }
          comments.push({
            prNumber: pr.number,
            prTitle: pr.title,
            prUrl: pr.html_url,
            authorLogin: comment.user.login,
            body: comment.body,
            filePath: null,
            line: null,
            createdAt: Math.floor(new Date(comment.created_at).getTime() / 1000),
          });
        }
      }
    } catch (err) {
      logger.error(`Failed to fetch PR data for ${filePath}`, err);
    }

    return { reviews, comments };
  }

  /**
   * Resolves a GitHub login to an email address by looking up user commits.
   * Best-effort — returns null if not found.
   */
  async resolveLoginToEmail(owner: string, repo: string, login: string): Promise<string | null> {
    try {
      await this.rateLimiter.consume();
      const { data: commits } = await withBackoff(() =>
        this.octokit.repos.listCommits({
          owner, repo, author: login, per_page: 1,
        })
      );
      const email = commits[0]?.commit?.author?.email ?? null;
      return email && email.endsWith('@users.noreply.github.com') ? null : email;
    } catch {
      return null;
    }
  }

  /** Returns remaining rate limit tokens */
  remainingRateLimit(): number {
    return this.rateLimiter.remaining();
  }
}
