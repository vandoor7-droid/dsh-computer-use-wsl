// Browser module for the DSH web shell.
//
// Two surfaces, both registered defensively (every host seam is looked up at
// runtime and every registration is wrapped, so a DSH build that renamed a slot
// loses one widget but never breaks the web app):
//
//   1. `plugins.item`  — the configuration form ON THE PLUGIN PAGE (not the
//      settings page): WSL memory/cores/swap, where the distro data and the
//      artifacts live, and the idle-release window. Values are read from the
//      host's configForms scope and written back through savePatch.
//   2. `conversation.input.dock` — the live WSL status badge in the chat dock:
//      未启动 / 空闲 / DSH 操作中 / 已人工接管 / 已释放, fed by the host-side
//      `/api/wslcu/status` route.

window.__ModuleLoader__.load({
  id: 'dsh-computer-use-wsl',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const NS = 'wslComputerUse';
    const STATUS_URL = '/api/wslcu/status';
    const POLL_MS = 2000;

// The composer card carries its own max width (content + 2×clearance) and is
// centred in the dock; mirror that centring so the chip sits on the card's edge.
const CHIP_ALIGN_PADDING = 'calc(max(0px, (100% - var(--dsh-composer-card-max-width, 712px)) / 2))';

    const LABEL = { off: '未启动', idle: '空闲', agent: 'DSH 操作中', user: '已人工接管', released: '已释放' };
    const TONE = {
      off: '#8b93a7',
      idle: '#2ecc71',
      agent: '#4d8bfe',
      user: '#f5a623',
      released: '#9b59b6',
    };

    const MUTED = 'var(--dsh-text-secondary, #8b93a7)';
    const BORDER = 'var(--dsh-border, #262b38)';

    const FIELD_STYLE = {
      padding: '6px 8px',
      borderRadius: 6,
      border: `1px solid ${BORDER}`,
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      minWidth: 160,
    };

    /* ------------------------------------------------------- settings form */

    const FIELDS = [
      {
        key: 'wslMemoryGb',
        label: 'WSL2 内存上限（GB）',
        kind: 'number',
        min: 1,
        max: 128,
        step: 1,
        hint: '写入 .wslconfig 的 [wsl2] memory，对所有 WSL 发行版生效；需重启 WSL 后生效。',
      },
      {
        key: 'wslProcessors',
        label: 'WSL2 逻辑核心数',
        kind: 'number',
        min: 1,
        max: 64,
        step: 1,
        hint: '写入 [wsl2] processors；不能超过本机物理/逻辑核心总数。',
      },
      {
        key: 'wslSwapGb',
        label: 'Swap 大小（GB，0 = 不分配）',
        kind: 'number',
        min: 0,
        max: 256,
        step: 1,
        hint: '写入 [wsl2] swap。',
      },
      {
        key: 'autoMemoryReclaim',
        label: '空闲内存回收策略',
        kind: 'select',
        options: [
          ['disabled', 'disabled（关闭）'],
          ['gradual', 'gradual（渐进回收）'],
          ['dropcache', 'dropcache（直接回收缓存）'],
        ],
        hint: '写入 [wsl2] autoMemoryReclaim。',
      },
      {
        key: 'distroDataDir',
        label: '发行版磁盘落盘目录',
        kind: 'text',
        placeholder: 'D:\\WSL\\UbuntuLab（留空 = 系统默认）',
        hint: '只记录目标位置。真正搬迁数据要显式调用 wsl_move_distro 工具（官方 wsl --manage --move）。',
      },
      {
        key: 'windowsOutputDir',
        label: '产物落盘目录（Windows）',
        kind: 'text',
        placeholder: 'D:\\WSL-CU\\output（留空 = LOCALAPPDATA\\wslcu\\output）',
        hint: '截图 / 导出 / 体检备份等 Windows 侧产物写到这里。',
      },
      {
        key: 'idleReleaseMin',
        label: '闲置自动释放（分钟，0 = 不释放）',
        kind: 'number',
        min: 0,
        max: 1440,
        step: 1,
        hint: '超过 N 分钟没有任何 mcp__wslcu__* 调用就终止本发行版释放内存；下次调用自动冷启动。',
      },
    ];

    function numberOr(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    function normalizeDraft(raw = {}) {
      return {
        wslMemoryGb: numberOr(raw.wslMemoryGb, 4),
        wslProcessors: numberOr(raw.wslProcessors, 2),
        wslSwapGb: numberOr(raw.wslSwapGb, 2),
        autoMemoryReclaim: String(raw.autoMemoryReclaim || 'disabled'),
        distroDataDir: String(raw.distroDataDir || ''),
        windowsOutputDir: String(raw.windowsOutputDir || ''),
        idleReleaseMin: numberOr(raw.idleReleaseMin, 30),
      };
    }

    function Field({ field, value, disabled, onChange }) {
      const control =
        field.kind === 'select'
          ? h(
              'select',
              { value, disabled, onChange: (e) => onChange(e.target.value), style: FIELD_STYLE },
              field.options.map(([v, text]) => h('option', { key: v, value: v }, text)),
            )
          : h('input', {
              type: field.kind === 'number' ? 'number' : 'text',
              value,
              min: field.min,
              max: field.max,
              step: field.step,
              placeholder: field.placeholder,
              disabled,
              spellCheck: false,
              onChange: (e) =>
                onChange(field.kind === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value),
              style: { ...FIELD_STYLE, width: field.kind === 'number' ? 110 : 280 },
            });

      return h(
        'label',
        { style: { display: 'grid', gap: 4, padding: '10px 0', borderTop: `1px solid ${BORDER}` } },
        h('span', { style: { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' } },
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, field.label),
          control),
        field.hint ? h('span', { style: { fontSize: 12, lineHeight: 1.5, color: MUTED } }, field.hint) : null,
      );
    }

    function SettingsCard(props) {
      const { scope, savePatch, t, openViewer } = props;
      const snapshot = React.useSyncExternalStore(
        (listener) => scope.subscribe(listener),
        () => scope.getSnapshot(),
      );
      const ready = snapshot && (snapshot.status === undefined ? snapshot.value !== undefined : snapshot.status === 'ready');
      const writable = Boolean(snapshot && snapshot.writable);
      const saved = React.useMemo(() => normalizeDraft(snapshot?.value || {}), [snapshot?.value]);
      const [draft, setDraft] = React.useState(saved);
      const [dirty, setDirty] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState('');
      const [tone, setTone] = React.useState('');

      const savedKey = JSON.stringify(saved);
      React.useEffect(() => {
        if (!dirty) setDraft(saved);
      }, [savedKey, dirty]);

      if (!ready) {
        return h('div', { style: { padding: '8px 0', fontSize: 13, color: MUTED } },
          '配置尚未加载：请确认插件已挂载为 bundle 行，然后刷新页面。');
      }

      const change = (key, value) => {
        const next = { ...draft, [key]: value };
        setDraft(next);
        setDirty(Object.keys(saved).some((k) => String(next[k]) !== String(saved[k])));
        setMessage('');
      };

      const save = async () => {
        setBusy(true);
        setMessage('');
        const patch = {};
        for (const { key } of FIELDS) {
          if (String(draft[key]) !== String(saved[key])) patch[key] = draft[key];
        }
        try {
          await savePatch(patch);
          setDirty(false);
          setTone('success');
          setMessage('已保存');
        } catch (error) {
          setTone('error');
          setMessage(`保存失败：${error && (error.message || error)}`);
        } finally {
          setBusy(false);
        }
      };

      return h(
        'div',
        { style: { display: 'grid', gap: 4, padding: '4px 0' } },
        h('div', { style: { fontSize: 13, color: MUTED, lineHeight: 1.6 } },
          'WSL / Linux 虚拟桌面。性能与位置项写入 .wslconfig（对该用户的所有 WSL 发行版生效，重启 WSL 后生效）；闲置释放只终止本插件管理的发行版。'),
        ...FIELDS.map((field) =>
          h(Field, {
            key: field.key,
            field,
            value: draft[field.key],
            disabled: !writable || busy,
            onChange: (value) => change(field.key, value),
          })),
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', paddingTop: 12 } },
          h('button', {
            type: 'button',
            onClick: save,
            disabled: !writable || busy || !dirty,
            style: {
              padding: '6px 16px',
              borderRadius: 6,
              border: '1px solid #4d8bfe',
              background: dirty && writable ? '#4d8bfe' : 'transparent',
              color: dirty && writable ? '#fff' : '#4d8bfe',
              cursor: dirty && writable ? 'pointer' : 'default',
              font: 'inherit',
            },
          }, busy ? '保存中…' : '保存'),
          h('button', {
            type: 'button',
            onClick: () => openViewer && openViewer(),
            style: {
              padding: '6px 16px',
              borderRadius: 6,
              border: `1px solid ${BORDER}`,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              font: 'inherit',
            },
          }, '打开查看器'),
          !writable
            ? h('span', { style: { fontSize: 12, color: MUTED } }, '配置为只读')
            : null,
          message
            ? h('span', {
                role: 'status',
                style: { fontSize: 12, color: tone === 'error' ? '#e74c3c' : '#2ecc71' },
              }, message)
            : null,
        ),
      );
    }

    /* --------------------------------------------------------- status badge */

    /** '#rrggbb' -> 'rgba(r, g, b, a)' so a state colour can tint a chip. */
    function tintOf(hex, alpha) {
      const value = String(hex).replace('#', '');
      const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
      const int = Number.parseInt(full, 16);
      if (!Number.isFinite(int)) return `rgba(139, 147, 167, ${alpha})`;
      return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
    }

    /** Only the idle state has a meaningful "released in N minutes" hint. */
    function idleCountdown(snapshot, state) {
      if (state !== 'idle' || !snapshot) return '';
      const minutes = Number(snapshot.idleReleaseMin);
      const last = Number(snapshot.lastActivityAt);
      const now = Number(snapshot.at);
      if (!(minutes > 0) || !(last > 0) || !(now > 0)) return '';
      const left = minutes * 60000 - (now - last);
      if (left <= 0) return '即将释放';
      return `约 ${Math.max(1, Math.round(left / 60000))} 分钟后释放`;
    }

    function StatusBadge(props) {
      const [status, setStatus] = React.useState(null);
      const [failed, setFailed] = React.useState(false);
      const [hover, setHover] = React.useState(false);
      const [pulse, setPulse] = React.useState(false);
      const openViewer = props && props.openViewer;

      React.useEffect(() => {
        let alive = true;
        let timer;
        const tick = async () => {
          try {
            const res = await fetch(STATUS_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(String(res.status));
            const body = await res.json();
            if (alive) {
              setStatus(body);
              setFailed(false);
            }
          } catch {
            if (alive) {
              setStatus(null);
              setFailed(true);
            }
          } finally {
            if (alive) timer = setTimeout(tick, POLL_MS);
          }
        };
        tick();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, []);

      const state = status && status.state ? status.state : failed ? 'off' : null;
      const label = state ? LABEL[state] || state : '检测中…';
      const color = state ? TONE[state] || MUTED : MUTED;
      const detail = status && status.detail ? ` · ${status.detail}` : '';
      const countdown = idleCountdown(status, state);
      const clickable = Boolean(openViewer);
      // Only a live desktop has something to say with motion;静止本身就是信息.
      const animated = state === 'agent' || state === 'user';

      React.useEffect(() => {
        if (!animated) {
          setPulse(false);
          return undefined;
        }
        // Re-checked every beat so toggling the OS setting takes effect without
        // a listener: reduce motion means no breathing at all.
        const timer = setInterval(() => {
          let reduce = false;
          try {
            reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          } catch {
            reduce = false;
          }
          setPulse(reduce ? false : (value) => !value);
        }, 700);
        return () => clearInterval(timer);
      }, [animated]);

      const glow = animated;
      const haloSpread = pulse ? 5 : 3;
      const haloAlpha = pulse ? 0.28 : 0.16;

      const chip = h(
        'button',
        {
          type: 'button',
          onClick: () => clickable && openViewer(),
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          title: status
            ? `WSL 子系统：${label}${detail}${countdown ? `（${countdown}）` : ''}
闲置 ${status.idleReleaseMin} 分钟后释放；点击打开查看器`
            : 'WSL 子系统状态不可用（宿主路由未挂载）',
          style: {
            alignSelf: 'flex-start',
            width: 'fit-content',
            maxWidth: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            margin: 0,
            padding: '4px 11px 4px 9px',
            borderRadius: 999,
            border: `1px solid ${tintOf(color, hover && clickable ? 0.55 : 0.38)}`,
            background: tintOf(color, hover && clickable ? 0.22 : 0.14),
            color: 'inherit',
            font: 'inherit',
            fontSize: 12,
            fontWeight: 500,
            lineHeight: '16px',
            whiteSpace: 'nowrap',
            cursor: clickable ? 'pointer' : 'default',
            transition: 'background 120ms ease, border-color 120ms ease, box-shadow 700ms ease',
            boxShadow: animated && pulse ? `0 0 0 3px ${tintOf(color, 0.1)}` : 'none',
          },
        },
        h('span', {
          'aria-hidden': true,
          style: {
            display: 'inline-block',
            flex: '0 0 auto',
            width: 6,
            height: 6,
            borderRadius: 3,
            background: color,
            transform: glow && pulse ? 'scale(1.35)' : 'scale(1)',
            transition: 'transform 700ms ease, box-shadow 700ms ease',
            boxShadow: glow ? `0 0 0 ${haloSpread}px ${tintOf(color, haloAlpha)}` : 'none',
          },
        }),
        h('span', null, label),
        detail ? h('span', { style: { color: MUTED } }, detail) : null,
        countdown ? h('span', { style: { color: MUTED, fontWeight: 400 } }, countdown) : null,
      );

      // The dock is a stretched flex column; the composer card itself is centred
      // with a side clearance. Mirror both so the chip lines up with the card
      // instead of hanging off its left edge (measured: 16px out before this).
      const wrapper = h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'flex-start',
            width: '100%',
            boxSizing: 'border-box',
            paddingLeft: CHIP_ALIGN_PADDING,
            paddingRight: CHIP_ALIGN_PADDING,
            marginBottom: 6,
          },
        },
        chip,
      );
      return wrapper;
    }
    /* ------------------------------------------------------------- mounting */

    const apply = (ctx) => {
      let sidebar = null;
      let modernRemote = null;

      try {
        ctx.inject(['sidebarRight'], (owner) => {
          sidebar = owner.sidebarRight;
          return () => {
            sidebar = null;
          };
        });
      } catch {
        /* no sidebar service on this host */
      }
      try {
        ctx.inject(['remote', 'remote.settings'], (owner) => {
          modernRemote = owner.remote.settings;
          return () => {
            modernRemote = null;
          };
        });
      } catch {
        /* older host */
      }

      const openViewer = () => {
        const url = 'http://127.0.0.1:6081/';
        try {
          if (sidebar && typeof sidebar.openTab === 'function') {
            sidebar.openTab('browser', { params: { url } });
            return;
          }
        } catch {
          /* fall through */
        }
        try {
          window.open(url, '_blank', 'noopener');
        } catch {
          /* nothing else to try */
        }
      };

      const mountSettings = (scope, owner, namespace) => {
        if (!scope || typeof scope.subscribe !== 'function') return;
        const connection = typeof scope.mutate === 'function' ? undefined : owner && owner.connection;

        const savePatch = async (patch) => {
          const entries = () => Object.entries(patch).map(([field, value]) => ({ op: 'set', path: [field], value }));
          const current = scope.getSnapshot();
          if (current && current.status !== undefined && current.status !== 'ready') {
            throw new Error('配置尚未加载');
          }
          if (modernRemote && owner && owner.configForms) {
            const response = await modernRemote.mutate(namespace, entries(), current && current.revision);
            if (response && response.ok) owner.configForms.describe().acceptView(response.value);
            else await owner.configForms.describe().load();
            if (!response || !response.ok) throw new Error((response && response.error && (response.error.message || response.error.code)) || '保存失败');
            return;
          }
          if (typeof scope.mutate === 'function') {
            const accepted = await scope.mutate(entries(), scope.getSnapshot().revision);
            if (!accepted) throw new Error('保存失败');
            return;
          }
          if (connection && connection.api && connection.api.settings && connection.api.settings.mutate) {
            const snapshot = scope.getSnapshot();
            const response = await connection.api.settings.mutate({
              ns: namespace,
              ops: entries(),
              ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
            });
            if (!response || !response.result || !response.result.ok) {
              throw new Error((response && response.result && (response.result.message || response.result.error)) || '保存失败');
            }
            await scope.load();
            return;
          }
          for (const [field, value] of Object.entries(patch)) await scope.set(field, value);
        };

        try {
          ctx.slots.inject('plugins.item', () =>
            ctx.slots.register(
              {
                name: 'plugins.item',
                id: 'wsl-computer-use',
                order: 31,
                label: () => 'WSL 虚拟桌面',
                locale: NS,
                inject: () => ({ scope, savePatch, openViewer, as: 'section', idPrefix: 'wslcu' }),
              },
              SettingsCard,
            ),
          );
        } catch {
          /* host without the plugin-page slot: the form is simply absent */
        }
      };

      try {
        ctx.inject(['configForms'], (owner) => {
          mountSettings(owner.configForms.get('mcp-dsh-computer-use-wsl'), owner, 'mcp-dsh-computer-use-wsl');
          return () => {};
        });
      } catch {
        /* no configForms service */
      }

      try {
        ctx.inject(['settingsScope', 'connection', 'remote'], (owner) => {
          mountSettings(owner.settingsScope.bind({ namespace: 'wsl-computer-use' }), owner, 'wsl-computer-use');
          return () => {};
        });
      } catch {
        /* no settingsScope service */
      }

      // The chat-dock badge: independent of the settings form, and harmless when
      // the host has no such slot.
      try {
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            { name: 'conversation.input.dock', id: 'wsl-computer-status', order: -40, locale: NS },
            () => h(StatusBadge, { openViewer }),
          ),
        );
      } catch {
        /* dock slot missing */
      }
    };

    return { apply, inject: ['slots'] };
  },
});
