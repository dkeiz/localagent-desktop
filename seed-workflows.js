/**
 * Seed script — inserts sample workflows for testing.
 * Usage: npx electron . --seed ./seed-workflows.js
 */
module.exports = async ({ db, workflowManager }) => {
    const workflows = [
        {
            name: 'System Health Check',
            description: 'Checks memory usage, disk space, and current time — quick system overview',
            trigger_pattern: 'system health check status',
            tool_chain: [
                { tool: 'get_memory_usage', params: {} },
                { tool: 'get_disk_space', params: {} },
                { tool: 'current_time', params: {} }
            ]
        },
        {
            name: 'Morning Briefing',
            description: 'Lists today\'s calendar events, pending todos, and current weather',
            trigger_pattern: 'morning briefing daily summary',
            tool_chain: [
                { tool: 'list_calendar_events', params: { limit: 5 } },
                { tool: 'todo_list', params: { completed: false } },
                { tool: 'current_weather', params: { city: 'Moscow' } }
            ]
        },
        {
            name: 'Quick Web Research',
            description: 'Searches the web for a topic and fetches the top result',
            trigger_pattern: 'research search lookup',
            tool_chain: [
                { tool: 'search_web_bing', params: { query: 'example search' } },
                { tool: 'current_time', params: {} }
            ]
        }
    ];

    for (const wf of workflows) {
        try {
            await db.addWorkflow(wf);
            console.log(`  [Seed] ✅ ${wf.name} (${wf.tool_chain.length} tools)`);
        } catch (err) {
            console.log(`  [Seed] ⚠ ${wf.name}: ${err.message}`);
        }
    }

    console.log(`[Seed] Inserted ${workflows.length} sample workflows`);
};
