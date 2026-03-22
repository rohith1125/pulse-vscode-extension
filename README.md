# Pulse — Team Knowledge for VS Code

> See who understands your codebase. Bus factor alerts, best person to ask, and decision archaeology — all inline in VS Code.

## What Problem Does Pulse Solve?

45% of developers lose 30+ minutes daily to knowledge silos. You open an unfamiliar function and have no idea:
- **Who** understands this code today (not just who last touched it)
- **Why** it was built this way (the PR discussion happened in Slack 2 years ago)
- **Who to ask** before you spend hours debugging the wrong path

Pulse builds a living knowledge map from your git history and GitHub PRs, surfaces it inline as hover cards and bus factor warnings, and tells you exactly who to ping.

## Features

### 🔍 Knowledge Hover Cards
Hover over any function to see:
- Top experts with expertise scores and last-active dates
- ⚠️ Bus factor warnings when only 1 person understands a file
- Linked PR context — why this code was written
- "Ask team →" quick action

### 📊 Bus Factor CodeLens
Inline annotations above functions showing knowledge concentration:
- `⚠️ Bus factor 1 — ask Alice` — critical risk
- `👥 2 experts · Bob + 1 more` — warning
- `✓ 4 experts` — healthy

### 👥 Ask Team
Run **Pulse: Ask Team About This** to see a ranked list of who understands the current file, with their last-active date and contact info.

### 📈 Knowledge Dashboard
Open the dashboard to see:
- Critical files (bus factor 1) that need immediate attention
- Knowledge distribution across your team
- Files at risk when someone leaves

### 🔗 GitHub Integration (optional)
Connect your GitHub account to unlock:
- PR discussion context in hover cards
- Reviewer history in expertise scores
- Decision archaeology — *why* this code was written

## Getting Started

1. **Install** Pulse from the VS Code Marketplace
2. **Open** any git repository
3. **Run** `Pulse: Scan Repository` from the Command Palette (`Ctrl+Shift+P`)
4. **Hover** over any function to see team knowledge

Scan completes in 2–5 minutes for most repositories. All data stays on your machine.

## Commands

| Command | Description |
|---------|-------------|
| `Pulse: Scan Repository` | Scan codebase and build knowledge graph |
| `Pulse: Open Knowledge Dashboard` | View team knowledge overview |
| `Pulse: Ask Team About This` | Find who to ask about the current file |
| `Pulse: Connect GitHub Account` | Enable PR context (optional) |
| `Pulse: Clear Cache & Rescan` | Reset all data and rescan |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pulse.enabled` | `true` | Enable/disable Pulse |
| `pulse.codeLensEnabled` | `true` | Show bus factor CodeLens |
| `pulse.hoverEnabled` | `true` | Show knowledge hover cards |
| `pulse.busFactorWarningThreshold` | `2` | Warn when experts ≤ N |
| `pulse.busFactorCriticalThreshold` | `1` | Critical when experts ≤ N |
| `pulse.decayHalfLifeMonths` | `6` | Months until expertise score halves |
| `pulse.autoScanIntervalMinutes` | `30` | Auto-scan interval (0 = disabled) |
| `pulse.githubEnabled` | `false` | Enable GitHub PR integration |

## Privacy

Pulse is **local-first**. All analysis runs on your machine:
- Git blame and commit history → stored in `.vscode/pulse.db` (never leaves your machine)
- PR titles and review data → fetched from GitHub, stored locally
- **No code content, metrics, or telemetry** is ever transmitted

The `.vscode/pulse.db` file is automatically added to your `.gitignore`.

## Requirements

- VS Code 1.85+
- Git installed in PATH
- Node.js 18+ (for native SQLite module)

## License

MIT
