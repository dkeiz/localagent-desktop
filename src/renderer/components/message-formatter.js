// Enhanced message formatting with markdown support
class MessageFormatter {
    constructor() {
        this.init();
    }

    init() {
        // Override the addMessage method to use formatting
        if (window.mainPanel) {
            const originalAddMessage = window.mainPanel.addMessage.bind(window.mainPanel);
            window.mainPanel.addMessage = (role, content) => {
                const messageId = originalAddMessage(role, content);
                this.formatMessage(messageId);
                return messageId;
            };
        }
    }

    formatMessage(messageId) {
        const messageDiv = document.getElementById(messageId);
        if (!messageDiv) return;

        let content = messageDiv.textContent;
        
        // Format code blocks
        content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            return `<pre><code class="language-${lang || 'text'}">${this.escapeHtml(code.trim())}</code></pre>`;
        });

        // Format inline code
        content = content.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Format bold
        content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Format italic
        content = content.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Format links
        content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Format lists
        content = content.replace(/^- (.+)$/gm, '<li>$1</li>');
        content = content.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

        messageDiv.innerHTML = content;
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
