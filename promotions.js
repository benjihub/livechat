const fs = require('fs').promises;
const path = require('path');

const PROMOTIONS_FILE = path.join(__dirname, 'promotions.json');

// Initialize promotions file if it doesn't exist
async function initPromotions() {
  try {
    await fs.access(PROMOTIONS_FILE);
  } catch (error) {
    // File doesn't exist, create with default promotions
    const defaultPromotions = [
      {id: 1, title: "Welcome Bonus", description: "Get 10% off on your first deposit", discount: 10, code: "WELCOME10"},
      {id: 2, title: "Weekend Special", description: "25% bonus on weekend deposits", discount: 25, code: "WEEKEND25"},
      {id: 3, title: "VIP Bonus", description: "Exclusive 50% bonus for VIP members", discount: 50, code: "VIP50"}
    ];
    await savePromotions(defaultPromotions);
  }
}

// Get all promotions
async function getPromotions() {
  try {
    const data = await fs.readFile(PROMOTIONS_FILE, 'utf8');
    const jsonData = JSON.parse(data);
    return jsonData.promotions || [];
  } catch (error) {
    console.error('Error reading promotions:', error);
    return [];
  }
}

// Save promotions to file
async function savePromotions(promotions) {
  try {
    const data = { promotions };
    await fs.writeFile(PROMOTIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving promotions:', error);
    return false;
  }
}

// Add a new promotion
async function addPromotion(promotion) {
  const promotions = await getPromotions();
  const newId = promotions.length > 0 ? Math.max(...promotions.map(p => p.id)) + 1 : 1;
  const newPromotion = { ...promotion, id: newId };
  promotions.push(newPromotion);
  await savePromotions(promotions);
  return newPromotion;
}

// Update an existing promotion
async function updatePromotion(id, updates) {
  const promotions = await getPromotions();
  const index = promotions.findIndex(p => p.id === id);
  if (index === -1) return null;
  
  const updatedPromotion = { ...promotions[index], ...updates };
  promotions[index] = updatedPromotion;
  await savePromotions(promotions);
  return updatedPromotion;
}

// Delete a promotion
async function deletePromotion(id) {
  const promotions = await getPromotions();
  const index = promotions.findIndex(p => p.id === id);
  if (index === -1) return false;
  
  promotions.splice(index, 1);
  await savePromotions(promotions);
  return true;
}

// Check if user is asking for more details about promotions
function isAskingForDetails(message) {
  if (!message) return false;
  const lowerMessage = message.toLowerCase();
  const detailKeywords = ['details', 'terms', 'conditions', 'syarat', 'ketentuan', 'info', 'more', 'tambahan'];
  const claimKeywords = ['how to claim', 'how do i claim', 'cara klaim', 'cara claim', 'klaim', 'claim'];
  const promoKeywords = ['promo', 'promotion', 'bonus', 'discount', 'diskon'];
  
  // If user explicitly asks how to claim, treat as details even without 'promo' word
  if (claimKeywords.some(keyword => lowerMessage.includes(keyword))) return true;
  
  // Otherwise require both a detail cue and a promo cue
  return (
    detailKeywords.some(keyword => lowerMessage.includes(keyword)) &&
    promoKeywords.some(keyword => lowerMessage.includes(keyword))
  );
}

// Format detailed promotion information
function formatPromotionDetails(promotion) {
  if (!promotion) return "Promotion not found.";
  
  const now = new Date();
  let response = `🎁 *${promotion.title}*\n\n`;
  
  // Basic info
  if (promotion.description) response += `📝 ${promotion.description}\n`;
  if (promotion.code) response += `🔑 *Code:* \`${promotion.code}\`\n`;
  
  // Bonus details
  if (promotion.bonusPercentage) {
    response += `💰 *${promotion.bonusPercentage}% Bonus`;
    if (promotion.maxBonus) response += ` (Max: ${promotion.maxBonus})`;
    response += '*\n';
  } else if (promotion.bonusAmount) {
    response += `🎰 *${promotion.bonusAmount}*\n`;
  }
  
  // Validity period (robust handling)
  const hasStart = Boolean(promotion.startDate);
  const hasEnd = Boolean(promotion.endDate);
  if (hasStart || hasEnd) {
    response += `📅 *Validity:* `;
    if (hasStart && hasEnd) {
      response += `${new Date(promotion.startDate).toLocaleDateString()} - ${new Date(promotion.endDate).toLocaleDateString()}\n`;
    } else if (hasEnd) {
      response += `Until ${new Date(promotion.endDate).toLocaleDateString()}\n`;
    } else if (hasStart) {
      response += `From ${new Date(promotion.startDate).toLocaleDateString()}\n`;
    }
  }
  
  // Eligible games/items (fallback to either key)
  const eligArr = (promotion.eligibleGames && promotion.eligibleGames.length)
    ? promotion.eligibleGames
    : (promotion.eligibleItems && promotion.eligibleItems.length ? promotion.eligibleItems : []);
  if (eligArr.length > 0) {
    response += `🎮 *Eligible Games:* ${eligArr.join(', ')}\n`;
  }
  
  // Terms and conditions
  if (promotion.terms) {
    response += '\n📜 *Terms & Conditions:*\n';
    const terms = Array.isArray(promotion.terms) ? promotion.terms : [promotion.terms];
    terms.forEach((term, i) => {
      response += `  ${i + 1}. ${term}\n`;
    });
  }
  
  // How to claim
  if (promotion.howToClaim && (Array.isArray(promotion.howToClaim) ? promotion.howToClaim.length : String(promotion.howToClaim).trim().length)) {
    response += '\n📌 *How to Claim:*\n';
    const steps = Array.isArray(promotion.howToClaim) ? promotion.howToClaim : [promotion.howToClaim];
    steps.forEach((step, i) => {
      response += `  ${i + 1}. ${step}\n`;
    });
  } else {
    // Generic fallback steps
    response += '\n📌 *How to Claim:*\n';
    response += '  1. Log in to your account\n';
    response += '  2. Go to the deposit page\n';
    response += '  3. Enter promo code (if any)\n';
    response += '  4. Make a qualifying deposit\n';
  }
  
  return response;
}

// Format promotions for display
function formatPromotions(promotions, userMessage = '') {
  if (!promotions || promotions.length === 0) {
    return "No current promotions available. Check back later!";
  }
  
  const showDetails = isAskingForDetails(userMessage);
  const now = new Date();
  
  if (showDetails) {
    // Show detailed view for all promotions
    return [
      "🎉 *Promotion Details* 🎉\n\n",
      ...promotions.map((p, idx) => {
        const body = formatPromotionDetails(p);
        const sep = idx < promotions.length - 1 ? ('\n' + '─'.repeat(30) + '\n\n') : '';
        return body + sep;
      })
    ].join('');
  } else {
    // Show brief list view
    return [
      "🎉 *Current Promotions* 🎉\n\n",
      ...promotions.map((p, index) => {
        let promoText = `*${index + 1}. ${p.title}*\n`;
        if (p.description) promoText += `   ${p.description}\n`;
        if (p.code) promoText += `   💎 Code: \`${p.code}\`\n`;
        if (p.bonusPercentage) promoText += `   🤑 ${p.bonusPercentage}% Bonus\n`;
        return promoText + '\n';
      }),
      "\n💡 Type 'more details' or 'terms' to see full terms and conditions for each promotion."
    ].join('');
  }
}

// Initialize the promotions file when this module is loaded
initPromotions().catch(console.error);

module.exports = {
  getPromotions,
  addPromotion,
  updatePromotion,
  deletePromotion,
  formatPromotions
};
