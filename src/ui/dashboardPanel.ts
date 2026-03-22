import * as vscode from 'vscode';
import * as path from 'path';
import { KnowledgeGraph, DashboardData } from '../core/knowledgeGraph';
import { logger } from '../utils/logger';

export class DashboardPanel {
  static readonly viewType = 'pulse.dashboard';
  private static instance: DashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private knowledgeGraph: KnowledgeGraph,
    private extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      msg => this.handleMessage(msg),
      null,
      this.disposables
    );
    this.render();
  }

  static createOrShow(knowledgeGraph: KnowledgeGraph, extensionUri?: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (DashboardPanel.instance) {
      DashboardPanel.instance.panel.reveal(column);
      DashboardPanel.instance.render();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Pulse — Team Knowledge',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: extensionUri
          ? [vscode.Uri.joinPath(extensionUri, 'media')]
          : [],
      }
    );

    DashboardPanel.instance = new DashboardPanel(
      panel,
      knowledgeGraph,
      extensionUri ?? vscode.Uri.file('')
    );
  }

  /** Call after scan to refresh the dashboard */
  static refresh(): void {
    DashboardPanel.instance?.render();
  }

  private render(): void {
    try {
      const data = this.knowledgeGraph.getDashboardData();
      this.panel.webview.html = this.buildHtml(data);
    } catch (err) {
      logger.error('Dashboard render failed', err);
    }
  }

  private handleMessage(message: { command: string; payload?: unknown }): void {
    switch (message.command) {
      case 'rescan':
        vscode.commands.executeCommand('pulse.scan');
        break;
      case 'askTeam':
        vscode.commands.executeCommand('pulse.askTeam');
        break;
    }
  }

  private buildHtml(data: DashboardData): string {
    const lastScanStr = data.lastScan
      ? data.lastScan.toLocaleString()
      : 'Never';

    const criticalRows = data.criticalFiles
      .slice(0, 20)
      .map(f => `
        <tr>
          <td class="file-path">${escapeHtml(f.filePath)}</td>
          <td class="center"><span class="badge critical">${f.busFactorCount}</span></td>
          <td>${escapeHtml(f.topExperts[0]?.contributor.name ?? '—')}</td>
          <td class="center"><button class="ask-btn" onclick="askTeam()">Ask →</button></td>
        </tr>
      `).join('');

    const warningRows = data.warningFiles
      .slice(0, 20)
      .map(f => `
        <tr>
          <td class="file-path">${escapeHtml(f.filePath)}</td>
          <td class="center"><span class="badge warning">${f.busFactorCount}</span></td>
          <td>${escapeHtml(f.topExperts[0]?.contributor.name ?? '—')}</td>
          <td></td>
        </tr>
      `).join('');

    const distributionBars = data.knowledgeDistribution
      .map(d => `
        <div class="dist-row">
          <span class="dist-name">${escapeHtml(d.contributorName)}</span>
          <div class="dist-bar-wrap">
            <div class="dist-bar" style="width:${d.percentage}%"></div>
          </div>
          <span class="dist-pct">${d.percentage}% (${d.fileCount} files)</span>
        </div>
      `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Pulse — Team Knowledge</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
    .subtitle { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 16px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .rescan-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 12px; }
    .rescan-btn:hover { background: var(--vscode-button-hoverBackground); }
    .summary { display: flex; gap: 12px; margin-bottom: 20px; }
    .card { flex: 1; padding: 12px 16px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); }
    .card-num { font-size: 28px; font-weight: 700; line-height: 1; }
    .card-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .card.critical .card-num { color: #f44336; }
    .card.warning .card-num { color: #ff9800; }
    .card.healthy .card-num { color: #4caf50; }
    h2 { font-size: 13px; font-weight: 600; margin: 20px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 4px 8px; color: var(--vscode-descriptionForeground); font-weight: 500; }
    td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .center { text-align: center; }
    .file-path { font-family: var(--vscode-editor-font-family); font-size: 11px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { display: inline-block; min-width: 20px; text-align: center; padding: 1px 5px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .badge.critical { background: #f44336; color: white; }
    .badge.warning { background: #ff9800; color: white; }
    .ask-btn { background: none; border: 1px solid var(--vscode-button-background); color: var(--vscode-button-background); padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
    .ask-btn:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .dist-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; }
    .dist-name { min-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dist-bar-wrap { flex: 1; background: var(--vscode-panel-border); border-radius: 2px; height: 8px; }
    .dist-bar { background: var(--vscode-button-background); height: 8px; border-radius: 2px; transition: width 0.3s; }
    .dist-pct { min-width: 100px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 8px 0; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Pulse — Team Knowledge</h1>
      <div class="subtitle">Last scan: ${escapeHtml(lastScanStr)} · ${data.totalFiles} files · ${data.totalContributors} contributors</div>
    </div>
    <button class="rescan-btn" onclick="rescan()">↻ Re-scan</button>
  </div>

  <div class="summary">
    <div class="card critical">
      <div class="card-num">${data.criticalFiles.length}</div>
      <div class="card-label">⚠️ Critical (bus factor 1)</div>
    </div>
    <div class="card warning">
      <div class="card-num">${data.warningFiles.length}</div>
      <div class="card-label">🟡 Warning (bus factor 2)</div>
    </div>
    <div class="card healthy">
      <div class="card-num">${Math.max(0, data.totalFiles - data.criticalFiles.length - data.warningFiles.length)}</div>
      <div class="card-label">✓ Healthy</div>
    </div>
  </div>

  ${data.criticalFiles.length > 0 ? `
  <h2>⚠️ Critical Files — Act Now</h2>
  <table>
    <tr><th>File</th><th>Bus Factor</th><th>Top Expert</th><th></th></tr>
    ${criticalRows}
  </table>` : ''}

  ${data.warningFiles.length > 0 ? `
  <h2>🟡 Warning Files</h2>
  <table>
    <tr><th>File</th><th>Bus Factor</th><th>Top Expert</th><th></th></tr>
    ${warningRows}
  </table>` : ''}

  ${data.criticalFiles.length === 0 && data.warningFiles.length === 0 ? `
  <div class="empty">✓ No bus factor risks detected. Your knowledge is well distributed!</div>
  ` : ''}

  ${data.knowledgeDistribution.length > 0 ? `
  <h2>📊 Knowledge Distribution</h2>
  <div>${distributionBars}</div>` : ''}

  ${data.lastScan === null ? `
  <div class="empty" style="margin-top:24px">
    No scan data yet. <button class="rescan-btn" onclick="rescan()">Scan now →</button>
  </div>` : ''}

  <script>
    const vscode = acquireVsCodeApi();
    function rescan() { vscode.postMessage({ command: 'rescan' }); }
    function askTeam() { vscode.postMessage({ command: 'askTeam' }); }
  </script>
</body>
</html>`;
  }

  dispose(): void {
    DashboardPanel.instance = undefined;
    this.panel.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
