# Changelog

All notable changes to PRism are documented here.

## [v1.0.0] — 2025-06-17

### Added

- Reusable `workflow_call` interface for org-wide adoption
- Jira integration opt-in via `enable_jira` input and `--jira` flag
- Auto-approval with configurable score threshold (`approve_threshold`)
- Per-file diff summaries with links to GitHub diff view
- Automatic cleanup of old PRism comments (keeps 2 most recent)
- Issue template chooser (Review Feedback, Feature Request, Bug Report)
- Feedback link in every PR comment footer

### Changed

- Model upgraded to `claude-sonnet-4-6`
- Large diff threshold raised from 100 to 300 lines
- GitHub files fetch now paginates (handles PRs with >100 files)
- Workflow inputs quoted to prevent shell injection
- Job timeout set to 5 minutes

### Fixed

- `PRISM_REPO_URL` corrected to `redbellynetwork/prism-bot`
- Removed redundant "View PR" link from comment footer (comment is already on the PR)
