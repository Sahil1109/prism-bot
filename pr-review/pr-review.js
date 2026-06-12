const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {}

const { fetchPRDiff, postPRComment, approvePR, PRISM_SIGNATURE } = require('./github');
const { fetchJiraTicket } = require('./jira');
const { reviewWithClaude } = require('./claude');

const REQUIRED_ENV = ['JIRA_EMAIL', 'JIRA_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY'];
const PRISM_REPO_URL = 'https://github.com/redbellynetwork/prism-bot';

const SEVERITY_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const ALIGNMENT_EMOJI = { aligned: '✅', misaligned: '❌', partial: '🔶', skipped: '⏭️', unknown: '❓' };

function scoreEmoji(score) {
  if (score >= 90) return '🏆';
  if (score >= 70) return '✅';
  if (score >= 50) return '⚠️';
  return '❌';
}

function checkEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

function extractJiraKey(str) {
  const match = str && str.match(/([A-Z][A-Z0-9]*-\d+)/);
  return match ? match[1] : null;
}

function fileDiffUrl(owner, repo, pullNumber, filename) {
  const hash = crypto.createHash('sha256').update(filename).digest('hex');
  return `https://github.com/${owner}/${repo}/pull/${pullNumber}/files#diff-${hash}`;
}

function formatComment(result, prUrl, owner, repo, pullNumber) {
  const scoreBar = '█'.repeat(Math.round(result.score / 10)) + '░'.repeat(10 - Math.round(result.score / 10));
  const sevEmoji = SEVERITY_EMOJI[result.severity] ?? '⚪';
  const aliEmoji = ALIGNMENT_EMOJI[result.business_alignment] ?? '❓';
  const emoji = scoreEmoji(result.score);

  const lines = [
    `## 🔷 PRism Review`,
    '',
    `| Score | Severity | Business Alignment |`,
    `|:---:|:---:|:---:|`,
    `| ${emoji} **${result.score}**/100 | ${sevEmoji} \`${result.severity}\` | ${aliEmoji} \`${result.business_alignment}\` |`,
    '',
    `\`${scoreBar}\``,
    '',
    `### Summary`,
    result.summary,
  ];

  if (result.missing_requirements?.length) {
    lines.push(
      '',
      `<details>`,
      `<summary>⚠️ Missing Requirements (${result.missing_requirements.length})</summary>`,
      '',
      ...result.missing_requirements.map(r => `- ${r}`),
      '',
      `</details>`
    );
  }

  if (result.code_issues?.length) {
    lines.push(
      '',
      `<details>`,
      `<summary>🔍 Code Issues (${result.code_issues.length})</summary>`,
      '',
      ...result.code_issues.map(i => `- ${i}`),
      '',
      `</details>`
    );
  }

  if (result.fileSummaries?.length) {
    const fileLines = [];
    result.fileSummaries.forEach(({ filename, summary }) => {
      const url = fileDiffUrl(owner, repo, pullNumber, filename);
      fileLines.push(`\n#### \`${filename}\` — [↗ view diff](${url})`, summary);
    });
    lines.push(
      '',
      `<details>`,
      `<summary>📂 File Changes (${result.fileSummaries.length} files)</summary>`,
      ...fileLines,
      '',
      `</details>`
    );
  }

  lines.push('', `---`, `${PRISM_SIGNATURE}(${PRISM_REPO_URL}) 🤖 • [View PR](${prUrl})*`);
  return lines.join('\n');
}

async function main() {
  checkEnv();

  const args = process.argv.slice(2);
  const commentFlag = args.includes('--comment');
  const approveArg = args.find(a => a.startsWith('--approve'));
  const approveThreshold = approveArg
    ? parseInt(approveArg.split('=')[1] ?? '80', 10)
    : null;
  const positional = args.filter(a => !a.startsWith('--'));

  if (positional.length < 3) {
    console.error('Usage: node pr-review.js <owner> <repo> <pull_number> [--comment] [--approve=80]');
    process.exit(1);
  }

  const [owner, repo, pullNumberStr] = positional;
  const pullNumber = parseInt(pullNumberStr, 10);

  console.log(`\nFetching PR #${pullNumber} from ${owner}/${repo}...`);
  const pr = await fetchPRDiff(owner, repo, pullNumber);

  const jiraKey = extractJiraKey(pr.branch) || extractJiraKey(pr.title);

  let ticket = null;
  if (jiraKey) {
    console.log(`Found Jira key: ${jiraKey} — fetching ticket...`);
    ticket = await fetchJiraTicket(jiraKey);
  } else {
    console.warn('No Jira key found in branch name or PR title — skipping business alignment.');
  }

  console.log('Sending to Claude for review...\n');
  const result = await reviewWithClaude(pr.diff, ticket, pr.files);

  if (!jiraKey) result.business_alignment = 'skipped';

  console.log('═'.repeat(50));
  console.log('  PR REVIEW RESULT');
  console.log('═'.repeat(50));
  console.log(`  Score:              ${result.score}/100`);
  console.log(`  Severity:           ${result.severity}`);
  console.log(`  Business Alignment: ${result.business_alignment}`);
  console.log('─'.repeat(50));
  console.log(`  Summary:\n  ${result.summary}`);

  if (result.missing_requirements?.length) {
    console.log('\n  Missing Requirements:');
    result.missing_requirements.forEach(r => console.log(`    • ${r}`));
  }

  if (result.code_issues?.length) {
    console.log('\n  Code Issues:');
    result.code_issues.forEach(i => console.log(`    • ${i}`));
  }

  console.log('═'.repeat(50));
  console.log('\nFull JSON:');
  console.log(JSON.stringify(result, null, 2));

  if (commentFlag) {
    console.log('\nPosting comment to PR...');
    const { url: commentUrl } = await postPRComment(owner, repo, pullNumber, formatComment(result, pr.url, owner, repo, pullNumber));
    console.log(`Comment posted: ${commentUrl}`);
  }

  if (approveThreshold !== null) {
    const isCritical = result.severity === 'critical';
    const isMisaligned = result.business_alignment === 'misaligned';
    const scoreOk = result.score >= approveThreshold;

    const blocked = [];
    if (!scoreOk)     blocked.push(`score ${result.score} < ${approveThreshold}`);
    if (isCritical)   blocked.push('severity is critical');
    if (isMisaligned) blocked.push('business alignment is misaligned');

    if (blocked.length === 0) {
      console.log(`\nAll checks passed — approving PR...`);
      const reviewUrl = await approvePR(
        owner, repo, pullNumber,
        `✅ Auto-approved by PRism (score: ${result.score}/100, severity: ${result.severity}, alignment: ${result.business_alignment})`
      );
      console.log(`PR approved: ${reviewUrl}`);
    } else {
      console.log(`\nApproval blocked: ${blocked.join('; ')}`);
    }
  }
}

main();
