# LocalAgent Desktop

Standalone desktop AI agent with calendar integration and MCP tooling.

## Features

- 🤖 Local LLM integration via Ollama
- 📅 Calendar integration
- 🔧 MCP (Model Context Protocol) tooling support
- 💬 Chat interface with session management
- 🎨 Modern Electron-based desktop UI

## Prerequisites

- Node.js (v16 or higher)
- Ollama installed and running locally

## Installation

```bash
npm install
```

## Usage

```bash
# Start the application
npm start

# Development mode with auto-reload
npm run dev

# Build for production
npm run build
```

## Project Structure

- `src/main/` - Electron main process
- `src/renderer/` - UI components and styles
- `preload.js` - Electron preload script

## License

MIT
