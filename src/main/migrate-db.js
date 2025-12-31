// Database migration helper
// Run this once to add new tables to existing database

const Database = require('better-sqlite3');
const path = require('path');

function migrateDatabase() {
    const { app } = require('electron');
    const dbPath = path.join(app.getPath('userData'), 'localagent.db');
    const db = new Database(dbPath);
    
    try {
        // Add prompt_rules table
        db.exec(`
            CREATE TABLE IF NOT EXISTS prompt_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                active BOOLEAN DEFAULT FALSE,
                type TEXT DEFAULT 'rule',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add chat_sessions table
        db.exec(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('Database migration completed successfully');
    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        db.close();
    }
}

module.exports = { migrateDatabase };
