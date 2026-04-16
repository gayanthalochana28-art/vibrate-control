// Global variables
let currentDeviceId = null;
let targetDeviceId = null;
let autoVibrate = false;
let screenShareStream = null;
let isScreenSharing = false;
let backgroundInterval = null;
let wakeLock = null;
let serviceWorker = null;

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
    await initializeDevice();
    setupEventListeners();
    setupFirebaseListeners();
    setupBackgroundMode();
    registerServiceWorker();
    addLog('✅ App initialized - Works in background!', 'success');
});

// Initialize device
async function initializeDevice() {
    currentDeviceId = localStorage.getItem('deviceId');
    if (!currentDeviceId) {
        currentDeviceId = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', currentDeviceId);
    }
    
    document.getElementById('deviceId').textContent = currentDeviceId;
    document.getElementById('statusText').textContent = 'Online';
    
    // Register in Firebase
    if (window.dbSet) {
        const deviceRef = window.dbRef(window.db, `devices/${currentDeviceId}`);
        await window.dbSet(deviceRef, {
            id: currentDeviceId,
            status: 'online',
            lastSeen: Date.now(),
            name: navigator.userAgent
        });
    }
    
    addLog(`Device ID: ${currentDeviceId}`, 'info');
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('startScreenShare').addEventListener('click', startScreenShare);
    document.getElementById('stopScreenShare').addEventListener('click', stopScreenShare);
    document.getElementById('viewScreenShare').addEventListener('click', viewScreenShare);
    document.getElementById('vibrateNow').addEventListener('click', () => sendVibrateCommand());
    document.getElementById('toggleAutoVibe').addEventListener('click', toggleAutoVibrate);
    document.getElementById('intensity').addEventListener('input', (e) => {
        document.getElementById('intensityVal').textContent = e.target.value;
    });
    document.getElementById('testBgVibrate').addEventListener('click', testBackgroundVibration);
}

// Setup Firebase listeners for commands
function setupFirebaseListeners() {
    if (!window.dbOnValue) return;
    
    const commandsRef = window.dbRef(window.db, `commands/${currentDeviceId}`);
    window.dbOnValue(commandsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            handleCommand(data);
            // Clear after processing
            window.dbRemove(window.dbRef(window.db, `commands/${currentDeviceId}`));
        }
    });
    
    // Listen for screen share
    const screenRef = window.dbRef(window.db, `screenshare/${currentDeviceId}`);
    window.dbOnValue(screenRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.active) {
            displayRemoteScreen(data.signal);
        }
    });
}

// Handle incoming commands
function handleCommand(command) {
    addLog(`📨 Received: ${command.type}`, 'info');
    
    switch(command.type) {
        case 'vibrate':
            executeVibration(command.intensity, command.pattern, command.duration);
            break;
        case 'auto_vibrate':
            autoVibrate = command.enabled;
            document.getElementById('toggleAutoVibe').innerHTML = 
                `🔄 Auto-Vibrate: ${autoVibrate ? 'ON' : 'OFF'}`;
            break;
        case 'screen_share_start':
            startReceivingScreenShare();
            break;
        case 'screen_share_stop':
            stopReceivingScreenShare();
            break;
        case 'play_video':
            playVideo(command.url);
            break;
    }
}

// Send command to target
async function sendCommand(command) {
    if (!targetDeviceId) {
        addLog('⚠️ No target device set!', 'error');
        alert('Please set target device first!');
        return false;
    }
    
    try {
        const commandRef = window.dbRef(window.db, `commands/${targetDeviceId}`);
        await window.dbSet(commandRef, {
            ...command,
            from: currentDeviceId,
            timestamp: Date.now()
        });
        addLog(`✅ Command sent to ${targetDeviceId}`, 'success');
        return true;
    } catch(error) {
        addLog(`❌ Error: ${error.message}`, 'error');
        return false;
    }
}

// Start Screen Share
async function startScreenShare() {
    try {
        addLog('🎥 Starting screen share...', 'info');
        
        // Request screen capture
        screenShareStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always"
            },
            audio: false
        });
        
        isScreenSharing = true;
        
        // Update UI
        document.getElementById('screenShareStatus').innerHTML = 
            '🟢 Screen sharing active';
        document.getElementById('screenShareStatus').style.background = '#e8f5e9';
        
        // Send command to target
        await sendCommand({
            type: 'screen_share_start',
            from: currentDeviceId
        });
        
        // Store stream info in Firebase
        const screenRef = window.dbRef(window.db, `screenshare/${currentDeviceId}`);
        await window.dbSet(screenRef, {
            active: true,
            timestamp: Date.now()
        });
        
        addLog('✅ Screen share started!', 'success');
        
        // Handle stream end
        screenShareStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };
        
    } catch(error) {
        addLog(`❌ Screen share failed: ${error.message}`, 'error');
    }
}

// Stop Screen Share
async function stopScreenShare() {
    if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
        screenShareStream = null;
    }
    
    isScreenSharing = false;
    document.getElementById('screenShareStatus').innerHTML = '⚪ Screen sharing stopped';
    document.getElementById('screenShareStatus').style.background = '#f5f5f5';
    
    // Update Firebase
    const screenRef = window.dbRef(window.db, `screenshare/${currentDeviceId}`);
    await window.dbSet(screenRef, {
        active: false,
        timestamp: Date.now()
    });
    
    await sendCommand({
        type: 'screen_share_stop',
        from: currentDeviceId
    });
    
    addLog('⏹️ Screen share stopped', 'info');
}

// View remote screen share
function viewScreenShare() {
    if (!targetDeviceId) {
        alert('Please set target device first!');
        return;
    }
    
    document.getElementById('remoteScreenCard').style.display = 'block';
    addLog(`👁️ Viewing screen from ${targetDeviceId}`, 'info');
}

// Display remote screen
function displayRemoteScreen(signal) {
    const videoElement = document.getElementById('remoteScreen');
    // Note: For full WebRTC implementation, you'd need to set up peer connection
    // This is a simplified version
    addLog('📺 Remote screen feed received', 'info');
}

// Send vibrate command
async function sendVibrateCommand() {
    const intensity = document.getElementById('intensity').value;
    const pattern = document.getElementById('vibePattern').value;
    const duration = document.getElementById('duration').value;
    
    await sendCommand({
        type: 'vibrate',
        intensity: intensity,
        pattern: pattern,
        duration: duration
    });
    
    // Execute locally as well
    executeVibration(intensity, pattern, duration);
}

// Execute vibration (works in background)
function executeVibration(intensity, pattern, duration) {
    addLog(`📳 Vibrating: ${pattern} at ${intensity}% for ${duration}ms`, 'vibrate');
    
    if ('vibrate' in navigator) {
        let patternArray = [];
        
        switch(pattern) {
            case 'pulse':
                patternArray = [200, 100, 200, 100, 200];
                break;
            case 'long':
                patternArray = [parseInt(duration)];
                break;
            case 'short':
                patternArray = [100];
                break;
            case 'heartbeat':
                patternArray = [200, 100, 200, 300, 400, 200];
                break;
            default:
                patternArray = [parseInt(duration)];
        }
        
        // Adjust intensity (simulated)
        const adjustedDuration = Math.floor(duration * (intensity / 100));
        
        try {
            navigator.vibrate(patternArray);
            
            // Visual feedback
            document.body.style.transition = 'background 0.1s';
            document.body.style.backgroundColor = '#ff9800';
            setTimeout(() => {
                document.body.style.backgroundColor = '';
            }, 200);
            
        } catch(e) {
            addLog('⚠️ Vibration error', 'error');
        }
    } else {
        // Fallback: alert for devices without vibration
        addLog('⚠️ Vibration not supported', 'warning');
        alert('📳 Vibration would occur here!');
    }
}

// Toggle auto vibrate
async function toggleAutoVibrate() {
    autoVibrate = !autoVibrate;
    document.getElementById('toggleAutoVibe').innerHTML = 
        `🔄 Auto-Vibrate: ${autoVibrate ? 'ON' : 'OFF'}`;
    
    await sendCommand({
        type: 'auto_vibrate',
        enabled: autoVibrate
    });
    
    addLog(`Auto-vibrate ${autoVibrate ? 'enabled' : 'disabled'}`, 'info');
}

// Setup background mode
async function setupBackgroundMode() {
    // Request wake lock to keep screen on (optional)
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        addLog('🔋 Screen wake lock acquired', 'success');
    } catch(e) {
        addLog('⚠️ Wake lock not supported', 'warning');
    }
    
    // Handle visibility change (screen off/background)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            addLog('📱 App in background - Still working!', 'info');
            startBackgroundTasks();
        } else {
            addLog('📱 App in foreground', 'info');
            stopBackgroundTasks();
        }
    });
    
    // Keep-alive ping every 30 seconds
    setInterval(async () => {
        if (window.dbSet && currentDeviceId) {
            const deviceRef = window.dbRef(window.db, `devices/${currentDeviceId}`);
            await window.dbSet(deviceRef, {
                ...(await window.dbSet(deviceRef, {})),
                lastSeen: Date.now(),
                status: 'online'
            });
            addLog('💓 Heartbeat sent', 'info');
        }
    }, 30000);
}

// Start background tasks
function startBackgroundTasks() {
    if (backgroundInterval) return;
    
    backgroundInterval = setInterval(() => {
        addLog('🔄 Background service running...', 'info');
        // Check for pending commands
        checkPendingCommands();
    }, 5000);
}

// Stop background tasks
function stopBackgroundTasks() {
    if (backgroundInterval) {
        clearInterval(backgroundInterval);
        backgroundInterval = null;
    }
}

// Check pending commands (for background mode)
async function checkPendingCommands() {
    if (!window.dbOnValue) return;
    
    const commandsRef = window.dbRef(window.db, `commands/${currentDeviceId}`);
    window.dbOnValue(commandsRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.pending) {
            handleCommand(data);
        }
    }, { onlyOnce: true });
}

// Register Service Worker for background sync
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            serviceWorker = registration;
            addLog('✅ Service Worker registered', 'success');
            
            // Request notification permission
            if ('Notification' in window) {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    addLog('🔔 Notifications enabled', 'success');
                }
            }
        } catch(error) {
            addLog('⚠️ Service Worker registration failed', 'warning');
        }
    }
}

// Test background vibration
function testBackgroundVibration() {
    addLog('🧪 Testing background vibration capability...', 'info');
    executeVibration(70, 'pulse', 1000);
    
    // Show notification if in background
    if (document.hidden && 'Notification' in window) {
        new Notification('VibeControl', {
            body: 'Vibration test in background mode!',
            icon: 'https://via.placeholder.com/64'
        });
    }
}

// Play custom video
function playCustomVideo() {
    const url = document.getElementById('videoUrl').value;
    if (!url) {
        alert('Please enter a video URL');
        return;
    }
    
    playVideo(url);
    
    sendCommand({
        type: 'play_video',
        url: url
    });
}

function playVideo(url) {
    const video = document.getElementById('videoPlayer');
    const placeholder = document.getElementById('videoPlaceholder');
    
    video.style.display = 'block';
    placeholder.style.display = 'none';
    video.src = url;
    video.play();
    
    addLog(`▶️ Playing video: ${url}`, 'info');
}

// Set target device
function setTargetDevice() {
    const target = document.getElementById('targetDevice').value;
    if (target && target !== currentDeviceId) {
        targetDeviceId = target;
        localStorage.setItem('targetDevice', targetDeviceId);
        document.getElementById('targetStatus').innerHTML = 
            `✅ Target set to: ${targetDeviceId}`;
        document.getElementById('targetStatus').style.background = '#e8f5e9';
        addLog(`🎯 Target device set: ${targetDeviceId}`, 'success');
    } else if (target === currentDeviceId) {
        alert('Cannot target yourself!');
    } else {
        alert('Please enter a valid device ID');
    }
}

// Copy device ID
function copyDeviceId() {
    navigator.clipboard.writeText(currentDeviceId);
    addLog('📋 Device ID copied!', 'success');
    alert('Device ID copied!');
}

// Toggle fullscreen
function toggleFullscreen() {
    const elem = document.getElementById('remoteScreen');
    if (elem.requestFullscreen) {
        elem.requestFullscreen();
    }
}

// Capture screenshot
function captureScreenshot() {
    const video = document.getElementById('remoteScreen');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    
    const link = document.createElement('a');
    link.download = 'screenshot.png';
    link.href = canvas.toDataURL();
    link.click();
    
    addLog('📸 Screenshot captured', 'success');
}

// Add log message
function addLog(message, type = 'info') {
    const logContainer = document.getElementById('logMessages');
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    
    const colors = {
        success: '#4caf50',
        error: '#f44336',
        info: '#2196f3',
        vibrate: '#ff9800',
        warning: '#ffc107'
    };
    
    logEntry.style.color = colors[type] || '#333';
    logEntry.style.padding = '4px';
    logEntry.style.borderLeft = `3px solid ${colors[type] || '#333'}`;
    logEntry.style.marginBottom = '4px';
    logEntry.innerHTML = `[${timestamp}] ${message}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Keep only last 100 messages
    while(logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

function clearLog() {
    document.getElementById('logMessages').innerHTML = '';
    addLog('Log cleared', 'info');
}

// Handle page unload
window.addEventListener('beforeunload', async () => {
    if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
    }
    
    if (currentDeviceId && window.dbSet) {
        const deviceRef = window.dbRef(window.db, `devices/${currentDeviceId}`);
        await window.dbSet(deviceRef, {
            id: currentDeviceId,
            status: 'offline',
            lastSeen: Date.now()
        });
    }
});

// Start receiving screen share
function startReceivingScreenShare() {
    addLog('📺 Starting to receive screen share...', 'info');
    document.getElementById('remoteScreenCard').style.display = 'block';
}

function stopReceivingScreenShare() {
    addLog('⏹️ Screen share ended', 'info');
    document.getElementById('remoteScreenCard').style.display = 'none';
}
