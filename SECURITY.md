# Security Policy

## Reporting a Vulnerability

Report security vulnerabilities via [GitHub private vulnerability reporting](https://github.com/redbellynetwork/prism-bot/security/advisories/new).

Do **not** open a public issue for security vulnerabilities.

## Secrets handled by PRism

| Secret              | Scope                                  | Recommendation                                        |
| ------------------- | -------------------------------------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Sent to Anthropic API only             | Set a spend cap on your Anthropic account             |
| `JIRA_TOKEN`        | Sent to your Atlassian instance only   | Use a dedicated read-only bot account                 |
| `GITHUB_TOKEN`      | Used to post PR comments and approvals | Scoped to `contents: read` and `pull-requests: write` |

Secrets are never logged or forwarded beyond their intended API.
