// Netlify cloud function: use GitHub Contents API as cloud storage.
// No longer depends on Nutstore WebDAV (163 mail WebDAV writes are locked).
//
// Required env vars (set in Netlify -> Project configuration -> Environment variables):
//   GH_TOKEN   GitHub Personal Access Token (Fine-grained, contents:write scope)
//   GH_REPO    Repository, e.g. "Mengyuan0902/zmy"  (optional, default Mengyuan0902/zmy)
//   GH_BRANCH  Branch name                          (optional, default main)
//   GH_PATH    Sync file path                       (optional, default pwb_data.json)
//   SYNC_KEY   Your own sync key                   (must match the one typed in the App)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key',
  'Access-Control-Max-Age': '86400',
};

const GH_API = 'https://api.github.com';
const DEFAULT_REPO = 'Mengyuan0902/zmy';
const DEFAULT_BRANCH = 'main';
const DEFAULT_PATH = 'pwb_data.json';

function b64encodeUtf8(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}
function b64decodeUtf8(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const token = process.env.GH_TOKEN;
  const key = process.env.SYNC_KEY;
  const repo = process.env.GH_REPO || DEFAULT_REPO;
  const branch = process.env.GH_BRANCH || DEFAULT_BRANCH;
  const path = process.env.GH_PATH || DEFAULT_PATH;

  if (!token) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'server_not_configured', detail: 'missing GH_TOKEN' }) };
  }
  if (!key) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'server_not_configured', detail: 'missing SYNC_KEY' }) };
  }

  const provided = (event.headers['x-sync-key'] || (event.queryStringParameters && event.queryStringParameters.key) || '').trim();
  if (provided !== key) {
    return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const ghHeaders = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pwb-sync/1.0',
  };

  const apiContentsUrl = `${GH_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;

  try {
    if (event.httpMethod === 'GET') {
      const r = await fetch(`${apiContentsUrl}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
      if (r.status === 404) {
        return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: {} }) };
      }
      if (!r.ok) {
        const t = await r.text();
        return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'github_get_' + r.status, detail: t.slice(0, 200) }) };
      }
      const meta = await r.json();
      let data = {};
      try { data = JSON.parse(b64decodeUtf8(meta.content || '')); } catch (e) { data = {}; }
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, sha: meta.sha, size: meta.size, path: meta.path, repo, branch }) };
    }

    if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
      const body = event.body || '{}';
      try { JSON.parse(body); } catch (e) {
        return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'bad_json' }) };
      }

      // Updating an existing file requires sha; new file omits sha.
      let sha = undefined;
      const getR = await fetch(`${apiContentsUrl}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
      if (getR.status === 200) {
        const meta = await getR.json();
        sha = meta.sha;
      } else if (getR.status !== 404) {
        const t = await getR.text();
        return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'github_lookup_' + getR.status, detail: t.slice(0, 200) }) };
      }

      const putPayload = {
        message: `chore(pwb-sync): update ${path} at ${new Date().toISOString()}`,
        content: b64encodeUtf8(body),
        branch: branch,
      };
      if (sha) putPayload.sha = sha;

      const putR = await fetch(apiContentsUrl, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(putPayload),
      });
      if (!putR.ok) {
        const t = await putR.text();
        return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'github_put_' + putR.status, detail: t.slice(0, 200) }) };
      }
      const resp = await putR.json();
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, sha: resp.content && resp.content.sha, ts: Date.now() }) };
    }

    return { statusCode: 405, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'method_not_allowed' }) };
  } catch (e) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'server_error', detail: String(e && e.message || e) }) };
  }
};