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
}
