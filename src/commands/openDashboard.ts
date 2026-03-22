import * as vscode from 'vscode';
import { KnowledgeGraph } from '../core/knowledgeGraph';

// Dashboard panel is a singleton — imported lazily to avoid circular deps
let dashboardModule: typeof import('../ui/dashboardPanel') | undefined;

export async function openDashboardCommand(knowledgeGraph: KnowledgeGraph, extensionUri: vscode.Uri): Promise<void> {
  try {
    if (!dashboardModule) {
      dashboardModule = await import('../ui/dashboardPanel');
    }
    dashboardModule.DashboardPanel.createOrShow(knowledgeGraph, extensionUri);
  } catch (err) {
    vscode.window.showErrorMessage(`Pulse: Open Dashboard failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}
