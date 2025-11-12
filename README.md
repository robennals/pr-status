# PR Status

A beautiful CLI tool to check the status of your open GitHub pull requests, categorized by priority and action needed.

Never lose track of your PRs again! This tool analyzes all your open pull requests and tells you exactly what needs your attention, from failing CI checks to PRs ready to merge.

## Features

- **Smart Prioritization**: PRs are automatically sorted by what needs your attention most
- **Rich Status Information**: See reviewer names, comment previews, and time since last update
- **Business Hours Tracking**: Excludes weekends when calculating how long reviewers have been waiting
- **Bot Filtering**: Automatically filters out bot reviews and comments to show only human feedback
- **Beautiful Output**: Color-coded status categories with emojis for quick scanning

## Installation

### Global Installation (Recommended)

Install globally to use from anywhere:

```bash
npm install -g @robennals/pr-status
```

Then run:

```bash
pr-status
```

### Local Installation

For use in a specific project:

```bash
npm install @robennals/pr-status
```

Then run using:

```bash
npx pr-status
```

Or add to your `package.json` scripts:

```json
{
  "scripts": {
    "pr-status": "@robennals/pr-status"
  }
}
```

### Development Setup

To work on the tool itself:

```bash
git clone https://github.com/robennals/pr-status.git
cd pr-status
npm install
npm run build
npm start
```

## Requirements

- **Node.js**: 18.0.0 or higher
- **GitHub CLI**: Must have `gh` installed and authenticated
  ```bash
  # Install gh if you haven't already
  brew install gh  # macOS
  # or visit https://cli.github.com for other platforms

  # Authenticate with GitHub
  gh auth login
  ```

## Status Categories

Your PRs are automatically categorized and displayed in priority order:

### ❌ CHECKS FAILING
CI/CD checks are failing. Fix these first before anything else.

### 💬 OPEN COMMENT
Reviewers have left comments or requested changes that you haven't replied to yet. These need your immediate attention.

### 🔄 RE-REQUEST
You've replied to comments but haven't re-requested review from the reviewer yet. Time to ping them!

### ✅ MERGE
All reviewers have approved - ready to merge! Ship it!

### ⏰ PROD
You've requested review but haven't heard back in over 48 business hours (excludes weekends). Consider following up.

### 👀 REQUEST
No reviewers have been requested yet. Time to ask for reviews!

### ⏳ WAITING
Waiting for review (less than 48 business hours since last update). Be patient!

## How It Works

The tool:
1. Fetches all your open PRs using GitHub CLI
2. Analyzes review states, comments, and timelines
3. Filters out bot reviews and comments
4. Calculates business hours for review waiting times
5. Groups PRs by priority status
6. Shows relevant reviewer information and comment previews

## Example Output

```
📋 PR Status Summary

Checking PRs for: robennals

💬 OPEN COMMENT:
  #123 Add user authentication feature
    → https://github.com/robennals/myproject/pull/123
    → Reviewer: johndoe
    → Changes requested - "Need to add input validation"

✅ MERGE:
  #456 Fix login bug
    → https://github.com/robennals/myproject/pull/456
    → Approved by jane, mike

⏰ PROD:
  #789 Update documentation
    → https://github.com/robennals/myproject/pull/789
    → Reviewer: @team-docs
    → No response for 3 business day(s)

Total: 3 open PR(s)
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Issues

Found a bug or have a feature request? Please open an issue at:
https://github.com/robennals/pr-status/issues

## License

Apache-2.0 - see [LICENSE](LICENSE) file for details.

## Author

Rob Ennals <rob.ennals@gmail.com>
