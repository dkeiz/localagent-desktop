function registerTerminalTools(server) {
  server.registerTool('run_command', {
    name: 'run_command',
    description: 'Execute a shell command in the terminal. Returns stdout, stderr, and exit code. SECURITY: This tool requires terminal capability to be enabled.',
    userDescription: 'Runs a shell command and returns its output',
    example: 'TOOL:run_command{"command":"dir","cwd":"C:/Users"}',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command (optional)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        output_to_file: {
          type: 'boolean',
          description: 'Save output to a workspace file instead of returning inline. Auto-triggers when output exceeds 1000 chars. Use for commands with large output (builds, installs, logs).',
          default: false
        }
      },
      required: ['command']
    }
  }, async (params) => {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const options = {
      cwd: params.cwd || process.cwd(),
      timeout: params.timeout || 30000,
      maxBuffer: 1024 * 1024 * 5,
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
    };

    const outputThreshold = 1000;

    try {
      const { stdout, stderr } = await execAsync(params.command, options);
      const fullOutput = (stdout || '') + (stderr ? '\n--- stderr ---\n' + stderr : '');

      if (server._sessionWorkspace && (params.output_to_file || fullOutput.length > outputThreshold)) {
        const sessionId = server._currentSessionId || 'default';
        const label = params.command.split(/\s+/)[0];
        const result = server._sessionWorkspace.writeOutput(sessionId, label, fullOutput);
        const lineCount = fullOutput.split('\n').length;
        const summary = fullOutput.substring(0, 500);
        return {
          success: true,
          command: params.command,
          cwd: options.cwd,
          output_mode: 'file',
          file_path: result.filePath,
          file_name: result.fileName,
          file_size: result.size,
          line_count: lineCount,
          summary: summary + (fullOutput.length > 500 ? '\n... (truncated, see file)' : ''),
          exitCode: 0
        };
      }

      return {
        success: true,
        command: params.command,
        cwd: options.cwd,
        output_mode: 'inline',
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0
      };
    } catch (error) {
      const fullOutput = (error.stdout || '') + (error.stderr ? '\n--- stderr ---\n' + error.stderr : error.message);

      if (server._sessionWorkspace && (params.output_to_file || fullOutput.length > outputThreshold)) {
        const sessionId = server._currentSessionId || 'default';
        const label = params.command.split(/\s+/)[0] + '_error';
        const result = server._sessionWorkspace.writeOutput(sessionId, label, fullOutput);
        return {
          success: false,
          command: params.command,
          cwd: options.cwd,
          output_mode: 'file',
          file_path: result.filePath,
          file_name: result.fileName,
          summary: fullOutput.substring(0, 500),
          exitCode: error.code || 1
        };
      }

      return {
        success: false,
        command: params.command,
        cwd: options.cwd,
        output_mode: 'inline',
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || error.message,
        exitCode: error.code || 1
      };
    }
  });

  server.registerTool('run_python', {
    name: 'run_python',
    description: 'Execute Python code. Can run a script file or inline code. SECURITY: This tool requires terminal capability to be enabled.',
    userDescription: 'Runs Python code and returns the output',
    example: 'TOOL:run_python{"code":"print(Hello World)"}',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python code to execute (inline)' },
        scriptPath: { type: 'string', description: 'Path to a Python script file to execute' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments to pass to the script' },
        cwd: { type: 'string', description: 'Working directory' }
      }
    }
  }, async (params) => {
    const { spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    return new Promise((resolve) => {
      let pythonArgs = [];
      let tempFile = null;

      if (params.code) {
        const tempDir = require('os').tmpdir();
        tempFile = path.join(tempDir, `agent_script_${Date.now()}.py`);
        fs.writeFileSync(tempFile, params.code);
        pythonArgs = [tempFile];
      } else if (params.scriptPath) {
        pythonArgs = [params.scriptPath];
      } else {
        resolve({ success: false, error: 'Either code or scriptPath is required' });
        return;
      }

      if (params.args) {
        pythonArgs = pythonArgs.concat(params.args);
      }

      const python = spawn('python', pythonArgs, {
        cwd: params.cwd || process.cwd(),
        timeout: 60000
      });

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => { stdout += data.toString(); });
      python.stderr.on('data', (data) => { stderr += data.toString(); });

      python.on('close', (code) => {
        if (tempFile && fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }

        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code
        });
      });

      python.on('error', (error) => {
        if (tempFile && fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        resolve({ success: false, error: error.message });
      });
    });
  });

  server.registerTool('list_workspace', {
    name: 'list_workspace',
    description: 'List all files in the current session workspace. Workspace files include command outputs, temp files, and other session artifacts.',
    userDescription: 'Lists files in the session temp workspace',
    example: 'TOOL:list_workspace{}',
    inputSchema: { type: 'object' }
  }, async () => {
    if (!server._sessionWorkspace) return { error: 'Session workspace not initialized' };
    const sessionId = server._currentSessionId || 'default';
    const files = server._sessionWorkspace.listFiles(sessionId);
    return { sessionId, fileCount: files.length, files };
  });

  server.registerTool('search_workspace', {
    name: 'search_workspace',
    description: 'Search file contents in the session workspace (grep-like). Useful for finding specific output in command log files without loading entire files into context.',
    userDescription: 'Search text within session workspace files',
    example: 'TOOL:search_workspace{"query":"error"}',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in workspace files (case-insensitive)' }
      },
      required: ['query']
    }
  }, async (params) => {
    if (!server._sessionWorkspace) return { error: 'Session workspace not initialized' };
    const sessionId = server._currentSessionId || 'default';
    const results = server._sessionWorkspace.searchFiles(sessionId, params.query);
    return { sessionId, query: params.query, resultCount: results.length, results };
  });
}

module.exports = { registerTerminalTools };
