import * as vscode from 'vscode';
import { KnowledgeGraph, BusFactorResult } from '../core/knowledgeGraph';
import { PulseSettings } from '../config/settings';
import { toRelativePath } from '../utils/fileUtils';
import { logger } from '../utils/logger';

export class PulseCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(
    private knowledgeGraph: KnowledgeGraph,
    private settings: PulseSettings
  ) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (!this.settings.codeLensEnabled) { return []; }

    const filePath = toRelativePath(document.uri.fsPath);
    const busFactor = this.knowledgeGraph.getBusFactorForFile(filePath);
    if (!busFactor) { return []; }

    // Get document symbols
    let symbols: vscode.DocumentSymbol[] = [];
    try {
      const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      );
      symbols = result ?? [];
    } catch (err) {
      logger.debug(`Could not get symbols for ${filePath}: ${err}`);
      return [];
    }

    if (token.isCancellationRequested) { return []; }

    // Only annotate top-level symbols to avoid clutter
    const topLevelSymbols = symbols.filter(s => isAnnotatableSymbol(s.kind));
    if (topLevelSymbols.length === 0) { return []; }

    // Show one CodeLens per file (at the first annotatable symbol)
    // This avoids overwhelming the UI
    const firstSymbol = topLevelSymbols[0];
    const range = new vscode.Range(firstSymbol.range.start, firstSymbol.range.start);

    const lens = new vscode.CodeLens(range);
    lens.command = {
      title: buildCodeLensTitle(busFactor),
      command: 'pulse.askTeam',
      tooltip: buildCodeLensTooltip(busFactor),
      arguments: [document.uri.fsPath, firstSymbol.name, firstSymbol.range.start.line],
    };

    return [lens];
  }

  resolveCodeLens(
    codeLens: vscode.CodeLens,
    token: vscode.CancellationToken
  ): vscode.CodeLens {
    return codeLens; // already resolved in provideCodeLenses
  }

  /** Call after scan completes to refresh all open editors */
  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  updateSettings(settings: PulseSettings): void {
    this.settings = settings;
    this._onDidChangeCodeLenses.fire();
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}

function isAnnotatableSymbol(kind: vscode.SymbolKind): boolean {
  return [
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Module,
    vscode.SymbolKind.Namespace,
    vscode.SymbolKind.Interface,
  ].includes(kind);
}

function buildCodeLensTitle(bf: BusFactorResult): string {
  if (bf.riskLevel === 'critical') {
    const expert = bf.topExperts[0]?.contributor.name;
    return expert
      ? `⚠️ Bus factor ${bf.busFactorCount} — ask ${expert}`
      : `⚠️ Bus factor ${bf.busFactorCount} (critical)`;
  }
  if (bf.riskLevel === 'warning') {
    const names = bf.topExperts.slice(0, 2).map(e => e.contributor.name);
    return names.length > 1
      ? `👥 ${bf.busFactorCount} experts · ${names[0]} + ${bf.busFactorCount - 1} more`
      : `👥 ${bf.busFactorCount} experts`;
  }
  return `✓ ${bf.busFactorCount} experts`;
}

function buildCodeLensTooltip(bf: BusFactorResult): string {
  const names = bf.topExperts.map(e => e.contributor.name).join(', ');
  return `Pulse: ${bf.busFactorCount} people understand this file. Top experts: ${names || 'none'}`;
}
