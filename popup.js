/**
 * XNote Downloader - Popup Script
 * Handles Community Shield toggle and settings persistence.
 */

// Storage key
const STORAGE_KEY = 'enableBlocklist';

// DOM elements
const enableBlocklistToggle = document.getElementById('enableBlocklist');
const statusBadge = document.getElementById('statusBadge');

/**
 * Update status badge UI based on toggle state.
 */
function updateStatusBadge(enabled) {
    if (enabled) {
        statusBadge.textContent = '● Protected';
        statusBadge.className = 'status-badge active';
    } else {
        statusBadge.textContent = '○ Disabled';
        statusBadge.className = 'status-badge inactive';
    }
}

/**
 * Load settings from storage.
 */
async function loadSettings() {
    try {
        const result = await chrome.storage.local.get({ [STORAGE_KEY]: true }); // Default: true (enabled)
        const enabled = result[STORAGE_KEY];
        enableBlocklistToggle.checked = enabled;
        updateStatusBadge(enabled);
    } catch (error) {
        console.error('[XNote Popup] Failed to load settings:', error);
    }
}

/**
 * Save settings to storage.
 */
async function saveSettings() {
    try {
        const enabled = enableBlocklistToggle.checked;
        await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
        updateStatusBadge(enabled);
        console.log('[XNote Popup] Community Shield:', enabled ? 'ON' : 'OFF');
    } catch (error) {
        console.error('[XNote Popup] Failed to save settings:', error);
    }
}

// Event listeners
enableBlocklistToggle.addEventListener('change', saveSettings);

// Initialize
loadSettings();
