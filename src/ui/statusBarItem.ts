import * as vscode from 'vscode';
import { KnowledgeGraph } from '../core/knowledgeGraph';

export class PulseStatusBarItem {
  private item: vscode.StatusBarItem;

  constructor(private knowledgeGraph: KnowledgeGraph) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'pulse.openDashboard';
    this.item.tooltip = 'Pulse: Open knowledge dashboard';
    this.refresh();
    this.item.show();
  }

  refresh(): void {
    try {
      const data = this.knowledgeGraph.getDashboardData();
      const criticalCount = data.criticalFiles.length;
      const warningCount = data.warningFiles.length;

      if (data.scanStatus === 'running') {
        this.item.text = '$(sync~spin) Pulse';
        this.item.tooltip = 'Pulse: Scanning...';
        return;
      }

      if (data.lastScan === null) {
        this.item.text = '$(pulse) Pulse';
        this.item.tooltip = 'Pulse: Not yet scanned. Click to scan.';
        this.item.command = 'pulse.scan';
        return;
      }

      if (criticalCount > 0) {
        this.item.text = `$(warning) Pulse: ${criticalCount} risk${criticalCount > 1 ? 's' : ''}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.item.tooltip = `Pulse: ${criticalCount} critical bus factor risks. Click to view.`;
        this.item.command = 'pulse.openDashboard';
      } else if (warningCount > 0) {
        this.item.text = `$(info) Pulse: ${warningCount} warning${warningCount > 1 ? 's' : ''}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.item.tooltip = `Pulse: ${warningCount} bus factor warnings. Click to view.`;
        this.item.command = 'pulse.openDashboard';
      } else {
        this.item.text = '$(check) Pulse';
        this.item.backgroundColor = undefined;
        this.item.tooltip = `Pulse: Knowledge healthy — ${data.totalFiles} files scanned`;
        this.item.command = 'pulse.openDashboard';
      }
    } catch {
      this.item.text = '$(pulse) Pulse';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
