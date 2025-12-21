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

// ============================================================================
// State
// ============================================================================

const processedTweets = new WeakSet();
let debounceTimer = null;

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
// Download Button
// ============================================================================

function createDownloadButton() {
    const button = document.createElement('div');
    button.className = 'xnote-download-btn';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', 'Download media');
    button.innerHTML = DOWNLOAD_ICON_SVG;
    return button;
}

function handleDownloadClick(e, tweetElement, buttonElement) {
    e.stopPropagation();
    e.preventDefault();

    if (buttonElement.classList.contains('loading')) {
        return;
    }

    handleDownload(tweetElement, buttonElement);
}

function injectDownloadButton(tweetElement) {
    const actionBar = tweetElement.querySelector(ACTION_BAR_SELECTOR);

    if (!actionBar) {
        console.warn('[XNote] Action bar not found in tweet:', tweetElement);
        return;
    }

    if (actionBar.querySelector('.xnote-download-btn')) {
        return;
    }

    const downloadBtn = createDownloadButton();

    downloadBtn.addEventListener('click', (e) => {
        handleDownloadClick(e, tweetElement, downloadBtn);
    });

    downloadBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            handleDownloadClick(e, tweetElement, downloadBtn);
        }
    });

    actionBar.appendChild(downloadBtn);
}

// ============================================================================
// Core Functions
// ============================================================================

function processTweet(tweet) {
    if (processedTweets.has(tweet)) {
        return;
    }
    processedTweets.add(tweet);
    injectDownloadButton(tweet);
}

function scanForTweets() {
    const tweets = document.querySelectorAll(TWEET_SELECTOR);
    tweets.forEach(processTweet);
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
// Initialization
// ============================================================================

function init() {
    console.log('[XNote] Initializing...');
    scanForTweets();
    initObserver();
    console.log('[XNote] Ready!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
