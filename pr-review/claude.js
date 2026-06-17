const MODEL = "claude-sonnet-4-6";
const LARGE_DIFF_THRESHOLD = 300;

function countDiffLines(diff) {
  return diff.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-"))
    .length;
}

async function callClaude(prompt, maxTokens = 2048) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
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

async function summarizeFile(filename, patch) {
  const prompt = `Summarize the following code change as 2-4 bullet points. Each bullet max 10 words. Only what changed, no filler.

File: ${filename}
Diff:
${patch || "(binary or no diff)"}`;

  const summary = await callClaude(prompt, 256);
  return { filename, summary };
}

function buildReviewPrompt(diffOrSummary, ticket) {
  if (!ticket) {
    return `You are a senior code reviewer. Review the following PR diff for code quality only. There is no Jira ticket — do not factor business alignment into the score.

=== PR DIFF ===
${diffOrSummary}

Return ONLY a JSON object with this exact structure:
{
  "severity": "critical" | "high" | "medium" | "low",
  "business_alignment": "skipped",
  "missing_requirements": [],
  "code_issues": ["<code-level concern>"],
  "score": <0-100>,
  "summary": "<2-3 sentence human-readable review>"
}`;
  }

  return `You are a senior code reviewer. Review the following PR diff against the Jira ticket requirements.

=== JIRA TICKET: ${ticket.key} ===
Title: ${ticket.summary || "(none)"}
Description & Acceptance Criteria:
${ticket.description || "(none)"}

=== PR DIFF ===
${diffOrSummary}

Return ONLY a JSON object with this exact structure:
{
  "severity": "critical" | "high" | "medium" | "low",
  "business_alignment": "aligned" | "partial" | "misaligned",
  "missing_requirements": ["<AC not addressed>"],
  "code_issues": ["<code-level concern>"],
  "score": <0-100>,
  "summary": "<2-3 sentence human-readable review>"
}`;
}

function extractJSON(text) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inString = false, escape = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(i, j + 1)); } catch {}
          break;
        }
      }
    }
  }
  return null;
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

  console.log("Scoring against Jira ACs...\n");
  const text = await callClaude(buildReviewPrompt(diffInput, ticket));

  const parsed = extractJSON(text);
  if (!parsed) {
    console.error("Claude returned no valid JSON:\n", text);
    process.exit(1);
  }

  return { ...parsed, fileSummaries };
}

module.exports = { reviewWithClaude };
