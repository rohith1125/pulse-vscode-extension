import * as vscode from 'vscode';
import { DashboardData } from '../core/knowledgeGraph';

export class NotificationManager {
  private lastCriticalCount = 0;

  /**
   * Called after each scan completes. Shows notification if new critical risks appeared.
   */
  onScanComplete(data: DashboardData): void {
    const criticalCount = data.criticalFiles.length;

    if (criticalCount > this.lastCriticalCount) {
      const newRisks = criticalCount - this.lastCriticalCount;
      const message = newRisks === 1
        ? `Pulse: 1 new critical bus factor risk detected`
        : `Pulse: ${newRisks} new critical bus factor risks detected`;

      vscode.window.showWarningMessage(message, 'View Dashboard').then(choice => {
        if (choice === 'View Dashboard') {
          vscode.commands.executeCommand('pulse.openDashboard');
        }
      });
    }

    this.lastCriticalCount = criticalCount;
  }

  showScanComplete(fileCount: number): void {
    vscode.window.showInformationMessage(`Pulse: Scan complete ✓ (${fileCount} files processed)`);
  }

  showScanError(error: Error): void {
    vscode.window.showErrorMessage(`Pulse: Scan failed — ${error.message}`);
  }

  showScanAlreadyRunning(): void {
    vscode.window.showInformationMessage('Pulse: Scan already in progress, skipping');
  }

  showNoWorkspace(): void {
    vscode.window.showInformationMessage('Pulse: Open a folder to use Pulse');
  }

  showGitHubConnected(username: string): void {
    vscode.window.showInformationMessage(`Pulse: Connected as @${username}`);
  }
}
