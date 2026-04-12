# Plugin: SearXNG Search
Version: 1.0.0
Description: SearXNG search plugin with optional local personal proxy server, discovery, and search

## Available Handlers

### plugin_searxng_search_discover
Discover reachable SearXNG endpoint and save config for this plugin
Parameters:

### plugin_searxng_search_search
Search the web via SearXNG. Optionally routes through local personal proxy when enabled.
Parameters:
  - query (string) [REQUIRED]: Search query
  - language (string): Language code (optional)
  - safe_search (number): Safe search level 0/1/2 (optional)
  - max_results (number): Maximum results
  - pageno (number): Page number

### plugin_searxng_search_server_status
Return local SearXNG personal proxy and backend status
Parameters:

## Configuration

- baseUrl: SearXNG base URL (e.g. https://searx.be)
- enableLocalServer: Enable local Node personal proxy server for this plugin
- localServerHost: Host for local proxy server (usually 127.0.0.1)
- localServerPort: Port for local proxy server (0 for auto)
- discoveryUrls: Comma-separated SearXNG base URLs for discovery probes
- backendMode: Backend mode: embedded or remote
- backendAutoStart: Auto-start embedded backend process when plugin is enabled
- backendCommand: Executable path for embedded SearXNG backend process
- backendArgs: Command arguments for embedded backend process
- backendWorkingDir: Working directory for backend process
- backendBaseUrl: Embedded backend base URL (e.g. http://127.0.0.1:8080)
- backendHealthPath: Health path appended to backendBaseUrl for readiness checks
- backendStartupTimeoutMs: Max wait for embedded backend readiness
- timeoutMs: HTTP timeout in milliseconds
- retryCount: Retry count for transient HTTP failures
- defaultLanguage: Default language code
- defaultSafeSearch: Safe-search level (0/1/2)
- defaultMaxResults: Default max results
