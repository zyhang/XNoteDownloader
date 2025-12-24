/**
 * XNote Downloader - Service Worker (Background Script)
 * Handles download requests, video resolution, and extension lifecycle.
 */

// ============================================================================
// Constants
// ============================================================================

const MESSAGE_TYPES = {
    DOWNLOAD_MEDIA: 'DOWNLOAD_MEDIA',
    RESOLVE_VIDEO_AND_DOWNLOAD: 'RESOLVE_VIDEO_AND_DOWNLOAD',
    RESOLVE_VIDEO_URL_ONLY: 'RESOLVE_VIDEO_URL_ONLY',
    BLOCK_USER: 'BLOCK_USER',
    BLOCK_USER_ACTION: 'BLOCK_USER_ACTION'
};

const SYNDICATION_API = 'https://cdn.syndication.twimg.com/tweet-result';

// Cloud API Configuration (Sift Backend)
const CLOUD_API_URL = 'https://sift-backend.onrender.com';
const CLOUD_API_KEY = 'sift';

// Storage Keys
const STORAGE_KEY_LOCAL_BLOCKLIST = 'localBlocklist';

// ============================================================================
// Cloud API - Report User to Sift Community Blocklist
// ============================================================================

/**
 * Report a user to the Sift cloud blocklist.
 * This runs independently - failures here should NOT affect the X block action.
 * @param {string} userId - The X user ID to report
 * @param {string} reason - Reason for blocking (e.g., 'spam', 'harassment')
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function reportUserToCloud(userId, reason = 'blocked') {
    const endpoint = `${CLOUD_API_URL}/report`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLOUD_API_KEY
            },
            body: JSON.stringify({
                user_id: userId,
                reason: reason
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[XNote BG] Cloud report failed: HTTP ${response.status} - ${errorText}`);
            return { success: false, error: `HTTP ${response.status}` };
        }

        const data = await response.json();
        console.log('[XNote BG] User reported to Sift cloud:', data);
        return { success: true, data };

    } catch (error) {
        // Network errors or other issues - log but don't throw
        console.error('[XNote BG] Cloud report error:', error.message);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// X Internal Block API (Client Impersonation)
// ============================================================================

// X Web App Bearer Token (public, hardcoded in X's JS bundle)
const X_BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// X Block API Endpoint
const X_BLOCK_API = 'https://twitter.com/i/api/1.1/blocks/create.json';

/**
 * Get authentication data (CSRF token + Cookie header) from X/Twitter cookies.
 * Service Workers don't automatically send cookies, so we must manually include them.
 * @returns {Promise<{csrfToken: string, cookieHeader: string}|null>}
 */
async function getAuthData() {
    try {
        // Try to get all cookies from both domains
        let cookies = await chrome.cookies.getAll({ domain: '.twitter.com' });

        // Also try x.com domain
        const xCookies = await chrome.cookies.getAll({ domain: '.x.com' });

        // Merge cookies (prefer twitter.com if duplicates)
        const cookieMap = new Map();
        for (const cookie of xCookies) {
            cookieMap.set(cookie.name, cookie.value);
        }
        for (const cookie of cookies) {
            cookieMap.set(cookie.name, cookie.value);
        }

        // Check for ct0 (CSRF token) - required
        const csrfToken = cookieMap.get('ct0');
        if (!csrfToken) {
            console.error('[XNote BG] ct0 cookie not found - user may not be logged in');
            return null;
        }

        // Check for auth_token - required for authenticated requests
        const authToken = cookieMap.get('auth_token');
        if (!authToken) {
            console.error('[XNote BG] auth_token cookie not found - user may not be logged in');
            return null;
        }

        // Build cookie header string from all cookies
        const cookieHeader = Array.from(cookieMap.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');

        console.log('[XNote BG] Auth data obtained (ct0 + auth_token + cookies)');
        return { csrfToken, cookieHeader };

    } catch (error) {
        console.error('[XNote BG] Failed to get auth data:', error.message);
        return null;
    }
}

/**
 * Block a user using X's internal API.
 * This mimics the web client's block request.
 * @param {string} screenName - The @username to block (without @)
 * @returns {Promise<{success: boolean, error?: string, needsRefresh?: boolean}>}
 */
async function blockUserOnX(screenName) {
    const authData = await getAuthData();

    if (!authData) {
        return {
            success: false,
            error: 'Not logged in to X',
            needsRefresh: true
        };
    }

    const { csrfToken, cookieHeader } = authData;

    try {
        // Build form data (x-www-form-urlencoded)
        const formData = new URLSearchParams();
        formData.append('screen_name', screenName);

        const response = await fetch(X_BLOCK_API, {
            method: 'POST',
            headers: {
                'authorization': X_BEARER_TOKEN,
                'x-csrf-token': csrfToken,
                'x-twitter-auth-type': 'OAuth2Session',
                'x-twitter-active-user': 'yes',
                'x-twitter-client-language': 'en',
                'content-type': 'application/x-www-form-urlencoded',
                'Cookie': cookieHeader  // Manually include cookies
            },
            body: formData.toString()
        });

        if (response.ok) {
            const data = await response.json();
            console.log('[XNote BG] User blocked on X successfully:', screenName);
            return { success: true, data };
        }

        // Handle auth errors
        if (response.status === 401 || response.status === 403) {
            const errorText = await response.text();
            console.error(`[XNote BG] X Block API auth error: ${response.status}`, errorText);
            return {
                success: false,
                error: `Auth error: ${response.status}`,
                needsRefresh: true
            };
        }

        // Other errors
        const errorText = await response.text();
        console.error(`[XNote BG] X Block API error: ${response.status} - ${errorText}`);
        return { success: false, error: `HTTP ${response.status}` };

    } catch (error) {
        console.error('[XNote BG] X Block API request failed:', error.message);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// Community Blocklist Sync
// ============================================================================

const BLOCKLIST_SYNC_ALARM = 'XNOTE_BLOCKLIST_SYNC';
const STORAGE_KEY_BLOCKLIST = 'communityBlocklist';
const BLOCKLIST_SYNC_INTERVAL_MINUTES = 30;

/**
 * Fetch community blocklist from cloud API.
 * Stores the result in chrome.storage.local for content script access.
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 */
async function fetchCloudBlocklist() {
    const endpoint = `${CLOUD_API_URL}/blocklist`;

    try {
        console.log('[XNote BG] Fetching community blocklist...');

        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`[XNote BG] Blocklist fetch failed: HTTP ${response.status}`);
            return { success: false, error: `HTTP ${response.status}` };
        }

        const data = await response.json();
        const users = data.users || [];

        // Store in chrome.storage.local for content script access
        await chrome.storage.local.set({
            [STORAGE_KEY_BLOCKLIST]: users,
            blocklistLastUpdated: Date.now()
        });

        console.log(`[XNote BG] Fetched community blocklist: ${users.length} users`);
        return { success: true, count: users.length };

    } catch (error) {
        // Network errors - log but don't throw, don't break other functionality
        console.error('[XNote BG] Blocklist fetch error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Initialize blocklist sync: fetch immediately and set up recurring alarm.
 */
async function initBlocklistSync() {
    // Fetch immediately
    await fetchCloudBlocklist();

    // Set up recurring alarm for periodic sync
    chrome.alarms.create(BLOCKLIST_SYNC_ALARM, {
        periodInMinutes: BLOCKLIST_SYNC_INTERVAL_MINUTES
    });

    console.log(`[XNote BG] Blocklist sync alarm set: every ${BLOCKLIST_SYNC_INTERVAL_MINUTES} minutes`);
}

// Listen for alarm triggers
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BLOCKLIST_SYNC_ALARM) {
        console.log('[XNote BG] Blocklist sync alarm triggered');
        fetchCloudBlocklist();
    }
});

// Listen for Community Shield toggle changes
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    // When shield is turned ON, re-fetch community blocklist
    if (changes.enableBlocklist) {
        const newValue = changes.enableBlocklist.newValue;
        const oldValue = changes.enableBlocklist.oldValue;

        console.log(`[XNote BG] Community Shield changed: ${oldValue} → ${newValue}`);

        // Only fetch when turning ON (false → true or undefined → true)
        if (newValue === true && oldValue !== true) {
            console.log('[XNote BG] Shield ON - refreshing community blocklist...');
            fetchCloudBlocklist();
        }
    }
});

// ============================================================================
// Lifecycle Events
// ============================================================================

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[XNote BG] Extension installed successfully!');
        // Initialize blocklist sync on fresh install
        initBlocklistSync();
    } else if (details.reason === 'update') {
        console.log(`[XNote BG] Updated to version ${chrome.runtime.getManifest().version}`);
        // Re-initialize sync on update
        initBlocklistSync();
    }
});

// Also sync on browser startup (in case extension was already installed)
chrome.runtime.onStartup.addListener(() => {
    console.log('[XNote BG] Browser started, syncing blocklist...');
    initBlocklistSync();
});

// ============================================================================
// Filename Utilities
// ============================================================================

/**
 * Sanitize filename by removing invalid characters.
 */
function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

/**
 * Extract filename from URL as fallback.
 */
function getFilenameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop() || 'download';
        return filename.split('?')[0];
    } catch (e) {
        return 'xnote_download';
    }
}

// ============================================================================
// Download Handler
// ============================================================================

/**
 * Download a file using chrome.downloads API.
 */
async function downloadFile(url, filename = null) {
    const downloadOptions = {
        url: url,
        conflictAction: 'uniquify',
        saveAs: false
    };

    if (filename) {
        downloadOptions.filename = sanitizeFilename(filename);
    }

    return new Promise((resolve) => {
        chrome.downloads.download(downloadOptions, (downloadId) => {
            if (chrome.runtime.lastError) {
                const errorMessage = chrome.runtime.lastError.message;
                console.error(`[XNote BG] Download failed: ${errorMessage}`);

                // Retry with fallback filename if custom filename caused error
                if (filename && errorMessage.includes('filename')) {
                    console.log('[XNote BG] Retrying with fallback filename...');

                    const fallbackOptions = {
                        url: url,
                        conflictAction: 'uniquify',
                        saveAs: false,
                        filename: getFilenameFromUrl(url)
                    };

                    chrome.downloads.download(fallbackOptions, (retryId) => {
                        if (chrome.runtime.lastError) {
                            console.error(`[XNote BG] Fallback download failed: ${chrome.runtime.lastError.message}`);
                            resolve({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            console.log(`[XNote BG] Fallback download started: ID ${retryId}`);
                            resolve({ success: true, downloadId: retryId });
                        }
                    });
                } else {
                    resolve({ success: false, error: errorMessage });
                }
            } else {
                console.log(`[XNote BG] Download started: ID ${downloadId}, File: ${filename || 'default'}`);
                resolve({ success: true, downloadId: downloadId });
            }
        });
    });
}

// ============================================================================
// Video Resolution (Syndication API) - Robust Extraction
// ============================================================================

/**
 * Find video variants from various possible locations in the API response.
 * Handles: direct video, GIFs, quoted tweets, mediaDetails.
 * @param {object} data - The API response data
 * @returns {Array} Array of video variants or empty array
 */
function findVariants(data) {
    // Check 1: Direct video path
    if (data.video && data.video.variants && data.video.variants.length > 0) {
        console.log('[XNote BG] Found variants at: data.video.variants');
        return data.video.variants;
    }

    // Check 2: mediaDetails path (for tweets with multiple media)
    if (data.mediaDetails && Array.isArray(data.mediaDetails)) {
        for (const media of data.mediaDetails) {
            if (media.video_info && media.video_info.variants && media.video_info.variants.length > 0) {
                console.log('[XNote BG] Found variants at: data.mediaDetails[].video_info.variants');
                return media.video_info.variants;
            }
        }
    }

    // Check 3: GIF/media entity path
    if (data.mediaEntity && data.mediaEntity.video_info && data.mediaEntity.video_info.variants) {
        console.log('[XNote BG] Found variants at: data.mediaEntity.video_info.variants');
        return data.mediaEntity.video_info.variants;
    }

    // Check 4: Quoted tweet video
    if (data.quoted_tweet && data.quoted_tweet.video && data.quoted_tweet.video.variants) {
        console.log('[XNote BG] Found variants at: data.quoted_tweet.video.variants');
        return data.quoted_tweet.video.variants;
    }

    // Check 5: Extended entities (common structure)
    if (data.extended_entities && data.extended_entities.media) {
        for (const media of data.extended_entities.media) {
            if (media.video_info && media.video_info.variants) {
                console.log('[XNote BG] Found variants at: data.extended_entities.media[].video_info.variants');
                return media.video_info.variants;
            }
        }
    }

    // Check 6: entities.media
    if (data.entities && data.entities.media) {
        for (const media of data.entities.media) {
            if (media.video_info && media.video_info.variants) {
                console.log('[XNote BG] Found variants at: data.entities.media[].video_info.variants');
                return media.video_info.variants;
            }
        }
    }

    return [];
}

/**
 * Resolve video URL using Twitter's public Syndication API.
 * @param {string} tweetId 
 * @returns {Promise<string|null>} MP4 URL or null if not found
 */
async function resolveVideoUrl(tweetId) {
    const apiUrl = `${SYNDICATION_API}?id=${tweetId}&token=x`;

    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const variants = findVariants(data);

        if (!variants || variants.length === 0) {
            return null;
        }

        let mp4s = variants.filter(v => v.type === 'video/mp4');

        if (mp4s.length === 0) {
            return null;
        }

        mp4s.sort((a, b) => {
            if (a.bitrate && b.bitrate) {
                return b.bitrate - a.bitrate;
            }

            const getRes = (url) => {
                const match = url.match(/\/(\d+)x(\d+)\//);
                if (match && match[1] && match[2]) {
                    return parseInt(match[1]) * parseInt(match[2]);
                }
                return 0;
            };

            return getRes(b.src) - getRes(a.src);
        });

        return mp4s[0].src;

    } catch (error) {
        console.error('[XNote BG] Failed to resolve video URL:', error.message);
        return null;
    }
}

/**
 * Resolve video and download it.
 */
async function resolveVideoAndDownload(tweetId, username, filename) {
    const videoUrl = await resolveVideoUrl(tweetId);

    if (!videoUrl) {
        return { success: false, error: 'Video not found or protected' };
    }

    const finalFilename = filename || `xnote_${username}_${tweetId}.mp4`;

    return await downloadFile(videoUrl, finalFilename);
}

// ============================================================================
// Message Listener
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type } = message;

    if (type === MESSAGE_TYPES.DOWNLOAD_MEDIA) {
        const { url, filename } = message;

        downloadFile(url, filename)
            .then((result) => sendResponse(result))
            .catch((error) => {
                console.error('[XNote BG] Unexpected error:', error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }

    if (type === MESSAGE_TYPES.RESOLVE_VIDEO_AND_DOWNLOAD) {
        const { tweetId, username, filename } = message;

        resolveVideoAndDownload(tweetId, username, filename)
            .then((result) => sendResponse(result))
            .catch((error) => {
                console.error('[XNote BG] Video resolve error:', error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }

    if (type === MESSAGE_TYPES.RESOLVE_VIDEO_URL_ONLY) {
        const { tweetId } = message;

        resolveVideoUrl(tweetId)
            .then((url) => {
                sendResponse({ success: !!url, url: url });
            })
            .catch((error) => {
                console.error('[XNote BG] URL-only resolve error:', error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }

    // Handle BLOCK_USER: Block on X + Report to Sift cloud (dual action)
    if (type === MESSAGE_TYPES.BLOCK_USER) {
        const { screenName, reason } = message;

        if (!screenName) {
            sendResponse({ success: false, error: 'No screen_name provided' });
            return true;
        }

        console.log(`[XNote BG] Block user request: @${screenName}, reason: ${reason || 'manual_block'}`);

        // Execute both actions in parallel
        Promise.allSettled([
            blockUserOnX(screenName),                           // Action A: X Internal API
            reportUserToCloud(screenName, reason || 'manual_block')  // Action B: Cloud API
        ]).then(([xResult, cloudResult]) => {
            // Log cloud result (non-blocking)
            if (cloudResult.status === 'fulfilled' && cloudResult.value.success) {
                console.log('[XNote BG] Cloud report completed successfully');
            } else {
                const cloudError = cloudResult.status === 'rejected'
                    ? cloudResult.reason
                    : cloudResult.value?.error;
                console.warn('[XNote BG] Cloud report failed (non-blocking):', cloudError);
            }

            // Determine success based on X API result only
            if (xResult.status === 'fulfilled') {
                const xData = xResult.value;

                if (xData.success) {
                    console.log('[XNote BG] Block action completed successfully');
                    sendResponse({ success: true, message: 'User blocked successfully' });
                } else if (xData.needsRefresh) {
                    console.error('[XNote BG] Auth error - user needs to refresh');
                    sendResponse({
                        success: false,
                        error: xData.error,
                        needsRefresh: true
                    });
                } else {
                    sendResponse({ success: false, error: xData.error });
                }
            } else {
                // Promise rejected (network error etc)
                console.error('[XNote BG] X Block request failed:', xResult.reason);
                sendResponse({ success: false, error: xResult.reason?.message || 'Request failed' });
            }
        });

        return true; // Keep message channel open for async response
    }

    // Handle BLOCK_USER_ACTION: Add to local blocklist + report to cloud
    // Note: X Block API is now called directly from content.js (for proper cookie access)
    if (type === MESSAGE_TYPES.BLOCK_USER_ACTION) {
        const { screen_name, tweet_id, reason } = message.payload || message;

        if (!screen_name) {
            console.warn('[XNote BG] BLOCK_USER_ACTION: No screen_name provided');
            return false;
        }

        console.log(`[XNote BG] Block action received: @${screen_name}, tweet: ${tweet_id}, reason: ${reason}`);

        // Step 1: Add to local blocklist (triggers storage.onChanged for all tabs)
        chrome.storage.local.get(STORAGE_KEY_LOCAL_BLOCKLIST, (result) => {
            const currentList = result[STORAGE_KEY_LOCAL_BLOCKLIST] || [];
            const lowerName = screen_name.toLowerCase();

            // Avoid duplicates
            if (!currentList.includes(lowerName)) {
                currentList.push(lowerName);
                chrome.storage.local.set({
                    [STORAGE_KEY_LOCAL_BLOCKLIST]: currentList
                }, () => {
                    console.log(`[XNote BG] Added @${screen_name} to local blocklist (total: ${currentList.length})`);
                });
            } else {
                console.log(`[XNote BG] @${screen_name} already in local blocklist`);
            }
        });

        // Step 2: Report to cloud (fire and forget)
        reportUserToCloud(screen_name, reason || 'manual_block')
            .then((result) => {
                if (result.success) {
                    console.log('[XNote BG] Cloud report completed');
                } else {
                    console.warn('[XNote BG] Cloud report failed (non-blocking):', result.error);
                }
            })
            .catch((error) => {
                console.warn('[XNote BG] Cloud report error (non-blocking):', error);
            });

        // No response needed - fire and forget pattern
        return false;
    }

    console.warn('[XNote BG] Unknown message type:', type);
    return false;
});
