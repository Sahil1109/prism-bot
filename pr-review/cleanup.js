const fs = require('fs');
const path = require('path');

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

const { cleanupPRismComments } = require('./github');

async function main() {
  const args = process.argv.slice(2);
  const keepArg = args.find(a => a.startsWith('--keep='));
  const keep = keepArg ? parseInt(keepArg.split('=')[1], 10) : 2;
  const positional = args.filter(a => !a.startsWith('--'));

  if (positional.length < 3) {
    console.error('Usage: node cleanup.js <owner> <repo> <pull_number> [--keep=2]');
    process.exit(1);
  }

  const [owner, repo, pullNumberStr] = positional;
  const pullNumber = parseInt(pullNumberStr, 10);

  console.log(`Cleaning up PRism comments on PR #${pullNumber}, keeping ${keep} most recent...`);
  await cleanupPRismComments(owner, repo, pullNumber, keep);
  console.log('Done.');
}

main();
