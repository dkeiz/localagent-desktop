# 🤖 LocalAgent Desktop

> A local-first AI agent desktop application with multi-chat, 37+ tools, plugin system, workflow automation, and multi-provider LLM support.

**⚠️ Alpha Release** — This is an early alpha for public testing. Expect rough edges, breaking changes, and evolving APIs.

---

## What is LocalAgent?

LocalAgent is an **Electron-based desktop AI assistant** that runs locally on your machine. Unlike cloud-only AI tools, LocalAgent:

- **Runs your own LLMs** via Ollama, LM Studio, or any OpenAI-compatible server
- **Connects to cloud providers** (OpenRouter, OpenAI, Qwen) when you want
- **Keeps your data local** — conversations, memory, workflows, and knowledge stay on your disk
- **Automates tasks** with 37+ built-in tools and extensible plugin system
- **Orchestrates multi-agent workflows** with pro agents, sub-agents, and research orchestration

---

## ✨ Key Features

### 💬 Multi-Chat Sessions
- Multiple independent chat tabs
- Persistent conversation history
- Session restore on startup

### 🔧 37+ Built-in MCP Tools
- File operations (read, write, edit, search)
- Web search and URL fetching
- Terminal command execution
- Calendar and todo management
- Workflow automation
- Media handling (images, audio, screenshots)
- Agent delegation and orchestration

### 🤖 Multi-Agent System
- 7 pro agents (Research Orchestrator, Code Reviewer, File Manager, Web Researcher, System Monitor, RAG Agent, Background Daemon)
- 11+ sub-agents for specialized tasks
- Delegated subtask runs with file-backed state
- Provider-aware parallel execution

### 🔌 Plugin System
- Hot-loadable plugins with lifecycle management
- SearXNG search integration
- TTS voice synthesis bridge
- Telegram bot relay
- RAG dataset studio
- Custom plugin creation

### 🎨 Themeable UI
- 8 built-in skins/themes
- Customizable appearance
- Workflow visual editor

### 🧠 Memory & Knowledge
- Persistent agent memory across sessions
- Knowledge management with staging workflow
- Background memory daemon for automatic summarization

### 🔄 Workflow Engine
- Auto-capture tool chains as reusable workflows
- Visual workflow editor
- Scheduled background workflows
- File-first workflow storage

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+**
- **npm**
- One of these LLM backends:
  - [Ollama](https://ollama.ai/) (recommended for local)
  - [LM Studio](https://lmstudio.ai/)
  - [OpenRouter](https://openrouter.ai/) (cloud, API key needed)

### Installation

```bash
# Clone the repository
git clone https://github.com/dkeiz/localagent-desktop.git
cd localagent-desktop

# Install dependencies
npm install

# Start the application
npm start
```

### Configure Your LLM Provider

1. Launch the app
2. Click **API Providers** tab in the left sidebar
3. Select your provider:
   - **Ollama**: Just works if Ollama is running on `localhost:11434`
   - **LM Studio**: Set URL to `http://localhost:1234`
   - **OpenRouter**: Paste your API key
4. Select a model and start chatting!

---

## 🐳 Docker (Headless Testing)

```bash
# Copy environment template
cp .env.example .env
# Edit .env with your API keys

# Build and run
docker-compose up --build

# The API is available at http://localhost:8788
```

Docker connects to your host's Ollama via `host.docker.internal:11434`.

---

## 📁 Project Structure

```
localagent/
├── src/
│   ├── main/           # Electron main process (backend)
│   │   ├── providers/  # LLM provider adapters
│   │   ├── mcp/        # MCP tool registrars
│   │   └── ipc/        # IPC handler registrations
│   └── renderer/       # Electron renderer (frontend)
│       ├── components/ # UI components
│       ├── styles/     # CSS stylesheets
│       └── skins/      # Theme system
├── agentin/            # Runtime file-backed state
│   ├── agents/         # Agent definitions and memory
│   ├── plugins/        # Plugin packages
│   ├── connectors/     # Worker-thread integrations
│   ├── knowledge/      # Knowledge base
│   ├── memory/         # Agent memory files
│   ├── prompts/        # System prompt and rules
│   ├── workflows/      # Workflow definitions
│   └── workspaces/     # Session work artifacts
├── tests/              # Contract and integration tests
└── tools/              # Development utilities
```

---

## 🔌 Plugin Development

Plugins live in `agentin/plugins/<plugin-id>/` with:
- `plugin.json` — Manifest with metadata and capabilities
- `main.js` — Backend entry point with lifecycle hooks

See [docs/tts-plugin-contract.md](docs/tts-plugin-contract.md) for an example plugin contract.

---

## 🧪 Testing

```bash
# Run contract tests (fast, no LLM needed)
npm run test:contracts

# Run quick tests
npm run test:quick

# Run core tests
npm run test:core

# Run all tests
npm run test:all
```

---

## 📖 Documentation

- [Development Guide](DEVELOPMENT_GUIDE.md) — Architecture, runtime model, extension paths
- [MCP Tools Guide](MCP_TOOLS_GUIDE.md) — Built-in tool inventory
- [Contributing](CONTRIBUTING.md) — How to contribute

---

## ⚠️ Alpha Disclaimer

This is an **alpha release** for public testing. Please be aware:

- **Breaking changes** may occur between releases
- **API surfaces** (IPC, tools, plugin contracts) are not yet frozen
- **Some features** are experimental (skins, research orchestrator, TTS)
- **Security**: Electron runs with `nodeIntegration: true` — this is known and tracked for hardening
- **Bug reports** are very welcome — please use GitHub Issues

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

Built with:
- [Electron](https://www.electronjs.org/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Ollama](https://ollama.ai/)
- [OpenRouter](https://openrouter.ai/)
