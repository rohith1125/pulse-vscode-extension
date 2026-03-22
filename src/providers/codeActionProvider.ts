import * as vscode from 'vscode';
import { KnowledgeGraph } from '../core/knowledgeGraph';
import { toRelativePath } from '../utils/fileUtils';

const ASK_TEAM_ACTION_TITLE = 'Pulse: Ask team about this';

export class PulseCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.Empty];

  constructor(private knowledgeGraph: KnowledgeGraph) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    // Skip non-source files
    const langId = document.languageId;
    const sourceLanguages = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'python', 'java', 'go', 'rust', 'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin']);
    if (!sourceLanguages.has(langId)) {
      return [];
    }

    const filePath = toRelativePath(document.uri.fsPath);
    if (!filePath) { return []; }
    const busFactor = this.knowledgeGraph.getBusFactorForFile(filePath);
    if (!busFactor) { return []; }

    const action = new vscode.CodeAction(
      ASK_TEAM_ACTION_TITLE,
      vscode.CodeActionKind.Empty
    );
    action.command = {
      command: 'pulse.askTeam',
      title: ASK_TEAM_ACTION_TITLE,
    };
    action.isPreferred = false;
    return [action];
  }
}
