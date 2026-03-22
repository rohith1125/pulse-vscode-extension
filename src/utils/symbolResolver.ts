import * as vscode from 'vscode';

/**
 * Returns the name of the innermost function/class/method symbol
 * that contains the given position, or undefined if none found.
 */
export async function resolveSymbolAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string | undefined> {
  let symbols: vscode.DocumentSymbol[];
  try {
    const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    );
    symbols = result ?? [];
  } catch {
    return undefined;
  }

  return findInnermostSymbol(symbols, position);
}

function findInnermostSymbol(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position
): string | undefined {
  for (const symbol of symbols) {
    if (symbol.range.contains(position)) {
      // Recurse into children first to get the most specific match
      const childMatch = findInnermostSymbol(symbol.children, position);
      if (childMatch) { return childMatch; }
      // Only return named symbols (functions, methods, classes)
      if (isNamedSymbol(symbol.kind)) {
        return symbol.name;
      }
    }
  }
  return undefined;
}

function isNamedSymbol(kind: vscode.SymbolKind): boolean {
  return [
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Constructor,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Module,
    vscode.SymbolKind.Namespace,
  ].includes(kind);
}
