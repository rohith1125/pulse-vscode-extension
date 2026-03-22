import * as vscode from 'vscode';
import { OUTPUT_CHANNEL_NAME } from '../constants';

let outputChannel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return outputChannel;
}

export const logger = {
  info(message: string): void {
    getChannel().appendLine(`[INFO] ${new Date().toISOString()} ${message}`);
  },
  warn(message: string): void {
    getChannel().appendLine(`[WARN] ${new Date().toISOString()} ${message}`);
  },
  error(message: string, error?: unknown): void {
    const errStr = error instanceof Error ? ` — ${error.message}` : error ? ` — ${String(error)}` : '';
    getChannel().appendLine(`[ERROR] ${new Date().toISOString()} ${message}${errStr}`);
  },
  debug(message: string): void {
    getChannel().appendLine(`[DEBUG] ${new Date().toISOString()} ${message}`);
  },
  show(): void {
    getChannel().show();
  },
  dispose(): void {
    outputChannel?.dispose();
    outputChannel = undefined;
  },
};
