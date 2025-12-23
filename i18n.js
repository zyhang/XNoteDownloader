/**
 * XNote Downloader - Internationalization (i18n) Module
 * Lightweight i18n system with 8 language support
 */

const TRANSLATIONS = {
    // English (Default)
    en: {
        // Buttons
        btn_download_pack: 'Save All',
        btn_review_data: 'Insights',
        btn_block: 'Block',
        btn_scraping: 'Scraping...',
        btn_export_csv: 'Export CSV',
        btn_packing: 'Packing...',
        btn_done: 'Done',
        btn_failed: 'Failed',
        btn_download_reviews: 'download reviews',

        // Modal
        modal_title: 'Comment Analysis',
        modal_close: 'Close',

        // Table Headers
        th_content: 'Content',
        th_author: 'Author',
        th_time: 'Time',
        th_likes: 'Likes',
        th_replies: 'Replies',
        th_retweets: 'Retweets',
        th_views: 'Views',

        // Status Messages
        status_scraping: 'Scraping comments: {current}/{total}...',
        status_downloading_images: 'Downloading images...',
        status_fetching_video: 'Fetching video...',
        status_zipping: 'Creating archive...',

        // Tooltips
        tooltip_xnote: 'XNote',

        // Menu Items
        menu_about: 'About XNote',
        menu_download_reviews: 'Download Reviews'
    },

    // Simplified Chinese
    'zh-CN': {
        btn_download_pack: '打包下载',
        btn_review_data: '评论分析',
        btn_block: '拉黑',
        btn_scraping: '抓取中...',
        btn_export_csv: '导出 CSV',
        btn_packing: '打包中...',
        btn_done: '完成',
        btn_failed: '失败',
        btn_download_reviews: '下载评论',

        modal_title: '评论数据分析',
        modal_close: '关闭',

        th_content: '评论内容',
        th_author: '评论人',
        th_time: '发布时间',
        th_likes: '点赞',
        th_replies: '评论',
        th_retweets: '转发',
        th_views: '浏览',

        status_scraping: '正在抓取评论: {current}/{total}...',
        status_downloading_images: '正在下载图片...',
        status_fetching_video: '正在获取视频...',
        status_zipping: '正在打包...',

        tooltip_xnote: 'XNote',

        menu_about: '关于 XNote',
        menu_download_reviews: '下载评论'
    },

    // Traditional Chinese
    'zh-TW': {
        btn_download_pack: '打包下載',
        btn_review_data: '留言分析',
        btn_block: '封鎖',
        btn_scraping: '擷取中...',
        btn_export_csv: '匯出 CSV',
        btn_packing: '打包中...',
        btn_done: '完成',
        btn_failed: '失敗',
        btn_download_reviews: '下載留言',

        modal_title: '留言數據分析',
        modal_close: '關閉',

        th_content: '留言內容',
        th_author: '留言者',
        th_time: '發布時間',
        th_likes: '按讚',
        th_replies: '回覆',
        th_retweets: '轉發',
        th_views: '瀏覽',

        status_scraping: '正在擷取留言: {current}/{total}...',
        status_downloading_images: '正在下載圖片...',
        status_fetching_video: '正在取得影片...',
        status_zipping: '正在打包...',

        tooltip_xnote: 'XNote',

        menu_about: '關於 XNote',
        menu_download_reviews: '下載留言'
    },

    // Japanese
    ja: {
        btn_download_pack: '一括保存',
        btn_review_data: 'コメント分析',
        btn_block: 'ブロック',
        btn_scraping: '取得中...',
        btn_export_csv: 'CSV出力',
        btn_packing: '作成中...',
        btn_done: '完了',
        btn_failed: '失敗',
        btn_download_reviews: 'コメント取得',

        modal_title: 'コメント分析',
        modal_close: '閉じる',

        th_content: 'コメント',
        th_author: 'ユーザー',
        th_time: '投稿日時',
        th_likes: 'いいね',
        th_replies: '返信',
        th_retweets: 'RT',
        th_views: '表示',

        status_scraping: 'コメント取得中: {current}/{total}...',
        status_downloading_images: '画像をダウンロード中...',
        status_fetching_video: '動画を取得中...',
        status_zipping: 'アーカイブ作成中...',

        tooltip_xnote: 'XNote',

        menu_about: 'XNote について',
        menu_download_reviews: 'コメントを取得'
    },

    // Korean
    ko: {
        btn_download_pack: '모두 저장',
        btn_review_data: '댓글 분석',
        btn_block: '차단',
        btn_scraping: '수집 중...',
        btn_export_csv: 'CSV 내보내기',
        btn_packing: '압축 중...',
        btn_done: '완료',
        btn_failed: '실패',
        btn_download_reviews: '댓글 다운로드',

        modal_title: '댓글 데이터 분석',
        modal_close: '닫기',

        th_content: '댓글 내용',
        th_author: '작성자',
        th_time: '작성 시간',
        th_likes: '좋아요',
        th_replies: '답글',
        th_retweets: '리트윗',
        th_views: '조회',

        status_scraping: '댓글 수집 중: {current}/{total}...',
        status_downloading_images: '이미지 다운로드 중...',
        status_fetching_video: '동영상 가져오는 중...',
        status_zipping: '압축 중...',

        tooltip_xnote: 'XNote',

        menu_about: 'XNote 정보',
        menu_download_reviews: '댓글 다운로드'
    },

    // German
    de: {
        btn_download_pack: 'Alles speichern',
        btn_review_data: 'Analyse',
        btn_block: 'Blockieren',
        btn_scraping: 'Erfassen...',
        btn_export_csv: 'CSV exportieren',
        btn_packing: 'Verpacken...',
        btn_done: 'Fertig',
        btn_failed: 'Fehler',
        btn_download_reviews: 'Kommentare laden',

        modal_title: 'Kommentaranalyse',
        modal_close: 'Schließen',

        th_content: 'Inhalt',
        th_author: 'Autor',
        th_time: 'Datum',
        th_likes: 'Likes',
        th_replies: 'Antworten',
        th_retweets: 'Retweets',
        th_views: 'Aufrufe',

        status_scraping: 'Kommentare erfassen: {current}/{total}...',
        status_downloading_images: 'Bilder herunterladen...',
        status_fetching_video: 'Video abrufen...',
        status_zipping: 'Archiv erstellen...',

        tooltip_xnote: 'XNote',

        menu_about: 'Über XNote',
        menu_download_reviews: 'Kommentare laden'
    },

    // French
    fr: {
        btn_download_pack: 'Tout sauvegarder',
        btn_review_data: 'Analyse',
        btn_block: 'Bloquer',
        btn_scraping: 'Extraction...',
        btn_export_csv: 'Exporter CSV',
        btn_packing: 'Compression...',
        btn_done: 'Terminé',
        btn_failed: 'Échec',
        btn_download_reviews: 'télécharger commentaires',

        modal_title: 'Analyse des commentaires',
        modal_close: 'Fermer',

        th_content: 'Contenu',
        th_author: 'Auteur',
        th_time: 'Date',
        th_likes: 'J\'aime',
        th_replies: 'Réponses',
        th_retweets: 'Retweets',
        th_views: 'Vues',

        status_scraping: 'Extraction des commentaires: {current}/{total}...',
        status_downloading_images: 'Téléchargement des images...',
        status_fetching_video: 'Récupération de la vidéo...',
        status_zipping: 'Création de l\'archive...',

        tooltip_xnote: 'XNote',

        menu_about: 'À propos de XNote',
        menu_download_reviews: 'Télécharger les commentaires'
    },

    // Spanish
    es: {
        btn_download_pack: 'Guardar todo',
        btn_review_data: 'Análisis',
        btn_block: 'Bloquear',
        btn_scraping: 'Extrayendo...',
        btn_export_csv: 'Exportar CSV',
        btn_packing: 'Empaquetando...',
        btn_done: 'Listo',
        btn_failed: 'Error',
        btn_download_reviews: 'descargar comentarios',

        modal_title: 'Análisis de comentarios',
        modal_close: 'Cerrar',

        th_content: 'Contenido',
        th_author: 'Autor',
        th_time: 'Fecha',
        th_likes: 'Me gusta',
        th_replies: 'Respuestas',
        th_retweets: 'Retweets',
        th_views: 'Vistas',

        status_scraping: 'Extrayendo comentarios: {current}/{total}...',
        status_downloading_images: 'Descargando imágenes...',
        status_fetching_video: 'Obteniendo vídeo...',
        status_zipping: 'Creando archivo...',

        tooltip_xnote: 'XNote',

        menu_about: 'Acerca de XNote',
        menu_download_reviews: 'Descargar comentarios'
    }
};

/**
 * Get the current locale based on browser language
 * Falls back to 'en' if language is not supported
 */
function getLocale() {
    // Get browser language (e.g., "en-US", "zh-CN", "ja")
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    const langLower = browserLang.toLowerCase();
    const prefix = langLower.split('-')[0];

    console.log('[XNote i18n] Raw browser language:', browserLang);
    console.log('[XNote i18n] Lowercase:', langLower);
    console.log('[XNote i18n] Prefix:', prefix);

    // Priority 1: Exact match (case-insensitive for zh-CN, zh-TW)
    if (langLower === 'zh-cn') return 'zh-CN';
    if (langLower === 'zh-tw') return 'zh-TW';
    if (langLower === 'zh-hk') return 'zh-TW'; // Hong Kong uses Traditional

    // Priority 2: Check if browser language directly matches a key
    if (TRANSLATIONS[browserLang]) return browserLang;

    // Priority 3: Check prefix match for supported languages
    const supportedPrefixes = ['en', 'ja', 'ko', 'de', 'fr', 'es'];
    if (supportedPrefixes.includes(prefix)) {
        return prefix;
    }

    // Priority 4: Handle other Chinese variants
    if (prefix === 'zh') {
        return 'zh-CN'; // Default Chinese to Simplified
    }

    // Default: English
    console.log('[XNote i18n] No match found, defaulting to en');
    return 'en';
}

// Cache the locale at load time
const CURRENT_LOCALE = getLocale();
console.log('[XNote i18n] Final selected locale:', CURRENT_LOCALE);
console.log('[XNote i18n] Sample translation test:', TRANSLATIONS[CURRENT_LOCALE]?.btn_download_pack);

/**
 * Translation function
 * @param {string} key - Translation key
 * @param {object} params - Optional parameters for interpolation (e.g., {current: 5, total: 100})
 * @returns {string} Translated string
 */
function t(key, params = {}) {
    const translations = TRANSLATIONS[CURRENT_LOCALE] || TRANSLATIONS.en;
    let text = translations[key] || TRANSLATIONS.en[key] || key;

    // Handle parameter interpolation (e.g., {current} and {total})
    Object.keys(params).forEach(param => {
        text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
    });

    return text;
}

// Create i18n object for easy access
const i18n = {
    t,
    getLocale,
    CURRENT_LOCALE,
    TRANSLATIONS
};

// Export for use in content script
if (typeof window !== 'undefined') {
    window.XNoteI18n = i18n;
}
