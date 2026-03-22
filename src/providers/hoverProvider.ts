import * as vscode from 'vscode';
import { KnowledgeGraph, ExpertiseResult, BusFactorResult, HoverContext } from '../core/knowledgeGraph';
import { PulseSettings } from '../config/settings';
import { resolveSymbolAtPosition } from '../utils/symbolResolver';
import { toRelativePath } from '../utils/fileUtils';
import { logger } from '../utils/logger';

export class PulseHoverProvider implements vscode.HoverProvider {
  private pendingRequest: NodeJS.Timeout | undefined;

  constructor(
    private knowledgeGraph: KnowledgeGraph,
    private settings: PulseSettings
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    if (!this.settings.hoverEnabled) { return null; }

    // Wait for debounce delay, cancel if token fires
    const debounced = await this.debounce(this.settings.hoverDelayMs, token);
    if (!debounced || token.isCancellationRequested) { return null; }

    const filePath = toRelativePath(document.uri.fsPath);

    try {
      const symbolName = await resolveSymbolAtPosition(document, position);
      if (token.isCancellationRequested) { return null; }

      const ctx = await this.knowledgeGraph.getHoverContext(
        filePath,
        position.line + 1, // 1-based line number
        this.settings,
        symbolName
      );
      if (!ctx || token.isCancellationRequested) { return null; }

      // Don't show hover if we have no useful data
      if (ctx.topExperts.length === 0 && !ctx.busFactorResult) { return null; }

      const markdown = this.buildMarkdown(ctx);
      const wordRange = document.getWordRangeAtPosition(position);
      return new vscode.Hover(markdown, wordRange);
    } catch (err) {
      logger.debug(`Hover error for ${filePath}: ${err}`);
      return null;
    }
  }

  private debounce(ms: number, token: vscode.CancellationToken): Promise<boolean> {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(true), ms);
      token.onCancellationRequested(() => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  private buildMarkdown(ctx: HoverContext): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true; // allow command links
    md.supportHtml = false;

    // Header
    const fileName = ctx.filePath.split('/').pop() ?? ctx.filePath;
    const symbolPart = ctx.symbolName ? ` · \`${ctx.symbolName}\`` : '';
    md.appendMarkdown(`**Pulse Knowledge** · \`${fileName}\`${symbolPart}\n\n`);

    // Experts table
    if (ctx.topExperts.length > 0) {
      md.appendMarkdown('| Expert | Score | Last active |\n');
      md.appendMarkdown('|--------|-------|-------------|\n');
      for (const expert of ctx.topExperts) {
        const bar = this.buildScoreBar(expert.score);
        const decay = expert.decayWarning ? ' ⚠️' : '';
        md.appendMarkdown(
          `| 👤 ${expert.contributor.name} | ${bar} ${Math.round(expert.score * 100)}% | ${expert.timeAgo}${decay} |\n`
        );
      }
      md.appendMarkdown('\n');
    }

    // Bus factor
    if (ctx.busFactorResult) {
      const bf = ctx.busFactorResult;
      if (bf.riskLevel === 'critical') {
        const expertName = bf.topExperts[0]?.contributor.name ?? 'unknown';
        md.appendMarkdown(`⚠️ **Bus factor: ${bf.busFactorCount}** (critical) — only ${expertName} deeply understands this\n\n`);
      } else if (bf.riskLevel === 'warning') {
        md.appendMarkdown(`🟡 **Bus factor: ${bf.busFactorCount}** (warning) — limited team knowledge\n\n`);
      }
    }

    // Recent PRs
    if (ctx.recentPRs.length > 0) {
      const pr = ctx.recentPRs[0];
      const prTitle = pr.prTitle ?? `PR #${pr.prNumber}`;
      const reviewerStr = pr.reviewers.length > 0 ? ` · reviewed by ${pr.reviewers.slice(0, 2).join(', ')}` : '';
      if (pr.prUrl) {
        md.appendMarkdown(`📎 [${prTitle}](${pr.prUrl})${reviewerStr}\n\n`);
      } else {
        md.appendMarkdown(`📎 ${prTitle}${reviewerStr}\n\n`);
      }
    }

    // Decision notes
    if (ctx.decisionNotes.length > 0) {
      const note = ctx.decisionNotes[0];
      const author = note.authorLogin ? `@${note.authorLogin}` : 'unknown';
      const prLink = note.prUrl ? `[PR #${note.prNumber}](${note.prUrl})` : `PR #${note.prNumber}`;
      md.appendMarkdown(`💬 ${author} in ${prLink}: *${note.excerpt}*\n\n`);
    }

    // Action links
    md.appendMarkdown(
      `[Ask team →](command:pulse.askTeam) · [Dashboard →](command:pulse.openDashboard)`
    );

    return md;
  }

  private buildScoreBar(score: number): string {
    const filled = Math.round(score * 8);
    const empty = 8 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /** Call this when settings change to apply new values */
  updateSettings(settings: PulseSettings): void {
    this.settings = settings;
  }
}
