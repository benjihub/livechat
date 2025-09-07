#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');

// Simple CLI to register/list/unregister LiveChat webhooks using Configuration API v3.6
// Requirements:
// - A Personal Access Token (PAT) with scope webhooks.configuration:rw in LIVECHAT_PAT
//   OR a Bearer access token in LIVECHAT_ACCESS_TOKEN
// - Your application Client ID in LIVECHAT_CLIENT_ID (owner_client_id)
// - Your webhook public URL in LIVECHAT_WEBHOOK_URL (must be reachable by LiveChat)
// - Shared secret to verify incoming webhooks in LIVECHAT_WEBHOOK_SECRET
// - Optional: LIVECHAT_API_BASE (defaults to https://api.livechatinc.com)

const API_BASE = process.env.LIVECHAT_API_BASE || 'https://api.livechatinc.com';
const OWNER_CLIENT_ID = process.env.LIVECHAT_CLIENT_ID || process.env.LIVECHAT_OWNER_CLIENT_ID || '';
const WEBHOOK_URL = process.env.LIVECHAT_WEBHOOK_URL || '';
const SECRET = process.env.LIVECHAT_WEBHOOK_SECRET || '';
const PAT = process.env.LIVECHAT_PAT || '';
const ACCESS = process.env.LIVECHAT_ACCESS_TOKEN || '';

function getAuthHeaders() {
  if (PAT) {
    // PAT can be used in Basic header as username:PAT, but API examples accept Bearer too using PAT
    return { Authorization: `Bearer ${PAT}` };
  }
  if (ACCESS) return { Authorization: `Bearer ${ACCESS}` };
  throw new Error('Provide LIVECHAT_PAT or LIVECHAT_ACCESS_TOKEN in environment.');
}

async function callConfig(action, body) {
  const url = `${API_BASE}/v3.6/configuration/action/${action}`;
  const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  const { data } = await axios.post(url, body, { headers });
  return data;
}

async function listWebhookNames() {
  const data = await callConfig('list_webhook_names', { version: '3.6' });
  console.log(JSON.stringify(data, null, 2));
}

async function listWebhooks() {
  if (!OWNER_CLIENT_ID) throw new Error('LIVECHAT_CLIENT_ID (owner_client_id) is required to list webhooks');
  const data = await callConfig('list_webhooks', { owner_client_id: OWNER_CLIENT_ID });
  console.log(JSON.stringify(data, null, 2));
}

async function registerWebhook(actionName, type = 'license') {
  if (!OWNER_CLIENT_ID) throw new Error('LIVECHAT_CLIENT_ID (owner_client_id) is required');
  if (!WEBHOOK_URL) throw new Error('LIVECHAT_WEBHOOK_URL is required');
  if (!SECRET) throw new Error('LIVECHAT_WEBHOOK_SECRET is required');
  const payload = {
    action: actionName,
    type, // 'license' or 'bot'
    owner_client_id: OWNER_CLIENT_ID,
    url: WEBHOOK_URL,
    secret_key: SECRET,
    description: `Registered via CLI for ${actionName}`,
    additional_data: ['chat_properties', 'chat_presence_user_ids']
  };
  const data = await callConfig('register_webhook', payload);
  console.log(JSON.stringify(data, null, 2));
}

async function unregisterWebhook(id) {
  if (!OWNER_CLIENT_ID) throw new Error('LIVECHAT_CLIENT_ID (owner_client_id) is required');
  if (!id) throw new Error('Webhook id is required');
  const payload = { id, owner_client_id: OWNER_CLIENT_ID };
  await callConfig('unregister_webhook', payload);
  console.log('OK');
}

async function enableLicenseWebhooks() {
  await callConfig('enable_license_webhooks', {});
  console.log('OK');
}

async function getLicenseWebhooksState() {
  const data = await callConfig('get_license_webhooks_state', {});
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case 'names':
        await listWebhookNames();
        break;
      case 'list':
        await listWebhooks();
        break;
      case 'register': {
        const actionName = rest[0] || 'incoming_event';
        const type = rest[1] || 'license';
        await registerWebhook(actionName, type);
        break;
      }
      case 'unregister': {
        const id = rest[0];
        await unregisterWebhook(id);
        break;
      }
      case 'enable':
        await enableLicenseWebhooks();
        break;
      case 'state':
        await getLicenseWebhooksState();
        break;
      default:
        console.log('Usage: node livechat-webhooks-cli.js <cmd>');
        console.log('  names                       # list supported webhook names (no auth)');
        console.log('  list                        # list registered webhooks for owner_client_id');
        console.log('  register <action> [type]    # register a webhook (type: license|bot)');
        console.log('  unregister <id>             # remove a webhook by id');
        console.log('  enable                      # enable license webhooks');
        console.log('  state                       # show license webhook state');
        process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.response?.data || e.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
