import { ipcRenderer } from 'electron';
import MainPanel from './components/main-panel';

class App {
    constructor() {
        this.mainPanel = new MainPanel();
        this.initializeApp();
    }

    async initializeApp() {
        // Listen for provider changes to refresh models
        const providerSelect = document.getElementById('ai-provider');
        providerSelect.addEventListener('change', async (e) => {
            await this.mainPanel.loadModelsForProvider(e.target.value);
        });

        // Initial setup
        await this.mainPanel.loadAISettings();
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
