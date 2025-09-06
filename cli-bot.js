#!/usr/bin/env node
// Simple terminal REPL to chat with the bot locally (no LiveChat API)
require('dotenv').config();
const readline = require('readline');

// Import bot functions (module will init DB and OpenAI per .env)
const {
  getCustomerServiceResponse,
  getChatState
} = require('./newtest3');

const chatId = `cli_${Date.now()}`;
let counter = 0;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'You > ' });

console.log('Local Bot REPL (no LiveChat)');
console.log('- Type your message and press Enter');
console.log('- Type /exit or press Ctrl+C to quit');
console.log('');
rl.prompt();

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) { rl.prompt(); return; }
  if (text === '/exit') { rl.close(); return; }

  try {
    // Ensure chat state exists
    getChatState(chatId);
    const messageId = `${chatId}_${++counter}`;
    const resp = await getCustomerServiceResponse(chatId, text, messageId);
    const reply = resp && typeof resp === 'string' ? resp : '(no response)';
    console.log(`Bot > ${reply}`);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    rl.prompt();
  }
}).on('close', () => {
  console.log('Goodbye!');
  process.exit(0);
});
