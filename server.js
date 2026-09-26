// Matchday Bulletin backend — plain Node.js, zero npm dependencies.
// Public GET /api/events for customers. Admin actions (add/edit/delete/send)
// require the X-Admin-Key header to match ADMIN_PASSWORD.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- tiny .env loader ---
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHAT_ID = process.env.CHAT_ID || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_FILE = path.join(__dirname, 'events.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function loadEvents() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}
function saveEvents(events) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2));
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) req.destroy(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function isAuthed(req) {
  if (!ADMIN_PASSWORD) return false; // no password configured -> admin routes stay locked
  const key = req.headers['x-admin-key'];
  return typeof key === 'string' && key.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_PASSWORD));
}

function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN || !CHAT_ID) {
      return reject(new Error('BOT_TOKEN / CHAT_ID not set on the server'));
    }
    const payload = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, r => {
      let body = '';
      r.on('data', c => (body += c));
      r.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.ok) resolve(parsed);
          else reject(new Error(parsed.description || 'Telegram API error'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'
};

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath.split('?')[0]);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function eventOut(ev) {
  // Customer-facing shape — same data, kept here in case we want to hide fields from
  // the public feed later without touching the storage format.
  return ev;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    // --- public ---
    if (url === '/api/events' && req.method === 'GET') {
      return sendJSON(res, 200, loadEvents().map(eventOut));
    }

    if (url === '/api/admin/login' && req.method === 'POST') {
      const body = await readBody(req);
      const ok = !!ADMIN_PASSWORD && body.password === ADMIN_PASSWORD;
      return sendJSON(res, ok ? 200 : 401, { ok });
    }

    // --- everything below requires the admin key ---
    const needsAuth = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
    if (needsAuth && url.startsWith('/api/events') && !isAuthed(req)) {
      return sendJSON(res, 401, { error: 'Not authorized' });
    }

    if (url === '/api/events' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.match || !String(body.match).trim()) {
        return sendJSON(res, 400, { error: 'match is required' });
      }
      const events = loadEvents();
      const ev = {
        id: crypto.randomBytes(6).toString('hex'),
        match: String(body.match).trim(),
        competition: body.competition ? String(body.competition).trim() : '',
        kickoff: body.kickoff || '',
        date: body.date || new Date().toISOString().slice(0, 10),
        notes: body.notes ? String(body.notes) : '',
        sent: false
      };
      events.push(ev);
      saveEvents(events);
      return sendJSON(res, 201, ev);
    }

    const idMatch = url.match(/^\/api\/events\/([a-f0-9]+)$/);
    if (idMatch && req.method === 'PUT') {
      const body = await readBody(req);
      const events = loadEvents();
      const idx = events.findIndex(e => e.id === idMatch[1]);
      if (idx === -1) return sendJSON(res, 404, { error: 'not found' });
      events[idx] = {
        ...events[idx],
        match: body.match !== undefined ? String(body.match).trim() : events[idx].match,
        competition: body.competition !== undefined ? String(body.competition).trim() : events[idx].competition,
        kickoff: body.kickoff !== undefined ? body.kickoff : events[idx].kickoff,
        date: body.date !== undefined ? body.date : events[idx].date,
        notes: body.notes !== undefined ? String(body.notes) : events[idx].notes
      };
      saveEvents(events);
      return sendJSON(res, 200, events[idx]);
    }

    if (idMatch && req.method === 'DELETE') {
      const events = loadEvents().filter(e => e.id !== idMatch[1]);
      saveEvents(events);
      return sendJSON(res, 200, { ok: true });
    }

    const sendMatch = url.match(/^\/api\/events\/([a-f0-9]+)\/send$/);
    if (sendMatch && req.method === 'POST') {
      const events = loadEvents();
      const idx = events.findIndex(e => e.id === sendMatch[1]);
      if (idx === -1) return sendJSON(res, 404, { error: 'not found' });
      const ev = events[idx];
      const lines = [
        `*${ev.match}*`,
        ev.competition ? `${ev.competition}` : '',
        ev.kickoff ? `Kickoff: ${ev.kickoff}` : '',
        ev.notes || ''
      ].filter(Boolean);
      await sendTelegramMessage(lines.join('\n'));
      events[idx].sent = true;
      saveEvents(events);
      return sendJSON(res, 200, events[idx]);
    }

    if (req.method === 'GET') return serveStatic(req, res);

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    return sendJSON(res, 502, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Matchday Bulletin running on http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.log('⚠️  ADMIN_PASSWORD not set — admin actions are locked until you set one.');
  if (!BOT_TOKEN || !CHAT_ID) console.log('⚠️  BOT_TOKEN / CHAT_ID not set — Send will fail until you set these.');
});
