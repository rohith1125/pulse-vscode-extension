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
    const channel = getChannel();
    const timestamp = new Date().toISOString();
    if (error instanceof Error) {
      channel.appendLine(`[ERROR] ${timestamp} ${message}: ${error.message}`);
      if (error.stack) {
        channel.appendLine(error.stack);
      }
    } else if (error) {
      channel.appendLine(`[ERROR] ${timestamp} ${message} — ${String(error)}`);
    } else {
      channel.appendLine(`[ERROR] ${timestamp} ${message}`);
    }
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
