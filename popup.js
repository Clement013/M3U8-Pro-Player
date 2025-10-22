class M3U8Player {
    constructor() {
        this.currentTabId = null;
        this.videos = [];
        this.players = {
            ct0u0: 'https://m3u8.ct0u0.dpdns.org/m3u8-player.html?url={url}',
            potplayer: 'potplayer://{url}',
            vlc: 'vlc://{url}',
            custom: ''
        };
        this.defaultPlayer = 'clementzq';

        this.init();
    }

    async init() {
        await this.loadSettings();
        await this.getCurrentTab();
        await this.loadVideos();
        this.setupEventListeners();
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['defaultPlayer', 'customPlayerUrl']);
            this.defaultPlayer = result.defaultPlayer || 'clementzq';
            this.players.custom = result.customPlayerUrl || '';

            document.getElementById('defaultPlayer').value = this.defaultPlayer;
            document.getElementById('customPlayerUrl').value = this.players.custom;

            this.toggleCustomUrl();
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({
                defaultPlayer: this.defaultPlayer,
                customPlayerUrl: this.players.custom
            });
            this.showToast('Settings saved!');
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    async getCurrentTab() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTabId = tabs[0]?.id;
        } catch (error) {
            console.error('Error getting current tab:', error);
        }
    }

    async loadVideos() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getM3U8_from_network",
                tabId: this.currentTabId
            });

            if (response && response.success) {
                this.videos = response.urls || [];
                this.renderVideos();
                this.updateStatus();
            } else {
                this.showError('Failed to load video streams');
            }
        } catch (error) {
            console.error('Error loading videos:', error);
            this.showError('Error loading video streams');
        }
    }

    renderVideos() {
        const videoList = document.getElementById('videoList');
        videoList.innerHTML = '';

        if (this.videos.length === 0) {
            this.showNoVideos();
            return;
        }

        this.videos.forEach((video, index) => {
            const videoElement = this.createVideoElement(video, index);
            videoList.appendChild(videoElement);
        });
    }

    createVideoElement(video, index) {
        const div = document.createElement('div');
        div.className = 'video-item';

        const timeStr = new Date(video.timestamp).toLocaleTimeString();
        const shortUrl = this.truncateUrl(video.url, 50);

        div.innerHTML = `
        <div class="video-info">
            <span class="video-quality">${video.subdomain}</span>
            <span class="video-time">${timeStr}</span>
        </div>
        <div class="video-url" title="${video.url}">${shortUrl}</div>
        <div class="player-buttons">
            <button class="btn btn-primary play-btn">▶️ Play</button>
            <button class="btn btn-secondary copy-btn">📋 Copy</button>
            <button class="btn btn-secondary download-btn">💾 Download</button>
            <button class="btn btn-secondary open-btn">🔗 Open</button>
        </div>
    `;

        // attach event listeners programmatically
        div.querySelector(".play-btn").addEventListener("click", () => player.playVideo(video.url));
        div.querySelector(".copy-btn").addEventListener("click", () => player.copyUrl(video.url));
        div.querySelector(".download-btn").addEventListener("click", () => player.downloadVideo(video.url));
        div.querySelector(".open-btn").addEventListener("click", () => player.openInNewTab(video.url));

        return div;
    }

    showNoVideos() {
        const videoList = document.getElementById('videoList');
        videoList.innerHTML = `
            <div class="no-videos">
                <div class="no-videos-icon">📹</div>
                <div><strong>No M3U8 streams detected</strong></div>
                <p style="margin-top: 10px; opacity: 0.7; font-size: 12px;">
                    Try refreshing the page and playing a video, then click the refresh button.
                </p>
            </div>
        `;
    }

    updateStatus() {
        const status = document.getElementById('status');
        const count = this.videos.length;

        if (count === 0) {
            status.innerHTML = `
                <div class="status-icon">❌</div>
                <div>No video streams found</div>
            `;
        } else {
            status.innerHTML = `
                <div class="status-icon">✅</div>
                <div>Found ${count} video stream${count > 1 ? 's' : ''}</div>
            `;
        }
    }

    showError(message) {
        const status = document.getElementById('status');
        status.innerHTML = `
            <div class="status-icon">⚠️</div>
            <div>${message}</div>
        `;
    }

    truncateUrl(url, maxLength) {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength - 3) + '...';
    }

    playVideo(url) {
        let playerUrl = this.players[this.defaultPlayer];
        if (this.defaultPlayer === 'custom' && !playerUrl) {
            this.showToast('Please configure custom player URL in settings');
            return;
        }

        playerUrl = playerUrl.replace('{url}', url);
        chrome.tabs.create({ url: playerUrl });
        // if (this.defaultPlayer === 'potplayer' || this.defaultPlayer === 'vlc') {
        //     // For desktop apps, try to open the protocol URL
        //     window.location.href = playerUrl;
        // } else {
        //     // For web players, open in new tab
        //     chrome.tabs.create({ url: playerUrl });
        // }

        this.showToast('Opening in player...');
    }

    async copyUrl(url) {
        try {
            await navigator.clipboard.writeText(url);
            this.showToast('URL copied to clipboard!');
        } catch (error) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.showToast('URL copied to clipboard!');
        }
    }

    downloadVideo(url) {
        // Create a temporary download link
        const link = document.createElement('a');
        link.href = url;
        link.download = `video_${Date.now()}.m3u8`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        this.showToast('Download started...');
    }

    openInNewTab(url) {
        chrome.tabs.create({ url: url });
        this.showToast('Opened in new tab');
    }

    async clearVideos() {
        try {
            await chrome.runtime.sendMessage({
                type: "clearM3U8",
                tabId: this.currentTabId
            });
            this.videos = [];
            this.renderVideos();
            this.updateStatus();
            this.showToast('Cleared all videos');
        } catch (error) {
            console.error('Error clearing videos:', error);
        }
    }

    showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    toggleSettings() {
        const panel = document.getElementById('settingsPanel');
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
    }

    toggleCustomUrl() {
        const customDiv = document.getElementById('customUrlDiv');
        const isCustom = document.getElementById('defaultPlayer').value === 'custom';
        customDiv.style.display = isCustom ? 'block' : 'none';
    }

    setupEventListeners() {
        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadVideos();
        });

        // Clear button
        document.getElementById('clearBtn').addEventListener('click', () => {
            this.clearVideos();
        });

        // Settings button
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.toggleSettings();
        });

        // Default player selection
        document.getElementById('defaultPlayer').addEventListener('change', (e) => {
            this.defaultPlayer = e.target.value;
            this.toggleCustomUrl();
            this.saveSettings();
        });

        // Custom player URL
        document.getElementById('customPlayerUrl').addEventListener('input', (e) => {
            this.players.custom = e.target.value;
            this.saveSettings();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'r' && e.ctrlKey) {
                e.preventDefault();
                this.loadVideos();
            }
        });
    }
}

// Initialize the player when popup loads
const player = new M3U8Player();

// Refresh data every 5 seconds if popup is open
setInterval(() => {
    if (document.visibilityState === 'visible') {
        player.loadVideos();
    }
}, 10000);