import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DB_FILENAME } from '../constants';

/** Returns the workspace root folder path, or undefined if no workspace is open */
export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Returns the absolute path for the Pulse SQLite database */
export function getWorkspaceDbPath(): string {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open');
  }
  return path.join(root, '.vscode', DB_FILENAME);
}

/** Ensures the .vscode directory exists */
export function ensureVscodeDir(): void {
  const root = getWorkspaceRoot();
  if (!root) { return; }
  const vscodeDir = path.join(root, '.vscode');
  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }
}

/** Converts an absolute path to a path relative to workspace root */
export function toRelativePath(absolutePath: string): string {
  const root = getWorkspaceRoot();
  if (!root) { return absolutePath; }
  return path.relative(root, absolutePath);
}

/** Converts a relative path to absolute based on workspace root */
export function toAbsolutePath(relativePath: string): string {
  const root = getWorkspaceRoot();
  if (!root) { return relativePath; }
  return path.join(root, relativePath);
}

/** Checks if a file size exceeds the configured max in KB */
export function isFileTooLarge(absolutePath: string, maxSizeKb: number): boolean {
  try {
    const stats = fs.statSync(absolutePath);
    return stats.size > maxSizeKb * 1024;
  } catch {
    return false;
  }
}

/** Returns true if the file matches any of the exclude glob patterns */
export function isExcluded(relativePath: string, excludePatterns: string[]): boolean {
  // Simple pattern matching: check if any pattern segment appears in path
  // For production, use minimatch — for now use basic substring/glob check
  return excludePatterns.some(pattern => {
    const normalised = pattern.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\//g, path.sep);
    return relativePath.includes(normalised.replace(/^\/|\/$/g, ''));
  });
}

/** Detects the programming language of a file by extension */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.cpp': 'cpp', '.cc': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
    '.c': 'c',
  };
  return langMap[ext] ?? 'plaintext';
}
