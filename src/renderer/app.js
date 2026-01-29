class App {
    constructor() {
        this.mainPanel = new MainPanel();
        this.initializeApp();
        this.initializePanelToggles();
    }

    async initializeApp() {
        // Listen for provider changes to refresh models
        const providerSelect = document.getElementById('ai-provider');
        if (providerSelect) {
            providerSelect.addEventListener('change', async (e) => {
                await this.mainPanel.loadModelsForProvider(e.target.value);
            });
        }
    }

    initializePanelToggles() {
        const appContainer = document.querySelector('.app-container');
        const leftSidebar = document.getElementById('left-sidebar');
        const rightPanel = document.getElementById('right-panel');
        const leftToggle = document.getElementById('toggle-left-sidebar');
        const rightToggle = document.getElementById('toggle-right-panel');

        // Restore saved panel states
        const leftCollapsed = localStorage.getItem('leftSidebarCollapsed') === 'true';
        const rightCollapsed = localStorage.getItem('rightPanelCollapsed') === 'true';

        if (leftCollapsed) {
            appContainer.classList.add('left-collapsed');
            leftSidebar.classList.add('collapsed');
            leftToggle.textContent = '▶';
        }

        if (rightCollapsed) {
            appContainer.classList.add('right-collapsed');
            rightPanel.classList.add('collapsed');
            rightToggle.textContent = '◀';
        }

        // Left sidebar toggle
        leftToggle.addEventListener('click', () => {
            const isCollapsed = leftSidebar.classList.toggle('collapsed');
            appContainer.classList.toggle('left-collapsed', isCollapsed);
            leftToggle.textContent = isCollapsed ? '▶' : '◀';
            localStorage.setItem('leftSidebarCollapsed', isCollapsed);
        });

        // Right panel toggle
        rightToggle.addEventListener('click', () => {
            const isCollapsed = rightPanel.classList.toggle('collapsed');
            appContainer.classList.toggle('right-collapsed', isCollapsed);
            rightToggle.textContent = isCollapsed ? '◀' : '▶';
            localStorage.setItem('rightPanelCollapsed', isCollapsed);
        });
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
