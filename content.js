/**
 * XNote Downloader - Content Script
 * Core observer for detecting tweets and downloading images/videos.
 */

console.log('XNote Downloader Loaded');

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

// Message types (must match background.js)
const MESSAGE_TYPES = {
    DOWNLOAD_MEDIA: 'DOWNLOAD_MEDIA',
    RESOLVE_VIDEO_AND_DOWNLOAD: 'RESOLVE_VIDEO_AND_DOWNLOAD'
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
    overlay.textContent = 'Scraping comments: 0/100...';
    return overlay;
}

/**
 * Update progress overlay text.
 */
function updateProgress(current, total) {
    const overlay = document.getElementById('xnote-progress-overlay');
    if (overlay) {
        overlay.textContent = `Scraping comments: ${current}/${total}...`;
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
    const header = 'Username,Date,Text,Likes,Replies_Count,Views';
    const rows = comments.map(c =>
        [
            escapeCSV(c.username),
            escapeCSV(c.date),
            escapeCSV(c.text),
            escapeCSV(c.likes),
            escapeCSV(c.replies_count),
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
 * Download video from a tweet via background script.
 * Fire-and-forget: sends message to background and shows processing feedback.
 */
function downloadTweetVideo(tweetElement, buttonElement) {
    const username = extractUsername(tweetElement);
    const tweetId = extractTweetId(tweetElement);

    if (tweetId === 'unknown') {
        console.error('[XNote] Cannot download: Tweet ID not found');
        showButtonFeedback(buttonElement, 'error');
        return;
    }

    const filename = `xnote_${username}_${tweetId}.mp4`;
    console.log(`[XNote] Requesting video download for @${username}, tweet ${tweetId}`);

    // Show processing feedback
    showButtonFeedback(buttonElement, 'loading');

    // Fire-and-forget: send to background script
    chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.RESOLVE_VIDEO_AND_DOWNLOAD,
        tweetId: tweetId,
        username: username,
        filename: filename
    });

    // Show success after brief delay (download happens in background)
    setTimeout(() => {
        showButtonFeedback(buttonElement, 'success');
    }, 800);
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
    button.setAttribute('aria-label', 'Download reviews');
    button.innerHTML = `
        <span class="xnote-btn-text">download reviews</span>
    `;
    return button;
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
 * Inject media download button into any tweet's action bar.
 */
function injectMediaDownloadButton(tweetElement) {
    const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);

    if (!actionBar) {
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
// Core Functions
// ============================================================================

/**
 * Process a tweet element - inject appropriate buttons.
 */
function processTweet(tweet) {
    if (processedTweets.has(tweet)) {
        return;
    }
    processedTweets.add(tweet);

    // Always inject media download button on all tweets
    injectMediaDownloadButton(tweet);
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
    injectCommentsDownloadButton(tweet);
    console.log('[XNote] Injected comments button into main tweet');
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
    tooltip.textContent = 'XNote';
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
        { label: 'About XNote', action: () => console.log('[XNote] XNote Downloader v1.0') }
    ];

    // Add "Download Reviews" option if on detail page
    if (isDetailPage()) {
        items.unshift({
            label: 'Download Reviews',
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
