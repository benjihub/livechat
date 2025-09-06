#!/usr/bin/env node
// Reset chat state and/or messages for a given chatId
// Usage:
//   node reset-chat.js --id CHAT_ID [--clear-messages]

const { initDb, getDb } = require('./db-utils');

async function main() {
  const args = process.argv.slice(2);
  const chatIdIdx = args.indexOf('--id');
  if (chatIdIdx === -1 || !args[chatIdIdx + 1]) {
    console.error('Usage: node reset-chat.js --id CHAT_ID [--clear-messages]');
    process.exit(1);
  }
  const chatId = args[chatIdIdx + 1];
  const clearMessages = args.includes('--clear-messages');

  try {
    await initDb();
    const db = await getDb();

    // Reset chat state (keep record but set defaults)
    const emptyState = {
      context: { language: 'en', conversationHistory: [] },
      payment_state: 'GREETING',
      lastProcessedMessageId: null,
      lastResponseTime: null,
      started: Date.now(),
      offTopicWarningCount: 0,
      hasSentWelcome: false,
      validation: {
        telegram_user_identified: null,
        cid_verified: null,
        plan_validated: null,
        plan_refetched: null,
        subscription_confirmed: null,
        currency_conversion_applied: null,
        payment_details_ready: null,
        transaction_extracted: null,
        data_submitted_to_agent: null,
        ready_for_processing: null,
        cid_attempts: 0,
        subscription_attempts: 0,
        payment_attempts: 0
      }
    };

    const up = db.prepare(`
      INSERT INTO chats (id, state, last_activity)
      VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(id) DO UPDATE SET state=excluded.state, last_activity=excluded.last_activity
    `);
    up.run(chatId, JSON.stringify(emptyState));

    if (clearMessages) {
      const del = db.prepare('DELETE FROM messages WHERE chat_id = ?');
      const info = del.run(chatId);
      console.log(`Deleted ${info.changes} messages for chat ${chatId}`);
    }

    console.log(`Reset state for chat ${chatId}`);
    process.exit(0);
  } catch (e) {
    console.error('Failed to reset chat:', e.message);
    process.exit(1);
  }
}

main();
