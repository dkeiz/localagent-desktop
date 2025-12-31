const Database = require('better-sqlite3');
const path = require('path');

class DatabaseWrapper {
    constructor() {
        const { app } = require('electron');
        this.dbPath = path.join(app.getPath('userData'), 'localagent.db');
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
    }

    async init() {
        try {
            await this.createTables();
            await this.seedDefaultRules();
            console.log('Database initialized');
        } catch (error) {
            console.error('Database initialization error:', error);
            throw error;
        }
    }

    async seedDefaultRules() {
        const existing = this.get('SELECT id FROM prompt_rules WHERE name = ?', ['Enforce Tool Usage']);
        if (!existing) {
            this.run(
                'INSERT INTO prompt_rules (name, content, active, type) VALUES (?, ?, ?, ?)',
                [
                    'Enforce Tool Usage',
                    'CRITICAL: You MUST use available tools for factual queries (time, date, weather, calendar, calculations). NEVER guess or use cached knowledge when a tool exists. Always call the appropriate tool first.',
                    0,
                    'system'
                ]
            );
        }
    }

    async createTables() {
        // Add session_id column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE conversations ADD COLUMN session_id INTEGER');
        } catch (e) {
            // Column already exists, ignore
        }

        const queries = [
            `CREATE TABLE IF NOT EXISTS calendar_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                start_time DATETIME NOT NULL,
                duration_minutes INTEGER DEFAULT 60,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task TEXT NOT NULL,
                completed BOOLEAN DEFAULT FALSE,
                priority INTEGER DEFAULT 1,
                due_date DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS api_keys (
                provider TEXT PRIMARY KEY,
                key TEXT NOT NULL,
                encrypted BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS prompt_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                active BOOLEAN DEFAULT FALSE,
                type TEXT DEFAULT 'rule',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const query of queries) {
            this.db.exec(query);
        }
    }

    run(sql, params = []) {
        const stmt = this.db.prepare(sql);
        const info = stmt.run(...params);
        return { id: info.lastInsertRowid, changes: info.changes };
    }

    get(sql, params = []) {
        const stmt = this.db.prepare(sql);
        return stmt.get(...params);
    }

    all(sql, params = []) {
        const stmt = this.db.prepare(sql);
        return stmt.all(...params);
    }

    close() {
        this.db.close();
        console.log('Database connection closed');
    }

    // Calendar methods
    async getCalendarEvents() {
        return this.all('SELECT * FROM calendar_events ORDER BY start_time');
    }

    async addCalendarEvent(event) {
        const { title, start_time, duration_minutes = 60, description = '' } = event;
        const result = this.run(
            'INSERT INTO calendar_events (title, start_time, duration_minutes, description) VALUES (?, ?, ?, ?)',
            [title, start_time, duration_minutes, description]
        );
        return { ...event, id: result.id };
    }

    async updateCalendarEvent(id, event) {
        const { title, start_time, duration_minutes, description } = event;
        this.run(
            'UPDATE calendar_events SET title = ?, start_time = ?, duration_minutes = ?, description = ? WHERE id = ?',
            [title, start_time, duration_minutes, description, id]
        );
        return { id, ...event };
    }

    async deleteCalendarEvent(id) {
        this.run('DELETE FROM calendar_events WHERE id = ?', [id]);
        return { id };
    }

    // Todo methods
    async getTodos() {
        return this.all('SELECT * FROM todos ORDER BY priority DESC, created_at');
    }

    async addTodo(todo) {
        const { task, priority = 1, due_date = null } = todo;
        const result = this.run(
            'INSERT INTO todos (task, priority, due_date) VALUES (?, ?, ?)',
            [task, priority, due_date]
        );
        return { ...todo, id: result.id };
    }

    async updateTodo(id, todo) {
        const { task, completed, priority, due_date } = todo;
        this.run(
            'UPDATE todos SET task = ?, completed = ?, priority = ?, due_date = ? WHERE id = ?',
            [task, completed, priority, due_date, id]
        );
        return { id, ...todo };
    }

    async deleteTodo(id) {
        this.run('DELETE FROM todos WHERE id = ?', [id]);
        return { id };
    }

    // Conversation methods
    async getConversations(limit = 100, sessionId = null) {
        if (sessionId) {
            return this.all('SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp', [sessionId]);
        }
        const session = await this.getCurrentSession();
        return this.all('SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp', [session.id]);
    }

    async addConversation(message) {
        const { role, content } = message;
        const session = await this.getCurrentSession();
        this.run(
            'INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)',
            [session.id, role, content]
        );
        this.run('UPDATE chat_sessions SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [session.id]);
        return message;
    }

    async clearConversations() {
        // Only clear conversations for current session
        const session = await this.getCurrentSession();
        this.run('DELETE FROM conversations WHERE session_id = ?', [session.id]);
        return { cleared: true };
    }

    // Prompt Rules methods
    async getPromptRules() {
        return this.all('SELECT * FROM prompt_rules ORDER BY created_at DESC');
    }

    async getActivePromptRules() {
        return this.all('SELECT * FROM prompt_rules WHERE active = 1 ORDER BY created_at');
    }

    async addPromptRule(rule) {
        const { name, content, type = 'rule' } = rule;
        const result = this.run(
            'INSERT INTO prompt_rules (name, content, type) VALUES (?, ?, ?)',
            [name, content, type]
        );
        return { ...rule, id: result.id, active: false };
    }

    async updatePromptRule(id, rule) {
        const { name, content, active } = rule;
        this.run(
            'UPDATE prompt_rules SET name = ?, content = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [name, content, active ? 1 : 0, id]
        );
        return { id, ...rule };
    }

    async togglePromptRule(id, active) {
        this.run(
            'UPDATE prompt_rules SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [active ? 1 : 0, id]
        );
        return { id, active };
    }

    async deletePromptRule(id) {
        this.run('DELETE FROM prompt_rules WHERE id = ?', [id]);
        return { id };
    }

    // Chat Sessions methods
    async createChatSession(title = null) {
        const result = this.run(
            'INSERT INTO chat_sessions (title) VALUES (?)',
            [title || `Chat ${new Date().toLocaleString()}`]
        );
        return { id: result.id, title };
    }

    async getChatSessions(date = null, limit = 6) {
        if (date) {
            // Get sessions for specific date
            return this.all(`
                SELECT cs.*, 
                       COUNT(c.id) as message_count,
                       (SELECT content FROM conversations WHERE session_id = cs.id AND role = 'user' ORDER BY timestamp LIMIT 1) as first_message
                FROM chat_sessions cs
                LEFT JOIN conversations c ON cs.id = c.session_id
                WHERE DATE(cs.created_at) = DATE(?)
                GROUP BY cs.id
                HAVING message_count > 0
                ORDER BY cs.last_message_at DESC
            `, [date]);
        }
        // Get last N sessions with messages
        return this.all(`
            SELECT cs.*, 
                   COUNT(c.id) as message_count,
                   (SELECT content FROM conversations WHERE session_id = cs.id AND role = 'user' ORDER BY timestamp LIMIT 1) as first_message
            FROM chat_sessions cs
            LEFT JOIN conversations c ON cs.id = c.session_id
            GROUP BY cs.id
            HAVING message_count > 0
            ORDER BY cs.last_message_at DESC
            LIMIT ?
        `, [limit]);
    }

    async loadChatSession(sessionId) {
        return this.all('SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp', [sessionId]);
    }

    async deleteChatSession(sessionId) {
        this.run('DELETE FROM conversations WHERE session_id = ?', [sessionId]);
        this.run('DELETE FROM chat_sessions WHERE id = ?', [sessionId]);
        return { success: true };
    }

    async getCurrentSession() {
        // Check if there's a current session setting
        const currentId = await this.getSetting('current_session_id');
        if (currentId) {
            const session = this.get('SELECT * FROM chat_sessions WHERE id = ?', [parseInt(currentId)]);
            if (session) return session;
        }
        
        // Otherwise get most recent
        const session = this.get('SELECT * FROM chat_sessions ORDER BY last_message_at DESC LIMIT 1');
        if (!session) {
            return await this.createChatSession();
        }
        return session;
    }

    async setCurrentSession(sessionId) {
        await this.setSetting('current_session_id', sessionId.toString());
        return { sessionId };
    }

    // Settings methods
    async getSetting(key) {
        try {
            const row = this.get('SELECT value FROM settings WHERE key = ?', [key]);
            return row ? row.value : null;
        } catch (error) {
            console.error(`Error getting setting '${key}':`, error);
            return null;
        }
    }

    async setSetting(key, value) {
        this.run(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [key, value]
        );
        return { key, value };
    }

    async saveSetting(key, value) {
        this.run(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [key, value]
        );
        return { key, value };
    }

    async getAllSettings() {
        const rows = this.all('SELECT key, value FROM settings');
        return rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
    }

    async getConfig() {
        const provider = await this.getSetting('llm.provider');
        const model = await this.getSetting('llm.model');
        const config = { provider, model };
        
        if (provider) {
            const apiKey = await this.getSetting(`llm.${provider}.apiKey`);
            const url = await this.getSetting(`llm.${provider}.url`);
            const useOAuth = await this.getSetting(`llm.${provider}.useOAuth`);
            if (apiKey) config.apiKey = apiKey;
            if (url) config.url = url;
            if (useOAuth === 'true') config.useOAuth = true;
        }
        
        return config;
    }

    // API Key methods
    async getAPIKey(provider) {
        const row = this.get('SELECT key FROM api_keys WHERE provider = ?', [provider]);
        return row ? row.key : null;
    }

    async setAPIKey(provider, key) {
        this.run(
            'INSERT OR REPLACE INTO api_keys (provider, key) VALUES (?, ?)',
            [provider, key]
        );
        return { provider };
    }
    
    async setActiveModel(provider, model) {
        // Save to settings table
        await this.setSetting(`active_model_${provider}`, model);
        return { provider, model };
    }

    // Tool activation methods
    async getToolStates() {
        const rows = this.all(`SELECT key, value FROM settings WHERE key LIKE 'tool.%.active'`);
        const states = {};
        rows.forEach(row => {
            const toolName = row.key.replace('tool.', '').replace('.active', '');
            states[toolName] = { active: row.value === 'true' };
        });
        return states;
    }

    async setToolActive(toolName, active) {
        const key = `tool.${toolName}.active`;
        const value = active ? 'true' : 'false';
        await this.setSetting(key, value);
        return { toolName, active };
    }
}

module.exports = DatabaseWrapper;
