// Global Variables
let currentDeviceId = null;
let targetDeviceId = null;
let autoVibrate = false;
let mediaStream = null;
let screenStream = null;
let currentCamera = 'user';
let peerConnection = null;
let liveViewActive = false;

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
    await initializeDevice();
    setupEventListeners();
    setupFirebaseListeners();
    startSystemMonitoring();
    addLog('✅ App initialized successfully!', 'success');
});

// Initialize device
async function initializeDevice() {
    currentDeviceId = localStorage.getItem('deviceId');
    if (!currentDeviceId) {
        currentDeviceId = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', currentDeviceId);
    }
    
    document.getElementById('deviceId').textContent = currentDeviceId;
    
    // Register in Firebase
    if (window.dbSet) {
        const deviceRef = window.dbRef(window.db, `devices/${currentDeviceId}`);
        await window.dbSet(deviceRef, {
            id: currentDeviceId,
            status: 'online',
            lastSeen: Date.now(),
            name: navigator.userAgent,
            battery: 100,
            signal: 'Good'
        });
    }
    
    // Load saved target
    const savedTarget = localStorage.getItem('targetDevice');
    if (savedTarget) {
        document.getElementById('targetDevice').value = savedTarget;
        targetDeviceId = savedTarget;
        updateTargetStatus();
    }
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('startScreenShare').addEventListener('click', startScreenShare);
    document.getElementById('stopScreenShare').addEventListener('click', stopScreenShare);
    document.getElementById('viewScreenShare').addEventListener('click', viewScreenShare);
    document.getElementById('startCamera').addEventListener('click', startCamera);
    document.getElementById('stopCamera').addEventListener('click', stopCamera);
    document.getElementById('capturePhoto').addEventListener('click', capturePhoto);
    document.getElementById('switchCamera').addEventListener('click', switchCamera);
    document.getElementById('vibrateNow').addEventListener('click', () => sendVibrateCommand());
    document.getElementById('toggleAutoVibe').addEventListener('click', toggleAutoVibrate);
    document.getElementById('intensity').addEventListener('input', (e) => {
        document.getElementById('intensityVal').textContent = e.target.value;
    });
}

// Setup Firebase listeners
function setupFirebaseListeners() {
    if (!window.dbOnValue) return;
    
    // Listen for commands
    const commandsRef = window.dbRef(window.db, `commands/${currentDeviceId}`);
    window.dbOnValue(commandsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            handleCommand(data);
            window.dbRemove(window.dbRef(window.db, `commands/${currentDeviceId}`));
        }
    });
    
    // Listen for screen share stream
    const screenRef = window.dbRef(window.db, `streams/${currentDeviceId}/screen`);
    window.dbOnValue(screenRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.active && data.sdp) {
            handleRemoteStream(data);
        }
    });
    
    // Listen for camera stream
    const cameraRef = window.dbRef(window.db, `streams/${currentDeviceId}/camera`);
    window.dbOnValue(cameraRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.active && data.image) {
            displayRemoteCamera(data.image);
        }
    });
}

// Handle incoming commands
async function handleCommand(command) {
    addLog(`📨 Received: ${command.type}`, 'info');
    
    switch(command.type) {
        case 'vibrate':
            executeVibration(command.intensity, command.pattern);
            break;
        case 'auto_vibrate':
            autoVibrate = command.enabled;
            document.getElementById('toggleAutoVibe').innerHTML = 
                `🔄 Auto-Vibrate: ${autoVibrate ? 'ON' : 'OFF'}`;
            break;
        case 'start_screen_share':
            await startReceivingScreenShare();
            break;
        case 'stop_screen_share':
            stopReceivingScreenShare();
            break;
        case 'capture_photo':
            await captureAndSendPhoto();
            break;
        case 'play_video':
            playRemoteVideo(command.url);
            break;
        case 'notification':
            showNotification(command.message);
            break;
        case 'live_view_request':
            startLiveViewStream();
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
        
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: false
        });
        
        const videoElement = document.getElementById('screenVideo');
        videoElement.srcObject = screenStream;
        document.getElementById('screenPlaceholder').style.display = 'none';
        
        // Capture and send frames
        captureAndSendFrames(screenStream, 'screen');
        
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };
        
        await sendCommand({
            type: 'start_screen_share',
            from: currentDeviceId
        });
        
        addLog('✅ Screen share started!', 'success');
        
    } catch(error) {
        addLog(`❌ Screen share failed: ${error.message}`, 'error');
    }
}

// Stop Screen Share
function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    const videoElement = document.getElementById('screenVideo');
    videoElement.srcObject = null;
    document.getElementById('screenPlaceholder').style.display = 'flex';
    
    sendCommand({
        type: 'stop_screen_share',
        from: currentDeviceId
    });
    
    addLog('⏹️ Screen share stopped', 'info');
}

// Capture and send frames periodically
function captureAndSendFrames(stream, type) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    setInterval(() => {
        if (video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            
            const imageData = canvas.toDataURL('image/jpeg', 0.3);
            
            // Send to Firebase
            const streamRef = window.dbRef(window.db, `streams/${targetDeviceId}/${type}`);
            window.dbSet(streamRef, {
                active: true,
                image: imageData,
                timestamp: Date.now()
            });
        }
    }, 500);
}

// Handle remote stream
function handleRemoteStream(data) {
    const videoElement = document.getElementById('screenVideo');
    const placeholder = document.getElementById('screenPlaceholder');
    
    if (data.image) {
        videoElement.src = data.image;
        placeholder.style.display = 'none';
        videoElement.style.display = 'block';
    }
}

// View remote screen share
function viewScreenShare() {
    if (!targetDeviceId) {
        alert('Please set target device first!');
        return;
    }
    
    addLog(`👁️ Viewing screen from ${targetDeviceId}`, 'info');
    
    const screenRef = window.dbRef(window.db, `streams/${targetDeviceId}/screen`);
    window.dbOnValue(screenRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.image) {
            const videoElement = document.getElementById('screenVideo');
            videoElement.src = data.image;
            document.getElementById('screenPlaceholder').style.display = 'none';
            videoElement.style.display = 'block';
            addLog('📺 Receiving screen share', 'success');
        }
    });
}

// Start Camera
async function startCamera() {
    try {
        addLog('📷 Starting camera...', 'info');
        
        const constraints = {
            video: { facingMode: currentCamera },
            audio: false
        };
        
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        const videoElement = document.getElementById('cameraVideo');
        videoElement.srcObject = mediaStream;
        document.getElementById('cameraPlaceholder').style.display = 'none';
        
        addLog('✅ Camera started!', 'success');
        
    } catch(error) {
        addLog(`❌ Camera error: ${error.message}`, 'error');
    }
}

// Stop Camera
function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    
    const videoElement = document.getElementById('cameraVideo');
    videoElement.srcObject = null;
    document.getElementById('cameraPlaceholder').style.display = 'flex';
    
    addLog('⏹️ Camera stopped', 'info');
}

// Switch Camera
function switchCamera() {
    currentCamera = currentCamera === 'user' ? 'environment' : 'user';
    stopCamera();
    startCamera();
    addLog(`🔄 Switched to ${currentCamera === 'user' ? 'front' : 'back'} camera`, 'info');
}

// Capture Photo
function capturePhoto() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    
    const photoData = canvas.toDataURL('image/jpeg');
    document.getElementById('capturedImage').src = photoData;
    document.getElementById('photoPreview').style.display = 'block';
    
    addLog('📸 Photo captured!', 'success');
}

// Send Photo to Target
async function sendPhotoToTarget() {
    const photoData = document.getElementById('capturedImage').src;
    
    await sendCommand({
        type: 'photo',
        image: photoData,
        from: currentDeviceId
    });
    
    addLog('📤 Photo sent to target!', 'success');
}

// Open Gallery
function openGallery() {
    document.getElementById('galleryInput').click();
    
    document.getElementById('galleryInput').onchange = (e) => {
        const files = Array.from(e.target.files);
        const preview = document.getElementById('galleryPreview');
        preview.innerHTML = '';
        
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const div = document.createElement('div');
                div.className = 'gallery-item';
                
                if (file.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = event.target.result;
                    div.appendChild(img);
                } else if (file.type.startsWith('video/')) {
                    const video = document.createElement('video');
                    video.src = event.target.result;
                    video.controls = true;
                    div.appendChild(video);
                }
                
                preview.appendChild(div);
            };
            reader.readAsDataURL(file);
        });
        
        addLog(`📁 ${files.length} file(s) loaded from gallery`, 'success');
    };
}

// Capture from camera (for gallery)
function captureFromCamera() {
    startCamera();
    setTimeout(() => {
        capturePhoto();
    }, 1000);
}

// Share Media to Target
async function shareMedia() {
    const mediaItems = document.querySelectorAll('.gallery-item img, .gallery-item video');
    if (mediaItems.length === 0) {
        alert('No media selected');
        return;
    }
    
    for (let item of mediaItems) {
        await sendCommand({
            type: 'media',
            src: item.src,
            from: currentDeviceId
        });
    }
    
    addLog(`📤 ${mediaItems.length} media item(s) shared`, 'success');
}

// Send vibrate command
async function sendVibrateCommand() {
    const intensity = document.getElementById('intensity').value;
    const pattern = document.getElementById('vibePattern').value;
    
    await sendCommand({
        type: 'vibrate',
        intensity: intensity,
        pattern: pattern
    });
    
    executeVibration(intensity, pattern);
}

// Execute vibration
function executeVibration(intensity, pattern) {
    addLog(`📳 Vibrating: ${pattern} at ${intensity}%`, 'vibrate');
    
    if ('vibrate' in navigator) {
        let patternArray = [];
        
        switch(pattern) {
            case 'pulse':
                patternArray = [200, 100, 200, 100, 200];
                break;
            case 'long':
                patternArray = [800];
                break;
            case 'short':
                patternArray = [100];
                break;
            case 'heartbeat':
                patternArray = [200, 100, 200, 300, 400, 200];
                break;
            case 'sos':
                patternArray = [100, 100, 100, 100, 100, 100, 300, 300, 300, 100, 100, 100];
                break;
            default:
                patternArray = [300];
        }
        
        navigator.vibrate(patternArray);
        
        // Visual feedback
        document.body.style.backgroundColor = '#ff9800';
        setTimeout(() => document.body.style.backgroundColor = '', 200);
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
}

// Play remote video
function playRemoteVideo() {
    const url = document.getElementById('videoUrl').value;
    if (!url) {
        alert('Enter video URL');
        return;
    }
    
    sendCommand({
        type: 'play_video',
        url: url
    });
    
    addLog(`▶️ Playing video on target: ${url}`, 'info');
}

function playRemoteVideo(url) {
    const video = document.getElementById('localVideo');
    video.style.display = 'block';
    video.src = url;
    video.play();
    addLog(`🎬 Playing video`, 'info');
}

// Send notification
async function sendNotification() {
    const message = document.getElementById('notificationMsg').value;
    if (!message) {
        alert('Enter message');
        return;
    }
    
    await sendCommand({
        type: 'notification',
        message: message
    });
    
    addLog(`🔔 Notification sent: ${message}`, 'success');
}

function showNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('VibeControl', { body: message, icon: '🔔' });
    }
    addLog(`🔔 Notification: ${message}`, 'info');
}

// Start live view
function startLiveView() {
    if (!targetDeviceId) {
        alert('Set target device first');
        return;
    }
    
    liveViewActive = true;
    sendCommand({
        type: 'live_view_request',
        from: currentDeviceId
    });
    
    // Listen for live stream
    const liveRef = window.dbRef(window.db, `streams/${targetDeviceId}/live`);
    window.dbOnValue(liveRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.image && liveViewActive) {
            const video = document.getElementById('liveVideo');
            video.src = data.image;
            document.getElementById('livePlaceholder').style.display = 'none';
        }
    });
    
    addLog('📡 Live view started', 'success');
}

function stopLiveView() {
    liveViewActive = false;
    document.getElementById('livePlaceholder').style.display = 'flex';
    addLog('⏹️ Live view stopped', 'info');
}

function startLiveViewStream() {
    if (mediaStream) {
        captureAndSendFrames(mediaStream, 'live');
    } else {
        startCamera();
        setTimeout(() => {
            captureAndSendFrames(mediaStream, 'live');
        }, 1000);
    }
}

// System Monitoring
async function startSystemMonitoring() {
    // Battery monitoring
    if ('getBattery' in navigator) {
        const battery = await navigator.getBattery();
        updateBatteryStatus(battery);
        
        battery.addEventListener('levelchange', () => updateBatteryStatus(battery));
        battery.addEventListener('chargingchange', () => updateBatteryStatus(battery));
    }
    
    // Signal strength simulation
    setInterval(() => {
        const signals = ['Excellent', 'Good', 'Fair', 'Poor'];
        const randomSignal = signals[Math.floor(Math.random() * signals.length)];
        document.getElementById('signalStrength').textContent = randomSignal;
    }, 5000);
    
    // Time update
    setInterval(() => {
        const now = new Date();
        document.getElementById('currentTime').textContent = now.toLocaleTimeString();
    }, 1000);
    
    // Storage info
    if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const used = (estimate.usage / (1024 * 1024)).toFixed(0);
        const total = (estimate.quota / (1024 * 1024)).toFixed(0);
        document.getElementById('storageStatus').textContent = `${used}MB/${total}MB`;
    }
}

function updateBatteryStatus(battery) {
    const level = Math.round(battery.level * 100);
    const charging = battery.charging ? '⚡' : '🔋';
    document.getElementById('batteryLevel').innerHTML = `${charging} ${level}%`;
}

// Set target device
function setTargetDevice() {
    const target = document.getElementById('targetDevice').value;
    if (target && target !== currentDeviceId) {
        targetDeviceId = target;
        localStorage.setItem('targetDevice', targetDeviceId);
        updateTargetStatus();
        addLog(`🎯 Target set: ${targetDeviceId}`, 'success');
    } else if (target === currentDeviceId) {
        alert('Cannot target yourself!');
    } else {
        alert('Enter valid device ID');
    }
}

function updateTargetStatus() {
    const statusDiv = document.getElementById('targetStatus');
    statusDiv.innerHTML = `✅ Target: ${targetDeviceId}`;
    statusDiv.style.background = '#e8f5e9';
    statusDiv.style.padding = '8px';
    statusDiv.style.borderRadius = '8px';
}

// Switch tabs
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`${tab}Tab`).classList.add('active');
    event.target.classList.add('active');
}

// Copy device ID
function copyDeviceId() {
    navigator.clipboard.writeText(currentDeviceId);
    addLog('📋 Device ID copied!', 'success');
    alert('Device ID copied!');
}

// Capture live frame
function captureLiveFrame() {
    const video = document.getElementById('liveVideo');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    
    const link = document.createElement('a');
    link.download = `frame_${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
    
    addLog('📸 Frame captured', 'success');
}

// Add log
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
}

function clearLog() {
    document.getElementById('logMessages').innerHTML = '';
    addLog('Log cleared', 'info');
}

// Display remote camera
function displayRemoteCamera(imageData) {
    const img = document.createElement('img');
    img.src = imageData;
    document.getElementById('galleryPreview').appendChild(img);
}

// Capture and send photo
async function captureAndSendPhoto() {
    if (mediaStream) {
        capturePhoto();
        setTimeout(() => sendPhotoToTarget(), 500);
    }
}

// Start receiving screen share
async function startReceivingScreenShare() {
    addLog('📺 Preparing to receive screen share...', 'info');
    const screenRef = window.dbRef(window.db, `streams/${currentDeviceId}/screen`);
    window.dbOnValue(screenRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.image) {
            const videoElement = document.getElementById('screenVideo');
            videoElement.src = data.image;
            document.getElementById('screenPlaceholder').style.display = 'none';
        }
    });
}

function stopReceivingScreenShare() {
    addLog('⏹️ Screen share ended', 'info');
    document.getElementById('screenPlaceholder').style.display = 'flex';
}

// Request notification permission
if ('Notification' in window) {
    Notification.requestPermission();
}

// Handle page unload
window.addEventListener('beforeunload', async () => {
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    
    if (currentDeviceId && window.dbSet) {
        const deviceRef = window.dbRef(window.db, `devices/${currentDeviceId}`);
        await window.dbSet(deviceRef, { status: 'offline', lastSeen: Date.now() });
    }
});

addLog('🎉 App ready! Set target device to start', 'success');
