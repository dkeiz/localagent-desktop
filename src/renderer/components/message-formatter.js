// Enhanced message formatting with markdown support
class MessageFormatter {
    constructor() {
        this.init();
    }

    init() {
        // Override the addMessage method to use formatting
        if (window.mainPanel && !window.mainPanel.__messageFormatterWrapped) {
            const originalAddMessage = window.mainPanel.addMessage.bind(window.mainPanel);
            window.mainPanel.addMessage = (role, content, style) => {
                const messageId = originalAddMessage(role, content, style);
                if (role !== 'assistant' && style !== 'terminal') {
                    this.formatMessage(messageId, content);
                }
                return messageId;
            };
            window.mainPanel.__messageFormatterWrapped = true;
        }
    }

    formatMessage(messageId, rawContent = null) {
        const messageDiv = document.getElementById(messageId);
        if (!messageDiv) return;

        const content = rawContent == null ? messageDiv.textContent : String(rawContent);
        messageDiv.innerHTML = this.renderMarkdown(content);
    }

    renderMarkdown(text) {
        const placeholders = [];
        const stash = (html) => {
            const token = `@@FMT${placeholders.length}@@`;
            placeholders.push({ token, html });
            return token;
        };

        let content = String(text || '');

        content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            return stash(`<pre><code class="language-${this.escapeAttribute(lang || 'text')}">${this.escapeHtml(code.trim())}</code></pre>`);
        });

        content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
            const safeUrl = this.sanitizeUrl(url);
            if (!safeUrl) {
                return this.escapeHtml(label);
            }
            return stash(`<a href="${this.escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(label)}</a>`);
        });

        content = content.replace(/`([^`]+)`/g, (match, code) => {
            return stash(`<code>${this.escapeHtml(code)}</code>`);
        });

        content = this.escapeHtml(content);
        content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        content = this.renderLists(content);

        placeholders.forEach(({ token, html }) => {
            content = content.split(token).join(html);
        });

        return content.replace(/\n/g, '<br>');
    }

    renderLists(text) {
        const lines = text.split('\n');
        const output = [];
        let inList = false;

        for (const line of lines) {
            const listItem = line.match(/^- (.+)$/);
            if (listItem) {
                if (!inList) {
                    output.push('<ul>');
                    inList = true;
                }
                output.push(`<li>${listItem[1]}</li>`);
                continue;
            }

            if (inList) {
                output.push('</ul>');
                inList = false;
            }
            output.push(line);
        }

        if (inList) {
            output.push('</ul>');
        }

        return output.join('\n');
    }

    sanitizeUrl(url) {
        try {
            const parsed = new URL(url);
            const protocol = parsed.protocol.toLowerCase();
            if (!['http:', 'https:', 'mailto:'].includes(protocol)) {
                return null;
            }
            return parsed.toString();
        } catch (error) {
            return null;
        }
    }

    escapeAttribute(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.messageFormatter = new MessageFormatter();
    }, 500);
});
