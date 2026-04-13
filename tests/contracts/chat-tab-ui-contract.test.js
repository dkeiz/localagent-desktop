const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'chat-tab-ui-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const html = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
    const api = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'electron-api.js'), 'utf8');
    const tabs = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'main-panel-tabs.js'), 'utf8');
    const styles = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'styles', 'chat-tabs.css'), 'utf8');

    assert.equal(html.includes('id="new-session-btn"'), false, 'Expected legacy New Chat button to be removed');
    assert.includes(html, '<div class="chat-tabs-strip">', 'Expected wrapper that keeps + next to the last tab');
    assert.includes(html, 'id="new-chat-btn" class="chat-tab-new"', 'Expected add-tab plus button in chat tab bar');
    assert.includes(api, 'clearChatSession: (sessionId)', 'Expected renderer API for clearing a specific chat session');
    assert.includes(tabs, 'async function clearTab(panel, sessionId)', 'Expected per-tab clear handler');
    assert.includes(tabs, 'clearBtn.className = \'chat-tab-reset\'', 'Expected dedicated clear icon on tabs');
    assert.includes(tabs, 'clearBtn.textContent = \'🖌\'', 'Expected brush-style clear icon on tabs');
    assert.includes(tabs, 'closeBtn.className = \'chat-tab-close\'', 'Expected existing close button to remain');
    assert.ok(
      tabs.indexOf('tabEl.appendChild(clearBtn);') < tabs.indexOf('tabEl.appendChild(statusDot);'),
      'Expected clear icon to render on the left edge before the tab status/label'
    );
    assert.includes(styles, '.chat-tabs-strip {', 'Expected strip layout styles for tabs plus icon');
    assert.includes(styles, '.chat-tab-reset,', 'Expected clear-button styling in chat tabs stylesheet');
  }
};
