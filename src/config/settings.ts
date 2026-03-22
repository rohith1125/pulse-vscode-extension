import * as vscode from 'vscode';

export interface PulseSettings {
  enabled: boolean;
  codeLensEnabled: boolean;
  hoverEnabled: boolean;
  busFactorWarningThreshold: number;
  busFactorCriticalThreshold: number;
  decayHalfLifeMonths: number;
  autoScanIntervalMinutes: number;
  excludePatterns: string[];
  githubEnabled: boolean;
  maxFileSizeKb: number;
  hoverDelayMs: number;
}

export function getSettings(): PulseSettings {
  const cfg = vscode.workspace.getConfiguration('pulse');
  const settings: PulseSettings = {
    enabled: cfg.get<boolean>('enabled', true),
    codeLensEnabled: cfg.get<boolean>('codeLensEnabled', true),
    hoverEnabled: cfg.get<boolean>('hoverEnabled', true),
    busFactorWarningThreshold: cfg.get<number>('busFactorWarningThreshold', 2),
    busFactorCriticalThreshold: cfg.get<number>('busFactorCriticalThreshold', 1),
    decayHalfLifeMonths: cfg.get<number>('decayHalfLifeMonths', 6),
    autoScanIntervalMinutes: cfg.get<number>('autoScanIntervalMinutes', 30),
    excludePatterns: cfg.get<string[]>('excludePatterns', ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/out/**']),
    githubEnabled: cfg.get<boolean>('githubEnabled', false),
    maxFileSizeKb: cfg.get<number>('maxFileSizeKb', 500),
    hoverDelayMs: cfg.get<number>('hoverDelayMs', 300),
  };

  if (settings.busFactorCriticalThreshold >= settings.busFactorWarningThreshold) {
    settings.busFactorCriticalThreshold = Math.max(0, settings.busFactorWarningThreshold - 1);
  }

  return settings;
}
