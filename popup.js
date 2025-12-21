/**
 * XNote Downloader - Popup Script
 * Handles settings UI and persistence.
 */

// Default settings
const DEFAULT_SETTINGS = {
    autoRename: true,
    origQuality: true
};

// DOM elements
const autoRenameToggle = document.getElementById('autoRename');
const origQualityToggle = document.getElementById('origQuality');

// Load settings from storage
async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        autoRenameToggle.checked = result.autoRename;
        origQualityToggle.checked = result.origQuality;
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Save settings to storage
async function saveSettings() {
    try {
        await chrome.storage.sync.set({
            autoRename: autoRenameToggle.checked,
            origQuality: origQualityToggle.checked
        });
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

// Event listeners
autoRenameToggle.addEventListener('change', saveSettings);
origQualityToggle.addEventListener('change', saveSettings);

// Initialize
loadSettings();
