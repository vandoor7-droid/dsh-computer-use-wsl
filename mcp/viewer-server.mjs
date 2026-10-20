/**
 * The sidebar viewer: a tiny same-origin shell that embeds noVNC and shows who
 * currently owns the pointer.
 *
 * Serving it from the MCP server process (rather than from a DSH host route)
 * keeps the plugin independent of host routing APIs: the sidebar only needs a
 * plain http://127.0.0.1:<port>/ URL, which both `sidebar_open` and
 * `ctx.sidebarRight.openTab('browser')` can show.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const WEB_DIR = new URL('../web/', import.meta.url);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * @param {object} options
 * @param {object} options.settings normalized settings
 * @param {import('./takeover.mjs').ControlState} options.control
 * @param {() => object} options.describe live desktop description
 * @param {(line: string) => void} [options.log]
 */
export async function startViewerServer({ settings, control, describe, log = () => {} }) {
  const token = randomBytes(12).toString('hex');
  const clients = new Set();

  const statePayload = () => ({ ...control.get(), desktop: describe() });

  const broadcast = (payload) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try {
        res.write(frame);
      } catch {
        clients.delete(res);
      }
    }
  };

  const unsubscribe = control.subscribe((snapshot) => broadcast({ ...snapshot, desktop: describe() }));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
    };

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      try {
        let html = await readFile(new URL('viewer.html', WEB_DIR), 'utf8');
        html = html.replace('__WSLCU_TOKEN__', token);
        send(200, html, MIME['.html']);
      } catch (error) {
        send(500, `viewer.html unavailable: ${error.message}`, 'text/plain; charset=utf-8');
      }
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/viewer.js' || url.pathname === '/viewer.css')) {
      try {
        const name = url.pathname.slice(1);
        send(200, await readFile(new URL(name, WEB_DIR), 'utf8'), MIME[url.pathname.slice(url.pathname.lastIndexOf('.'))]);
      } catch (error) {
        send(404, String(error.message), 'text/plain; charset=utf-8');
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      send(200, JSON.stringify(statePayload()));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`retry: 1500\n\n`);
      res.write(`data: ${JSON.stringify(statePayload())}\n\n`);
      clients.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clients.delete(res);
        }
      }, 25000);
      heartbeat.unref?.();
      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/takeover') {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        send(400, JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
      if (body.token !== token) {
        send(403, JSON.stringify({ error: 'bad token' }));
        return;
      }
      const action = String(body.action || '');
      if (!['start', 'stop', 'toggle'].includes(action)) {
        send(400, JSON.stringify({ error: 'action must be start|stop|toggle' }));
        return;
      }
      const current = control.get().state === 'user';
      const next = action === 'toggle' ? !current : action === 'start';
      const snapshot = control.setUserActive(next);
      log(`takeover ${action} -> ${snapshot.state}`);
      send(200, JSON.stringify({ ...snapshot, desktop: describe() }));
      return;
    }

    send(404, JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.viewerPort, settings.bindHost, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : settings.viewerPort;

  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    token,
    close: async () => {
      unsubscribe();
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* already gone */
        }
      }
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
