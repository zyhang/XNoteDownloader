/**
 * XNote Downloader - Filter Rules Module
 * Rule compilation, caching, and matching logic for content filtering.
 */

// ============================================================================
// Type Definitions (JSDoc)
// ============================================================================

/**
 * @typedef {Object} FilterRule
 * @property {string} id - Unique identifier
 * @property {string} name - Display name for the rule
 * @property {string} pattern - The keyword or regex pattern
 * @property {boolean} isRegex - Whether pattern is regex
 * @property {boolean} caseSensitive - Case sensitive matching
 * @property {boolean} enabled - Rule is active
 * @property {RegExp|null} compiled - Pre-compiled regex (runtime only, not stored)
 */

/**
 * @typedef {Object} FilterSettings
 * @property {boolean} enabled - Master toggle
 * @property {'all'|'retweets'|'foryou'} scope - Filter scope
 * @property {FilterRule[]} rules - List of filter rules
 * @property {string[]} whitelistUsers - Whitelisted @handles (lowercase)
 * @property {string[]} whitelistTweets - Whitelisted tweet IDs
 */

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_FILTER_SETTINGS = {
    enabled: false,
    scope: 'all',
    rules: [],
    whitelistUsers: [],
    whitelistTweets: []
};

// ============================================================================
// Rule Compilation
// ============================================================================

/**
 * Compile a single filter rule into a RegExp object.
 * @param {FilterRule} rule - The rule to compile
 * @returns {FilterRule} - Rule with compiled regex (or null if failed)
 */
function compileRule(rule) {
    if (!rule.enabled || !rule.pattern) {
        return { ...rule, compiled: null };
    }

    try {
        if (rule.isRegex) {
            // User-provided regex pattern
            const flags = rule.caseSensitive ? 'g' : 'gi';
            rule.compiled = new RegExp(rule.pattern, flags);
        } else {
            // Simple keyword - escape special chars and create regex
            const escaped = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const flags = rule.caseSensitive ? 'g' : 'gi';
            rule.compiled = new RegExp(escaped, flags);
        }
    } catch (e) {
        console.error(`[XNote] Failed to compile rule "${rule.name}":`, e.message);
        rule.compiled = null;
    }

    return rule;
}

/**
 * Compile all filter rules and cache the RegExp objects.
 * @param {FilterRule[]} rules - Array of rules to compile
 * @returns {FilterRule[]} - Rules with compiled regex
 */
function compileAllRules(rules) {
    return rules.map(compileRule);
}

/**
 * Validate a regex pattern without throwing.
 * @param {string} pattern - The regex pattern
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRegex(pattern) {
    try {
        new RegExp(pattern);
        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

// ============================================================================
// Text Matching
// ============================================================================

/**
 * Check if text matches any of the compiled rules.
 * @param {string} text - Text to check
 * @param {FilterRule[]} compiledRules - Rules with compiled regex
 * @returns {FilterRule|null} - First matching rule, or null
 */
function matchesRules(text, compiledRules) {
    if (!text || !compiledRules.length) return null;

    for (const rule of compiledRules) {
        if (!rule.enabled || !rule.compiled) continue;

        // Reset regex lastIndex for global patterns
        rule.compiled.lastIndex = 0;

        if (rule.compiled.test(text)) {
            return rule;
        }
    }

    return null;
}

// ============================================================================
// Tab Detection
// ============================================================================

/**
 * Detect if the current view is the "For You" algorithmic timeline.
 * @returns {boolean}
 */
function isForYouTab() {
    try {
        const tabList = document.querySelector('[role="tablist"]');
        if (!tabList) return false;

        const selectedTab = tabList.querySelector('[aria-selected="true"]');
        if (!selectedTab) return false;

        const tabText = selectedTab.textContent?.toLowerCase() || '';
        return tabText.includes('for you') || tabText.includes('为你推荐');
    } catch (e) {
        console.warn('[XNote] Failed to detect tab:', e);
        return false; // Default: process all if detection fails
    }
}

/**
 * Detect if a tweet is a Retweet or Quote Tweet.
 * @param {HTMLElement} tweetElement - The tweet element
 * @returns {boolean}
 */
function isRetweetOrQuote(tweetElement) {
    // Check for "Retweeted" indicator
    const socialContext = tweetElement.querySelector('[data-testid="socialContext"]');
    if (socialContext) {
        const text = socialContext.textContent?.toLowerCase() || '';
        if (text.includes('retweet') || text.includes('转推')) {
            return true;
        }
    }

    // Check for quoted tweet
    const quotedTweet = tweetElement.querySelector('[data-testid="quoteTweet"]');
    if (quotedTweet) {
        return true;
    }

    return false;
}

// ============================================================================
// Main Decision Logic
// ============================================================================

/**
 * Determine if a tweet should be processed based on scope settings.
 * @param {HTMLElement} tweetElement - The tweet element
 * @param {FilterSettings} settings - Filter settings
 * @returns {boolean} - True if tweet should be checked against rules
 */
function shouldProcessTweet(tweetElement, settings) {
    if (!settings.enabled) return false;

    switch (settings.scope) {
        case 'retweets':
            return isRetweetOrQuote(tweetElement);
        case 'foryou':
            return isForYouTab();
        case 'all':
        default:
            return true;
    }
}

/**
 * Check if a tweet is whitelisted.
 * @param {HTMLElement} tweetElement - The tweet element
 * @param {FilterSettings} settings - Filter settings
 * @returns {boolean}
 */
function isWhitelisted(tweetElement, settings) {
    // Check tweet ID whitelist
    const tweetLink = tweetElement.querySelector('a[href*="/status/"]');
    if (tweetLink) {
        const match = tweetLink.href.match(/\/status\/(\d+)/);
        if (match && settings.whitelistTweets.includes(match[1])) {
            return true;
        }
    }

    // Check user handle whitelist
    const userLink = tweetElement.querySelector('[data-testid="User-Name"] a[href^="/"]');
    if (userLink) {
        const handle = userLink.href.split('/').pop()?.toLowerCase();
        if (handle && settings.whitelistUsers.includes(handle)) {
            return true;
        }
    }

    return false;
}

/**
 * Extract text content from a tweet for matching.
 * @param {HTMLElement} tweetElement - The tweet element
 * @returns {string}
 */
function extractTweetTextForMatching(tweetElement) {
    const parts = [];

    // Method 1: Standard tweet text selector
    const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
    if (tweetText) {
        // Collect all text including emoji from img alt
        let textParts = [];

        // Walk through all child nodes to get text + emoji in order
        const walker = document.createTreeWalker(
            tweetText,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG') {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            }
        );

        let node;
        while (node = walker.nextNode()) {
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent;
                if (t) textParts.push(t);
            } else if (node.tagName === 'IMG') {
                const alt = node.getAttribute('alt');
                if (alt) textParts.push(alt);
            }
        }

        const text = textParts.join('').trim();
        if (text) {
            parts.push(text);
        }
    }

    // Method 2: Try lang attribute selector (fallback)
    if (parts.length === 0) {
        const langText = tweetElement.querySelector('div[lang]');
        if (langText) {
            const text = langText.textContent?.trim();
            if (text) parts.push(text);
        }
    }

    // Method 3: Quoted tweet text
    const quotedText = tweetElement.querySelector('[data-testid="quoteTweet"] [data-testid="tweetText"]');
    if (quotedText) {
        parts.push(quotedText.textContent || '');
    }

    // Method 4: For video/image-only tweets, try to get any visible text
    if (parts.length === 0) {
        // Look for any span with text in the tweet body area
        const spans = tweetElement.querySelectorAll('div[dir="auto"] span');
        for (const span of spans) {
            const text = span.textContent?.trim();
            if (text && text.length > 0 && !text.startsWith('@') && !text.startsWith('#')) {
                parts.push(text);
                break;
            }
        }
    }

    const result = parts.join(' ').trim();
    return result;
}

/**
 * Generate a unique ID for rules.
 * @returns {string}
 */
function generateRuleId() {
    return 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ============================================================================
// Storage Helpers
// ============================================================================

/**
 * Load filter settings from chrome.storage.local.
 * @returns {Promise<FilterSettings>}
 */
async function loadFilterSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get({ filterSettings: DEFAULT_FILTER_SETTINGS }, (result) => {
            const settings = { ...DEFAULT_FILTER_SETTINGS, ...result.filterSettings };
            // Compile rules after loading
            settings.rules = compileAllRules(settings.rules);
            resolve(settings);
        });
    });
}

/**
 * Save filter settings to chrome.storage.local.
 * @param {FilterSettings} settings
 * @returns {Promise<void>}
 */
async function saveFilterSettings(settings) {
    // Remove compiled regex before saving (not serializable)
    const toSave = {
        ...settings,
        rules: settings.rules.map(r => {
            const { compiled, ...rest } = r;
            return rest;
        })
    };

    return new Promise((resolve) => {
        chrome.storage.local.set({ filterSettings: toSave }, resolve);
    });
}

// Export for use in other modules (content.js, popup.js)
if (typeof window !== 'undefined') {
    window.XNoteFilter = {
        DEFAULT_FILTER_SETTINGS,
        compileRule,
        compileAllRules,
        validateRegex,
        matchesRules,
        isForYouTab,
        isRetweetOrQuote,
        shouldProcessTweet,
        isWhitelisted,
        extractTweetTextForMatching,
        generateRuleId,
        loadFilterSettings,
        saveFilterSettings
    };
}
