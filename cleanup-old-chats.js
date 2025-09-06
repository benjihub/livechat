const { cleanupOldChats } = require('./db-utils');

async function runCleanup() {
  try {
    console.log('Starting chat cleanup...');
    const deletedCount = await cleanupOldChats();
    console.log(`Successfully cleaned up ${deletedCount} old chats.`);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runCleanup();
