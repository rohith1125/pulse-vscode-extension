import * as vscode from 'vscode';
import { KnowledgeGraph, ExpertiseResult } from '../core/knowledgeGraph';
import { getSettings } from '../config/settings';
import { toRelativePath } from '../utils/fileUtils';
import { resolveSymbolAtPosition } from '../utils/symbolResolver';
import { logger } from '../utils/logger';

export async function askTeamCommand(knowledgeGraph: KnowledgeGraph): Promise<void> {
  try {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Pulse: Open a file to use Ask Team');
    return;
  }

  const filePath = toRelativePath(editor.document.uri.fsPath);
  const settings = getSettings();
  const experts = knowledgeGraph.getTopExpertsForFile(filePath, settings, 5);

  if (experts.length === 0) {
    vscode.window.showInformationMessage(
      'Pulse: No expertise data for this file. Run "Pulse: Scan Repository" first.'
    );
    return;
  }

  const symbolName = await resolveSymbolAtPosition(editor.document, editor.selection.active);

  const items: vscode.QuickPickItem[] = experts.map(expert => {
    const score = Math.round(expert.score * 100);
    const bar = buildBar(expert.score);
    const decay = expert.decayWarning ? '  ⚠️ expertise may be stale' : '';
    const contact = expert.contributor.slackHandle
      ? `  @${expert.contributor.slackHandle} on Slack`
      : expert.contributor.githubLogin
        ? `  @${expert.contributor.githubLogin} on GitHub`
        : `  ${expert.contributor.email}`;

    return {
      label: `👤 ${expert.contributor.name}`,
      description: `${bar} ${score}%${decay}`,
      detail: `Last active: ${expert.timeAgo}${contact}  ·  ${expert.commitCount} commits · ${expert.reviewCount} reviews`,
    };
  });

  const title = symbolName
    ? `Pulse: Who understands \`${symbolName}\`?`
    : `Pulse: Who understands \`${filePath.split('/').pop()}\`?`;

  const selected = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Select an expert to copy their contact info',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selected) { return; }

  const expertName = selected.label.replace('👤 ', '');
  const expert = experts.find(e => e.contributor.name === expertName);
  if (!expert) { return; }

  // Copy contact to clipboard
  const contact = expert.contributor.slackHandle
    ? `@${expert.contributor.slackHandle}`
    : expert.contributor.githubLogin
      ? `@${expert.contributor.githubLogin}`
      : expert.contributor.email;

  await vscode.env.clipboard.writeText(contact);
  vscode.window.showInformationMessage(
    `Pulse: Copied ${contact} to clipboard`
  );

  // If GitHub login available, offer to open profile
  if (expert.contributor.githubLogin) {
    const openProfile = await vscode.window.showInformationMessage(
      `Open @${expert.contributor.githubLogin}'s GitHub profile?`,
      'Open', 'No'
    );
    if (openProfile === 'Open') {
      vscode.env.openExternal(
        vscode.Uri.parse(`https://github.com/${expert.contributor.githubLogin}`)
      );
    }
  }
  } catch (err) {
    vscode.window.showErrorMessage(`Pulse: Ask Team failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildBar(score: number): string {
  const filled = Math.round(score * 8);
  return '█'.repeat(filled) + '░'.repeat(8 - filled);
}
