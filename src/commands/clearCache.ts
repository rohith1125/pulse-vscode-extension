import * as vscode from 'vscode';
import { PulseDatabase } from '../data/database';
import { RepoScanner } from '../data/repoScanner';
import { getSettings } from '../config/settings';
import { logger } from '../utils/logger';

export async function clearCacheCommand(
  db: PulseDatabase,
  scanner: RepoScanner
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    'Pulse: Clear all cached knowledge data and rescan?',
    { modal: true },
    'Clear & Rescan'
  );

  if (confirm !== 'Clear & Rescan') { return; }

  try {
    db.clearAll();
    vscode.window.showInformationMessage('Pulse: Cache cleared. Starting rescan...');
    const settings = getSettings();
    scanner.scanInBackground(settings);
  } catch (err) {
    logger.error('Failed to clear cache', err);
    vscode.window.showErrorMessage('Pulse: Failed to clear cache');
  }
}
