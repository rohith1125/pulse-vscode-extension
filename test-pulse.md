# Pulse Extension — Complete Testing Guide

---

## 0. Pre-Flight Setup

### Install the extension from source

```bash
cd /Users/friday/Desktop/pulse-vscode-extension
npm install
node esbuild.js          # should print: [build] development build complete
```

**What can break:**
- `better-sqlite3` fails to compile on Node 24 — you'll see `node-gyp` errors
  - **Fix:** `npm install --ignore-scripts` then test without DB (extension will crash on activate)
  - **Real fix:** Switch Node version → `nvm use 20` then `npm install`
- `esbuild` not found → `npm install` didn't complete. Re-run.
- `dist/extension.js` not generated → check `esbuild.js` for syntax errors

**Verify build succeeded:**
```bash
ls dist/extension.js   # must exist
```

---

## 1. Load Extension in VS Code

```
1. Open /Users/friday/Desktop/pulse-vscode-extension in VS Code
2. Press F5
3. A new "Extension Development Host" window opens
```

**What can break:**
- F5 does nothing → `.vscode/launch.json` missing — create it:

`.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

`.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "npm: compile",
      "type": "npm",
      "script": "compile",
      "group": { "kind": "build", "isDefault": true },
      "presentation": { "reveal": "silent" }
    }
  ]
}
```

---

## 2. Activation Test

In the Extension Development Host window, open **any git repository** (File → Open Folder).

**Expected:** Pulse status bar item appears bottom-right showing `$(pulse) Pulse`

**What can break:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| No status bar item | Extension didn't activate | Check `activationEvents` in package.json — must be `workspaceContains:.git` |
| "No workspace folder open" error | Opened a file, not a folder | Open a folder, not a single file |
| Extension crashes on activate | `better-sqlite3` native module failed | Node version issue — use Node 20 LTS |
| `.vscode/pulse.db` creation fails | Permissions issue | Check filesystem permissions on `.vscode/` |

**Verify activation:**
```
Ctrl+Shift+P → "Pulse: Scan Repository"  ← should appear in command palette
```

If the command doesn't appear → extension isn't activated.

**Test activation on NON-git folder:**
Open a folder without `.git` → Pulse should NOT activate (no status bar item). This is correct behavior.

---

## 3. Scan Command — The Most Critical Test

```
Ctrl+Shift+P → "Pulse: Scan Repository"
```

**Expected:** Progress notification appears, counts files, completes with "Pulse: Scan complete ✓"

### 3a. Happy path test
Open a real git repo with commits.

**Watch for:**
- Progress bar shows filenames updating
- No error notifications
- Status bar updates after scan completes
- `.vscode/pulse.db` file appears in the repo's `.vscode/` folder

```bash
# Verify DB was created and has data:
sqlite3 /path/to/your-repo/.vscode/pulse.db "SELECT COUNT(*) FROM commits; SELECT COUNT(*) FROM contributors; SELECT COUNT(*) FROM files;"
```

### 3b. Empty repo test
```bash
mkdir /tmp/empty-test && cd /tmp/empty-test && git init
```
Open it → Run scan.

**Expected:** Scan completes silently (0 files). No crash.

### 3c. Repo with no remote
**Expected:** Scan completes normally. GitHub fetch is skipped with a warning.

### 3d. Large repo test
Try a repo with thousands of files.

**Expected:** Scan caps at 5000 files, shows warning in Pulse output channel.
**Check:** `View → Output → Pulse` channel for warning message.

### 3e. Binary files
Repo with `.png`, `.pdf`, `.exe` files.

**Expected:** Skipped silently. No crash from garbage blame output.

### 3f. Files with spaces/special characters
Repo with `"my file (v2).ts"` or Unicode filenames.

**Expected:** Scanned without error.

### 3g. Scan while scan is running
Start a scan, immediately run it again.

**Expected:** "Scan already in progress, skipping" logged. Second scan does nothing.

---

## 4. Hover Provider Test

After a successful scan, open any `.ts`, `.js`, or `.py` file in the scanned repo.

### 4a. Basic hover
Hover your cursor over a function name for 300ms.

**Expected:** Hover card appears with:
- "Pulse Knowledge · filename"
- Expert table (name, score bar, last active)
- Bus factor line (if applicable)
- "Ask team →" and "Dashboard →" links

**What can break:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| No hover card | File not in DB | Run scan first |
| Hover appears instantly (no delay) | Debounce not working | Check `hoverDelayMs` setting |
| "Ask team →" link not clickable | `isTrusted = false` on MarkdownString | Check `md.isTrusted = true` in hoverProvider.ts |
| Hover shows but expert names are blank | DB query returning empty | Check `getExpertiseScoresForFile()` |

### 4b. Hover on untracked file
Open a brand new file never committed.

**Expected:** No hover card. No error.

### 4c. Hover cancellation
Move mouse rapidly across many tokens.

**Expected:** No lag. CancellationToken aborts stale requests.

### 4d. Test hover content accuracy
```bash
git log --follow --format="%ae|%an" -- src/yourfile.ts | head -5
```
Compare names in hover card to actual git contributors.

---

## 5. CodeLens Test

### 5a. Basic CodeLens
Open a `.ts` file with function declarations.

**Expected:** CodeLens annotations appear above the first top-level function:
- `⚠️ Bus factor 1 — ask Alice` (critical)
- `👥 2 experts · Bob + 1 more` (warning)
- `✓ 4 experts` (healthy)

**What can break:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| No CodeLens visible | No document symbols | Language server not running, or file type not supported |
| Clicking CodeLens does nothing | Command not registered | Verify `pulse.askTeam` is registered in extension.ts |

### 5b. Toggle CodeLens off
```
Settings → pulse.codeLensEnabled → false
```
**Expected:** CodeLens disappears from all files immediately.

### 5c. CodeLens on files with no symbols
Open a `.json`, `.md`, or `.txt` file.

**Expected:** No CodeLens. No error.

---

## 6. Ask Team Command

```
Ctrl+Shift+P → "Pulse: Ask Team About This"
```
Or: right-click in editor → "Pulse: Ask team about this"

### 6a. Basic flow
**Expected:** QuickPick panel opens showing ranked experts with score bars, last-active dates.

**What can break:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No expertise data for this file" | File not scanned | Run scan first |
| QuickPick appears but empty | `getTopExpertsForFile()` returns [] | Check DB has expertise_scores |
| Selecting expert does nothing | Clipboard write failing | Check clipboard permissions |

### 6b. Verify clipboard copy
Select an expert → `Cmd+V` in any text field → expert's contact should paste.

### 6c. No active editor
Close all editor tabs → run the command.

**Expected:** "Pulse: Open a file to use Ask Team" info message.

---

## 7. Dashboard Test

```
Ctrl+Shift+P → "Pulse: Open Knowledge Dashboard"
```

### 7a. After scan
**Expected:** Webview panel opens with:
- Summary cards (Critical / Warning / Healthy counts)
- Critical files table with bus factor badges
- Knowledge distribution bars

### 7b. Before any scan
**Expected:** "No scan data yet. Scan now →" message.

### 7c. "Re-scan" button
Click "↻ Re-scan".

**Expected:** Scan progress notification appears, dashboard updates when complete.

### 7d. Dashboard with custom thresholds
Change `busFactorCriticalThreshold` to 3 → re-scan.

**Expected:** More files appear as critical.

---

## 8. GitHub Integration Test

### 8a. Connect GitHub
```
Ctrl+Shift+P → "Pulse: Connect GitHub Account"
```

**Expected:** VS Code OAuth prompt → sign in → "Pulse: Connected as @username" message.

**What can break:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| OAuth prompt never appears | VS Code version too old | Upgrade to VS Code 1.85+ |
| "GitHub sign-in failed" | OAuth scope rejected | Check GITHUB_SCOPES in githubAuth.ts |

### 8b. Enable GitHub and rescan
```
Settings → pulse.githubEnabled = true
Pulse: Scan Repository
```

**Expected:** Scan takes longer, hover cards gain PR context links.

### 8c. Rate limit handling
Test on a repo with 200+ PRs.

**Expected:** Scan completes without 429 errors. Output: "GitHub data fetch complete".

### 8d. Non-GitHub remote
Test on a GitLab or Bitbucket repo with GitHub enabled.

**Expected:** "Could not parse GitHub remote URL" warning. Scan continues with git-only data.

---

## 9. Clear Cache Command

```
Ctrl+Shift+P → "Pulse: Clear Cache & Rescan"
```

**Expected:** Modal confirmation → "Clear & Rescan" → cache cleared → background scan starts.

**Verify:**
```bash
sqlite3 /path/to/repo/.vscode/pulse.db "SELECT COUNT(*) FROM commits;"
# Should return 0 immediately after clear (before rescan completes)
```

---

## 10. Settings Tests

### 10a. Disable extension
```
pulse.enabled = false → reload window
```
**Expected:** No status bar, no hover, no CodeLens.

### 10b. Hover delay
```
pulse.hoverDelayMs = 0    → hover appears instantly
pulse.hoverDelayMs = 2000 → 2 second delay
```

### 10c. Exclude patterns
```
pulse.excludePatterns = ["**/*.ts"]
```
Run scan → hover over `.ts` file → no hover data.

### 10d. Max file size
```
pulse.maxFileSizeKb = 1
```
Run scan → most files skipped. Output channel shows fewer files processed.

### 10e. Disable auto-scan
```
pulse.autoScanIntervalMinutes = 0
```
Reload → no automatic scan on activation. Manual scan still works.

---

## 11. Incremental Scan Test

1. Run a full scan
2. Modify a source file (add a comment)
3. Save the file
4. Wait 5 seconds

**Expected:** Incremental scan runs automatically. Output channel: "Incremental scan: 1 changed files".

---

## 12. Auto-Scan Timer Test

```
pulse.autoScanIntervalMinutes = 1
```
Reload window, wait 1 minute.

**Expected:** Scan runs automatically. Output channel shows scan activity.

---

## 13. Edge Cases That Will Break Things

### 13a. Squash-merged PRs
All PR commits squashed → blame shows only the squasher.

**Expected:** Single contributor scores very high. Known limitation.

### 13b. Git repo with submodules
**Expected:** Submodule files excluded by `git ls-files`. If not, blame on submodule paths fails silently.

### 13c. File renamed/moved
`git blame --follow` handles renames.

**Expected:** History follows file through renames. Verify on a known-renamed file.

### 13d. Detached HEAD state
After `git checkout <hash>`.

**Expected:** `getAllContributors()` uses `HEAD` — may warn. Check output channel.

### 13e. Monorepo (100,000+ files)
**Expected:** Capped at 5000 files. Warning in output channel. Scan completes.

### 13f. Windows line endings (CRLF)
Repo from Windows origin on macOS.

**Expected:** `parsePorcelainBlame()` handles `\r\n`. No crash.

### 13g. Emoji in commit messages
**Expected:** Subject stored with emoji intact. Pipe-delimited parsing still works.

### 13h. Multiple workspace folders
**Expected:** Only `workspaceFolders[0]` scanned. Known limitation.

---

## 14. Output Channel — Your Debug Window

```
View → Output → (dropdown) → Pulse
```

**Key log lines to look for:**

| Log line | Meaning |
|----------|---------|
| `[INFO] Pulse activated` | Extension loaded correctly |
| `[INFO] Starting full repository scan...` | Scan started |
| `[INFO] Found N contributors` | git shortlog worked |
| `[INFO] Scan complete. N files processed.` | Success |
| `[WARN] Capping scan at 5000 files` | Large repo, expected |
| `[WARN] Could not parse GitHub remote URL` | Non-GitHub remote, expected |
| `[ERROR] ...` | Something failed — read message + stack |

---

## 15. Full Regression Checklist

Run these in order on a real repo:

- [ ] Extension activates (status bar item appears)
- [ ] `pulse.scan` completes without error
- [ ] `.vscode/pulse.db` created with rows in all tables
- [ ] Hover card appears on a function (300ms delay)
- [ ] Hover card shows correct contributor names (verify against `git log`)
- [ ] CodeLens appears above top-level function
- [ ] CodeLens text matches bus factor (1 = critical, 2+ = warning/healthy)
- [ ] `pulse.askTeam` opens QuickPick with ranked experts
- [ ] Selecting expert copies contact to clipboard
- [ ] `pulse.openDashboard` opens webview with data
- [ ] Dashboard "Re-scan" button triggers scan
- [ ] `pulse.connectGitHub` completes OAuth flow
- [ ] GitHub-enabled scan adds PR context to hover cards
- [ ] `pulse.clearCache` clears DB and restarts scan
- [ ] Status bar shows warning background for critical repos
- [ ] Settings changes (disable CodeLens, hover) take effect immediately
- [ ] Output channel shows no `[ERROR]` lines
- [ ] Extension deactivates cleanly (close window, no crash)

---

## 16. Known Issues (Don't Waste Time)

| Issue | Root Cause | Status |
|-------|-----------|--------|
| `better-sqlite3` fails on Node 24 | No prebuilt binary for Node 24 | Use Node 20 LTS |
| Hover card on `.json` files shows nothing | JSON has no document symbols | Expected behavior |
| GitHub scan slow on large repos | Rate limiter throttles to 4800 req/hr | Expected — handled gracefully |
| Bus factor shows 0 experts on new files | No blame data yet | Run full scan first |
| CodeLens flickers on first load | Language server startup race | Harmless — refreshes after 1s |
| Only first workspace folder scanned | `getWorkspaceRoot()` returns `[0]` | Known limitation |
