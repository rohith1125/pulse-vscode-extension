import * as vscode from 'vscode';
import { PulseDatabase } from './data/database';
import { KnowledgeGraph } from './core/knowledgeGraph';
import { RepoScanner } from './data/repoScanner';
import { PulseHoverProvider } from './providers/hoverProvider';
import { PulseCodeLensProvider } from './providers/codeLensProvider';
import { PulseCodeActionProvider } from './providers/codeActionProvider';
import { PulseStatusBarItem } from './ui/statusBarItem';
import { NotificationManager } from './ui/notificationManager';
import { DashboardPanel } from './ui/dashboardPanel';
import { signInToGitHub } from './auth/githubAuth';
import { scanRepositoryCommand } from './commands/scanRepository';
import { askTeamCommand } from './commands/askTeam';
import { openDashboardCommand } from './commands/openDashboard';
import { clearCacheCommand } from './commands/clearCache';
import { getSettings } from './config/settings';
import { getWorkspaceDbPath, ensureVscodeDir, getWorkspaceRoot } from './utils/fileUtils';
import { logger } from './utils/logger';
import { EXTENSION_NAME, INCREMENTAL_SCAN_DEBOUNCE_MS } from './constants';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    logger.info(`${EXTENSION_NAME} activating...`);

    // Check workspace
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      logger.info('No workspace folder open, Pulse inactive');
      return;
    }

    const settings = getSettings();
    if (!settings.enabled) {
      logger.info('Pulse disabled via settings');
      return;
    }

    // Initialize database
    ensureVscodeDir();
    const dbPath = getWorkspaceDbPath();
    const db = new PulseDatabase(dbPath);

    // Core services
    const knowledgeGraph = new KnowledgeGraph(db);
    const scanner = new RepoScanner(db, knowledgeGraph);
    const notificationManager = new NotificationManager();

    // Providers
    const hoverProvider = new PulseHoverProvider(knowledgeGraph, settings);
    const codeLensProvider = new PulseCodeLensProvider(knowledgeGraph, settings);
    const codeActionProvider = new PulseCodeActionProvider();

    // Register language providers
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { scheme: 'file' },
        hoverProvider
      ),
      vscode.languages.registerCodeLensProvider(
        { scheme: 'file' },
        codeLensProvider
      ),
      vscode.languages.registerCodeActionsProvider(
        { scheme: 'file' },
        codeActionProvider,
        { providedCodeActionKinds: PulseCodeActionProvider.providedCodeActionKinds }
      )
    );

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('pulse.scan', async () => {
        await scanRepositoryCommand(scanner);
        // After scan: refresh UI
        codeLensProvider.refresh();
        statusBar.refresh();
        DashboardPanel.refresh();
        const dashData = knowledgeGraph.getDashboardData();
        notificationManager.onScanComplete(dashData);
      }),

      vscode.commands.registerCommand('pulse.openDashboard', () =>
        openDashboardCommand(knowledgeGraph)
      ),

      vscode.commands.registerCommand('pulse.askTeam', () =>
        askTeamCommand(knowledgeGraph)
      ),

      vscode.commands.registerCommand('pulse.connectGitHub', async () => {
        const session = await signInToGitHub();
        if (session) {
          vscode.window.showInformationMessage(
            `Pulse: Connected as @${session.account.label}. Re-scan to load PR data.`
          );
        }
      }),

      vscode.commands.registerCommand('pulse.clearCache', () =>
        clearCacheCommand(db, scanner)
      )
    );

    // Status bar
    const statusBar = new PulseStatusBarItem(knowledgeGraph);
    context.subscriptions.push({ dispose: () => statusBar.dispose() });

    // Settings change listener — update providers when config changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('pulse')) {
          const newSettings = getSettings();
          hoverProvider.updateSettings(newSettings);
          codeLensProvider.updateSettings(newSettings);
          statusBar.refresh();
        }
      })
    );

    // File watcher — queue incremental scan on file saves
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    fileWatcher.onDidChange(() => scanner.queueIncrementalScan(getSettings()));
    fileWatcher.onDidCreate(() => scanner.queueIncrementalScan(getSettings()));
    context.subscriptions.push(fileWatcher);

    // Auto-scan on activation if DB is stale or empty
    const meta = db.getScanMetadata();
    const staleAfterMs = settings.autoScanIntervalMinutes * 60 * 1000;
    const shouldAutoScan = settings.autoScanIntervalMinutes > 0 && (
      meta.lastScan === null ||
      Date.now() - meta.lastScan * 1000 > staleAfterMs
    );

    if (shouldAutoScan) {
      logger.info('Auto-scan triggered on activation');
      // Small delay to let VS Code finish loading
      setTimeout(() => scanner.scanInBackground(getSettings()), 2000);
    }

    // Auto-scan interval (if configured)
    if (settings.autoScanIntervalMinutes > 0) {
      const intervalMs = settings.autoScanIntervalMinutes * 60 * 1000;
      const autoScanInterval = setInterval(() => {
        scanner.scanInBackground(getSettings());
      }, intervalMs);
      context.subscriptions.push({ dispose: () => clearInterval(autoScanInterval) });
    }

    // Cleanup on deactivation
    context.subscriptions.push({
      dispose: () => {
        scanner.dispose();
        db.close();
        logger.dispose();
      }
    });

    logger.info(`${EXTENSION_NAME} activated`);
  } catch (err) {
    logger.error('Pulse failed to activate', err instanceof Error ? err : new Error(String(err)));
  }
}

export function deactivate(): void {
  // Cleanup is handled via context.subscriptions
  logger.info(`${EXTENSION_NAME} deactivated`);
}
