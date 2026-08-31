import { createServer } from 'node:http';
import { URL } from 'node:url';
import { createCanvas, joinSession } from '@github/copilot-sdk/extension';

const repository = 'matsujirushi/tailspin-toys';
const servers = new Map();

function scoreIssue(issue) {
  const labels = issue.labels.map((label) => label.name.toLowerCase());
  let score = issue.comments * 2;
  score += Math.min(30, Math.floor((Date.now() - Date.parse(issue.created_at)) / 86_400_000));
  if (labels.some((label) => /bug|critical|urgent|security/.test(label))) score += 100;
  if (labels.some((label) => /enhancement|feature/.test(label))) score += 10;
  return score;
}

function triageIssues(issues) {
  return issues
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({ ...issue, triageScore: scoreIssue(issue) }))
    .sort((left, right) => right.triageScore - left.triageScore)
    .map((issue, index) => ({
      ...issue,
      priority: index < 3 ? 'attention' : 'backlog',
      justification:
        index < 3
          ? 'High triage score: active discussion, age, or a priority label indicates this may be blocking progress.'
          : 'Lower relative triage score; keep visible for follow-up after the urgent queue.',
    }));
}

async function loadIssues() {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/issues?state=open&per_page=100`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'issue-triage-board' } },
  );
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return triageIssues(await response.json());
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Issue triage board</title>
  <style>
    :root { color-scheme: light dark; font-family: var(--font-sans, system-ui, sans-serif); }
    body { margin: 0; padding: 24px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); }
    h1, h2, p { margin-top: 0; } h1 { font-size: 24px; } h2 { margin-bottom: 12px; font-size: 16px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: start; margin-bottom: 24px; }
    .muted { color: var(--text-color-muted, #656d76); font-size: 13px; }
    .board { display: grid; gap: 24px; } .column { display: grid; gap: 12px; }
    .card { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 10px; padding: 16px; background: var(--background-color-muted, #f6f8fa); }
    .card h3 { margin: 0 0 8px; font-size: 15px; } .card p { margin-bottom: 10px; line-height: 1.45; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .tag { border-radius: 999px; padding: 3px 8px; font-size: 12px; background: var(--background-color-neutral-muted, #ddf4ff); }
    button { border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; color: var(--color-white, #fff); background: var(--true-color-blue, #0969da); }
    button:hover { filter: brightness(1.1); } button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
    button[disabled] { opacity: .65; cursor: wait; } .error { color: var(--true-color-red, #cf222e); }
  </style>
</head>
<body>
  <header><div><h1>Issue triage board</h1><p class="muted">Open issues ranked by urgency, activity, and age.</p></div><button id="refresh" type="button">Refresh</button></header>
  <main id="board" class="board" aria-live="polite"><p>Loading issues…</p></main>
  <script>
    const board = document.querySelector('#board');
    const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
    const card = (issue) => '<article class="card"><h3><a href="' + escape(issue.html_url) + '" target="_blank" rel="noreferrer">#' + issue.number + ' ' + escape(issue.title) + '</a></h3><div class="meta"><span class="tag">' + issue.comments + ' comments</span>' + issue.labels.map((label) => '<span class="tag">' + escape(label.name) + '</span>').join('') + '</div><p>' + escape(issue.body || 'No description provided.') + '</p><p class="muted"><strong>Why here:</strong> ' + escape(issue.justification) + '</p><button type="button" data-number="' + issue.number + '" data-title="' + escape(issue.title) + '">Add to current context</button></article>';
    async function refresh() {
      board.innerHTML = '<p>Loading issues…</p>';
      try {
        const response = await fetch('/api/issues');
        if (!response.ok) throw new Error('Unable to load GitHub issues.');
        const issues = await response.json();
        const urgent = issues.filter((issue) => issue.priority === 'attention');
        const backlog = issues.filter((issue) => issue.priority !== 'attention');
        board.innerHTML = '<section class="column"><h2>Needs attention now (' + urgent.length + ')</h2>' + (urgent.map(card).join('') || '<p class="muted">No open issues found.</p>') + '</section><section class="column"><h2>Remaining issues (' + backlog.length + ')</h2>' + (backlog.map(card).join('') || '<p class="muted">No remaining issues.</p>') + '</section>';
      } catch (error) { board.innerHTML = '<p class="error">' + escape(error.message) + '</p>'; }
    }
    board.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-number]');
      if (!button) return;
      button.disabled = true;
      try {
        const response = await fetch('/api/add', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ number: button.dataset.number, title: button.dataset.title }) });
        if (!response.ok) throw new Error('Unable to add issue to context.');
        button.textContent = 'Added to current context';
      } catch (error) { button.disabled = false; button.textContent = error.message; }
    });
    document.querySelector('#refresh').addEventListener('click', refresh);
    refresh();
  </script>
</body>
</html>`;
}

async function startServer(session) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/api/issues') {
        const issues = await loadIssues();
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(issues));
        return;
      }
      if (url.pathname === '/api/add' && request.method === 'POST') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const issue = JSON.parse(body);
        await session.send({ prompt: `Add GitHub issue #${issue.number} (${issue.title}) to the current working context and start triaging it.` });
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ added: true }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderHtml());
    } catch (error) {
      await session.log(`Issue triage board error: ${error.message}`, { level: 'error' });
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Request failed.' }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/` };
}

const session = await joinSession({
  canvases: [
    createCanvas({
      id: 'issue-triage-board',
      displayName: 'Issue triage board',
      description: 'Kanban board for prioritizing open repository issues and adding one to the current session context.',
      actions: [
        {
          name: 'refresh_issues',
          description: 'Fetch and return the currently open issues ranked for triage.',
          handler: async () => ({ repository, issues: await loadIssues() }),
        },
        {
          name: 'add_issue_to_context',
          description: 'Add a selected GitHub issue to the current session context.',
          inputSchema: { type: 'object', properties: { number: { type: 'integer' }, title: { type: 'string' } }, required: ['number', 'title'] },
          handler: async (ctx) => {
            await session.send({ prompt: `Add GitHub issue #${ctx.input.number} (${ctx.input.title}) to the current working context and start triaging it.` });
            return { added: true, number: ctx.input.number };
          },
        },
      ],
      open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
          entry = await startServer(session);
          servers.set(ctx.instanceId, entry);
        }
        return { title: 'Issue triage board', url: entry.url };
      },
      onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (entry) {
          servers.delete(ctx.instanceId);
          await new Promise((resolve) => entry.server.close(resolve));
        }
      },
    }),
  ],
});
