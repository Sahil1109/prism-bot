const MODEL = "claude-sonnet-4-6";
const LARGE_DIFF_THRESHOLD = 300;

const REVIEW_TOOL = {
  name: "submit_review",
  description: "Submit the structured PR review result",
  input_schema: {
    type: "object",
    properties: {
      severity: {
        type: "string",
        enum: ["critical", "high", "medium", "low"],
        description: "Highest severity issue found in the diff",
      },
      business_alignment: {
        type: "string",
        enum: ["aligned", "partial", "misaligned", "skipped"],
        description: "How well the PR addresses the Jira ticket requirements",
      },
      missing_requirements: {
        type: "array",
        items: { type: "string" },
        description: "AC items from the Jira ticket not addressed by this PR",
      },
      code_issues: {
        type: "array",
        items: { type: "string" },
        description: "Code-level concerns found in the diff",
      },
      score: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Overall PR quality score per rubric",
      },
      summary: {
        type: "string",
        description: "2-3 sentence human-readable review summary",
      },
      rollback_guide: {
        type: "array",
        items: { type: "string" },
        description: "3-5 triage steps for oncall if prod breaks after this PR merges. Each step names a specific file, service, or metric to check and why it is at risk. Be concrete — reference actual filenames and changed behaviour from the diff.",
      },
    },
    required: [
      "severity",
      "business_alignment",
      "missing_requirements",
      "code_issues",
      "score",
      "summary",
      "rollback_guide",
    ],
  },
};

const SCORING_RUBRIC = `Scoring rubric (start at 100, deduct):
- Critical bug or security vulnerability: -30
- High severity issue (data loss, broken logic): -15
- Medium issue (edge case, poor error handling): -8
- Low / style issue: -3
- Missing AC item from Jira ticket: -10 each
- Floor is 0.`;

function countDiffLines(diff) {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") || l.startsWith("-")).length;
}

async function callClaude(prompt, maxTokens = 256) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Anthropic API error ${res.status}: ${body}`);
    process.exit(1);
  }

  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function callClaudeReview(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      temperature: 0,
      tools: [REVIEW_TOOL],
      tool_choice: { type: "tool", name: "submit_review" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Anthropic API error ${res.status}: ${body}`);
    process.exit(1);
  }

  const data = await res.json();
  const toolUse = data.content?.find((b) => b.type === "tool_use");
  if (!toolUse?.input) {
    console.error("Claude returned no tool use result:\n", JSON.stringify(data));
    process.exit(1);
  }
  return toolUse.input;
}

async function summarizeFile(filename, patch) {
  const prompt = `Summarize the following code change as 2-4 bullet points. Each bullet max 10 words. Only what changed, no filler.

File: ${filename}
Diff:
${patch || "(binary or no diff)"}`;

  const summary = await callClaude(prompt);
  return { filename, summary };
}

const ROLLBACK_GUIDANCE = `Rollback guide rules:
- Write 3-5 steps an oncall engineer should check if prod breaks after this PR merges.
- Each step must name a specific file, service, database table, metric, or external dependency from the diff and explain why it is at risk.
- Order by likelihood of failure, highest first.
- If the diff has no prod risk (docs-only, test-only, config comments), return a single step: "Low-risk change — no specific triage needed."`;

const REVIEWER_GUIDANCE = `Reviewer ground rules:
- Only flag issues you can verify in the diff. Do not assume problems that contradict what the code shows.
- GitHub Actions: secrets marked "required: false" are optional — callers are not forced to pass them. Do not flag unused optional secrets as a security issue.
- GitHub Actions: SHA-pinned actions are the supply-chain security mechanism. A missing human-readable version comment is a style preference (low at most), not a vulnerability.
- GitHub Actions: reusable workflows may set timeout-minutes themselves — verify before flagging the caller for omitting it.
- Distinguish bugs (broken logic, real data loss) from style preferences (naming, comments). Style issues are low severity only.
- Concurrency cancel-in-progress: acceptable for AI review jobs; only flag if the diff shows no cleanup mechanism exists.`;

const PONYTAIL_GUIDANCE = `Over-engineering check (ponytail):
- Flag changes that did not need to happen: speculative abstractions, interface with one implementation, config for a value that never changes, boilerplate "for later".
- Flag hand-rolled code that stdlib or an already-installed dep covers. Name the replacement.
- Flag reimplemented helpers or patterns that already exist in the codebase. Name the replacement.
- Flag churn: renames, reformatting, or rewrites that add no behavior. Prefer the smallest diff that works.
- Do NOT demand new abstractions, layers, or "robustness" the PR did not ask for. Reward deletion and simplicity.
- Report these under code_issues, prefixed "over-engineering:". Severity low unless it adds real risk.`;

function buildReviewPrompt(diffOrSummary, ticket) {
  if (!ticket) {
    return `You are a senior code reviewer. Review the following PR diff for code quality only. No Jira ticket — set business_alignment to "skipped".

${REVIEWER_GUIDANCE}

${PONYTAIL_GUIDANCE}

${ROLLBACK_GUIDANCE}

${SCORING_RUBRIC}

=== PR DIFF ===
${diffOrSummary}`;
  }

  return `You are a senior code reviewer. Review the following PR diff against the Jira ticket requirements.

${REVIEWER_GUIDANCE}

${PONYTAIL_GUIDANCE}

${ROLLBACK_GUIDANCE}

${SCORING_RUBRIC}

=== JIRA TICKET: ${ticket.key} ===
Title: ${ticket.summary || "(none)"}
Description & Acceptance Criteria:
${ticket.description || "(none)"}

=== PR DIFF ===
${diffOrSummary}`;
}

async function reviewWithClaude(diff, ticket, files) {
  console.log(`Summarizing ${files.length} file(s)...`);
  const fileSummaries = await Promise.all(
    files.map((f) => summarizeFile(f.filename, f.patch)),
  );

  let diffInput = diff;
  if (countDiffLines(diff) > LARGE_DIFF_THRESHOLD) {
    console.log(
      `Large diff (>${LARGE_DIFF_THRESHOLD} lines) — scoring from summaries...`,
    );
    diffInput = fileSummaries
      .map((s) => `=== ${s.filename} ===\n${s.summary}`)
      .join("\n\n");
  }

  console.log("Scoring...\n");
  const result = await callClaudeReview(buildReviewPrompt(diffInput, ticket));
  return { ...result, fileSummaries };
}

module.exports = { reviewWithClaude };
