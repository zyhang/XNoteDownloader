/**
 * XNote Downloader - Main World Script
 * This script runs in the page's main world context (not isolated).
 * It can access page cookies and make authenticated requests to X APIs.
 */

(function () {
    'use strict';

    // X Web App Bearer Token (public, hardcoded in X's JS bundle)
    const X_BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

    // Use current origin to avoid CORS issues (x.com or twitter.com)
    const X_BLOCK_API = window.location.origin + '/i/api/1.1/blocks/create.json';

    function getCsrfToken() {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'ct0') {
                return value;
            }
        }
        return null;
    }

    async function blockUserOnX(screenName, reqId) {
        const csrfToken = getCsrfToken();

        if (!csrfToken) {
            console.error('[XNote MW] No ct0 token found');
            window.postMessage({
                type: 'XNOTE_BLOCK_USER_RESULT',
                success: false,
                error: 'Not logged in (no ct0)',
                reqId: reqId
            }, '*');
            return;
        }

        try {
            const formData = new URLSearchParams();
            formData.append('screen_name', screenName);

            console.log('[XNote MW] Blocking user:', screenName);

            const response = await fetch(X_BLOCK_API, {
                method: 'POST',
                headers: {
                    'authorization': X_BEARER_TOKEN,
                    'x-csrf-token': csrfToken,
                    'x-twitter-auth-type': 'OAuth2Session',
                    'x-twitter-active-user': 'yes',
                    'x-twitter-client-language': 'en',
                    'content-type': 'application/x-www-form-urlencoded'
                },
                credentials: 'include',
                body: formData.toString()
            });

            if (response.ok) {
                const data = await response.json();
                console.log('[XNote MW] User blocked successfully:', screenName);
                window.postMessage({
                    type: 'XNOTE_BLOCK_USER_RESULT',
                    success: true,
                    data: data,
                    reqId: reqId
                }, '*');
            } else {
                const errorText = await response.text();
                console.error('[XNote MW] Block API error:', response.status, errorText);
                window.postMessage({
                    type: 'XNOTE_BLOCK_USER_RESULT',
                    success: false,
                    error: 'HTTP ' + response.status,
                    reqId: reqId
                }, '*');
            }
        } catch (error) {
            console.error('[XNote MW] Block request failed:', error.message);
            window.postMessage({
                type: 'XNOTE_BLOCK_USER_RESULT',
                success: false,
                error: error.message,
                reqId: reqId
            }, '*');
        }
    }

    // React Props extraction for video URLs
    function getReactProps(el) {
        if (!el) return null;
        const keys = Object.keys(el);
        const propKey = keys.find(k => k.startsWith('__reactProps'));
        return propKey ? el[propKey] : null;
    }

    function getReactFiber(el) {
        if (!el) return null;
        const keys = Object.keys(el);
        const fiberKey = keys.find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        return fiberKey ? el[fiberKey] : null;
    }

    function findVideoInfoInReact(element) {
        try {
            const props = getReactProps(element);
            const fiber = getReactFiber(element);

            function searchForVideo(obj, depth = 0) {
                if (depth > 20 || !obj || typeof obj !== 'object') return null;

                if (obj.video_info && obj.video_info.variants) {
                    const variants = obj.video_info.variants.filter(v => v.content_type === 'video/mp4');
                    if (variants.length > 0) {
                        variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                        return variants[0].url;
                    }
                }

                if (obj.extended_entities && obj.extended_entities.media) {
                    for (const m of obj.extended_entities.media) {
                        if (m.video_info && m.video_info.variants) {
                            const res = searchForVideo(m, depth + 1);
                            if (res) return res;
                        }
                    }
                }

                if (obj.legacy && obj.legacy.extended_entities) {
                    const res = searchForVideo(obj.legacy.extended_entities, depth + 1);
                    if (res) return res;
                }

                const keysToCheck = ['tweet', 'result', 'media', 'props', 'children', 'memoizedProps', 'stateNode'];
                for (const key of keysToCheck) {
                    if (obj[key] && typeof obj[key] === 'object') {
                        const res = searchForVideo(obj[key], depth + 1);
                        if (res) return res;
                    }
                }

                if (Array.isArray(obj)) {
                    for (let i = 0; i < Math.min(obj.length, 10); i++) {
                        const res = searchForVideo(obj[i], depth + 1);
                        if (res) return res;
                    }
                }

                return null;
            }

            if (props) {
                const url = searchForVideo(props, 0);
                if (url) return url;
            }

            if (fiber) {
                const url = searchForVideo(fiber, 0);
                if (url) return url;
            }
        } catch (e) { }
        return null;
    }

    // Message listener
    window.addEventListener('message', (event) => {
        // Only accept messages from same origin
        if (event.source !== window) return;

        if (event.data.type === 'XNOTE_GET_VIDEO_URL') {
            const article = document.querySelector('article[data-testid="tweet"]');
            const url = findVideoInfoInReact(article);
            window.postMessage({ type: 'XNOTE_VIDEO_URL_RESULT', url: url, reqId: event.data.reqId }, '*');
        }

        if (event.data.type === 'XNOTE_BLOCK_USER') {
            blockUserOnX(event.data.screenName, event.data.reqId);
        }
    });

    console.log('[XNote MW] Main world script loaded');
})();
