/* Sidebar shell: embeds noVNC and mirrors the control state machine. */
(() => {
  const token = document.querySelector('meta[name="wslcu-token"]').content;
  const el = {
    pill: document.getElementById('pill'),
    pillText: document.getElementById('pillText'),
    pillTool: document.getElementById('pillTool'),
    btn: document.getElementById('takeover'),
    frame: document.getElementById('screen'),
    empty: document.getElementById('empty'),
    meta: document.getElementById('meta'),
    conn: document.getElementById('conn'),
    raw: document.getElementById('rawLink'),
    since: document.getElementById('since'),
  };

  const LABEL = { idle: '空闲', agent: 'DSH 操作中', user: '你正在操作' };
  let lastFrameSrc = '';
  let lastKey = '';

  function setFrame(url) {
    if (!url || url === lastFrameSrc) return;
    lastFrameSrc = url;
    el.frame.src = url;
    el.raw.href = url;
    el.empty.hidden = true;
  }

  function render(state) {
    const s = state.state || 'idle';
    const desktop = state.desktop || {};

    el.pill.dataset.state = s;
    el.pillText.textContent = LABEL[s] || s;
    el.pillTool.textContent = s === 'agent' && state.tool ? `· ${state.tool}` : '';

    const takingOver = s === 'user';
    el.btn.textContent = takingOver ? '交还给 DSH' : '我要接管';
    el.btn.dataset.mode = takingOver ? 'user' : 'agent';

    el.conn.dataset.live = desktop.ready ? '1' : '0';
    el.meta.textContent = desktop.ready
      ? `${desktop.resolution || ''} · ${desktop.display || ''} · ${desktop.owned ? '本插件启动' : '复用已有桌面'}`
      : '未启动';

    if (state.since) {
      const secs = Math.max(0, Math.round((Date.now() - state.since) / 1000));
      el.since.textContent = s === 'idle' ? '' : `${secs}s`;
    }

    if (desktop.ready && desktop.sidebarUrl) {
      setFrame(desktop.sidebarUrl);
    } else {
      el.empty.hidden = false;
      el.conn.dataset.live = '0';
    }
  }

  async function post(action) {
    el.btn.disabled = true;
    try {
      const response = await fetch('/takeover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, token }),
      });
      if (!response.ok) throw new Error(await response.text());
      render(await response.json());
    } catch (error) {
      el.since.textContent = `接管失败：${error.message}`;
    } finally {
      el.btn.disabled = false;
    }
  }

  el.btn.addEventListener('click', () => {
    post(el.pill.dataset.state === 'user' ? 'stop' : 'start');
  });

  // Seed once so a stale SSE connection still shows something.
  fetch('/state')
    .then((r) => r.json())
    .then(render)
    .catch(() => {});

  let source = null;
  let retry = 0;

  function connect() {
    source = new EventSource('/events');
    source.onopen = () => {
      retry = 0;
    };
    source.onmessage = (event) => {
      try {
        const state = JSON.parse(event.data);
        const key = `${state.state}|${state.tool}|${state.desktop?.ready}|${state.desktop?.sidebarUrl}`;
        if (key !== lastKey) {
          lastKey = key;
          render(state);
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    source.onerror = () => {
      source.close();
      // Fallback polling keeps the badge honest when SSE is unavailable.
      fetch('/state').then((r) => r.json()).then(render).catch(() => {});
      const delay = Math.min(15000, 1000 * 2 ** retry++);
      setTimeout(connect, delay);
    };
  }

  connect();
})();
