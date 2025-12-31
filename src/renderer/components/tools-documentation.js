// Tools Documentation Component
class ToolsDocumentation {
  constructor() {
    this.tools = [];
    this.categories = {};
  }

  async init() {
    await this.loadTools();
    this.render();
  }

  async loadTools() {
    try {
      this.tools = await window.electronAPI.getMCPToolsDocumentation();
      this.categorizeTools();
    } catch (error) {
      console.error('Failed to load tools documentation:', error);
    }
  }

  categorizeTools() {
    this.categories = {};
    this.tools.forEach(tool => {
      const category = tool.category || 'Other';
      if (!this.categories[category]) {
        this.categories[category] = [];
      }
      this.categories[category].push(tool);
    });
  }

  render() {
    const container = document.getElementById('tools-documentation');
    if (!container) return;

    let html = `
      <div class="tools-doc-header">
        <h2>📚 MCP Tools Documentation</h2>
        <p class="tools-doc-subtitle">Available tools for both AI and manual use</p>
      </div>
      
      <div class="tools-search">
        <input type="text" id="tools-search-input" placeholder="Search tools..." />
      </div>
    `;

    // Render by category
    const categoryOrder = ['System', 'Calendar', 'Todo', 'Search', 'Math', 'Rules', 'Other'];
    const categoryIcons = {
      'System': '🕐',
      'Calendar': '📅',
      'Todo': '✅',
      'Search': '🔍',
      'Math': '🔢',
      'Rules': '⚙️',
      'Other': '📦'
    };

    categoryOrder.forEach(category => {
      if (!this.categories[category] || this.categories[category].length === 0) return;

      const icon = categoryIcons[category] || '📦';
      html += `
        <div class="tools-category">
          <h3 class="tools-category-title">${icon} ${category} Tools</h3>
          <div class="tools-list">
      `;

      this.categories[category].forEach(tool => {
        html += this.renderTool(tool);
      });

      html += `
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    this.attachEventListeners();
  }

  renderTool(tool) {
    const hasParams = tool.parameters && tool.parameters.length > 0;
    
    let paramsHtml = '';
    if (hasParams) {
      paramsHtml = '<div class="tool-parameters"><strong>Parameters:</strong><ul>';
      tool.parameters.forEach(param => {
        const required = param.required ? '<span class="param-required">[REQUIRED]</span>' : '';
        const defaultVal = param.default !== undefined ? ` <span class="param-default">(default: ${JSON.stringify(param.default)})</span>` : '';
        paramsHtml += `
          <li>
            <code>${param.name}</code> <span class="param-type">(${param.type})</span> ${required}${defaultVal}
            <br><span class="param-desc">${param.description}</span>
          </li>
        `;
      });
      paramsHtml += '</ul></div>';
    }

    const exampleHtml = tool.example ? `
      <div class="tool-example">
        <strong>Example:</strong>
        <div class="tool-example-code">
          <code>${this.escapeHtml(tool.example)}</code>
          <button class="copy-btn" data-copy="${this.escapeHtml(tool.example)}" title="Copy to clipboard">📋</button>
        </div>
      </div>
    ` : '';

    const outputHtml = tool.exampleOutput ? `
      <div class="tool-output">
        <strong>Expected Output:</strong>
        <pre><code>${this.escapeHtml(tool.exampleOutput)}</code></pre>
      </div>
    ` : '';

    return `
      <div class="tool-card" data-tool-name="${tool.name}">
        <div class="tool-header">
          <h4 class="tool-name">${tool.name}</h4>
          <button class="tool-test-btn" data-tool="${tool.name}">Test Tool</button>
        </div>
        <p class="tool-description">${tool.description}</p>
        <p class="tool-technical"><em>Technical: ${tool.technicalDescription}</em></p>
        ${paramsHtml}
        ${exampleHtml}
        ${outputHtml}
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  attachEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('tools-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterTools(e.target.value);
      });
    }

    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const text = e.target.getAttribute('data-copy');
        navigator.clipboard.writeText(text).then(() => {
          e.target.textContent = '✅';
          setTimeout(() => {
            e.target.textContent = '📋';
          }, 2000);
        });
      });
    });

    // Test tool buttons
    document.querySelectorAll('.tool-test-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const toolName = e.target.getAttribute('data-tool');
        this.testTool(toolName);
      });
    });
  }

  filterTools(query) {
    const lowerQuery = query.toLowerCase();
    document.querySelectorAll('.tool-card').forEach(card => {
      const toolName = card.getAttribute('data-tool-name').toLowerCase();
      const content = card.textContent.toLowerCase();
      
      if (toolName.includes(lowerQuery) || content.includes(lowerQuery)) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });

    // Hide empty categories
    document.querySelectorAll('.tools-category').forEach(category => {
      const visibleCards = category.querySelectorAll('.tool-card[style="display: block;"], .tool-card:not([style*="display: none"])');
      category.style.display = visibleCards.length > 0 ? 'block' : 'none';
    });
  }

  testTool(toolName) {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) return;

    // Build a simple test call
    const params = {};
    tool.parameters.forEach(param => {
      if (param.required) {
        // Prompt for required params
        const value = prompt(`Enter value for ${param.name} (${param.type}):\n${param.description}`);
        if (value !== null) {
          params[param.name] = param.type === 'number' ? Number(value) : value;
        }
      }
    });

    // Execute the tool
    window.electronAPI.executeMCPTool(toolName, params)
      .then(response => {
        if (response.success) {
          alert(`Tool executed successfully!\n\nResult:\n${JSON.stringify(response.result, null, 2)}`);
        } else {
          alert(`Tool execution failed:\n${response.error}`);
        }
      })
      .catch(error => {
        alert(`Error executing tool:\n${error.message}`);
      });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('tools-documentation')) {
      const toolsDoc = new ToolsDocumentation();
      toolsDoc.init();
    }
  });
} else {
  if (document.getElementById('tools-documentation')) {
    const toolsDoc = new ToolsDocumentation();
    toolsDoc.init();
  }
}

module.exports = ToolsDocumentation;
