const JIRA_BASE = 'https://redbelly.atlassian.net';

function adfToText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.content) return node.content.map(adfToText).join('\n');
  return '';
}

async function fetchJiraTicket(ticketKey) {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  const res = await fetch(
    `${JIRA_BASE}/rest/api/3/issue/${ticketKey}?fields=summary,description`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }
  );

  if (!res.ok) {
    const body = await res.text();
    console.warn(`Jira API error ${res.status}: ${body} — skipping Jira context.`);
    return null;
  }

  const data = await res.json();
  const summary = data.fields.summary || '';
  const description = adfToText(data.fields.description);

  return { key: ticketKey, summary, description };
}

module.exports = { fetchJiraTicket };
