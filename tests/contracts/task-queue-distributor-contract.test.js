const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'task-queue-distributor-contract',
  tags: ['contract', 'fast'],
  async run({ assert, rootDir }) {
    const queueFile = path.join(rootDir, 'agentin', 'tasks', 'tasks.md');
    const skillFile = path.join(rootDir, 'agentin', 'skills', 'global-task-distributor.md');
    const runtimePaths = fs.readFileSync(path.join(rootDir, 'src', 'main', 'runtime-paths.js'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(rootDir, 'src', 'main', 'bootstrap.js'), 'utf8');
    const taskService = fs.readFileSync(path.join(rootDir, 'src', 'main', 'task-queue-service.js'), 'utf8');
    const daemon = fs.readFileSync(path.join(rootDir, 'src', 'main', 'background-memory-daemon.js'), 'utf8');
    const agentLoop = fs.readFileSync(path.join(rootDir, 'src', 'main', 'agent-loop.js'), 'utf8');
    const ipcChat = fs.readFileSync(path.join(rootDir, 'src', 'main', 'ipc', 'register-chat-data-handlers.js'), 'utf8');
    const rendererApi = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'electron-api.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'index.html'), 'utf8');
    const commandHandler = fs.readFileSync(path.join(rootDir, 'src', 'renderer', 'components', 'command-handler.js'), 'utf8');

    assert.equal(fs.existsSync(queueFile), true, 'Expected global task queue file to exist');
    assert.equal(fs.existsSync(skillFile), true, 'Expected compact skill explanation file to exist');

    const queueContent = fs.readFileSync(queueFile, 'utf8');
    assert.includes(queueContent, '<!-- TASK_QUEUE:BEGIN -->', 'Expected queue begin marker');
    assert.includes(queueContent, '<!-- TASK_QUEUE:END -->', 'Expected queue end marker');

    const skillContent = fs.readFileSync(skillFile, 'utf8');
    assert.includes(skillContent, '## Task Line Format', 'Expected compact format guidance for LLMs');
    assert.includes(skillContent, '## Claim + Handoff Rules', 'Expected claim/handoff guidance for executors');

    assert.includes(runtimePaths, 'tasksQueueFile', 'Expected runtime task queue path');
    assert.includes(bootstrap, 'new TaskQueueService', 'Expected bootstrap to initialize task queue service');
    assert.includes(taskService, 'CREATE TABLE IF NOT EXISTS task_queue_events', 'Expected DB logger table for task events');
    assert.includes(taskService, 'createOrReuseTask', 'Expected dedupe-aware task upsert method');
    assert.includes(taskService, 'claimNextTask', 'Expected task claim method');

    assert.includes(agentLoop, 'daemon.enqueue_memory_job', 'Expected session-close flow to enqueue global daemon task');
    assert.includes(daemon, '_drainGlobalQueueTasks', 'Expected daemon global queue drain integration');

    assert.includes(ipcChat, "ipcMain.handle('task-queue:list'", 'Expected task queue IPC list handler');
    assert.includes(ipcChat, "ipcMain.handle('task-queue:run'", 'Expected task queue IPC run handler');
    assert.includes(rendererApi, 'tasks: {', 'Expected renderer task API namespace');
    assert.includes(rendererApi, 'onTaskQueueUpdate', 'Expected task queue update event bridge');

    assert.equal(indexHtml.includes('id="tasks-btn"'), false, 'Expected no dedicated task icon in chat controls');
    assert.equal(indexHtml.includes('components/tasks-button.js'), false, 'Expected no tasks popover script wiring');
    assert.includes(commandHandler, "this.commands.set('/tasks'", 'Expected /tasks command support');
    assert.includes(commandHandler, "this.commands.set('/task'", 'Expected /task alias support');
  }
};
