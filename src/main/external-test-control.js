const http = require('http');

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw || '{}'));
  } catch (_) {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function createExternalTestControl({ invokeIpc, shutdownRuntime, getWindowCount, port = 8788, host = '127.0.0.1' }) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}:${port}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          mode: 'external-test',
          host,
          port,
          windowCount: typeof getWindowCount === 'function' ? getWindowCount() : null
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/invoke') {
        const body = await readBody(req);
        const payload = safeJsonParse(body);
        if (!payload || typeof payload !== 'object') {
          sendJson(res, 400, { success: false, error: 'Invalid JSON payload' });
          return;
        }

        const channel = String(payload.channel || '').trim();
        const args = Array.isArray(payload.args) ? payload.args : [];
        if (!channel) {
          sendJson(res, 400, { success: false, error: 'channel is required' });
          return;
        }

        try {
          const result = await invokeIpc(channel, ...args);
          sendJson(res, 200, { success: true, result });
        } catch (error) {
          sendJson(res, 500, { success: false, error: error.message || String(error) });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/shutdown') {
        sendJson(res, 200, { success: true, shuttingDown: true });
        setTimeout(() => {
          shutdownRuntime().catch(() => {});
        }, 10);
        return;
      }

      sendJson(res, 404, { success: false, error: 'Not found' });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message || String(error) });
    }
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve());
      });
      console.log(`[ExternalTest] Control API listening at http://${host}:${port}`);
    },
    async stop() {
      await new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch (_) {
          resolve();
        }
      });
    }
  };
}

module.exports = {
  createExternalTestControl
};
