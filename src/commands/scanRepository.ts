import * as vscode from 'vscode';
import { RepoScanner } from '../data/repoScanner';
import { getSettings } from '../config/settings';
import { logger } from '../utils/logger';

export async function scanRepositoryCommand(scanner: RepoScanner): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Pulse: Scanning repository',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Initializing...' });
      const settings = getSettings();
      try {
        await scanner.scan(settings, (current, total, currentFile) => {
          const percent = total > 0 ? Math.round((current / total) * 100) : 0;
          const fileName = currentFile.split('/').pop() ?? currentFile;
          progress.report({
            message: `${fileName} (${current}/${total})`,
            increment: total > 0 ? (1 / total) * 100 : 0,
          });
        });
        vscode.window.showInformationMessage('Pulse: Scan complete ✓');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Pulse: Scan failed — ${message}`);
        logger.error('Scan failed', err);
      }
    }
  );
}
