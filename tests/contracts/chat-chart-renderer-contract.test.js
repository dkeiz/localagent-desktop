const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRenderer(rootDir) {
  const source = fs.readFileSync(
    path.join(rootDir, 'src', 'renderer', 'components', 'chart-renderer.js'),
    'utf8'
  );
  const context = {
    window: {},
    console
  };
  vm.runInNewContext(source, context, { filename: 'chart-renderer.js' });
  return context.window.agentChartRenderer;
}

function makeEscapingDocument() {
  return {
    createElement() {
      return {
        innerHTML: '',
        set textContent(value) {
          this.innerHTML = String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }
      };
    }
  };
}

function loadMessageFormatter(rootDir) {
  const source = fs.readFileSync(
    path.join(rootDir, 'src', 'renderer', 'components', 'message-formatter.js'),
    'utf8'
  );
  const context = {
    window: {
      agentChartRenderer: {
        hydrate(root) {
          root.__chartHydrated = true;
        }
      }
    },
    document: makeEscapingDocument(),
    URL,
    console
  };
  vm.runInNewContext(source, context, { filename: 'message-formatter.js' });
  return context.window.MessageFormatter;
}

module.exports = {
  name: 'chat-chart-renderer-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const renderer = loadRenderer(rootDir);
    const normalized = renderer.normalize({
      type: 'line',
      title: 'Trend',
      data: [
        { label: 'Jan', value: 4 },
        { label: 'Feb', value: 7 }
      ]
    });

    assert.equal(normalized.type, 'line', 'Expected supported chart type to survive normalization');
    assert.deepEqual(normalized.labels, ['Jan', 'Feb'], 'Expected object data labels to normalize');
    assert.deepEqual(normalized.values, [4, 7], 'Expected object data values to normalize');

    const html = renderer.render(normalized);
    assert.includes(html, 'agent-chart-frame', 'Expected chart frame HTML');
    assert.includes(html, 'Trend', 'Expected chart title in rendered HTML');
    assert.includes(html, '<polyline', 'Expected line chart SVG');

    const host = {
      dataset: {
        agentChart: JSON.stringify({ type: 'table', labels: ['A'], values: [3] })
      },
      innerHTML: '',
      classList: { add() {} }
    };
    renderer.hydrate({
      querySelectorAll() {
        return [host];
      }
    });

    assert.includes(host.innerHTML, 'agent-chart-table', 'Expected hydration to render table chart');
    assert.equal(host.dataset.agentChartRendered, 'true', 'Expected hydration marker');

    const MessageFormatter = loadMessageFormatter(rootDir);
    const formatter = new MessageFormatter();
    const messageDiv = { innerHTML: '' };
    formatter.renderInto(messageDiv, {
      role: 'assistant',
      content: '```chart\n{"type":"bar","labels":["A"],"values":[1]}\n```'
    });

    assert.includes(messageDiv.innerHTML, 'data-agent-chart=', 'Expected chart fence markup in chat messages');
    assert.equal(messageDiv.__chartHydrated, true, 'Expected message rendering to hydrate chart content');
  }
};
