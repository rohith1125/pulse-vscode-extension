import * as vscode from 'vscode';
import { logger } from '../utils/logger';

const GITHUB_SCOPES = ['repo', 'read:user'];

export interface GitHubSession {
  accessToken: string;
  account: {
    id: string;
    label: string; // username
  };
}

/**
 * Gets an existing GitHub session without prompting the user.
 * Returns null if not authenticated.
 */
export async function getGitHubSession(): Promise<GitHubSession | null> {
  try {
    const session = await vscode.authentication.getSession('github', GITHUB_SCOPES, {
      createIfNone: false,
      silent: true,
    });
    return session ?? null;
  } catch (err) {
    logger.debug(`No GitHub session: ${err}`);
    return null;
  }
}

/**
 * Prompts the user to authenticate with GitHub.
 * Returns the session if successful, null if the user cancels.
 */
export async function signInToGitHub(): Promise<GitHubSession | null> {
  try {
    const session = await vscode.authentication.getSession('github', GITHUB_SCOPES, {
      createIfNone: true,
    });
    if (session) {
      logger.info(`GitHub authenticated as @${session.account.label}`);
    }
    return session ?? null;
  } catch (err) {
    logger.error('GitHub sign-in failed', err);
    return null;
  }
}

/**
 * Returns true if a GitHub session exists.
 */
export async function isGitHubAuthenticated(): Promise<boolean> {
  const session = await getGitHubSession();
  return session !== null;
}
