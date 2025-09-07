const axios = require('axios');
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { getPromotions, formatPromotions } = require('./promotions');
const PROMOTIONS_FILE = path.join(__dirname, 'promotions.json');
const dbUtils = require('./db-utils');

// Initialize database connection
dbUtils.initDb().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

const ACCESS_TOKEN = process.env.LIVECHAT_ACCESS_TOKEN || '';
if (!ACCESS_TOKEN) {
  console.warn('WARNING: LIVECHAT_ACCESS_TOKEN not set. LiveChat features in smart-payment-ai are disabled.');
}

let openai = null;
(async () => {
  try {
    if (process.env.USE_OPENAI && process.env.OPENAI_API_KEY) {
      const mod = await import('openai');
      const OpenAI = mod.OpenAI || mod.default;
      if (OpenAI) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        console.log('✅ OpenAI (smart-payment-ai) enabled');
      }
    }
  } catch (e) {
    console.warn('OpenAI init failed in smart-payment-ai:', e.message);
  }
})();

// Game information and rules
const GAME_INFO = {
  'slot': {
    name: '🎰 Slot Machines',
    description: 'Classic slot machines with various themes and jackpots',
    rules: '1. Select your bet amount\n2. Spin the reels\n3. Match symbols to win\n4. Special symbols trigger bonus rounds',
    min_bet: 1000,
    max_bet: 5000000
  },
  'poker': {
    name: '♠️ Poker',
    description: 'Classic Texas Hold\'em poker against other players',
    rules: '1. Blinds are posted\n2. Players receive hole cards\n3. Betting rounds: Pre-flop, Flop, Turn, River\n4. Best 5-card hand wins the pot',
    min_bet: 5000,
    max_bet: 10000000
  },
  'blackjack': {
    name: '🃏 Blackjack',
    description: 'Beat the dealer without going over 21',
    rules: '1. Cards 2-10 = face value\n2. Face cards = 10\n3. Ace = 1 or 11\n4. Closest to 21 wins',
    min_bet: 2000,
    max_bet: 5000000
  },
  'roulette': {
    name: '🎡 Roulette',
    description: 'Bet on numbers, colors, or sections of the wheel',
    rules: '1. Place chips on betting area\n2. Ball is spun on wheel\n3. Winning number/color is announced\n4. Payouts based on bet type',
    min_bet: 1000,
    max_bet: 10000000
  },
  'baccarat': {
    name: '🎴 Baccarat',
    description: 'Simple card game betting on Player or Banker',
    rules: '1. Bet on Player, Banker, or Tie\n2. Two cards dealt to each\n3. Closest to 9 wins\n4. Face cards = 0, Ace = 1',
    min_bet: 10000,
    max_bet: 20000000
  }
};

// Human support request types that trigger notifications
const HUMAN_SUPPORT_REQUESTS = [
  'withdraw', 'withdrawal', 'tarik dana', 'penarikan',
  'account', 'akun', 'profile', 'profil',
  'verification', 'verifikasi', 'kyc',
  'problem', 'masalah', 'issue', 'kendala',
  'help', 'bantuan', 'tolong', 'sos',
  'password', 'reset password', 'ganti password', 'lupa password',
  'create account', 'buat akun', 'register', 'daftar',
  'withdraw', 'withdrawal', 'withdraw money', 'tarik tunai'
];

// Enhanced promo-related intents
const isPromoQuery = (message) => {
  const lowerMsg = message.toLowerCase();
  return (
    /(promo|bonus|discount|voucher|kode promo|promosi|hadiah)/i.test(lowerMsg) ||
    /(what.*promo|what.*bonus|ada.*promo|ada.*bonus|list.*promo|list.*bonus)/i.test(lowerMsg) ||
    /(promo.*apa|bonus.*apa|discount.*apa)/i.test(lowerMsg)
  );
};

// Format promo expiration date
const formatExpirationDate = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + parseInt(days));
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
};

// Keywords that should trigger support pinging
const SUPPORT_KEYWORDS = [
  'withdraw', 'withdrawal', 'tarik dana', 'penarikan',
  'account', 'akun', 'profile', 'profil',
  'verification', 'verifikasi', 'kyc',
  'problem', 'masalah', 'issue', 'kendala',
  'help', 'bantuan', 'tolong', 'sos',
  'password', 'reset password', 'ganti password', 'lupa password',
  'create account', 'buat akun', 'register', 'daftar',
  'withdraw', 'withdrawal', 'withdraw money', 'tarik tunai'
];

// Supported banks and payment channels
const SUPPORTED_BANKS = [
  'BCA', 'BNI', 'BRI', 'Mandiri', 'CIMB Niaga', 'Permata', 'Danamon',
  'Maybank', 'OCBC NISP', 'BSI', 'SeaBank'
];

function isBankInfoQuery(message) {
  const t = (message || '').toLowerCase();
  return (
    /(what|which)\s+(bank|banks)\s+do\s+(you|u)\s+(have|support|provide|accept)/.test(t) ||
    /do\s+(you|u)\s+accept\s+(bank|banks)/.test(t) ||
    /(supported|available)\s+banks?/.test(t) ||
    /(bank list|daftar bank)/.test(t) ||
    /bank\s+(apa|apa saja)\s*(yang )?(tersedia|didukung|kalian punya|diterima)/.test(t) ||
    /(menerima|terima|accept)\s+bank(s)?/.test(t) ||
    /(bank|rekening).*\b(accept|diterima|supported)\b/.test(t)
  );
}

// Revalidate a chat is still active before attempting to send
// Helper to POST to LiveChat with Basic/Bearer fallback
async function livechatPost(path, body, { timeout = 8000, label = 'livechat' } = {}) {
  const url = `https://api.livechatinc.com/v3.5${path}`;
  const strategies = [
    { Authorization: `Basic ${ACCESS_TOKEN}` },
    { Authorization: `Bearer ${ACCESS_TOKEN}` }
  ];
  let lastErr;
  for (let i = 0; i < strategies.length; i++) {
    try {
      const { data } = await axios.post(url, body, { headers: { ...strategies[i], 'Content-Type': 'application/json', Accept: 'application/json' }, timeout });
      return data;
    } catch (e) {
      lastErr = e;
      const status = e.response?.status;
      if (status === 401 || status === 403) {
        // try next auth style
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

async function isChatStillActive(chatId) {
  try {
    const data = await livechatPost('/agent/action/list_chats', { filters: { status: ['active', 'queued', 'pending'] }, limit: 50 }, { label: 'list_chats' });
    const chats = data?.chats_summary || data?.chats || data?.data?.chats || [];
    const found = (Array.isArray(chats) ? chats : []).find(c => (c.id || c.chat_id || c.chat?.id) === chatId);
    if (!found) return false;
    const status = found.status || found.chat?.status;
    return status !== 'archived' && status !== 'closed';
  } catch (e) {
    console.warn(`⚠️ isChatStillActive check failed for ${chatId}:`, e.response?.data?.error?.message || e.message);
    // Be conservative and prevent sending if we cannot verify
    return false;
  }
}

function isBankChangeIntent(message) {
  const t = (message || '').toLowerCase();
  return (
    /(change|update|ganti|ubah).*bank/.test(t) ||
    /(change|update|ganti|ubah).*rekening/.test(t) ||
    /(edit|perbarui|update).*bank/.test(t)
  );
}

// Function to generate current timestamp in default format
function getCurrentTimestamp() {
  const now = new Date();
  return now.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// Configuration
const POLL_INTERVAL = 5000;

// Smart State Management
const chatStates = new Map();
const processedMessages = new Map();
const MESSAGE_TTL = 5 * 60 * 1000; // 5 minutes TTL for message tracking

// Clean up old message IDs periodically
setInterval(() => {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_TTL) {
      processedMessages.delete(messageId);
    }
  }
}, MESSAGE_TTL);

const lastResponseTimes = new Map();
const sentMessages = new Map();

// Payment Assistant Templates
const PAYMENT_TEMPLATES = {
  en: {
    welcome: "Hello! I'm here to help you with your Cekipos payment, bro. Can you share your CID? Don't have it handy? Just type /mycid in your Telegram channel that has Cekipos subscription activated.",
    cid_collected: "Perfect! I got your CID, bro. I see you have {current_subscription}. For extension, here are your payment details: Amount: {amount} USDT. Send your payment to: {transfer_address}. Once you've sent it, just upload your payment screenshot here and I'll handle the verification!",
    upgrade_options: "Got it, bro! You want to {plan_type}. Here are the available subscription options:\n{options}\nWhich one would you like to choose?",
    payment_received: "Awesome, bro! I've verified your payment details and everything looks good! Submitting this to our team for final processing now. You should hear back soon! Thanks for your patience.",
    completion: "Perfect, bro! All done! I've submitted your payment details to our team for processing. What happens next: Our agent will verify your payment, your {plan} subscription will be activated, and you'll get confirmation once it's complete! Thanks for choosing Cekipos!",
    out_of_scope: "I'm only here to help with payment processing, bro. For questions about {topic}, I can connect you with our support team who can give you detailed info! Would you like me to inform for assistance?",
    handoff: "I'm having trouble helping you with this, bro. Let me connect you with our support team. Please contact @cscekipos for immediate assistance."
  },
  id: {
    welcome: "Halo! Saya di sini untuk membantu kakak dengan pembayaran Cekipos nya. Bisakah bagikan CID kakak? Ketik saja /mycid di channel Telegram kakak sendiri yang sudah berlangganan Cekipos.",
    cid_collected: "Sempurna! CID kakak sudah saya dapat. Saya lihat kakak punya {current_subscription}. Untuk perpanjangan, ini detail pembayaran nya: Jumlah: {amount} USDT. Kirim pembayaran ke: {transfer_address}. Setelah kakak kirim, upload saja screenshot pembayaran nya di sini dan saya akan verifikasi!",
    upgrade_options: "Baik kakak! Kakak mau {plan_type}. Ini pilihan langganan yang tersedia:\n{options}\nMana yang mau kakak pilih?",
    payment_received: "Mantap, kak! Saya sudah verifikasi detail pembayaran kakak dan semua oke! Sekarang saya submit ke tim untuk proses final. Kakak akan dapat kabar segera! Makasih ya sabar nya.",
    completion: "Sempurna, kak! Semua beres! Saya sudah submit detail pembayaran kakak ke tim untuk diproses. Yang terjadi selanjutnya: Agen kami akan verifikasi pembayaran kakak, langganan {plan} kakak akan diaktifkan, dan kakak akan dapat konfirmasi setelah selesai! Makasih sudah pilih Cekipos!",
    out_of_scope: "Saya hanya membantu untuk proses pembayaran saja, kak. Untuk pertanyaan tentang {topic}, saya bisa hubungkan kakak dengan tim support yang bisa kasih info lengkap! Mau saya arahkan kakak ke tim support untuk bantuan?",
    handoff: "Saya agak kesulitan membantu kakak untuk ini. Biar saya hubungkan dengan tim support ya. Silakan hubungi @cscekipos untuk bantuan langsung."
  }
};

// Payment Assistant States
const PAYMENT_STATES = {
  GREETING: 'greeting',
  COLLECTING_CID: 'collecting_cid',
  FETCHING_INFO: 'fetching_info',
  READY_FOR_PAYMENT: 'ready_for_payment',
  SHOWING_SUBSCRIPTION_OPTIONS: 'showing_subscription_options',
  COLLECTING_SUBSCRIPTION: 'collecting_subscription',
  PLAN_CHANGED: 'plan_changed',
  AWAITING_PAYMENT: 'awaiting_payment',
  PROCESSING: 'processing',
  SUBMITTED_TO_AGENT: 'submitted_to_agent',
  HANDOFF: 'handoff',
  OUT_OF_SCOPE: 'out_of_scope',
  ERROR: 'error'
};

// Initialize Chat State with Payment Assistant
function getChatState(chatId) {
  const db = dbUtils.getDb();
  if (!db) {
    console.error('Database not initialized');
    return {
      state: 'AWAITING_INITIAL_MESSAGE',
      context: {
        language: 'en',
        lastInteraction: Date.now()
      }
    };
  }
  if (!chatStates.has(chatId)) {
    chatStates.set(chatId, {
      context: {
        language: 'en',
        telegram_username: null,
        telegram_from_id: null,
        cid: null,
        plan: 'EXTEND',
        subscription_type: null,
        preferred_currency: 'USDT',
        transfer_address: null,
        transfer_amount: null,
        original_price_usdt: null,
        converted_price_idr: null,
        idr_rate: null,
        transaction_date: null,
        transaction_id: null,
        currency: null,
        transaction_amount: null,
        conversationHistory: []
      },
      payment_state: PAYMENT_STATES.GREETING,
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
    });
  }
  return chatStates.get(chatId);
}

// Enhanced Off-Topic Detection for Gambling Support Site
function detectOffTopic(message) {
  const text = message.toLowerCase();
  
  // Gambling and payment-related keywords (should NOT be off-topic)
  const gamblingKeywords = [
    'cid', 'cekipos', 'payment', 'pembayaran', 'subscription', 'langganan',
    'extend', 'perpanjang', 'upgrade', 'downgrade', 'plan', 'paket',
    'usdt', 'idr', 'transfer', 'kirim', 'upload', 'screenshot', 'bukti',
    'transaction', 'transaksi', 'amount', 'jumlah', 'price', 'harga',
    'bet', 'taruhan', 'gamble', 'judi', 'casino', 'slot', 'poker', 'togel',
    'win', 'menang', 'lose', 'lsoe', 'kalah', 'profit', 'untung', 'loss', 'rugi',
    'deposit', 'setor', 'withdraw', 'tarik', 'balance', 'saldo', 'bonus',
    'promo', 'promotion', 'jackpot', 'jackpot', 'odds', 'peluang', 'chance',
    'lucky', 'beruntung', 'unlucky', 'sial', 'winning', 'losing', 'profit',
    'money', 'uang', 'cash', 'tunai', 'bank', 'rekening', 'account', 'akun'
  ];
  
  // Story telling indicators (off-topic)
  const storyKeywords = [
    'kemarin', 'tadi', 'baru saja', 'sebelumnya', 'waktu itu', 'dulu', 'pas', 'ketika',
    'yesterday', 'earlier', 'just now', 'before', 'that time', 'when', 'then', 'once',
    'cerita', 'story', 'kejadian', 'incident', 'pengalaman', 'experience', 'hal lucu', 'funny thing'
  ];
  
  // Rant indicators (off-topic)
  const rantKeywords = [
    'kesal', 'marah', 'jengkel', 'sebel', 'capek', 'lelah', 'bosan', 'stress', 'frustasi',
    'angry', 'frustrated', 'tired', 'bored', 'stress', 'annoyed', 'sick of', 'fed up',
    'gak enak', 'tidak nyaman', 'ribet', 'complicated', 'susah', 'difficult', 'masalah', 'problem'
  ];
  
  // Casual chat indicators (off-topic)
  const casualKeywords = [
    'apa kabar', 'how are you', 'lagi apa', 'what are you doing', 'lagi dimana', 'where are you',
    'makan apa', 'what are you eating', 'lagi kerja', 'are you working', 'liburan', 'holiday',
    'hobi', 'hobby', 'film', 'movie', 'musik', 'music', 'game', 'permainan', 'sport', 'olahraga',
    'weather', 'cuaca', 'hot', 'panas', 'cold', 'dingin', 'rain', 'hujan', 'sunny', 'cerah',
    "what's the weather", "how's the weather", "weather today", "cuaca hari ini"
  ];
  
  // Personal questions (off-topic)
  const personalKeywords = [
    'who are you', 'siapa kamu', 'what are you', 'apa kamu', 'are you human', 'kamu manusia',
    'are you real', 'kamu asli', 'are you a bot', 'kamu bot', 'are you ai', 'kamu ai',
    'what can you do', 'apa yang bisa kamu lakukan', 'what can i ask', 'apa yang bisa saya tanya',
    'tell me about yourself', 'ceritakan tentang dirimu', 'what is your name', 'siapa namamu'
  ];
  
  // General off-topic indicators
  const offTopicKeywords = [
    'politik', 'politics', 'berita', 'news', 'gossip', 'gosip', 'selebriti', 'celebrity',
    'inflasi', 'inflation', 'ekonomi', 'economy', 'covid', 'virus', 'vaksin', 'vaccine',
    'lockdown', 'pandemi', 'pandemic', 'test', 'testing', 'tes', 'coba', 'try'
  ];
  
  // Check for gambling/payment-related content first
  const hasGamblingKeywords = gamblingKeywords.some(k => text.includes(k));
  if (hasGamblingKeywords) {
    return { isOffTopic: false, type: 'gambling', score: -5 };
  }
  
  // Helper to check if any keyword matches
  function matchesAny(keywords) {
    return keywords.some(k => text.includes(k));
  }
  
  // Scoring system
  let score = 0;
  
  if (matchesAny(storyKeywords)) score += 3;
  if (matchesAny(rantKeywords)) score += 3;
  if (matchesAny(casualKeywords)) score += 3; // Increased from 2 to 3
  if (matchesAny(offTopicKeywords)) score += 2;
  if (matchesAny(personalKeywords)) score += 4;
  
  // Check for long messages (likely off-topic)
  const isLongMessage = message.length > 100;
  if (isLongMessage) score += 2;
  
  // Check for emotional indicators
  const emotionalIndicators = ['😡', '😤', '😠', '😞', '😔', '😢', '😭', '🤬', '💔', '😩', '😫', '😖', '😣'];
  const hasEmotionalEmojis = emotionalIndicators.some(emoji => message.includes(emoji));
  if (hasEmotionalEmojis) score += 1;
  
  // Check for story patterns
  const storyPatterns = [
    /kemarin\s+.*\s+/, /tadi\s+.*\s+/, /waktu\s+itu\s+/, /dulu\s+.*\s+/,
    /yesterday\s+.*\s+/, /earlier\s+.*\s+/, /that\s+time\s+/, /when\s+.*\s+/
  ];
  const hasStoryPattern = storyPatterns.some(pattern => pattern.test(message));
  if (hasStoryPattern) score += 2;
  
  // Check for very short messages (likely off-topic)
  const isVeryShortMessage = message.length <= 10 && !hasGamblingKeywords;
  if (isVeryShortMessage) score += 3;
  
  // Reduce score for greetings
  if (text.includes('hello') || text.includes('hi') || text.includes('halo') || text.includes('hai')) {
    score -= 2;
  }
  
  return {
    isOffTopic: score >= 3,
    type: score >= 3 ? (matchesAny(personalKeywords) ? 'personal' :
                        matchesAny(storyKeywords) ? 'story' : 
                        matchesAny(rantKeywords) ? 'rant' : 
                        matchesAny(casualKeywords) ? 'casual' : 'offtopic') : 'offtopic',
    score: score
  };
}

// Extract CID from message
function extractCID(message) {
  const cidPatterns = [
    /cid[:\s]*(\d+)/i,
    /cekipos[:\s]*(\d+)/i,
    /(\d{4,10})/ // Simple numeric pattern for CID
  ];
  
  for (const pattern of cidPatterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

// Extract plan type from message
function extractPlanType(message) {
  const text = message.toLowerCase();
  
  if (text.includes('upgrade') || text.includes('naik')) {
    return 'UPGRADE';
  } else if (text.includes('downgrade') || text.includes('turun')) {
    return 'DOWNGRADE';
  } else if (text.includes('extend') || text.includes('perpanjang')) {
    return 'EXTEND';
  }
  
  return 'EXTEND'; // Default
}

// Extract currency preference
function extractCurrencyPreference(message) {
  const text = message.toLowerCase();
  
  if (text.includes('idr') || text.includes('rupiah') || text.includes('rp')) {
    return 'IDR';
  } else if (text.includes('usdt') || text.includes('dollar') || text.includes('dolar')) {
    return 'USDT';
  }
  
  return 'USDT'; // Default
}

// Mock Search CID function (replace with actual API call)
async function searchCID(cid) {
  // Mock response - replace with actual API integration
  return {
    success: true,
    data: {
      current_subscription: 'Premium Monthly',
      expiry_date: '2024-02-15',
      available_plans: [
        { name: 'Premium Monthly', price: 125, currency: 'USDT' },
        { name: 'Premium Yearly', price: 1200, currency: 'USDT' },
        { name: 'Business Monthly', price: 250, currency: 'USDT' },
        { name: 'Business Yearly', price: 2400, currency: 'USDT' }
      ],
      transfer_address: '0x1dC45622D4ba8B70e11190873cbEB03408Df3f08',
      idr_rate: 15600
    }
  };
}

// Process payment assistant logic
async function processPaymentAssistant(chatId, userMessage, chatState) {
  const context = chatState.context;
  const templates = PAYMENT_TEMPLATES[context.language];
  
  // Extract user information
  const cid = extractCID(userMessage);
  const planType = extractPlanType(userMessage);
  const currency = extractCurrencyPreference(userMessage);
  
  // Update context
  if (cid) context.cid = cid;
  if (planType !== 'EXTEND') context.plan = planType;
  if (currency !== 'USDT') context.preferred_currency = currency;
  
  // Store message in history
  context.conversationHistory.push({
    message: userMessage,
    timestamp: Date.now(),
    type: 'user'
  });
  
  // Keep only last 10 messages
  if (context.conversationHistory.length > 10) {
    context.conversationHistory = context.conversationHistory.slice(-10);
  }
  
  // State machine logic
  switch (chatState.payment_state) {
    case PAYMENT_STATES.GREETING:
      chatState.payment_state = PAYMENT_STATES.COLLECTING_CID;
      return templates.welcome;
      
    case PAYMENT_STATES.COLLECTING_CID:
      if (cid) {
        chatState.payment_state = PAYMENT_STATES.FETCHING_INFO;
        context.validation.cid_verified = true;
        
        // Fetch subscription info
        const subscriptionInfo = await searchCID(cid);
        if (subscriptionInfo.success) {
          const data = subscriptionInfo.data;
          context.transfer_address = data.transfer_address;
          context.idr_rate = data.idr_rate;
          
          if (context.plan === 'EXTEND') {
            // Default extension flow
            const currentPlan = data.available_plans.find(p => p.name === data.current_subscription);
            if (currentPlan) {
              context.transfer_amount = currentPlan.price;
              context.original_price_usdt = currentPlan.price;
              chatState.payment_state = PAYMENT_STATES.READY_FOR_PAYMENT;
              
              return templates.cid_collected
                .replace('{current_subscription}', data.current_subscription)
                .replace('{amount}', currentPlan.price)
                .replace('{transfer_address}', data.transfer_address);
            }
          } else {
            // Upgrade/Downgrade flow
            chatState.payment_state = PAYMENT_STATES.SHOWING_SUBSCRIPTION_OPTIONS;
            const options = data.available_plans
              .map(plan => `- ${plan.name}: ${plan.price} USDT`)
              .join('\n');
            
            return templates.upgrade_options
              .replace('{plan_type}', context.plan.toLowerCase())
              .replace('{options}', options);
          }
        }
      } else {
        context.validation.cid_attempts++;
        if (context.validation.cid_attempts >= 3) {
          chatState.payment_state = PAYMENT_STATES.HANDOFF;
          return templates.handoff;
        }
        return templates.welcome;
      }
      break;
      
    case PAYMENT_STATES.SHOWING_SUBSCRIPTION_OPTIONS:
      // User selected a subscription type
      const selectedPlan = context.conversationHistory
        .slice(-3)
        .find(msg => msg.type === 'user' && 
          (msg.message.toLowerCase().includes('premium') || 
           msg.message.toLowerCase().includes('business') ||
           msg.message.toLowerCase().includes('monthly') ||
           msg.message.toLowerCase().includes('yearly')));
      
      if (selectedPlan) {
        // Extract plan details (simplified)
        const planMatch = selectedPlan.message.toLowerCase().match(/(premium|business)\s+(monthly|yearly)/);
        if (planMatch) {
          const planName = `${planMatch[1].charAt(0).toUpperCase() + planMatch[1].slice(1)} ${planMatch[2].charAt(0).toUpperCase() + planMatch[2].slice(1)}`;
          const subscriptionInfo = await searchCID(context.cid);
          
          if (subscriptionInfo.success) {
            const selectedPlanData = subscriptionInfo.data.available_plans.find(p => p.name === planName);
            if (selectedPlanData) {
              context.subscription_type = planName;
              context.transfer_amount = selectedPlanData.price;
              context.original_price_usdt = selectedPlanData.price;
              chatState.payment_state = PAYMENT_STATES.READY_FOR_PAYMENT;
              
              return templates.cid_collected
                .replace('{current_subscription}', subscriptionInfo.data.current_subscription)
                .replace('{amount}', selectedPlanData.price)
                .replace('{transfer_address}', subscriptionInfo.data.transfer_address);
            }
          }
        }
      }
      
      context.validation.subscription_attempts++;
      if (context.validation.subscription_attempts >= 3) {
        chatState.payment_state = PAYMENT_STATES.HANDOFF;
        return templates.handoff;
      }
      
      return "Please select a subscription plan from the options above.";
      
    case PAYMENT_STATES.READY_FOR_PAYMENT:
      // Check if user uploaded payment proof or mentioned payment
      if (userMessage.toLowerCase().includes('upload') || 
          userMessage.toLowerCase().includes('screenshot') ||
          userMessage.toLowerCase().includes('bukti') ||
          userMessage.toLowerCase().includes('kirim')) {
        chatState.payment_state = PAYMENT_STATES.PROCESSING;
        return templates.payment_received;
      }
      
      return "Please upload your payment screenshot when ready!";
      
    case PAYMENT_STATES.PROCESSING:
      chatState.payment_state = PAYMENT_STATES.SUBMITTED_TO_AGENT;
      return templates.completion.replace('{plan}', context.subscription_type || context.plan);
      
    case PAYMENT_STATES.SUBMITTED_TO_AGENT:
      return "Your payment has been submitted for processing. You'll receive confirmation soon!";
      
    case PAYMENT_STATES.HANDOFF:
      return templates.handoff;
      
    default:
      return null;
  }
}

// API Functions
async function getActiveChats() {
  try {
    const data = await livechatPost('/agent/action/list_chats', { filters: { status: ['active', 'queued', 'pending'] }, limit: 20 }, { label: 'list_chats' });
    const chats = data?.chats_summary || data?.chats || data?.data?.chats || data;
    const activeChats = Array.isArray(chats) ? chats.filter(chat => {
      const status = chat.status || chat.chat?.status;
      return status !== 'archived' && status !== 'closed';
    }) : [];
    return activeChats;
  } catch (error) {
    console.error('Failed to get chats:', error.response?.data || error.message);
    return [];
  }
}

async function sendMessage(chatId, message) {
  const strategies = [
    async () => {
      return await axios.post(
        'https://api.livechatinc.com/v3.5/agent/action/send_event',
        {
          chat_id: chatId,
          event: {
            type: 'message',
            text: message,
            recipients: 'all'
          }
        },
        {
          headers: {
            Authorization: `Basic ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: 3000
        }
      );
    },
    async () => {
      return await axios.post(
        'https://api.livechatinc.com/v3.5/agent/action/send_event',
        {
          chat_id: chatId,
          event: {
            type: 'message',
            text: message,
            recipients: 'all'
          }
        },
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: 3000
        }
      );
    }
  ];

  // Try strategies sequentially to avoid duplicate sends
  for (let i = 0; i < strategies.length; i++) {
    try {
      await strategies[i]();
      console.log(`✅ Message sent to ${chatId} (strategy ${i + 1})`);
      return true;
    } catch (error) {
      console.log(`Strategy ${i + 1} failed:`, error.response?.data?.error?.message || error.message);
      // try next strategy
    }
  }

  console.error(`❌ All strategies failed for chat ${chatId}`);
  return false;
}

async function getLatestCustomerMessage(chatId) {
  try {
    const data = await livechatPost('/agent/action/list_threads', { chat_id: chatId }, { label: 'list_threads', timeout: 8000 });

    const allEvents = (data.threads || []).flatMap(thread => thread.events || []);
    
    const customerMessages = allEvents
      .filter(event => {
        if (event.type !== 'message' || !event.text || !event.author_id) {
          return false;
        }
        
        const authorId = event.author_id.toLowerCase();
        if (authorId.includes('agent') || authorId.includes('bot') || authorId.includes('system')) {
          return false;
        }
        
        const messageText = event.text.toLowerCase();
        const botIndicators = [
          'hello boss', 'how can i help', 'bosku', 'mohon ditunggu', 'baik bosku',
          'selamat bermain', 'good luck', 'terima kasih', 'thank you',
          'deposit has been processed', 'withdrawal has been processed',
          'please wait', 'mohon menunggu', 'will be processed'
        ];
        
        if (botIndicators.some(indicator => messageText.includes(indicator))) {
          return false;
        }
        
        return true;
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (customerMessages.length === 0) return null;

    const latestMessage = customerMessages[0];
    // Use a stable message ID to avoid re-processing on each poll
    const createdAtMs = latestMessage.created_at ? new Date(latestMessage.created_at).getTime() : null;
    const stableIdPart = latestMessage.id || createdAtMs || Buffer.from(`${latestMessage.text}`).toString('base64');
    return {
      ...latestMessage,
      messageId: `${chatId}_${stableIdPart}`
    };
    
  } catch (error) {
    console.error(`❌ Error getting messages for ${chatId}:`, error.response?.data || error.message);
    return null;
  }
}

async function ensureParticipating(chatId) {
  // Try accept, then join; ignore failures
  try { await livechatPost('/agent/action/accept_chat', { chat_id: chatId }, { label: 'accept_chat' }); } catch(_) {}
  try { await livechatPost('/agent/action/join_chat', { chat_id: chatId }, { label: 'join_chat' }); } catch(_) {}
}

async function processChat(chat) {
  try {
    const latestMessage = await getLatestCustomerMessage(chat.id);
    if (!latestMessage) return;

    // Check if we've already processed this message
    const messageKey = `${chat.id}_${latestMessage.messageId}`;
    if (processedMessages.has(messageKey)) {
      console.log(`🚫 Skipping already processed message ${latestMessage.messageId} in chat ${chat.id}`);
      return null;
    }
    
    // Mark this message as processed with current timestamp
    processedMessages.set(messageKey, Date.now());

    // Anti-spam: per-chat cooldown
    const COOLDOWN_MS = 8000; // 8s cooldown between bot replies per chat
    const nowTs = Date.now();
    const lastRespAt = lastResponseTimes.get(chat.id) || 0;
    if (nowTs - lastRespAt < COOLDOWN_MS) {
      console.log(`⏳ Cooldown active for ${chat.id}, skipping send`);
      return null;
    }

    const response = await getSmartResponse(chat.id, latestMessage.text, latestMessage.messageId);
    
    if (response) {
      // Revalidate chat activity immediately before send to avoid "Chat not active" errors
      const stillActive = await isChatStillActive(chat.id);
      if (!stillActive) {
        console.log(`🚫 Chat ${chat.id} is no longer active. Skipping send.`);
        // Still mark as processed to avoid retries
        processedMessages.set(messageKey, Date.now());
        return null;
      }
      // Ensure we are a participant (accept/join if needed)
      await ensureParticipating(chat.id);
      // Anti-duplicate: avoid sending identical text within 60 seconds
      const DUP_WINDOW_MS = 60000;
      const lastSent = sentMessages.get(chat.id);
      if (lastSent && lastSent.text === response && (nowTs - lastSent.at) < DUP_WINDOW_MS) {
        console.log(`🔁 Duplicate response suppressed for ${chat.id}`);
        // Still mark as processed
        processedMessages.set(messageKey, Date.now());
        return null;
      }
      const sent = await sendMessage(chat.id, response);
      
      if (sent) {
        // Mark as processed (refresh timestamp for TTL)
        processedMessages.set(messageKey, Date.now());
        const chatState = getChatState(chat.id);
        chatState.lastProcessedMessageId = latestMessage.messageId;
        lastResponseTimes.set(chat.id, Date.now());
        sentMessages.set(chat.id, { text: response, at: Date.now() });
        console.log(`✅ Response sent to ${chat.id}: "${response.substring(0, 50)}..."`);
      }
    } else {
      console.log(`⚠️ No response generated for ${chat.id}`);
      // Still mark as processed to avoid re-evaluating the same message repeatedly
      processedMessages.set(messageKey, Date.now());
    }
    
  } catch (error) {
    console.error(`❌ Error processing chat ${chat.id}:`, error.message);
  }
}

async function processChats() {
  try {
    const chats = await getActiveChats();
    if (chats.length === 0) {
      console.log('💤 No active chats');
      return;
    }

    const promises = chats.map(async (chat) => {
      await processChat(chat);
    });
    
    await Promise.allSettled(promises);
    
  } catch (error) {
    console.error('❌ Error in processChats:', error.message);
  }
}

async function startSmartPaymentAssistant() {
  console.log('💬 Smart Cekipos Payment Assistant Started');
  console.log('✨ Features:');
  console.log('   • Payment processing automation');
  console.log('   • CID extraction and validation');
  console.log('   • Subscription plan management');
  console.log('   • Currency conversion (USDT/IDR)');
  console.log('   • Off-topic detection and redirection');
  console.log('   • Bilingual support (EN/ID)');
  console.log('   • State machine for conversation flow');
  console.log('   • Smart response generation');
  console.log(`🔄 Polling every ${POLL_INTERVAL/1000} seconds\n`);
  
  try {
    const chats = await getActiveChats();
    console.log(`✅ Connected! Found ${chats.length} chats\n`);
  } catch (error) {
    console.log('❌ Connection failed. Check access token.');
    return;
  }
  
  while (true) {
    try {
      await processChats();
    } catch (error) {
      console.error('❌ Polling error:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

// Helper function to check if user is asking for more details about promos
async function isAskingForMoreDetails(message, chatId) {
  if (!message) return false;
  
  const lowerMessage = message.toLowerCase().trim();
  const chatState = getChatState(chatId);
  const context = chatState.context || {};
  
  // Always check these phrases regardless of context
  const detailPhrases = [
    'more info', 'more details', 'more information', 'tell me more',
    'info lebih', 'detail lebih', 'informasi lebih', 'apa lagi',
    'bagaimana cara', 'how to', 'cara klaim', 'syarat', 'ketentuan',
    'terms', 'conditions', 'what about', 'what are the', 'how do i',
    'bisa tolong', 'bisa minta', 'bisa beri', 'bisa kasih',
    'info', 'details', 'informasi', 'jelas', 'jelaskan', 'explain',
    'show me', 'give me', 'what else', 'what about', 'how about',
    'bisa lihat', 'bisa tolong', 'bisa bantu', 'bisa kasih tahu',
    'bisa beri tahu', 'bisa tunjukkan', 'bisa jelaskan'
  ];
  
  // If message contains any of these phrases, it's definitely asking for more info
  if (detailPhrases.some(phrase => lowerMessage.includes(phrase))) {
    console.log('Detail phrase detected in message');
    return true;
  }
  
  // If the last message was about promos, be more lenient with follow-ups
  if (context.lastPromoMessage) {
    console.log('Last message was about promos, being lenient with follow-up');
    
    // Return true for very short follow-up messages (likely asking for more)
    if (lowerMessage.split(' ').length <= 5) {
      console.log('Short follow-up message detected');
      return true;
    }
    
    // Return true for any message that looks like a question
    if (lowerMessage.endsWith('?') || 
        lowerMessage.startsWith('what') || 
        lowerMessage.startsWith('how') ||
        lowerMessage.startsWith('can') ||
        lowerMessage.startsWith('bisa') ||
        lowerMessage.startsWith('apa') ||
        lowerMessage.startsWith('bagaimana') ||
        lowerMessage.startsWith('boleh')) {
      console.log('Question detected in follow-up');
      return true;
    }
  }
  
  // First, check with simple patterns for quick responses
  const quickChecks = {
    // Exact matches that definitely indicate a request for more info
    exactMatches: [
      'more info', 'more details', 'more information', 'what are the terms',
      'info lebih', 'detail lebih', 'informasi lebih', 'syarat dan ketentuan',
      'tell me more', 'what else', 'apa lagi', 'bagaimana cara', 'what games',
      'how to', 'cara klaim', 'syarat ketentuan', 'terms and conditions',
      'eligible games', 'game yang berlaku', 'what are the details', 'what is included'
    ],
    
    // Keywords that suggest the user wants more information
    detailKeywords: [
      'detail', 'details', 'info', 'information', 'more', 'about',
      'rincian', 'informasi', 'tambahan', 'lengkap', 'full', 'tentang',
      'complete', 'selengkapnya', 'lebih lanjut', 'cara', 'how', 'what',
      'syarat', 'ketentuan', 'terms', 'conditions', 'klaim', 'claim',
      'caranya', 'how to', 'include', 'included', 'termasuk', 'game', 'games',
      'permainan', 'eligible', 'berlaku', 'turnover', 'syarat', 'ketentuan',
      'require', 'requirements', 'persyaratan', 'need', 'perlu'
    ]
  };
  
  // If it's a clear request for more info, return true immediately
  const lowerMsg = message.toLowerCase();
  const detailKeywords = [
    'more', 'info', 'details', 'syarat', 'ketentuan', 'terms', 'conditions',
    'how', 'what', 'when', 'where', 'why', 'can you', 'bisa', 'boleh',
    'jelas', 'jelaskan', 'explain', 'tell me', 'show me'
  ];
  
  const isExplicitRequest = detailKeywords.some(keyword => 
    lowerMessage.includes(keyword)
  );
  
  if (isExplicitRequest) {
    console.log('Explicit request for more details detected');
    return true;
  }
  
  // If it's a simple yes/affirmative response to a promo list, return true
  const affirmativeWords = ['yes', 'ya', 'iya', 'ok', 'oke', 'sure', 'okay', 'lanjut', 'next'];
  const isAffirmative = affirmativeWords.some(word => 
    new RegExp(`\\b${word}\\b`, 'i').test(lowerMessage)
  );
  
  if (isFollowUp && isAffirmative) {
    console.log('Affirmative response to promo list detected');
    return true;
  }
  
  // If it's just a number (selecting a promo), handle it in the main function
  if (/^\d+$/.test(message.trim())) {
    return false;
  }
  
  // Use OpenAI for more complex cases
  try {
    if (!openai) {
      // Fallback to keyword-based check when OpenAI is disabled
      return detailKeywords.some(keyword => lowerMsg.includes(keyword));
    }
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that determines if a user wants more information about promotions. " +
                   "Respond with 'yes' if the user is asking for more details, clarification, or additional information. " +
                   "Respond with 'no' if the user is not asking for more information or if the message is unrelated. " +
                   "Only respond with 'yes' or 'no'."
        },
        {
          role: "user",
          content: `User message: "${message}"\n` +
                   `Context: ${context.lastPromoMessage ? 'User previously asked about promotions' : 'No previous context'}`
        }
      ],
      temperature: 0.3,
      max_tokens: 1
    });
    
    const response = completion.choices[0]?.message?.content?.toLowerCase().trim();
    console.log(`OpenAI analyzed message for details request: ${response}`);
    
    return response === 'yes';
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    // Check for detail-related keywords in the message
    return detailKeywords.some(keyword => lowerMsg.includes(keyword));
  }
}


function formatDetailedPromoResponse(promotions, language) {
  const isID = language === 'id';
  let response = isID 
    ? '🎁 *Detail Promo & Syarat Ketentuan* 🎁\n\n' 
    : '🎁 *Promotion Details & Terms* 🎁\n\n';

  // Add each promotion's details
  promotions.forEach((promo, index) => {
    // Add separator between promotions
    if (index > 0) {
      response += '\n' + '─'.repeat(30) + '\n\n';
    }
    
    response += `*${promo.title}*\n`;
    
    // Add description if available
    if (promo.description) {
      response += `📝 ${promo.description}\n`;
    }
    
    // Show promo code if available
    if (promo.code) {
      response += isID 
        ? `🎟️ *Kode Promo:* \`${promo.code}\`\n`
        : `🎟️ *Promo Code:* \`${promo.code}\`\n`;
    }
    
    // Show bonus percentage if available
    if (promo.bonusPercentage) {
      response += isID
        ? `💰 *Bonus:* ${promo.bonusPercentage}%\n`
        : `💰 *Bonus:* ${promo.bonusPercentage}%\n`;
    }
    
    // Show end date if available
    if (promo.endDate) {
      const endDate = new Date(promo.endDate);
      const formattedDate = endDate.toLocaleDateString(
        isID ? 'id-ID' : 'en-US', 
        { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          timeZone: 'UTC'
        }
      );
      response += isID
        ? `⏰ *Berlaku hingga:* ${formattedDate}\n`
        : `⏰ *Valid until:* ${formattedDate}\n`;
    }
    
    // Show eligible games/items if available
    if (promo.eligibleItems && Array.isArray(promo.eligibleItems) && promo.eligibleItems.length > 0) {
      response += isID
        ? `🎮 *Game yang Berlaku:*\n   ${promo.eligibleItems.join(', ')}\n`
        : `🎮 *Eligible Games:*\n   ${promo.eligibleItems.join(', ')}\n`;
    }
    
    // Show minimum deposit if available
    if (promo.minDeposit) {
      response += isID
        ? `💵 *Minimal Deposit:* ${promo.minDeposit}\n`
        : `💵 *Minimum Deposit:* ${promo.minDeposit}\n`;
    }
    
    // Show max bonus if available
    if (promo.maxBonus) {
      response += isID
        ? `🏆 *Maksimal Bonus:* ${promo.maxBonus}\n`
        : `🏆 *Maximum Bonus:* ${promo.maxBonus}\n`;
    }
    
    // Show turnover requirement if available
    if (promo.turnover) {
      response += isID
        ? `🔄 *Turnover:* ${promo.turnover}x\n`
        : `🔄 *Turnover:* ${promo.turnover}x\n`;
    }
    
    // Show terms and conditions if available
    if (promo.terms) {
      response += isID 
        ? '\n📜 *Syarat & Ketentuan:*\n'
        : '\n📜 *Terms & Conditions:*\n';
      // Split terms by period and add as bullet points
      const terms = promo.terms.split('.')
        .filter(term => term.trim().length > 0)
        .map(term => term.endsWith('.') ? term : term + '.');
      
      terms.forEach(term => {
        response += `• ${term.trim()}\n`;
      });
    }
    
    // Add a separator between promotions
    if (index < promotions.length - 1) {
      response += '\n' + '─'.repeat(30) + '\n\n';
    }
  });
  
  // Add footer with claim instructions
  // Add general claim instructions
  response += '\n' + '─'.repeat(30) + '\n';
  response += isID 
    ? '📌 *Cara Klaim:*\n1. Login ke akun Anda\n2. Kunjungi halaman deposit\n3. Masukkan kode promo (jika ada)\n4. Lakukan deposit sesuai ketentuan\n\n⏱️ *Waktu Proses:* Maksimal 1x24 jam kerja\n\n💡 *Butuh Bantuan?* Hubungi customer service kami 24/7.'
    : '📌 *How to Claim:*\n1. Log in to your account\n2. Go to the deposit page\n3. Enter the promo code (if any)\n4. Make a qualifying deposit\n\n⏱️ *Processing Time:* Within 24 working hours\n\n💡 *Need Help?* Contact our 24/7 customer service.';
    
  return response;
}

// Helper function to format promo list
function formatPromoList(promotions, language) {
  const isID = language === 'id';
  let response = isID 
    ? '🎉 *Daftar Promo & Bonus* 🎉\n\n' 
    : '🎉 *Available Promotions & Bonuses* 🎉\n\n';

  // Add each promotion with brief details
  promotions.forEach((promo, index) => {
    response += `*${index + 1}. ${promo.title}*\n`;
    
    // Show promo code if available
    if (promo.code) {
      response += isID 
        ? `   💎 Kode: \`${promo.code}\`\n` 
        : `   💎 Code: \`${promo.code}\`\n`;
    }
    
    // Show bonus percentage if available
    if (promo.bonusPercentage) {
      response += isID
        ? `   🎁 Bonus: ${promo.bonusPercentage}%\n`
        : `   🎁 Bonus: ${promo.bonusPercentage}%\n`;
    }
    
    // Show only first line of description for the list view
    const shortDesc = promo.description.split('\n')[0];
    response += `   📝 ${shortDesc}\n\n`;
  });

  // Add clear instructions for getting more details
  response += '\n' + '─'.repeat(30) + '\n';
  
  if (isID) {
    response += 'ℹ️ *Cara mendapatkan info lebih lanjut:*\n';
    response += '• Balas dengan nomor promo (contoh: "1" untuk promo pertama)\n';
    response += '• Atau ketik "info promo [nama promo]"\n';
    response += '• Atau tanyakan "detail promo" atau "syarat ketentuan"';
  } else {
    response += 'ℹ️ *How to get more details:*\n';
    response += '• Reply with the promo number (e.g., "1" for the first promo)\n';
    response += '• Or type "info promo [promo name]"\n';
    response += '• Or ask for "promo details" or "terms and conditions"';
  }
    
  return response;
}

// Optional: chat cleanup skipped as db-utils does not expose list/delete helpers in this project

// Enhanced response generation with promotions support
async function getSmartResponse(chatId, userMessage, messageId) {
  try {
    const chatState = getChatState(chatId);
    const context = chatState.context || { language: 'en' };
    const language = context.language;
    const now = Date.now();
    
    // Initialize context if not exists
    if (!chatState.context) {
      chatState.context = { language, isDiscussingPromos: false };
    }

    // Handle bank info queries
    if (isBankInfoQuery(userMessage)) {
      const banksList = SUPPORTED_BANKS.join(', ');
      if (language === 'id') {
        // Clear any pending promo context to avoid redundant follow-ups
        context.isDiscussingPromos = false;
        context.lastPromoMessage = null;
        context.lastPromoShownDetails = false;
        context.promoMessageCount = 0;
        
        // Return a single, clear example-based response
        return [
          `✅ Kami menerima banyak bank seperti: ${banksList}, dll.`,
          `Jika kakak ingin ganti rekening terdaftar, beri tahu saya ya—nanti saya pandu verifikasinya.`
        ].join('\n');
      }
      // English
      // Clear any pending promo context to avoid redundant follow-ups
      context.isDiscussingPromos = false;
      context.lastPromoMessage = null;
      context.lastPromoShownDetails = false;
      context.promoMessageCount = 0;

      // Return a single, clear example-based response
      return [
        `✅ We accept many banks like: ${banksList}, etc.`,
        `If you need to change your registered bank, just tell me and I'll guide you through verification.`
      ].join('\n');
    }

    // Handle bank change intent (collect verification details)
    if (isBankChangeIntent(userMessage)) {
      context.bankChange = { stage: 'collecting' };
      if (language === 'id') {
        return [
          '🔐 Untuk ganti bank terdaftar, saya perlu verifikasi data kakak:',
          '1) User ID (CID)',
          '2) Nama lengkap sesuai akun',
          '3) Bank terdaftar saat ini + 4 digit terakhir rekening',
          '4) Bank baru + nomor rekening baru',
          '5) Nama pemilik rekening baru',
          '',
          'Ketik semua data di atas dalam satu pesan (format bebas).'
        ].join('\n');
      }
      return [
        '🔐 To change your registered bank, I need to verify your details:',
        '1) User ID (CID)',
        '2) Full name on the account',
        '3) Current bank name + last 4 digits of the account',
        '4) New bank name + new account number',
        '5) Account holder name for the new account',
        '',
        'Please send all the above info in a single message (any format is okay).'
      ].join('\n');
    }
    
    // Compute if the user is asking for details/terms/eligible games
    const wantsDetails = /\b(details?|more|info|terms?|conditions?|syarat|ketentuan|eligible|games?)\b/i.test(userMessage);

    // Check if user is asking about promos
    const isPromoQueryFlag = isPromoQuery(userMessage);
    if (isPromoQueryFlag) {
      // Mark promo conversation context for smarter follow-ups
      context.isDiscussingPromos = true;
      context.lastPromoMessage = String(userMessage || '').slice(0, 200);
      context.promoMessageCount = (context.promoMessageCount || 0) + 1;
      context.lastPromoTimestamp = Date.now();
      // Throttle promo list to avoid spamming: do not resend within 2 minutes
      const lastSentAt = context.promoSentAt || 0;
      const THROTTLE_MS = 2 * 60 * 1000;
      if (now - lastSentAt < THROTTLE_MS && !(wantsDetails)) {
        console.log(`🔁 Promo list throttled for chat ${chatId}`);
        return null;
      }
      // Return brief JSON of promotions excluding eligibleGames, terms, and endDate
      try {
        const promos = await getPromotions();
        const briefPromos = (promos || []).map(p => {
          const { eligibleGames, terms, endDate, ...rest } = p || {};
          return rest;
        });
        const out = JSON.stringify({ promotions: briefPromos }, null, 2);
        context.promoSentAt = now;
        return out;
      } catch (e) {
        console.error('Failed to build brief promotions JSON:', e);
        // Fallback to safe empty structure
        return JSON.stringify({ promotions: [] }, null, 2);
      }
    }
    
    // If discussing promos and user asks a follow-up question, return full JSON with detailed fields
    if (context.isDiscussingPromos && wantsDetails) {
      const promos = await getPromotions();
      const out = JSON.stringify({ promotions: promos }, null, 2);
      context.promoSentAt = now;
      return out;
    }

    // Log the current context for debugging
    console.log('Current context:', JSON.stringify(context, null, 2));

    // Handle non-promo responses
    if (userMessage && userMessage.trim()) {
      // If we showed promos before and this is a follow-up message, check if they want details
      if (context.lastPromoMessage) {
        console.log('Last message was about promos, checking if user wants more details...');
        const wantsDetails = await isAskingForMoreDetails(userMessage, chatId);
        console.log('Wants details:', wantsDetails);
        
        if (wantsDetails) {
          const promos = await getPromotions();
          if (promos && promos.length > 0) {
            context.lastPromoShownDetails = true;
            return formatDetailedPromoResponse(promos, language);
          }
        }
      }
      
      // Clear promo context if it's a completely different topic and not a short follow-up
    const isRelatedToPromo = userMessage.match(/\b(promo|promotion|bonus|discount|diskon|reward|hadiah|cashback|freebet|free spin|turnover|syarat|ketentuan|terms|conditions|game|permainan|slot|casino|sport|sports|live|poker|togel|toto)\b/i);
    
    if (context.isDiscussingPromos && !isRelatedToPromo && userMessage.length > 10) {
      // Only clear the context if the message is not a short follow-up
      context.isDiscussingPromos = false;
      context.lastPromoMessage = null;
      context.lastPromoShownDetails = false;
      context.promoMessageCount = 0;
    } else if (isRelatedToPromo) {
      // If message is related to promos, keep the context alive
      context.isDiscussingPromos = true;
    }  
      
      return null;
    }
  } catch (error) {
    console.error('Error in getSmartResponse:', error);
    return null;
  }
}

// Export functions for testing
module.exports = {
  detectOffTopic,
  extractCID,
  extractPlanType,
  extractCurrencyPreference,
  getChatState,
  processPaymentAssistant,
  getSmartResponse,
  PAYMENT_STATES,
  PAYMENT_TEMPLATES
};

// Start the smart payment assistant
if (require.main === module) {
  startSmartPaymentAssistant().catch(console.error);
}