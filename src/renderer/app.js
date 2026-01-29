class App {
    constructor() {
        this.mainPanel = new MainPanel();
        this.initializeApp();
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
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
