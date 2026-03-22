import * as vscode from 'vscode';
import { KnowledgeGraph } from '../core/knowledgeGraph';

// Dashboard panel is a singleton — imported lazily to avoid circular deps
let dashboardModule: typeof import('../ui/dashboardPanel') | undefined;

export async function openDashboardCommand(knowledgeGraph: KnowledgeGraph): Promise<void> {
  if (!dashboardModule) {
    dashboardModule = await import('../ui/dashboardPanel');
  }
  dashboardModule.DashboardPanel.createOrShow(knowledgeGraph);
}
