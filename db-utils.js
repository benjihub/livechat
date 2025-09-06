const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

const dbPath = path.join(__dirname, 'database', 'chats.db');
let dbInstance = null;

// Ensure database directory exists and initialize database
async function initDb() {
  if (dbInstance) return dbInstance;
  
  try {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    
    // Initialize the database with better-sqlite3
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    
    // Enable foreign key constraints
    db.pragma('foreign_keys = ON');
    
    // Create tables if they don't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        last_activity INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_chat_id ON messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_last_activity ON chats(last_activity);
    `);
    
    dbInstance = db;
    return db;
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Get or create chat state
async function getChatState(db, chatId) {
  try {
    const stmt = db.prepare('SELECT state FROM chats WHERE id = ?');
    const row = stmt.get(chatId);
    return row ? JSON.parse(row.state) : null;
  } catch (error) {
    console.error('Error getting chat state:', error);
    throw error;
  }
}

// Update chat state
async function updateChatState(db, chatId, state) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const stmt = db.prepare(`
      INSERT INTO chats (id, state, last_activity) 
      VALUES (?, ?, ?) 
      ON CONFLICT(id) DO UPDATE SET 
        state = excluded.state,
        last_activity = excluded.last_activity
    `);
    
    stmt.run(chatId, JSON.stringify(state), now);
  } catch (error) {
    console.error('Error updating chat state:', error);
    throw error;
  }
}

// Add message to chat
async function addMessage(db, chatId, role, content) {
  try {
    const stmt = db.prepare(
      'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)'
    );
    const info = stmt.run(chatId, role, content);
    return info.lastInsertRowid;
  } catch (error) {
    console.error('Error adding message:', error);
    throw error;
  }
}

// Get chat messages
async function getChatMessages(db, chatId, limit = 50) {
  try {
    const stmt = db.prepare(
      'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
    );
    return stmt.all(chatId, limit) || [];
  } catch (error) {
    console.error('Error getting chat messages:', error);
    throw error;
  }
}

// Clean up old chats (older than 48 hours)
async function cleanupOldChats() {
  try {
    const db = await getDb();
    const twoDaysAgo = Math.floor(Date.now() / 1000) - (48 * 60 * 60);
    
    const stmt = db.prepare('DELETE FROM chats WHERE last_activity < ?');
    const result = stmt.run(twoDaysAgo);
    return result.changes;
  } catch (error) {
    console.error('Error cleaning up old chats:', error);
    throw error;
  }
}

// Get the database instance
async function getDb() {
  if (!dbInstance) {
    await initDb();
  }
  return dbInstance;
}

module.exports = {
  initDb,
  getDb,
  getChatState,
  updateChatState,
  addMessage,
  getChatMessages,
  cleanupOldChats
};
