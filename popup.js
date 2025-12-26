/**
 * XNote Downloader - Popup Script
 * Handles Community Shield toggle and Content Filter settings.
 */

// ============================================================================
// DOM Elements
// ============================================================================

const enableBlocklistToggle = document.getElementById('enableBlocklist');
const enableFilterToggle = document.getElementById('enableFilter');
const scopeSelector = document.getElementById('scopeSelector');
const rulesList = document.getElementById('rulesList');
const newRuleInput = document.getElementById('newRuleInput');
const isRegexCheckbox = document.getElementById('isRegex');
const caseSensitiveCheckbox = document.getElementById('caseSensitive');
const addRuleBtn = document.getElementById('addRuleBtn');
const regexError = document.getElementById('regexError');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const includeQuoteToggle = document.getElementById('includeQuote');

// ============================================================================
// Filter Settings State
// ============================================================================

let filterSettings = null;

// ============================================================================
// Community Shield
// ============================================================================

async function loadBlocklistSetting() {
    try {
        const result = await chrome.storage.local.get({ enableBlocklist: true });
        enableBlocklistToggle.checked = result.enableBlocklist;
    } catch (error) {
        console.error('[XNote Popup] Failed to load blocklist setting:', error);
    }
}

async function saveBlocklistSetting() {
    try {
        const enabled = enableBlocklistToggle.checked;
        await chrome.storage.local.set({ enableBlocklist: enabled });
        console.log('[XNote Popup] Community Shield:', enabled ? 'ON' : 'OFF');
    } catch (error) {
        console.error('[XNote Popup] Failed to save blocklist setting:', error);
    }
}

// ============================================================================
// Include Quote Setting
// ============================================================================

async function loadQuoteSetting() {
    try {
        const result = await chrome.storage.local.get({ includeQuoteTweet: true });
        includeQuoteToggle.checked = result.includeQuoteTweet;
    } catch (error) {
        console.error('[XNote Popup] Failed to load quote setting:', error);
    }
}

async function saveQuoteSetting() {
    try {
        const enabled = includeQuoteToggle.checked;
        await chrome.storage.local.set({ includeQuoteTweet: enabled });
        console.log('[XNote Popup] Include Quote Tweet:', enabled ? 'ON' : 'OFF');
    } catch (error) {
        console.error('[XNote Popup] Failed to save quote setting:', error);
    }
}

// ============================================================================
// Content Filter Settings
// ============================================================================

async function loadFilterSettings() {
    try {
        if (typeof XNoteFilter !== 'undefined') {
            filterSettings = await XNoteFilter.loadFilterSettings();
        } else {
            // Fallback if XNoteFilter not loaded
            const result = await chrome.storage.local.get({
                filterSettings: {
                    enabled: false,
                    scope: 'all',
                    rules: [],
                    whitelistUsers: [],
                    whitelistTweets: []
                }
            });
            filterSettings = result.filterSettings;
        }

        // Update UI
        enableFilterToggle.checked = filterSettings.enabled;
        updateScopeUI(filterSettings.scope);
        renderRulesList();
    } catch (error) {
        console.error('[XNote Popup] Failed to load filter settings:', error);
    }
}

async function saveFilterSettings() {
    try {
        // Remove compiled regex before saving
        const toSave = {
            ...filterSettings,
            rules: filterSettings.rules.map(r => {
                const { compiled, ...rest } = r;
                return rest;
            })
        };
        await chrome.storage.local.set({ filterSettings: toSave });
        console.log('[XNote Popup] Filter settings saved');
    } catch (error) {
        console.error('[XNote Popup] Failed to save filter settings:', error);
    }
}

// ============================================================================
// Scope Selector
// ============================================================================

function updateScopeUI(scope) {
    scopeSelector.querySelectorAll('.scope-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.scope === scope);
    });
}

function handleScopeClick(e) {
    const btn = e.target.closest('.scope-btn');
    if (!btn) return;

    filterSettings.scope = btn.dataset.scope;
    updateScopeUI(filterSettings.scope);
    saveFilterSettings();
}

// ============================================================================
// Rules List
// ============================================================================

function renderRulesList() {
    if (!filterSettings.rules || filterSettings.rules.length === 0) {
        rulesList.innerHTML = '<div class="empty-state">暂无规则</div>';
        return;
    }

    rulesList.innerHTML = filterSettings.rules.map((rule, index) => `
        <div class="rule-item" data-index="${index}">
            <div class="rule-pattern">${escapeHtml(rule.name || rule.pattern)}</div>
            <div class="rule-badges">
                ${rule.isRegex ? '<span class="rule-badge regex">正则</span>' : ''}
                ${rule.caseSensitive ? '<span class="rule-badge case">Aa</span>' : ''}
            </div>
            <button class="rule-delete" data-index="${index}">×</button>
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function handleRuleDelete(e) {
    const btn = e.target.closest('.rule-delete');
    if (!btn) return;

    const index = parseInt(btn.dataset.index, 10);
    filterSettings.rules.splice(index, 1);
    renderRulesList();
    saveFilterSettings();
}

// ============================================================================
// Add Rule
// ============================================================================

function validateRegex(pattern) {
    try {
        new RegExp(pattern);
        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

function handleAddRule() {
    const pattern = newRuleInput.value.trim();
    if (!pattern) return;

    const isRegex = isRegexCheckbox.checked;
    const caseSensitive = caseSensitiveCheckbox.checked;

    // Validate regex if needed
    if (isRegex) {
        const validation = validateRegex(pattern);
        if (!validation.valid) {
            regexError.textContent = `正则无效: ${validation.error}`;
            regexError.style.display = 'block';
            return;
        }
    }
    regexError.style.display = 'none';

    // Create new rule
    const newRule = {
        id: 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: pattern.length > 30 ? pattern.substring(0, 30) + '...' : pattern,
        pattern: pattern,
        isRegex: isRegex,
        caseSensitive: caseSensitive,
        enabled: true
    };

    filterSettings.rules.push(newRule);
    renderRulesList();
    saveFilterSettings();

    // Clear input
    newRuleInput.value = '';
    isRegexCheckbox.checked = false;
    caseSensitiveCheckbox.checked = false;
}

// ============================================================================
// Import/Export
// ============================================================================

function handleExport() {
    const data = {
        rules: filterSettings.rules.map(r => {
            const { compiled, ...rest } = r;
            return rest;
        }),
        whitelistUsers: filterSettings.whitelistUsers,
        exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `xnote-filter-rules-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
}

function handleImport() {
    importFile.click();
}

async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.rules && Array.isArray(data.rules)) {
            // Merge imported rules
            const existingPatterns = new Set(filterSettings.rules.map(r => r.pattern));
            const newRules = data.rules.filter(r => !existingPatterns.has(r.pattern));

            filterSettings.rules.push(...newRules);
            renderRulesList();
            saveFilterSettings();

            alert(`导入成功! 新增 ${newRules.length} 条规则`);
        }

        if (data.whitelistUsers && Array.isArray(data.whitelistUsers)) {
            const newUsers = data.whitelistUsers.filter(u => !filterSettings.whitelistUsers.includes(u));
            filterSettings.whitelistUsers.push(...newUsers);
            saveFilterSettings();
        }
    } catch (error) {
        alert('导入失败: ' + error.message);
    }

    // Reset file input
    importFile.value = '';
}

// ============================================================================
// Event Listeners
// ============================================================================

enableBlocklistToggle.addEventListener('change', saveBlocklistSetting);
includeQuoteToggle.addEventListener('change', saveQuoteSetting);
enableFilterToggle.addEventListener('change', () => {
    filterSettings.enabled = enableFilterToggle.checked;
    saveFilterSettings();
});
scopeSelector.addEventListener('click', handleScopeClick);
rulesList.addEventListener('click', handleRuleDelete);
addRuleBtn.addEventListener('click', handleAddRule);
newRuleInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddRule();
});
exportBtn.addEventListener('click', handleExport);
importBtn.addEventListener('click', handleImport);
importFile.addEventListener('change', handleImportFile);

// ============================================================================
// Initialize
// ============================================================================

loadBlocklistSetting();
loadQuoteSetting();
loadFilterSettings();
