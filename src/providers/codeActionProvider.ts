import * as vscode from 'vscode';

const ASK_TEAM_ACTION_TITLE = 'Pulse: Ask team about this';

export class PulseCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.Empty];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
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
