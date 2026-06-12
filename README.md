# PRism Bot

AI-powered PR reviewer. Scores pull requests against Jira acceptance criteria using Claude, posts a structured review comment, and optionally auto-approves.

## How it works

1. Fetches PR diff from GitHub
2. Extracts Jira key from branch name or PR title (e.g. `PROJ-123`)
3. Fetches Jira ticket AC (if credentials provided)
4. Sends diff + AC to Claude for scoring
5. Posts review comment to PR
6. Optionally auto-approves if score meets threshold

## Usage in your repo

Add a workflow file (e.g. `.github/workflows/prism.yml`):

```yaml
name: PRism Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  prism-review:
    permissions:
      contents: read
      pull-requests: write
    uses: Sahil1109/prism-bot/.github/workflows/prism-review.yml@main
    with:
      owner: ${{ github.repository_owner }}
      repo: ${{ github.event.repository.name }}
      pull_number: ${{ github.event.pull_request.number }}
      # approve_threshold: 80   # uncomment to enable auto-approval
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}     # optional
      JIRA_TOKEN: ${{ secrets.JIRA_TOKEN }}     # optional
```

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `owner` | yes | — | GitHub repo owner |
| `repo` | yes | — | GitHub repo name |
| `pull_number` | yes | — | PR number |
| `approve_threshold` | no | `0` | Score (0–100) required for auto-approval. `0` = disabled |

### Secrets

| Secret | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Anthropic API key |
| `JIRA_EMAIL` | no | Atlassian account email |
| `JIRA_TOKEN` | no | Atlassian API token |

`GITHUB_TOKEN` is provided automatically — do not pass it.

## Auto-approval

Disabled by default. Enable by setting `approve_threshold` (e.g. `80`).

PR is auto-approved only when **all** of:
- Score ≥ threshold
- Severity is not `critical`
- Business alignment is not `misaligned`

## Jira integration

If `JIRA_EMAIL` and `JIRA_TOKEN` are not set, or the Jira ticket is not found, PRism skips business alignment (shown as `skipped` / `unknown`) and still reviews the code. Pipeline never fails due to missing Jira context.

Jira key is extracted from branch name or PR title (e.g. `feature/PROJ-123-my-feature` or `[PROJ-123] My PR`).

## Review output

Posted as a PR comment:

- **Score** — 0–100
- **Severity** — `critical` / `high` / `medium` / `low`
- **Business alignment** — `aligned` / `partial` / `misaligned` / `skipped` / `unknown`
- **Missing requirements** — AC items not addressed
- **Code issues** — code-level concerns
- **File changes** — per-file diff summaries

Old PRism comments are cleaned up automatically (keeps 2 most recent).

## Local usage

```bash
cd pr-review
cp .env.example .env   # fill in values
npm install

# Review only (print to stdout)
npm run review -- <owner> <repo> <pull_number>

# Review + post comment
npm run review -- <owner> <repo> <pull_number> --comment

# Review + post comment + auto-approve at threshold 80
npm run review -- <owner> <repo> <pull_number> --comment --approve=80

# Clean up old PRism comments (keep 2 most recent)
npm run cleanup -- <owner> <repo> <pull_number> --keep=2
```

### Environment variables

```
ANTHROPIC_API_KEY=   # required
GITHUB_TOKEN=        # required
JIRA_EMAIL=          # optional
JIRA_TOKEN=          # optional
```

## Requirements

- Node.js >= 18
