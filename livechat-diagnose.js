// Quick LiveChat diagnostics
require('dotenv').config();
const axios = require('axios');

const TOKEN = process.env.LIVECHAT_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
if (!TOKEN) {
  console.error('No LIVECHAT_ACCESS_TOKEN in environment');
  process.exit(1);
}

const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(TOKEN);
const headersVariants = [
  { name: 'Bearer', headers: { Authorization: `Bearer ${TOKEN}` } },
  { name: 'Basic', headers: { Authorization: `Basic ${TOKEN}` } }
];

(async () => {
  console.log('LiveChat token length:', TOKEN.length);
  console.log('Prefix:', TOKEN.slice(0,10)+'...');

  for (const variant of headersVariants) {
    try {
      const { data } = await axios.post('https://api.livechatinc.com/v3.5/agent/action/list_chats', {
        filters: { status: ['active','queued','pending'] },
        limit: 1
      }, { headers: { ...variant.headers, 'Content-Type':'application/json', Accept:'application/json' }, timeout: 8000 });
      console.log(`[${variant.name}] SUCCESS -> keys:`, Object.keys(data));
    } catch (e) {
      console.log(`[${variant.name}] FAIL -> status:`, e.response?.status, 'message:', e.response?.data?.error?.message || e.message);
    }
  }
})();
