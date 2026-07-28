// Netlify Function: 中转代理，浏览器同源调用，由本函数用服务器身份读写坚果云 WebDAV
// 环境变量（在 Netlify 后台设置，绝不出现在浏览器）：
//   NUTSTORE_USER = 坚果云邮箱
//   NUTSTORE_PASS = 坚果云「应用密码」（设置→安全→第三方应用管理里生成）
//   SYNC_KEY      = 自定义共享密钥，用于校验调用方
const DAV_BASE = 'https://dav.jianguoyun.com/dav/';
const DIR = 'pwb_sync';
const FILE = 'pwb_data.json';
const DIR_URL = DAV_BASE + DIR + '/';
const FILE_URL = DAV_BASE + DIR + '/' + FILE;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-sync-key',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
};

function authHeader() {
  const u = process.env.NUTSTORE_USER || '';
  const p = process.env.NUTSTORE_PASS || '';
  return 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
}

// 坚果云根目录常为 WebDAV 只读，子目录可写。先 MKCOL 创建子目录（已存在会返回 405/409，忽略即可）。
async function ensureDir(headers) {
  try {
    await fetch(DIR_URL, { method: 'MKCOL', headers });
  } catch (e) {}
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  const user = process.env.NUTSTORE_USER;
  const pass = process.env.NUTSTORE_PASS;
  const key = process.env.SYNC_KEY;
  if (!user || !pass || !key) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'server_not_configured' }) };
  }
  const provided = event.headers['x-sync-key'] || (event.queryStringParameters && event.queryStringParameters.key);
  if (provided !== key) {
    return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const headers = { Authorization: authHeader(), 'Content-Type': 'application/json' };

  try {
    if (event.httpMethod === 'GET') {
      const r = await fetch(FILE_URL, { headers });
      if (r.status === 404) {
        return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }) };
      }
      if (!r.ok) {
        return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'nutstore_' + r.status }) };
      }
      const text = await r.text();
      let data = {};
      try { data = JSON.parse(text); } catch (e) { data = {}; }
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) };
    }

    if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
      let body = event.body || '{}';
      try { JSON.parse(body); } catch (e) {
        return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'bad_json' }) };
      }
      await ensureDir(headers);
      const r = await fetch(FILE_URL, { method: 'PUT', headers, body });
      if (r.status !== 200 && r.status !== 201 && r.status !== 204 && r.status !== 207) {
        return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'nutstore_' + r.status }) };
      }
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'method_not_allowed' }) };
  } catch (e) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
