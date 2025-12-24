/**
 * XNote Downloader - Content Script
 * Core observer for detecting tweets and downloading images/videos.
 */

console.log('XNote Downloader Loaded');

// Inject Main World Script (External File)
// Uses external file to avoid CSP restrictions on inline scripts
function injectMainWorldScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function () {
        console.log('[XNote] Main world script injected');
        this.remove();
    };
    script.onerror = function () {
        console.error('[XNote] Failed to inject main world script');
    };
    (document.head || document.documentElement).appendChild(script);
}

injectMainWorldScript();

// ============================================================================
// Constants
// ============================================================================

const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const ACTION_BAR_SELECTOR = '[role="group"]';
const VIDEO_SELECTOR = 'video, [data-testid="videoComponent"]';
const DEBOUNCE_DELAY = 500;

// Comment scraping constants
const COMMENT_SCRAPE_LIMIT = 100;
const SCROLL_WAIT_MIN = 1500;
const SCROLL_WAIT_MAX = 2500;
const MAX_EMPTY_SCROLLS = 3;

// Sift Action Bar SVG Icons (18.75px, line-style matching Twitter)
const SIFT_ICONS = {
    // Download arrow icon
    download: `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="currentColor">
        <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.001 3.308c0 1.469-.932 2.692-2.5 2.692H5.5c-1.567 0-2.5-1.223-2.5-2.692V15h2v3.308c0 .29.226.692.5.692h13c.274 0 .5-.402.5-.692V15h2z" transform="rotate(180 12 12)"/>
    </svg>`,

    // Archive/box icon (for zip download)
    archive: `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="currentColor">
        <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zm-8.01-9l-3 3h2.01v3h2v-3h2.01l-3.01-3z" transform="rotate(180 12 13)"/>
    </svg>`,

    // Chart icon (for review data)
    chart: `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="currentColor">
        <path d="M3 3v18h18v-2H5V3H3zm15.293 4.293l-4.5 4.5-3-3-4 4 1.414 1.414L11 11.414l3 3 5.293-5.293 1.414 1.414 1.414-1.414-2.828-2.828z"/>
    </svg>`,

    // Shield/block icon
    block: `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="currentColor">
        <path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12S6.2 22.5 12 22.5 22.5 17.8 22.5 12 17.8 1.5 12 1.5zM4 12c0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20c-4.41 0-8-3.59-8-8zm14.31 4.9L7.1 5.69C8.45 4.63 10.15 4 12 4c4.41 0 8 3.59 8 8 0 1.85-.63 3.55-1.69 4.9z"/>
    </svg>`,

    // Three dots menu icon
    menu: `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="currentColor">
        <path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
    </svg>`
};

// Message types (must match background.js)
const MESSAGE_TYPES = {
    DOWNLOAD_MEDIA: 'DOWNLOAD_MEDIA',
    RESOLVE_VIDEO_AND_DOWNLOAD: 'RESOLVE_VIDEO_AND_DOWNLOAD',
    RESOLVE_VIDEO_URL_ONLY: 'RESOLVE_VIDEO_URL_ONLY',
    BLOCK_USER: 'BLOCK_USER',
    BLOCK_USER_ACTION: 'BLOCK_USER_ACTION'
};

// Download arrow SVG icon
const DOWNLOAD_ICON_SVG = `
<svg viewBox="0 0 24 24" class="xnote-download-icon" aria-hidden="true">
  <path fill="currentColor" d="M12 15.25l-4-4h2.5V5h3v6.25H16l-4 4zM19 19H5v-2h14v2z"/>
</svg>
`;

// Tool icon SVG for floating button (XNote Logo)
const TOOL_ICON_SVG = `
<svg viewBox="0 0 54 18" class="xnote-tool-icon" aria-hidden="true" style="width: 42px;">
  <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="800" font-size="14" fill="currentColor" letter-spacing="-0.5" style="font-weight: 800;">XNote</text>
</svg>
`;

// ============================================================================
// State
// ============================================================================

const processedTweets = new WeakSet();
const processedMainTweets = new WeakSet();
let debounceTimer = null;
let isScrapingComments = false;
let lastUrl = window.location.href;

// Combined blocklist - Set for O(1) lookups (merges community + local)
let blockedUsersSet = new Set();

// Community Shield toggle state (default: true = enabled)
let enableBlocklist = true;

/**
 * Initialize blocklist and settings from chrome.storage.local.
 */
function initBlocklistFromStorage() {
    chrome.storage.local.get(['communityBlocklist', 'localBlocklist', 'enableBlocklist'], (result) => {
        const communityUsers = result.communityBlocklist || [];
        const localUsers = result.localBlocklist || [];

        // Merge both lists into one Set (lowercase for case-insensitive matching)
        blockedUsersSet = new Set([
            ...communityUsers.map(u => u.toLowerCase()),
            ...localUsers.map(u => u.toLowerCase())
        ]);

        // Load toggle state (default: true if not set)
        enableBlocklist = result.enableBlocklist !== false;

        // Set initial body class for CSS-based visibility control
        updateShieldBodyClass(enableBlocklist);

        console.log(`[XNote] Loaded blocklist: ${communityUsers.length} community + ${localUsers.length} local = ${blockedUsersSet.size} total`);
        console.log(`[XNote] Community Shield: ${enableBlocklist ? 'ON' : 'OFF'}`);
    });
}

/**
 * Update shield state via body class (instant CSS-based toggle).
 * @param {boolean} enabled - Whether shield is ON
 */
function updateShieldBodyClass(enabled) {
    if (enabled) {
        document.body.classList.add('xnote-shield-on');
        console.log('[XNote] Shield ON - body class added');
    } else {
        document.body.classList.remove('xnote-shield-on');
        console.log('[XNote] Shield OFF - body class removed');
    }
}

/**
 * Rescan all visible tweets and fold blocked users (when shield is turned ON).
 */
function rescanAllTweets() {
    const allTweets = document.querySelectorAll(TWEET_SELECTOR);
    console.log(`[XNote] Rescanning ${allTweets.length} tweets (Shield ON)`);

    allTweets.forEach(tweet => {
        // Only check if not already folded
        if (!tweet.classList.contains('xnote-tweet-folded')) {
            checkAndFoldTweet(tweet);
        }
    });
}

// Listen for storage changes (blocklist updates or toggle changes)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    // Handle enableBlocklist toggle change
    if (changes.enableBlocklist) {
        const newValue = changes.enableBlocklist.newValue;
        const oldValue = changes.enableBlocklist.oldValue;

        console.log(`[XNote] Community Shield changed: ${oldValue} → ${newValue}`);
        enableBlocklist = newValue !== false;

        // Instantly toggle visibility via body class
        updateShieldBodyClass(enableBlocklist);

        // If turning ON, also rescan for any new blocked users
        if (enableBlocklist) {
            rescanAllTweets();
        }
    }

    // Handle blocklist updates
    if (changes.communityBlocklist || changes.localBlocklist) {
        chrome.storage.local.get(['communityBlocklist', 'localBlocklist'], (result) => {
            const communityUsers = result.communityBlocklist || [];
            const localUsers = result.localBlocklist || [];

            blockedUsersSet = new Set([
                ...communityUsers.map(u => u.toLowerCase()),
                ...localUsers.map(u => u.toLowerCase())
            ]);

            console.log(`[XNote] Blocklist updated: ${blockedUsersSet.size} users total`);

            // Re-scan visible tweets if shield is ON
            if (enableBlocklist) {
                debouncedScan();
            }
        });
    }
});

// Initialize blocklist on script load
initBlocklistFromStorage();

// ============================================================================
// Progress Overlay
// ============================================================================

/**
 * Create and show progress overlay for comment scraping.
 */
function showProgressOverlay() {
    let overlay = document.getElementById('xnote-progress-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'xnote-progress-overlay';
        overlay.className = 'xnote-progress-overlay';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    overlay.textContent = t('status_scraping', { current: 0, total: 100 });
    return overlay;
}

/**
 * Update progress overlay text.
 */
function updateProgress(current, total) {
    const overlay = document.getElementById('xnote-progress-overlay');
    if (overlay) {
        overlay.textContent = t('status_scraping', { current, total });
    }
}

/**
 * Hide and remove progress overlay.
 */
function hideProgressOverlay() {
    const overlay = document.getElementById('xnote-progress-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// ============================================================================
// URL Detection & Main Tweet Identification
// ============================================================================

/**
 * Check if current URL is a tweet detail page.
 */
function isDetailPage() {
    return /\/status\/\d+/.test(window.location.href);
}

/**
 * Check if a tweet element is the main tweet (not a reply).
 * On detail pages, the main tweet typically has larger text styling.
 */
function isMainTweet(tweetElement) {
    // Get tweet ID from element
    const tweetId = extractTweetId(tweetElement);
    const urlTweetId = getCurrentTweetIdFromUrl();

    // Main tweet should match URL tweet ID
    if (tweetId && urlTweetId && tweetId === urlTweetId) {
        return true;
    }

    // Fallback: Check for larger text (main tweets have bigger font)
    const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
    if (tweetText) {
        const fontSize = window.getComputedStyle(tweetText).fontSize;
        const fontSizeNum = parseInt(fontSize, 10);
        // Main tweet text is usually 17px+, replies are 15px
        if (fontSizeNum >= 17) {
            return true;
        }
    }

    return false;
}

// ============================================================================
// Comment Parsing
// ============================================================================

/**
 * Get the current tweet ID from the URL.
 */
function getCurrentTweetIdFromUrl() {
    const match = window.location.href.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
}

/**
 * Parse a comment element to extract data.
 */
function parseCommentElement(element) {
    const data = {
        id: null,
        username: '',
        date: '',
        text: '',
        likes: 0,
        replies_count: 0,
        retweets_count: 0, // Added field
        views: 0
    };

    // Extract tweet ID (comment ID)
    const timeEl = element.querySelector('time');
    if (timeEl) {
        const parentLink = timeEl.closest('a');
        if (parentLink) {
            const href = parentLink.getAttribute('href');
            const match = href && href.match(/\/status\/(\d+)/);
            if (match) {
                data.id = match[1];
            }
        }
        data.date = timeEl.getAttribute('datetime') || '';
    }

    // Extract username from user links (the handle like @username)
    const userLinks = element.querySelectorAll('a[href^="/"]');
    for (const link of userLinks) {
        const href = link.getAttribute('href');
        if (href && /^\/[a-zA-Z0-9_]+$/.test(href)) {
            // Use the handle as username (without @)
            data.username = href.slice(1);
            break;
        }
    }

    // Extract text content (excluding XNote buttons)
    const textDiv = element.querySelector('[data-testid="tweetText"]');
    if (textDiv) {
        // Clone the element to avoid modifying the original
        const textClone = textDiv.cloneNode(true);
        // Remove any XNote elements that might be inside
        const xnoteElements = textClone.querySelectorAll('[class*="xnote"]');
        xnoteElements.forEach(el => el.remove());
        data.text = textClone.textContent || '';
    }

    // Extract like count from action bar
    const likeButton = element.querySelector('[data-testid="like"], [data-testid="unlike"]');
    if (likeButton) {
        const likeText = likeButton.getAttribute('aria-label') || '';
        const likeMatch = likeText.match(/(\d+)/);
        if (likeMatch) {
            data.likes = parseInt(likeMatch[1], 10);
        }
    }

    // Extract reply count
    const replyButton = element.querySelector('[data-testid="reply"]');
    if (replyButton) {
        const replyText = replyButton.getAttribute('aria-label') || '';
        const replyMatch = replyText.match(/(\d+)/);
        if (replyMatch) {
            data.replies_count = parseInt(replyMatch[1], 10);
        }
    }

    // Extract retweet count (Retweet/Repost)
    const retweetButton = element.querySelector('[data-testid="retweet"], [data-testid="unretweet"]');
    if (retweetButton) {
        const avgLabel = retweetButton.getAttribute('aria-label') || '';
        const rtMatch = avgLabel.match(/(\d+)/);
        if (rtMatch) {
            data.retweets_count = parseInt(rtMatch[1], 10);
        }
    }

    // Extract view count (analytics)
    const analyticsLink = element.querySelector('a[href*="/analytics"]');
    if (analyticsLink) {
        const viewText = analyticsLink.getAttribute('aria-label') || '';
        const viewMatch = viewText.match(/([\d,]+)/);
        if (viewMatch) {
            data.views = parseInt(viewMatch[1].replace(/,/g, ''), 10);
        }
    }

    return data;
}

// ============================================================================
// CSV Export
// ============================================================================

/**
 * Escape a value for CSV format.
 */
function escapeCSV(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const str = String(value);
    // If contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Convert comments array to CSV string.
 */
function convertToCSV(comments) {
    const header = 'Username,Date,Text,Likes,Replies_Count,Retweets_Count,Views';
    const rows = comments.map(c =>
        [
            escapeCSV(c.username),
            escapeCSV(c.date),
            escapeCSV(c.text),
            escapeCSV(c.likes),
            escapeCSV(c.replies_count),
            escapeCSV(c.retweets_count),
            escapeCSV(c.views)
        ].join(',')
    );
    return header + '\n' + rows.join('\n');
}

/**
 * Trigger browser download of CSV file.
 */
function downloadCSV(csvContent, tweetId) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comments_${tweetId}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ============================================================================
// Comment Scraping Logic
// ============================================================================

/**
 * Random wait helper.
 */
function randomWait(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Scrape comments from the current tweet page.
 */
async function scrapeComments(tweetId) {
    const scrapedIds = new Set();
    const comments = [];
    let emptyScrollCount = 0;

    showProgressOverlay();

    while (comments.length < COMMENT_SCRAPE_LIMIT && emptyScrollCount < MAX_EMPTY_SCROLLS) {
        // Get all tweet elements
        const tweetElements = document.querySelectorAll(TWEET_SELECTOR);
        let newCommentsFound = 0;

        for (const element of tweetElements) {
            const commentData = parseCommentElement(element);

            // Skip if no ID or if it's the main tweet
            if (!commentData.id || commentData.id === tweetId) {
                continue;
            }

            // Skip if already scraped
            if (scrapedIds.has(commentData.id)) {
                continue;
            }

            scrapedIds.add(commentData.id);
            comments.push(commentData);
            newCommentsFound++;

            if (comments.length >= COMMENT_SCRAPE_LIMIT) {
                break;
            }
        }

        updateProgress(comments.length, COMMENT_SCRAPE_LIMIT);

        if (newCommentsFound === 0) {
            emptyScrollCount++;
        } else {
            emptyScrollCount = 0;
        }

        // Scroll down
        window.scrollBy(0, window.innerHeight);

        // Random wait
        await randomWait(SCROLL_WAIT_MIN, SCROLL_WAIT_MAX);
    }

    hideProgressOverlay();
    return comments;
}

/**
 * Handle comments download action.
 */
async function handleCommentsDownload(tweetElement, buttonElement) {
    if (isScrapingComments) {
        console.log('[XNote] Already scraping comments...');
        return;
    }

    const tweetId = getCurrentTweetIdFromUrl() || extractTweetId(tweetElement);

    if (tweetId === 'unknown') {
        console.error('[XNote] Cannot scrape comments: Tweet ID not found');
        showButtonFeedback(buttonElement, 'error');
        return;
    }

    console.log(`[XNote] Starting comment scrape for tweet ${tweetId}`);
    isScrapingComments = true;
    showButtonFeedback(buttonElement, 'loading');

    try {
        const comments = await scrapeComments(tweetId);

        if (comments.length === 0) {
            console.log('[XNote] No comments found');
            showButtonFeedback(buttonElement, 'error');
        } else {
            console.log(`[XNote] Scraped ${comments.length} comments`);
            const csv = convertToCSV(comments);
            downloadCSV(csv, tweetId);
            showButtonFeedback(buttonElement, 'success');
        }
    } catch (error) {
        console.error('[XNote] Error scraping comments:', error);
        showButtonFeedback(buttonElement, 'error');
    } finally {
        isScrapingComments = false;
    }
}

// ============================================================================
// Tweet Data Extraction
// ============================================================================

/**
 * Extract username from tweet element.
 */
function extractUsername(tweetElement) {
    const userLinks = tweetElement.querySelectorAll('a[href^="/"]');

    for (const link of userLinks) {
        const href = link.getAttribute('href');
        if (href && /^\/[a-zA-Z0-9_]+$/.test(href)) {
            return href.slice(1);
        }
    }

    const allText = tweetElement.textContent;
    const usernameMatch = allText.match(/@([a-zA-Z0-9_]+)/);
    if (usernameMatch) {
        return usernameMatch[1];
    }

    return 'unknown';
}

/**
 * Extract tweet ID from tweet element.
 */
function extractTweetId(tweetElement) {
    const timeElement = tweetElement.querySelector('time');
    if (timeElement) {
        const parentLink = timeElement.closest('a');
        if (parentLink) {
            const href = parentLink.getAttribute('href');
            const match = href && href.match(/\/status\/(\d+)/);
            if (match) {
                return match[1];
            }
        }
    }

    const allLinks = tweetElement.querySelectorAll('a[href*="/status/"]');
    for (const link of allLinks) {
        const href = link.getAttribute('href');
        const match = href && href.match(/\/status\/(\d+)/);
        if (match) {
            return match[1];
        }
    }

    return 'unknown';
}

/**
 * Check if tweet contains video.
 */
function hasVideo(tweetElement) {
    return tweetElement.querySelector(VIDEO_SELECTOR) !== null;
}

/**
 * Find all media images in a tweet.
 */
function findMediaImages(tweetElement) {
    const allImages = tweetElement.querySelectorAll('img');
    const mediaImages = [];

    for (const img of allImages) {
        const src = img.src || '';

        if (!src.includes('pbs.twimg.com/media')) {
            continue;
        }

        if (img.width > 0 && img.width < 100) {
            continue;
        }

        mediaImages.push(img);
    }

    return mediaImages;
}

/**
 * Convert image URL to original quality.
 */
function getOriginalQualityUrl(url) {
    try {
        const urlObj = new URL(url);
        urlObj.searchParams.set('name', 'orig');
        return urlObj.toString();
    } catch (e) {
        if (url.includes('name=')) {
            return url.replace(/name=[a-z]+/i, 'name=orig');
        }
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}name=orig`;
    }
}

/**
 * Extract file extension from URL.
 */
function getExtension(url) {
    try {
        const urlObj = new URL(url);
        const format = urlObj.searchParams.get('format');
        if (format) {
            return format;
        }
        const pathname = urlObj.pathname;
        const match = pathname.match(/\.([a-z0-9]+)$/i);
        if (match) {
            return match[1];
        }
    } catch (e) {
        // Ignore
    }
    return 'jpg';
}

// ============================================================================
// Download Logic
// ============================================================================

/**
 * Request video URL from React props extraction (main world script).
 * @returns {Promise<string|null>} Video URL or null
 */
function requestVideoUrlFromReact() {
    return new Promise((resolve) => {
        const reqId = Math.random().toString();
        const listener = (event) => {
            if (event.data.type === 'XNOTE_VIDEO_URL_RESULT' && event.data.reqId === reqId) {
                window.removeEventListener('message', listener);
                resolve(event.data.url);
            }
        };
        window.addEventListener('message', listener);
        window.postMessage({ type: 'XNOTE_GET_VIDEO_URL', reqId }, '*');
        setTimeout(() => {
            window.removeEventListener('message', listener);
            resolve(null);
        }, 5000);
    });
}

/**
 * Download video from a tweet.
 * Strategy: 
 *   1. Try Syndication API via background script
 *   2. If fails (age-restricted), try React props extraction
 *   3. Download the resolved URL
 */
async function downloadTweetVideo(tweetElement, buttonElement) {
    const username = extractUsername(tweetElement);
    const tweetId = extractTweetId(tweetElement);

    if (tweetId === 'unknown') {
        console.error('[XNote] Cannot download: Tweet ID not found');
        showButtonFeedback(buttonElement, 'error');
        return;
    }

    const filename = `xnote_${username}_${tweetId}.mp4`;
    showButtonFeedback(buttonElement, 'loading');

    try {
        // Try Syndication API first
        const response = await chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.RESOLVE_VIDEO_URL_ONLY,
            tweetId: tweetId
        });

        let videoUrl = null;

        if (response && response.success && response.url) {
            videoUrl = response.url;
        } else {
            // Fallback to React props extraction
            videoUrl = await requestVideoUrlFromReact();
        }

        if (videoUrl) {
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.DOWNLOAD_MEDIA,
                url: videoUrl,
                filename: filename
            });
            showButtonFeedback(buttonElement, 'success');
        } else {
            console.error('[XNote] Could not resolve video URL');
            showButtonFeedback(buttonElement, 'error');
        }

    } catch (error) {
        console.error('[XNote] Video download error:', error);
        showButtonFeedback(buttonElement, 'error');
    }
}

/**
 * Download all images from a tweet.
 */
async function downloadTweetImages(tweetElement, buttonElement) {
    const username = extractUsername(tweetElement);
    const tweetId = extractTweetId(tweetElement);
    const images = findMediaImages(tweetElement);

    console.log(`[XNote] Downloading from @${username}, tweet ${tweetId}, found ${images.length} images`);

    if (images.length === 0) {
        console.warn('[XNote] No media images found in this tweet');
        showButtonFeedback(buttonElement, 'error');
        return;
    }

    showButtonFeedback(buttonElement, 'loading');

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const originalUrl = getOriginalQualityUrl(img.src);
        const ext = getExtension(originalUrl);
        const filename = `xnote_${username}_${tweetId}_${i + 1}.${ext}`;

        console.log(`[XNote] Downloading: ${filename}`);

        try {
            const response = await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.DOWNLOAD_MEDIA,
                url: originalUrl,
                filename: filename
            });

            if (response && response.success) {
                successCount++;
            } else {
                errorCount++;
                console.error(`[XNote] Download failed: ${response?.error || 'Unknown error'}`);
            }
        } catch (error) {
            errorCount++;
            console.error(`[XNote] Message error: ${error.message}`);
        }
    }

    if (errorCount === 0) {
        showButtonFeedback(buttonElement, 'success');
    } else if (successCount > 0) {
        showButtonFeedback(buttonElement, 'success');
    } else {
        showButtonFeedback(buttonElement, 'error');
    }
}

/**
 * Main download handler - determines if tweet has video or images.
 */
async function handleDownload(tweetElement, buttonElement) {
    if (hasVideo(tweetElement)) {
        await downloadTweetVideo(tweetElement, buttonElement);
    } else {
        await downloadTweetImages(tweetElement, buttonElement);
    }
}

/**
 * Show visual feedback on the download button.
 */
function showButtonFeedback(button, state) {
    button.classList.remove('loading', 'success', 'error');
    button.classList.add(state);

    if (state === 'success' || state === 'error') {
        setTimeout(() => {
            button.classList.remove(state);
        }, 1500);
    }
}

// ============================================================================
// Download Buttons
// ============================================================================

/**
 * Create media download button (icon only).
 */
function createMediaDownloadButton() {
    const button = document.createElement('div');
    button.className = 'xnote-download-btn xnote-media-btn';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', 'Download media');
    button.innerHTML = DOWNLOAD_ICON_SVG;
    return button;
}

/**
 * Create comments download button (text button, Twitter native style).
 */
function createCommentsDownloadButton() {
    const button = document.createElement('div');
    button.className = 'xnote-download-btn xnote-comments-btn';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', t('btn_download_reviews'));
    button.innerHTML = `
        <span class="xnote-btn-text">${t('btn_download_reviews')}</span>
    `;
    return button;
}

/**
 * Create Sift Block button (danger action button).
 */
function createSiftBlockButton() {
    const button = document.createElement('div');
    button.className = 'xnote-download-btn xnote-sift-block-btn';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', t('btn_sift_block'));
    button.innerHTML = `
        <span class="xnote-btn-text">${t('btn_sift_block')}</span>
    `;
    return button;
}

// ============================================================================
// Sift Action Bar Component (Native Twitter Style)
// ============================================================================

let activeSiftPopover = null;
let popoverHideTimeout = null;

/**
 * Create a single icon button for the Sift Action Bar.
 * @param {string} iconSvg - SVG icon string
 * @param {string} tooltipText - Text to show in tooltip
 * @param {string} className - Additional class name
 * @param {boolean} isDanger - If true, uses red color scheme
 * @returns {HTMLElement}
 */
function createSiftIconButton(iconSvg, tooltipText, className = '', isDanger = false) {
    const button = document.createElement('div');
    button.className = `sift-icon-btn ${className} ${isDanger ? 'sift-danger' : ''}`;
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', tooltipText);

    // Icon
    const icon = document.createElement('div');
    icon.className = 'sift-icon';
    icon.innerHTML = iconSvg;
    button.appendChild(icon);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'sift-tooltip';
    tooltip.textContent = tooltipText;
    button.appendChild(tooltip);

    // Show tooltip on hover with delay
    let tooltipTimeout;
    button.addEventListener('mouseenter', () => {
        tooltipTimeout = setTimeout(() => {
            tooltip.classList.add('show');
        }, 500);
    });

    button.addEventListener('mouseleave', () => {
        clearTimeout(tooltipTimeout);
        tooltip.classList.remove('show');
    });

    return button;
}

/**
 * Create the Sift popover menu.
 * @param {HTMLElement} tweetElement - The tweet element
 * @returns {HTMLElement}
 */
function createSiftPopover(tweetElement) {
    const popover = document.createElement('div');
    popover.className = 'sift-popover';

    // Menu items
    const menuItems = [
        { icon: SIFT_ICONS.archive, label: t('btn_download_zip') || 'Download Zip', action: 'zip', danger: false },
        { icon: SIFT_ICONS.chart, label: t('btn_review_data') || 'Review Data', action: 'review', danger: false },
        { icon: SIFT_ICONS.block, label: t('btn_sift_block') || 'Sift Block', action: 'block', danger: true }
    ];

    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = `sift-popover-item ${item.danger ? 'sift-danger' : ''}`;
        menuItem.innerHTML = `
            <div class="sift-popover-icon">${item.icon}</div>
            <span class="sift-popover-label">${item.label}</span>
        `;
        menuItem.dataset.action = item.action;
        popover.appendChild(menuItem);
    });

    return popover;
}

/**
 * Show the Sift popover menu.
 * @param {HTMLElement} trigger - The trigger button
 * @param {HTMLElement} popover - The popover element
 */
function showSiftPopover(trigger, popover) {
    // Hide any existing popover
    hideSiftPopover();

    // Position relative to trigger
    const rect = trigger.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    popover.style.left = `${rect.left + rect.width / 2}px`;
    popover.style.transform = 'translateX(-50%)';

    document.body.appendChild(popover);
    activeSiftPopover = popover;

    // Add show class for animation
    requestAnimationFrame(() => {
        popover.classList.add('show');
    });
}

/**
 * Hide the active Sift popover.
 */
function hideSiftPopover() {
    if (activeSiftPopover) {
        activeSiftPopover.classList.remove('show');
        setTimeout(() => {
            if (activeSiftPopover && activeSiftPopover.parentNode) {
                activeSiftPopover.remove();
            }
            activeSiftPopover = null;
        }, 150);
    }
}

/**
 * Create the Sift Action Bar for a tweet.
 * List view: Download + Block icons
 * Detail view: Download + Block + Comments icons
 * @param {HTMLElement} tweetElement - The tweet element
 * @param {boolean} isDetail - Whether this is a detail page
 * @returns {HTMLElement}
 */
function createSiftActionBar(tweetElement, isDetail = false) {
    const container = document.createElement('div');
    container.className = 'sift-action-bar';

    // Download button (always visible) - uses zip package download
    const downloadBtn = createSiftIconButton(
        SIFT_ICONS.download,
        '打包下载',
        'sift-download-btn'
    );

    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        handleBoxDownload(tweetElement);
    });

    container.appendChild(downloadBtn);

    // Block button (always visible)
    const blockBtn = createSiftIconButton(
        SIFT_ICONS.block,
        '上报拉黑',
        'sift-block-btn',
        true // isDanger
    );

    blockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        handleSiftBlock(tweetElement, blockBtn);
    });

    container.appendChild(blockBtn);

    // Comments button (only on detail page)
    if (isDetail) {
        const commentsBtn = createSiftIconButton(
            SIFT_ICONS.chart,
            t('btn_download_reviews') || 'Download Comments',
            'sift-comments-btn'
        );

        commentsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            handleCommentsDownload(tweetElement, commentsBtn);
        });

        container.appendChild(commentsBtn);
    }

    return container;
}

/**
 * Extract user ID from tweet element.
 * Twitter stores the user ID in various places.
 */
function extractUserId(tweetElement) {
    // Method 1: Look for data-user-id attribute
    const userIdAttr = tweetElement.querySelector('[data-user-id]');
    if (userIdAttr) {
        return userIdAttr.getAttribute('data-user-id');
    }

    // Method 2: Try to find it in the user link structure
    // Usually profile links contain the screen name, not user ID
    // For now, we'll use the username as the identifier
    const username = extractUsername(tweetElement);
    if (username && username !== 'unknown') {
        // Return username as user_id - the backend can handle screen names
        return username;
    }

    return null;
}

/**
 * Show a toast notification.
 */
function showToast(message, duration = 3000) {
    // Remove existing toast if any
    const existingToast = document.getElementById('xnote-toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'xnote-toast';
    toast.className = 'xnote-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger fade-in
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto-remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ============================================================================
// X Block API (via Main World Script)
// ============================================================================

/**
 * Block a user using X's internal API via main world script.
 * Uses postMessage to communicate with injected script running in page context.
 * @param {string} screenName - The @username to block (without @)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function blockUserOnX(screenName) {
    return new Promise((resolve) => {
        const reqId = Math.random().toString(36).substring(2);

        const listener = (event) => {
            if (event.data.type === 'XNOTE_BLOCK_USER_RESULT' && event.data.reqId === reqId) {
                window.removeEventListener('message', listener);
                resolve({
                    success: event.data.success,
                    error: event.data.error,
                    data: event.data.data
                });
            }
        };

        window.addEventListener('message', listener);

        // Send request to main world script
        window.postMessage({
            type: 'XNOTE_BLOCK_USER',
            screenName: screenName,
            reqId: reqId
        }, '*');

        // Timeout after 10 seconds
        setTimeout(() => {
            window.removeEventListener('message', listener);
            resolve({ success: false, error: 'Request timeout' });
        }, 10000);
    });
}

// ============================================================================
// Sift Block Handler
// ============================================================================

/**
 * Handle Sift Block action - Optimistic UI pattern.
 * Immediately hides tweet and sends message to background.
 * Background handles local storage update and cloud report.
 */
async function handleSiftBlock(tweetElement, buttonElement) {
    const screenName = extractUsername(tweetElement);
    const tweetId = extractTweetId(tweetElement);

    if (!screenName || screenName === 'unknown') {
        console.error('[XNote] Cannot block: screen_name not found');
        showButtonFeedback(buttonElement, 'error');
        return;
    }

    console.log(`[XNote] Sift Block: @${screenName} (tweet: ${tweetId})`);

    // === OPTIMISTIC UI: Immediately update DOM ===

    // 1. Update button to loading state first
    buttonElement.classList.add('loading');
    const btnText = buttonElement.querySelector('.xnote-btn-text');
    if (btnText) {
        btnText.textContent = '...';
    }

    // 2. Call X Block API directly from content script
    const blockResult = await blockUserOnX(screenName);

    if (blockResult.success) {
        // Success: Update UI
        buttonElement.classList.remove('loading');
        buttonElement.classList.add('success');
        if (btnText) {
            btnText.textContent = t('btn_done');
        }

        // 3. Hide tweet content
        const tweetContent = tweetElement.querySelector('[data-testid="tweetText"]');
        const mediaContent = tweetElement.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]');

        if (tweetContent) {
            tweetContent.classList.add('xnote-content-hidden');
        }
        mediaContent.forEach(media => {
            media.classList.add('xnote-content-hidden');
        });

        // 4. Insert blocked overlay
        const overlay = document.createElement('div');
        overlay.className = 'xnote-blocked-overlay';
        overlay.innerHTML = `<span>${t('status_blocked_reported')}</span>`;

        const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);
        if (actionBar && actionBar.parentNode) {
            actionBar.parentNode.insertBefore(overlay, actionBar);
        }

        // 5. Hide the Sift Block button
        buttonElement.style.display = 'none';

        // 6. Mark tweet as folded
        tweetElement.classList.add('xnote-tweet-folded');

        // 7. Show toast notification
        showToast(t('status_blocked_reported'));

        // 8. Send to background for local blocklist + cloud report (fire and forget)
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.BLOCK_USER_ACTION,
            payload: {
                screen_name: screenName,
                tweet_id: tweetId,
                reason: 'manual_click'
            }
        });

        console.log('[XNote] Block action completed successfully');

    } else {
        // Failed: Show error state
        buttonElement.classList.remove('loading');
        buttonElement.classList.add('error');
        if (btnText) {
            btnText.textContent = t('btn_error');
        }
        showToast(`Block failed: ${blockResult.error}`);
        console.error('[XNote] Block action failed:', blockResult.error);

        // Reset button after 2 seconds
        setTimeout(() => {
            buttonElement.classList.remove('error');
            if (btnText) {
                btnText.textContent = t('btn_sift_block');
            }
        }, 2000);
    }
}

/**
 * Handle Sift Block button click.
 */
function handleSiftBlockClick(e, tweetElement, buttonElement) {
    e.stopPropagation();
    e.preventDefault();

    if (buttonElement.classList.contains('loading') || buttonElement.classList.contains('success')) {
        return;
    }

    handleSiftBlock(tweetElement, buttonElement);
}

/**
 * Inject Sift Block button into tweet's action bar.
 */
function injectSiftBlockButton(tweetElement) {
    const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);

    if (!actionBar) {
        return;
    }

    // Don't inject if already exists
    if (actionBar.querySelector('.xnote-sift-block-btn')) {
        return;
    }

    // Don't inject if tweet is already folded (user already in blocklist)
    if (tweetElement.classList.contains('xnote-tweet-folded')) {
        return;
    }

    const blockBtn = createSiftBlockButton();

    blockBtn.addEventListener('click', (e) => {
        handleSiftBlockClick(e, tweetElement, blockBtn);
    });

    blockBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            handleSiftBlockClick(e, tweetElement, blockBtn);
        }
    });

    actionBar.appendChild(blockBtn);
}

/**
 * Handle media download button click.
 */
function handleMediaDownloadClick(e, tweetElement, buttonElement) {
    e.stopPropagation();
    e.preventDefault();

    if (buttonElement.classList.contains('loading')) {
        return;
    }

    handleDownload(tweetElement, buttonElement);
}

/**
 * Handle comments download button click.
 */
function handleCommentsDownloadClick(e, tweetElement, buttonElement) {
    e.stopPropagation();
    e.preventDefault();

    if (buttonElement.classList.contains('loading')) {
        return;
    }

    handleCommentsDownload(tweetElement, buttonElement);
}

/**
 * Inject unified Sift Action Bar into a tweet's action bar.
 * List view: Download + Block
 * Detail view main tweet: Download + Block + Comments
 */
function injectSiftActionBar(tweetElement) {
    const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);

    if (!actionBar) {
        return;
    }

    // Don't inject if tweet is already folded (user in blocklist)
    if (tweetElement.classList.contains('xnote-tweet-folded')) {
        return;
    }

    // Don't re-inject if already present
    if (actionBar.querySelector('.sift-action-bar')) {
        return;
    }

    // Determine if this is a detail page main tweet
    const isDetail = isDetailPage() && isMainTweet(tweetElement);

    const siftBar = createSiftActionBar(tweetElement, isDetail);
    actionBar.appendChild(siftBar);
}

/**
 * Inject media download button into any tweet's action bar.
 * @deprecated - Use injectSiftActionBar instead
 */
function injectMediaDownloadButton(tweetElement) {
    const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);

    if (!actionBar) {
        return;
    }

    // Skip injection if this is the main tweet on a detail page (Clean UI request)
    if (isDetailPage() && isMainTweet(tweetElement)) {
        return;
    }

    // Don't inject if tweet is already folded (user in blocklist)
    if (tweetElement.classList.contains('xnote-tweet-folded')) {
        return;
    }

    if (actionBar.querySelector('.xnote-media-btn')) {
        return;
    }

    const downloadBtn = createMediaDownloadButton();

    downloadBtn.addEventListener('click', (e) => {
        handleMediaDownloadClick(e, tweetElement, downloadBtn);
    });

    downloadBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            handleMediaDownloadClick(e, tweetElement, downloadBtn);
        }
    });

    actionBar.appendChild(downloadBtn);
}

/**
 * Inject comments download button into main tweet's action bar (detail page only).
 */
function injectCommentsDownloadButton(tweetElement) {
    const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);

    if (!actionBar) {
        return;
    }

    if (actionBar.querySelector('.xnote-comments-btn')) {
        return;
    }

    const downloadBtn = createCommentsDownloadButton();

    downloadBtn.addEventListener('click', (e) => {
        handleCommentsDownloadClick(e, tweetElement, downloadBtn);
    });

    downloadBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            handleCommentsDownloadClick(e, tweetElement, downloadBtn);
        }
    });

    actionBar.appendChild(downloadBtn);
}

// ============================================================================
// Community Blocklist Auto-Fold
// ============================================================================

/**
 * Create the fold bar UI element.
 * @param {HTMLElement} tweetElement - The tweet to attach unfold action to
 * @returns {HTMLElement} The fold bar element
 */
function createFoldBar(tweetElement) {
    const bar = document.createElement('div');
    bar.className = 'xnote-fold-bar';

    const textSpan = document.createElement('span');
    textSpan.className = 'xnote-fold-text';
    textSpan.textContent = t('fold_warning');

    const showBtn = document.createElement('button');
    showBtn.className = 'xnote-show-anyway-btn';
    showBtn.textContent = t('btn_show_anyway');
    showBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        unfoldTweet(tweetElement);
    });

    bar.appendChild(textSpan);
    bar.appendChild(showBtn);
    return bar;
}

/**
 * Fold a tweet (hide content, show warning bar).
 * @param {HTMLElement} tweetElement - The tweet to fold
 */
function foldTweet(tweetElement) {
    // Already folded?
    if (tweetElement.classList.contains('xnote-tweet-folded')) {
        return;
    }

    // Find content elements to hide
    const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
    const mediaElements = tweetElement.querySelectorAll(
        '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="card.wrapper"]'
    );

    // Hide content
    if (tweetText) {
        tweetText.classList.add('xnote-content-hidden');
    }
    mediaElements.forEach(el => {
        el.classList.add('xnote-content-hidden');
    });

    // Create and insert fold bar
    const foldBar = createFoldBar(tweetElement);

    // Insert after user info area, before content
    const tweetInner = tweetText?.parentElement || tweetElement;
    if (tweetText) {
        tweetInner.insertBefore(foldBar, tweetText);
    } else {
        // Fallback: insert at beginning of content area
        const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);
        if (actionBar && actionBar.parentNode) {
            actionBar.parentNode.insertBefore(foldBar, actionBar);
        }
    }

    // Mark as folded
    tweetElement.classList.add('xnote-tweet-folded');
    console.log('[XNote] Folded tweet from blocked user');
}

/**
 * Unfold a tweet (restore content, remove warning bar).
 * @param {HTMLElement} tweetElement - The tweet to unfold
 */
function unfoldTweet(tweetElement) {
    // Remove fold bar
    const foldBar = tweetElement.querySelector('.xnote-fold-bar');
    if (foldBar) {
        foldBar.remove();
    }

    // Restore hidden content
    const hiddenElements = tweetElement.querySelectorAll('.xnote-content-hidden');
    hiddenElements.forEach(el => {
        el.classList.remove('xnote-content-hidden');
    });

    // Remove folded marker
    tweetElement.classList.remove('xnote-tweet-folded');
    console.log('[XNote] Unfolded tweet');
}

/**
 * Check if a tweet is from a blocked user and fold if necessary.
 * @param {HTMLElement} tweetElement - The tweet to check
 */
function checkAndFoldTweet(tweetElement) {
    // Skip if Community Shield is OFF
    if (!enableBlocklist) {
        return;
    }

    // Skip if already folded
    if (tweetElement.classList.contains('xnote-tweet-folded')) {
        return;
    }

    // Skip if blocklist is empty
    if (blockedUsersSet.size === 0) {
        return;
    }

    // Extract username (screen_name)
    const username = extractUsername(tweetElement);
    if (!username || username === 'unknown') {
        return;
    }

    // Check against blocklist (case-insensitive)
    if (blockedUsersSet.has(username.toLowerCase())) {
        console.log(`[XNote] Detected blocked user: @${username}`);
        foldTweet(tweetElement);
    }
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Process a tweet element - inject Sift Action Bar and check blocklist.
 */
function processTweet(tweet) {
    if (processedTweets.has(tweet)) {
        return;
    }
    processedTweets.add(tweet);

    // Check if tweet is from a blocked user and fold if necessary
    checkAndFoldTweet(tweet);

    // Inject unified Sift Action Bar (replaces multiple button injections)
    injectSiftActionBar(tweet);
}

/**
 * Process main tweet on detail page - inject comments button.
 */
function processMainTweet(tweet) {
    if (processedMainTweets.has(tweet)) {
        return;
    }

    if (!isDetailPage()) {
        return;
    }

    if (!isMainTweet(tweet)) {
        return;
    }

    processedMainTweets.add(tweet);
    // Advanced area buttons removed - all actions now in Sift Action Bar
    console.log('[XNote] Processed main tweet on detail page');
}

/**
 * Inject Advanced Action Area (Zip & Review Data).
 */
function injectAdvancedArea(tweetElement) {
    if (tweetElement.querySelector('.xnote-advanced-area')) return;

    // Find insertion point: Above Stats Row or Action Bar
    const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);
    if (!actionBar) return;

    const container = actionBar.parentElement;
    let insertTarget = actionBar;

    // Try to find stats row (links to retweets/likes)
    const statsLinks = tweetElement.querySelectorAll('a[href$="/retweets"], a[href$="/likes"]');
    if (statsLinks.length > 0) {
        // Find the specific row container
        let current = statsLinks[0];
        while (current && current.parentElement !== container) {
            current = current.parentElement;
        }
        if (current) insertTarget = current;
    }

    const area = document.createElement('div');
    area.className = 'xnote-advanced-area';

    // Zip Download Button
    const zipBtn = document.createElement('div');
    zipBtn.className = 'xnote-btn-primary';
    zipBtn.textContent = t('btn_download_pack');
    zipBtn.onclick = (e) => {
        e.stopPropagation();
        handleBoxDownload(tweetElement, zipBtn);
    };

    // Review Data Button
    const reviewBtn = document.createElement('div');
    reviewBtn.className = 'xnote-btn-secondary';
    reviewBtn.textContent = t('btn_review_data');
    reviewBtn.onclick = (e) => {
        e.stopPropagation();
        handleReviewData(tweetElement, reviewBtn);
    };

    area.appendChild(zipBtn);
    area.appendChild(reviewBtn);

    container.insertBefore(area, insertTarget);
}

/**
 * Handle "Download Zip" Action.
 */
async function handleBoxDownload(tweetElement, button = null) {
    // Handle loading state
    if (button) {
        if (button.classList.contains('loading')) return;
        button.classList.add('loading');
    }

    // For progress display
    const originalText = button ? button.textContent : '';

    try {
        const username = extractUsername(tweetElement);
        const tweetId = extractTweetId(tweetElement);
        const zip = new JSZip();

        // 1. Text
        const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
        const text = textElement ? textElement.innerText : '';
        zip.file("text.txt", text);

        // 2. Images
        const images = findMediaImages(tweetElement);
        for (let i = 0; i < images.length; i++) {
            const url = getOriginalQualityUrl(images[i].src);
            try {
                // Use background script to fetch blob to avoid CORS issues if any,
                // but usually content script can fetch if host permissions are set.
                // However, X images are CDN. Let's try fetch directly.
                const imgBlob = await fetch(url).then(r => r.blob());
                const ext = getExtension(url);
                zip.file(`img_${i + 1}.${ext}`, imgBlob);
            } catch (e) {
                console.error('Image fetch failed', e);
            }
        }

        // 3. Video (if any)
        if (hasVideo(tweetElement)) {
            let videoUrl = null;

            // Method 1: Try Syndication API via background script
            try {
                const response = await chrome.runtime.sendMessage({
                    type: MESSAGE_TYPES.RESOLVE_VIDEO_URL_ONLY,
                    tweetId: tweetId
                });
                if (response && response.success && response.url) {
                    videoUrl = response.url;
                }
            } catch (e) {
                console.error('[XNote] Syndication API error:', e);
            }

            // Method 2: Try React props extraction (fallback)
            if (!videoUrl) {
                videoUrl = await requestVideoUrlFromReact();
            }

            // Download the video if URL was found
            if (videoUrl) {
                try {
                    const vidBlob = await fetch(videoUrl).then(r => r.blob());
                    zip.file("video.mp4", vidBlob);
                } catch (e) {
                    console.error('[XNote] Video fetch failed:', e);
                }
            }
        }

        // Generate Zip
        const content = await zip.generateAsync({ type: "blob" });
        const zipUrl = URL.createObjectURL(content);

        // Trigger Download
        const link = document.createElement("a");
        link.href = zipUrl;
        link.download = `Tweet_${username}_${tweetId}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(zipUrl);

        // Success - remove loading state
        if (button) {
            button.classList.remove('loading');
            button.classList.add('success');
            setTimeout(() => button.classList.remove('success'), 2000);
        }
        showToast(t('btn_done') || 'Download complete!');

    } catch (e) {
        console.error('Zip download failed', e);
        if (button) {
            button.classList.remove('loading');
            button.classList.add('error');
            setTimeout(() => button.classList.remove('error'), 2000);
        }
        showToast(t('btn_failed') || 'Download failed');
    }
}

/**
 * Handle "Review Data" Modal.
 */
function handleReviewData(tweetElement, button) {
    // Create Modal HTML
    const existingModal = document.getElementById('xnote-review-modal');
    if (existingModal) existingModal.remove();

    const overlay = document.createElement('div');
    overlay.id = 'xnote-review-modal';
    overlay.className = 'xnote-modal-overlay';

    overlay.innerHTML = `
        <div class="xnote-modal">
            <div class="xnote-modal-header">
                <div class="xnote-modal-title">${t('modal_title')}</div>
                <div class="xnote-modal-actions">
                    <button class="xnote-btn-primary" id="xnote-export-csv" style="height: 28px; font-size: 13px;">${t('btn_export_csv')}</button>
                    <button class="xnote-close-btn" id="xnote-close-modal">✕</button>
                </div>
            </div>
            <div class="xnote-modal-body">
                <table class="xnote-data-table">
                    <thead>
                        <tr>
                            <th>${t('th_content')}</th>
                            <th>${t('th_author')}</th>
                            <th>${t('th_time')}</th>
                            <th>${t('th_likes')}</th>
                            <th>${t('th_replies')}</th>
                            <th>${t('th_retweets')}</th>
                            <th>${t('th_views')}</th>
                        </tr>
                    </thead>
                    <tbody id="xnote-table-body">
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('#xnote-close-modal');
    const exportBtn = overlay.querySelector('#xnote-export-csv');
    const tableBody = overlay.querySelector('#xnote-table-body');

    const close = () => {
        overlay.remove();
        isScrapingComments = false; // Stop scraping
    };

    closeBtn.onclick = close;
    overlay.onclick = (e) => {
        if (e.target === overlay) close();
    };

    const scrapedData = [];
    const scrapedIds = new Set();

    exportBtn.onclick = () => {
        const csv = convertToCSV(scrapedData);
        downloadCSV(csv, getCurrentTweetIdFromUrl() || 'data');
    };

    // Start scraping in background
    startModalScraping(scrapedData, scrapedIds, tableBody);
}

async function startModalScraping(dataArray, idSet, tableBody) {
    if (isScrapingComments) return;
    isScrapingComments = true;

    let emptyScrollCount = 0;

    while (isScrapingComments && emptyScrollCount < MAX_EMPTY_SCROLLS) {
        const tweetElements = document.querySelectorAll(TWEET_SELECTOR);
        let newFound = 0;

        for (const element of tweetElements) {
            const d = parseCommentElement(element);
            if (!d.id || idSet.has(d.id)) continue;
            // Ideally check if it's main tweet

            idSet.add(d.id);
            dataArray.push(d);
            newFound++;

            // Append to table
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${d.text.substring(0, 100)}</td>
                <td>@${d.username}</td>
                <td>${d.date ? new Date(d.date).toLocaleString() : '-'}</td>
                <td>${d.likes}</td>
                <td>${d.replies_count}</td>
                <td>${d.retweets_count}</td> <!-- Show retweets count -->
                <td>${d.views || '-'}</td>
             `;
            tableBody.appendChild(tr);
        }

        if (newFound === 0) emptyScrollCount++;
        else emptyScrollCount = 0;

        window.scrollBy(0, window.innerHeight);
        await randomWait(1500, 2500);
    }

    isScrapingComments = false;
}

/**
 * Scan for all tweets and process them.
 */
function scanForTweets() {
    const tweets = document.querySelectorAll(TWEET_SELECTOR);
    tweets.forEach(tweet => {
        processTweet(tweet);
        processMainTweet(tweet);
    });
}

function debouncedScan() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        scanForTweets();
        debounceTimer = null;
    }, DEBOUNCE_DELAY);
}

// ============================================================================
// MutationObserver Setup
// ============================================================================

function initObserver() {
    const observer = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldScan = true;
                break;
            }
        }
        if (shouldScan) {
            debouncedScan();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('[XNote] MutationObserver initialized');
    return observer;
}

// ============================================================================
// URL Change Detection (for SPA navigation)
// ============================================================================

/**
 * Check for URL changes and trigger re-scan.
 */
function checkUrlChange() {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log('[XNote] URL changed, rescanning...');
        // Small delay to let new content load
        setTimeout(() => {
            scanForTweets();
        }, 500);
    }
}

/**
 * Start URL change polling (for SPA navigation).
 */
function startUrlWatcher() {
    // Poll for URL changes every 500ms
    setInterval(checkUrlChange, 500);

    // Also listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
        setTimeout(() => {
            scanForTweets();
        }, 500);
    });
}

// ============================================================================
// Floating Tool Button
// ============================================================================

/**
 * Create the floating XNote tool button.
 */
function createFloatingButton() {
    const button = document.createElement('div');
    button.id = 'xnote-floating-btn';
    button.className = 'xnote-floating-btn';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', 'XNote Tools');
    button.innerHTML = TOOL_ICON_SVG;

    // Add tooltip
    const tooltip = document.createElement('span');
    tooltip.className = 'xnote-floating-tooltip';
    tooltip.textContent = t('tooltip_xnote');
    button.appendChild(tooltip);

    return button;
}

/**
 * Handle floating button click.
 */
function handleFloatingButtonClick() {
    // Toggle menu or show options
    const existingMenu = document.getElementById('xnote-floating-menu');
    if (existingMenu) {
        existingMenu.remove();
        return;
    }

    const menu = document.createElement('div');
    menu.id = 'xnote-floating-menu';
    menu.className = 'xnote-floating-menu';

    // Menu items
    const items = [
        { label: t('menu_about'), action: () => console.log('[XNote] XNote Downloader v1.0') }
    ];

    // Add "Download Reviews" option if on detail page
    if (isDetailPage()) {
        items.unshift({
            label: t('menu_download_reviews'),
            action: () => {
                const mainTweet = document.querySelector(TWEET_SELECTOR);
                if (mainTweet && isMainTweet(mainTweet)) {
                    const btn = mainTweet.querySelector('.xnote-comments-btn');
                    if (btn) {
                        btn.click();
                    } else {
                        handleCommentsDownload(mainTweet, document.getElementById('xnote-floating-btn'));
                    }
                }
                menu.remove();
            }
        });
    }

    items.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'xnote-floating-menu-item';
        menuItem.textContent = item.label;
        menuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            item.action();
            menu.remove();
        });
        menu.appendChild(menuItem);
    });

    document.body.appendChild(menu);

    // Close menu on click outside
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
}

/**
 * Inject floating button into the page.
 */
function injectFloatingButton() {
    if (document.getElementById('xnote-floating-btn')) {
        return;
    }

    const button = createFloatingButton();

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        handleFloatingButtonClick();
    });

    button.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            handleFloatingButtonClick();
        }
    });

    document.body.appendChild(button);
    console.log('[XNote] Floating button injected');
}

// ============================================================================
// Initialization
// ============================================================================

function init() {
    console.log('[XNote] Initializing...');
    scanForTweets();
    initObserver();
    startUrlWatcher();
    injectFloatingButton();
    console.log('[XNote] Ready!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
