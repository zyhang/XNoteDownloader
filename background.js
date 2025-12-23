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
    RESOLVE_VIDEO_URL_ONLY: 'RESOLVE_VIDEO_URL_ONLY'
};

const SYNDICATION_API = 'https://cdn.syndication.twimg.com/tweet-result';

// ============================================================================
// Lifecycle Events
// ============================================================================

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[XNote BG] Extension installed successfully!');
    } else if (details.reason === 'update') {
        console.log(`[XNote BG] Updated to version ${chrome.runtime.getManifest().version}`);
    }
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

    console.warn('[XNote BG] Unknown message type:', type);
    return false;
});
