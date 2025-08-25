// Enhanced M3U8 detection with multiple URLs per tab and better error handling
const m3u8Storage = {};

// Enhanced URL validation and extraction for M3U8
function extractM3U8Url(url) {
  try {
    const parsed = new URL(url);

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

    // If no M3U8 found in parameters, return null
    return null;
  } catch (e) {
    return null;
  }
}

function isValidM3U8Url(url) {
  return extractM3U8Url(url) !== null;
}

// Store multiple M3U8 URLs per tab with timestamps
function storeM3U8Url(tabId, originalUrl) {
  // Extract the actual M3U8 URL
  const m3u8Url = extractM3U8Url(originalUrl);

  if (!m3u8Url) {
    console.log(`❌ Tab ${tabId} - No valid M3U8 URL found in:`, originalUrl);
    return;
  }

  if (!m3u8Storage[tabId]) {
    m3u8Storage[tabId] = [];
  }

  // Avoid duplicates
  const exists = m3u8Storage[tabId].some(item => item.url === m3u8Url);
  if (!exists) {
    m3u8Storage[tabId].push({
      url: m3u8Url,
      timestamp: Date.now(),
      subdomain: extractSubdomain(m3u8Url),
      originalUrl: originalUrl // Keep reference to original URL for debugging
    });

    // Keep only the last 10 URLs per tab to prevent memory issues
    if (m3u8Storage[tabId].length > 10) {
      m3u8Storage[tabId] = m3u8Storage[tabId].slice(-10);
    }

    console.log(`🎯 Tab ${tabId} - New M3U8 detected:`, m3u8Url);

    // Update badge with count
    updateBadge(tabId);
  }
}

// Extract quality information from URL if possible
function extractQuality(url) {
  const qualityMatches = url.match(/(\d+p|\d+x\d+)/i);
  return qualityMatches ? qualityMatches[0] : 'Unknown';
}

// Extract Subdomain
function extractSubdomain(url) {
  const hostname = new URL(url).hostname;
  return hostname.replace(/\.com$/, "");
}

// Update extension badge
function updateBadge(tabId) {
  const count = m3u8Storage[tabId] ? m3u8Storage[tabId].length : 0;
  chrome.action.setBadgeText({
    text: count > 0 ? count.toString() : '',
    tabId: tabId
  });
  chrome.action.setBadgeBackgroundColor({ color: '#FF6B6B' });
  chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
}

// Listen for network requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const m3u8Url = extractM3U8Url(details.url);
    if (m3u8Url) {
      storeM3U8Url(details.tabId, details.url);
    }
  },
  { urls: ["<all_urls>"] },
  []
);

// Also listen for response headers that might indicate M3U8 content
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const contentType = details.responseHeaders?.find(
      header => header.name.toLowerCase() === 'content-type'
    );

    if (contentType &&
      (contentType.value.includes('application/vnd.apple.mpegurl') ||
        contentType.value.includes('application/x-mpegURL'))) {
      storeM3U8Url(details.tabId, details.url);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Clear storage when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    delete m3u8Storage[tabId];
    updateBadge(tabId);
    console.log(`🧹 Cleared M3U8 storage for Tab ${tabId}`);
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete m3u8Storage[tabId];
  console.log(`🗑️ Cleaned up storage for closed Tab ${tabId}`);
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "getM3U8_from_network":
      const tabId = msg.tabId;
      const urls = m3u8Storage[tabId] || [];
      sendResponse({
        urls: urls,
        count: urls.length,
        success: true
      });
      break;

    case "clearM3U8":
      const clearTabId = msg.tabId;
      delete m3u8Storage[clearTabId];
      updateBadge(clearTabId);
      sendResponse({ success: true });
      break;

    case "contentScriptM3U8Found":
      // Handle M3U8 URLs found by content script
      if (sender.tab && sender.tab.id) {
        storeM3U8Url(sender.tab.id, msg.url);
        sendResponse({ success: true });
      }
      break;

    case "testUrl":
      // Test if a URL is accessible
      fetch(msg.url, { method: 'HEAD', mode: 'no-cors' })
        .then(() => sendResponse({ accessible: true }))
        .catch(() => sendResponse({ accessible: false }));
      return true; // Will respond asynchronously

    default:
      sendResponse({ success: false, error: "Unknown message type" });
  }

  return false;
});