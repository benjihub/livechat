#!/usr/bin/env node
require('dotenv').config();
const { getCustomerServiceResponse, getChatState } = require('./newtest3');

async function main() {
  const msg = process.argv.slice(2).join(' ').trim();
  if (!msg) {
    console.error('Usage: npm run cli:once -- "your message here"');
    process.exit(1);
  }
  const chatId = `cli_${new Date().toISOString().replace(/[:.]/g,'-')}`;
  getChatState(chatId);
  const reply = await getCustomerServiceResponse(chatId, msg, `${chatId}_1`);
  console.log(reply || '(no response)');
}

main().catch(e => { console.error(e.message); process.exit(1); });
