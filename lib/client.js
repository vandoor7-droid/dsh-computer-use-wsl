// Browser module for the DSH web shell.
//
// Deliberately defensive: every host seam is looked up at runtime and every
// registration is wrapped, so a DSH version that renamed a slot loses the card
// but never breaks the web app. The plugin's tools and the viewer page do not
// depend on this file at all.
window.__ModuleLoader__.load({
  id: 'dsh-computer-use-wsl',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const NS = 'wslComputerUse.settings';
    const DEFAULT_URL = 'http://127.0.0.1:6081/';

    function Card() {
      const [url, setUrl] = React.useState(DEFAULT_URL);
      const [note, setNote] = React.useState('');

      const open = () => {
        try {
          const sidebar = Card.sidebarRight;
          if (sidebar && typeof sidebar.openTab === 'function') {
            sidebar.openTab('browser', { params: { url } });
            setNote('已在侧边栏打开');
            return;
          }
        } catch (error) {
          setNote(`侧边栏不可用：${error && error.message}`);
          return;
        }
        try {
          window.open(url, '_blank', 'noopener');
          setNote('已在浏览器新标签打开');
        } catch (error) {
          setNote(`打开失败：${error && error.message}`);
        }
      };

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' } },
        h(
          'div',
          { style: { fontSize: 13, color: 'var(--dsh-text-secondary, #8b93a7)' } },
          'WSL / Linux 虚拟桌面。DSH 操作鼠标键盘时，视图顶部会显示「DSH 操作中」；点「我要接管」即可随时接管。',
        ),
        h(
          'label',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('span', { style: { whiteSpace: 'nowrap' } }, '视图地址'),
          h('input', {
            value: url,
            onChange: (event) => setUrl(event.target.value),
            spellCheck: false,
            style: {
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--dsh-border, #262b38)',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
            },
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(
            'button',
            {
              type: 'button',
              onClick: open,
              style: {
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid #4d8bfe',
                background: 'transparent',
                color: '#4d8bfe',
                cursor: 'pointer',
                font: 'inherit',
              },
            },
            '在侧边栏打开',
          ),
          note ? h('span', { style: { fontSize: 12, color: 'var(--dsh-text-secondary, #8b93a7)' } }, note) : null,
        ),
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--dsh-text-secondary, #8b93a7)' } },
          '默认端口 6081。若 DSH 报告 viewer 端口漂移，请以此处的实际地址为准（工具 health 会返回 viewerUrl）。',
        ),
      );
    }

    const apply = (ctx) => {
      try {
        if (ctx && ctx.slots && typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'wsl-computer-use',
                order: 17,
                label: () => 'WSL 虚拟桌面',
                locale: NS,
              },
              Card,
            ),
          );
        }
      } catch {
        /* host without the settings slot: the card is simply absent */
      }
      try {
        ctx.inject(['sidebarRight'], (owner) => {
          Card.sidebarRight = owner.sidebarRight;
          return () => {
            Card.sidebarRight = undefined;
          };
        });
      } catch {
        /* no sidebar service on this host */
      }
    };

    return { apply, inject: ['slots'] };
  },
});
