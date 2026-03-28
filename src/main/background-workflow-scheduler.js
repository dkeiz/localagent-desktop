const ResourceMonitor = require('./resource-monitor');

/**
 * BackgroundWorkflowScheduler — Runs user-scheduled workflows on a fixed 15-minute tick.
 *
 * Separate from the Memory Daemon:
 *   - Memory Daemon: escalating ticks, inference-wise decisions about memory housekeeping
 *   - Workflow Scheduler: fixed 15-min interval, deterministic — checks schedule table, runs what's due
 *
 * Resource gate: same GPU + VRAM + CPU < 20% check.
 *
 * Schedule storage: workflow_schedules DB table
 *   - workflow_id, interval_minutes, last_run, next_run, enabled
 */
class BackgroundWorkflowScheduler {
    constructor(workflowManager, db, eventBus) {
        this.workflowManager = workflowManager;
        this.db = db;
        this.eventBus = eventBus;

        this.running = false;
        this._tickTimer = null;

        // Fixed 15-minute tick
        this.TICK_INTERVAL = 15 * 60 * 1000;
        this.RESOURCE_THRESHOLD = 20;
        this._resourceMonitor = new ResourceMonitor(this.RESOURCE_THRESHOLD);

        // Listen for user activity
        this._userActive = false;
        if (this.eventBus) {
            this.eventBus.on('chat:user-active', () => { this._userActive = true; });
            this.eventBus.on('chat:user-idle', () => { this._userActive = false; });
        }
    }

    // ==================== Lifecycle ====================

    async start() {
        if (this.running) return;

        // Ensure DB table exists
        this._ensureTable();

        this.running = true;
        console.log('[WorkflowScheduler] Started (15-min tick)');

        if (this.eventBus) {
            this.eventBus.publish('daemon:started', { daemon: 'workflow-scheduler' });
        }

        // First tick after 1 minute (give app time to fully initialize)
        this._scheduleTick(60 * 1000);
    }

    stop() {
        this.running = false;
        if (this._tickTimer) {
            clearTimeout(this._tickTimer);
            this._tickTimer = null;
        }

        console.log('[WorkflowScheduler] Stopped');
        if (this.eventBus) {
            this.eventBus.publish('daemon:stopped', { daemon: 'workflow-scheduler' });
        }
    }

    getStatus() {
        const schedules = this._getDueSchedules();
        const allSchedules = this._getAllSchedules();
        return {
            running: this.running,
            tickInterval: this.TICK_INTERVAL / 60000,
            scheduledWorkflows: allSchedules.length,
            dueNow: schedules.length,
        };
    }

    // ==================== Tick ====================

    _scheduleTick(delay) {
        if (!this.running) return;
        if (this._tickTimer) clearTimeout(this._tickTimer);

        this._tickTimer = setTimeout(async () => {
            await this._onTick();
        }, delay);
    }

    async _onTick() {
        if (!this.running) return;

        try {
            // Check resources
            const resources = await this._checkResources();
            if (!resources.available) {
                console.log(`[WorkflowScheduler] Resources busy (${resources.combined}%), skipping tick`);
                if (this.eventBus) {
                    this.eventBus.publish('workflow:scheduled-skipped', {
                        reason: 'resources',
                        load: resources.combined,
                    });
                }
                this._scheduleTick(this.TICK_INTERVAL);
                return;
            }

            // Don't run while user is actively chatting
            if (this._userActive) {
                console.log('[WorkflowScheduler] User active, skipping tick');
                this._scheduleTick(this.TICK_INTERVAL);
                return;
            }

            // Get due schedules
            const dueSchedules = this._getDueSchedules();
            if (dueSchedules.length === 0) {
                this._scheduleTick(this.TICK_INTERVAL);
                return;
            }

            console.log(`[WorkflowScheduler] ${dueSchedules.length} workflow(s) due`);

            // Execute each due workflow
            for (const schedule of dueSchedules) {
                await this._executeScheduledWorkflow(schedule);
            }

        } catch (err) {
            console.error('[WorkflowScheduler] Tick error:', err.message);
        }

        // Schedule next tick
        this._scheduleTick(this.TICK_INTERVAL);
    }

    // ==================== Workflow Execution ====================

    async _executeScheduledWorkflow(schedule) {
        console.log(`[WorkflowScheduler] Running workflow #${schedule.workflow_id} (schedule #${schedule.id})`);

        try {
            const result = await this.workflowManager.executeWorkflow(schedule.workflow_id);

            // Update last_run and next_run
            const nextRun = new Date(Date.now() + schedule.interval_minutes * 60 * 1000).toISOString();
            this.db.run(
                'UPDATE workflow_schedules SET last_run = ?, next_run = ? WHERE id = ?',
                [new Date().toISOString(), nextRun, schedule.id]
            );

            console.log(`[WorkflowScheduler] Workflow #${schedule.workflow_id} completed`);
            if (this.eventBus) {
                this.eventBus.publish('workflow:scheduled-complete', {
                    scheduleId: schedule.id,
                    workflowId: schedule.workflow_id,
                    workflowName: schedule.workflow_name,
                    result: result ? JSON.stringify(result).substring(0, 300) : 'No output',
                });
            }

        } catch (err) {
            console.error(`[WorkflowScheduler] Workflow #${schedule.workflow_id} failed:`, err.message);

            // Update last_run even on failure
            const nextRun = new Date(Date.now() + schedule.interval_minutes * 60 * 1000).toISOString();
            this.db.run(
                'UPDATE workflow_schedules SET last_run = ?, next_run = ? WHERE id = ?',
                [new Date().toISOString(), nextRun, schedule.id]
            );

            if (this.eventBus) {
                this.eventBus.publish('workflow:scheduled-failed', {
                    scheduleId: schedule.id,
                    workflowId: schedule.workflow_id,
                    workflowName: schedule.workflow_name,
                    error: err.message,
                });
            }
        }
    }

    // ==================== Schedule Management ====================

    /**
     * Add a workflow to the schedule.
     */
    addSchedule(workflowId, intervalMinutes, workflowName = '') {
        const nextRun = new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
        const result = this.db.run(
            `INSERT INTO workflow_schedules (workflow_id, workflow_name, interval_minutes, next_run)
             VALUES (?, ?, ?, ?)`,
            [workflowId, workflowName, intervalMinutes, nextRun]
        );
        return { id: result.id, workflowId, intervalMinutes, nextRun };
    }

    /**
     * Remove a workflow from the schedule.
     */
    removeSchedule(scheduleId) {
        this.db.run('DELETE FROM workflow_schedules WHERE id = ?', [scheduleId]);
        return { success: true };
    }

    /**
     * Enable/disable a schedule.
     */
    toggleSchedule(scheduleId, enabled) {
        this.db.run('UPDATE workflow_schedules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, scheduleId]);
        return { success: true };
    }

    /**
     * Get all schedules.
     */
    _getAllSchedules() {
        try {
            return this.db.all('SELECT * FROM workflow_schedules ORDER BY next_run');
        } catch (e) {
            return [];
        }
    }

    /**
     * Get schedules that are due (next_run <= now AND enabled).
     */
    _getDueSchedules() {
        try {
            const now = new Date().toISOString();
            return this.db.all(
                `SELECT ws.*, w.name as workflow_name
                 FROM workflow_schedules ws
                 LEFT JOIN workflows w ON ws.workflow_id = w.id
                 WHERE ws.enabled = 1 AND ws.next_run <= ?
                 ORDER BY ws.next_run`,
                [now]
            );
        } catch (e) {
            return [];
        }
    }

    // ==================== DB Table ====================

    _ensureTable() {
        try {
            this.db.db.exec(`CREATE TABLE IF NOT EXISTS workflow_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workflow_id INTEGER NOT NULL,
                workflow_name TEXT DEFAULT '',
                interval_minutes INTEGER NOT NULL DEFAULT 60,
                last_run TEXT,
                next_run TEXT,
                enabled INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (workflow_id) REFERENCES workflows(id)
            )`);
        } catch (e) {
            // Table already exists
        }
    }

    // ==================== Resource Check ====================

    async _checkResources() {
        return await this._resourceMonitor.check();
    }
}

module.exports = BackgroundWorkflowScheduler;
