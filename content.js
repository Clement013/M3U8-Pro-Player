// Content script to detect M3U8 URLs in page sources and XHR requests
(function() {
    'use strict';

    // Track original XMLHttpRequest and fetch to catch dynamic M3U8 requests
    const originalXHR = window.XMLHttpRequest;
    const originalFetch = window.fetch;

    // Override XMLHttpRequest
    window.XMLHttpRequest = function() {
        const xhr = new originalXHR();
        const originalOpen = xhr.open;
        const originalSend = xhr.send;

        xhr.open = function(method, url, ...args) {
            this._url = url;
            return originalOpen.apply(this, [method, url, ...args]);
        };

        xhr.send = function(...args) {
            this.addEventListener('readystatechange', function() {
                if (this.readyState === 4 && this.status === 200) {
                    checkForM3U8(this._url, this.responseText);
                }
            });
            return originalSend.apply(this, args);
        };

        return xhr;
    };

    // Override fetch
    window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : input.url;
        
        return originalFetch(input, init).then(response => {
            if (response.ok && response.url) {
                // Clone response to avoid consuming the stream
                const clonedResponse = response.clone();
                clonedResponse.text().then(text => {
                    checkForM3U8(response.url, text);
                }).catch(() => {
                    // Ignore errors when reading response text
                });
            }
            return response;
        });
    };

    // Function to check if content contains M3U8 URLs or is M3U8 content
    function checkForM3U8(originalUrl, content) {
        try {
            // Check if the URL itself contains M3U8
            const extractedUrl = extractM3U8Url(originalUrl);
            if (extractedUrl) {
                reportM3U8(extractedUrl, originalUrl);
                return;
            }

            // Check if content contains M3U8 URLs
            if (content && typeof content === 'string') {
                const m3u8Urls = extractM3U8UrlsFromContent(content);
                m3u8Urls.forEach(url => reportM3U8(url, originalUrl));
            }
        } catch (error) {
            // Silently ignore errors
        }
    }

    // Function to extract actual M3U8 URL from wrapper URLs
    function extractM3U8Url(url) {
        try {
            const parsed = new URL(url, window.location.origin);
            
            // Check if this is a direct M3U8 URL
            if (parsed.pathname.toLowerCase().endsWith('.m3u8')) {
                return url;
            }
            
            // Extract M3U8 URL from common parameter names
            const possibleParams = ['url', 'src', 'source', 'stream', 'video', 'link', 'file'];
            
            for (const param of possibleParams) {
                const paramValue = parsed.searchParams.get(param);
                if (paramValue) {
                    // Decode URL-encoded parameters
                    const decodedValue = decodeURIComponent(paramValue);
                    // Check if the parameter value is an M3U8 URL
                    if (decodedValue.toLowerCase().includes('.m3u8')) {
                        return decodedValue;
                    }
                }
            }
            
            return null;
        } catch {
            return null;
        }
    }

    // Check if URL is M3U8
    function isM3U8Url(url) {
        return extractM3U8Url(url) !== null;
    }

    // Extract M3U8 URLs from content
    function extractM3U8UrlsFromContent(content) {
        const urls = [];
        
        // Pattern to match M3U8 URLs
        const m3u8Patterns = [
            /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi,
            /https?:\/\/[^\s"']*[?&].*m3u8[^\s"']*/gi,
            /"(https?:\/\/[^"]*\.m3u8[^"]*)"/gi,
            /'(https?:\/\/[^']*\.m3u8[^']*)'/gi
        ];

        m3u8Patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const url = match[1] || match[0];
                if (url && isValidUrl(url)) {
                    urls.push(url);
                }
            }
        });

        return [...new Set(urls)]; // Remove duplicates
    }

    // Validate URL
    function isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    }

    // Report M3U8 URL to background script
    function reportM3U8(m3u8Url, originalUrl = null) {
        try {
            chrome.runtime.sendMessage({
                type: 'contentScriptM3U8Found',
                url: originalUrl || m3u8Url, // Send original URL so background can extract properly
                source: 'content_script',
                timestamp: Date.now()
            });
        } catch (error) {
            // Silently ignore if extension context is invalid
        }
    }

    // Scan page on load for existing M3U8 references
    function scanPageForM3U8() {
        try {
            // Check all script tags
            const scripts = document.querySelectorAll('script');
            scripts.forEach(script => {
                if (script.textContent) {
                    checkForM3U8(script.src || window.location.href, script.textContent);
                }
            });

            // Check video sources
            const videos = document.querySelectorAll('video source, video');
            videos.forEach(video => {
                const src = video.src || video.getAttribute('src');
                if (src) {
                    const extractedUrl = extractM3U8Url(src);
                    if (extractedUrl) {
                        reportM3U8(extractedUrl, src);
                    }
                }
            });

            // Check for data attributes that might contain M3U8 URLs
            const elementsWithData = document.querySelectorAll('[data-src], [data-video], [data-stream]');
            elementsWithData.forEach(el => {
                const dataSrc = el.getAttribute('data-src') || 
                              el.getAttribute('data-video') || 
                              el.getAttribute('data-stream');
                if (dataSrc) {
                    const extractedUrl = extractM3U8Url(dataSrc);
                    if (extractedUrl) {
                        reportM3U8(extractedUrl, dataSrc);
                    }
                }
            });

            // Check page source for M3U8 URLs
            const pageContent = document.documentElement.innerHTML;
            const m3u8Urls = extractM3U8UrlsFromContent(pageContent);
            m3u8Urls.forEach(reportM3U8);

        } catch (error) {
            // Silently ignore errors
        }
    }

    // Observer for dynamically added content
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check new video elements
                    if (node.tagName === 'VIDEO' || node.querySelector) {
                        const videos = node.tagName === 'VIDEO' ? [node] : node.querySelectorAll('video, source');
                        videos.forEach(video => {
                            const src = video.src || video.getAttribute('src');
                            if (src) {
                                const extractedUrl = extractM3U8Url(src);
                                if (extractedUrl) {
                                    reportM3U8(extractedUrl, src);
                                }
                            }
                        });
                    }

                    // Check new script elements
                    if (node.tagName === 'SCRIPT' && node.textContent) {
                        checkForM3U8(window.location.href, node.textContent);
                    }
                }
            });
        });
    });

    // Start observing when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            scanPageForM3U8();
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    } else {
        scanPageForM3U8();
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Clean up observer when page unloads
    window.addEventListener('beforeunload', () => {
        observer.disconnect();
    });

    console.log('🎬 M3U8 Pro Player content script loaded');

})();