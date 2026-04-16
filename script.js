


// Global variables
let currentDeviceId = null;
let targetDeviceId = null;
let autoVibrateEnabled = false;
let currentVideoStream = null;
let bluetoothDevice = null;
let bluetoothCharacteristic = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeDevice();
    setupEventListeners();
    setupFirebaseListeners();
    addLog('App started successfully', 'success');
});

// Initialize device ID
function initializeDevice() {
    currentDeviceId = localStorage.getItem('deviceId');
    if (!currentDeviceId) {
        currentDeviceId = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', currentDeviceId);
    }
    document.getElementById('deviceId').textContent = currentDeviceId;
    addLog(`Device ID: ${currentDeviceId}`, 'info');
    
    // Register device in Firebase
    const deviceRef = ref(window.database, `devices/${currentDeviceId}`);
    set(deviceRef, {
        id: currentDeviceId,
        status: 'online',
        lastSeen: Date.now(),
        target: null
    });
    
    // Update status
    document.getElementById('connectionStatus').innerHTML = `
        <div class="led green"></div>
        <span>Connected to Firebase</span>
    `;
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('startVideo').addEventListener('click', startVideo);
    document.getElementById('stopVideo').addEventListener('click', stopVideo);
    document.getElementById('vibrateBtn').addEventListener('click', () => sendVibrateCommand('manual'));
    document.getElementById('toggleAutoVibrate').addEventListener('click', toggleAutoVibrate);
    document.getElementById('intensity').addEventListener('input', updateIntensity);
    document.getElementById('vibePattern').addEventListener('change', updatePattern);
    document.getElementById('bluetoothBtn').addEventListener('click', connectBluetooth);
}

// Setup Firebase listeners
function setupFirebaseListeners() {
    if (!window.database) return;
    
    const commandsRef = ref(window.database, `commands/${currentDeviceId}`);
    onValue(commandsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            handleIncomingCommand(data);
            // Clear command after processing
            set(ref(window.database, `commands/${currentDeviceId}`), null);
        }
    });
}

// Handle incoming commands
function handleIncomingCommand(command) {
    addLog(`Received command: ${command.type} from ${command.from}`, 'info');
    
    switch(command.type) {
        case 'start_video':
            playVideo(command.data);
            break;
        case 'stop_video':
            stopVideoPlayback();
            break;
        case 'vibrate':
            executeVibration(command.intensity, command.pattern);
            break;
        case 'auto_vibrate':
            autoVibrateEnabled = command.enabled;
            document.getElementById('toggleAutoVibrate').innerHTML = 
                `<span class="btn-icon">🔄</span> Auto-Vibrate: ${autoVibrateEnabled ? 'ON' : 'OFF'}`;
            break;
    }
}

// Start video
function startVideo() {
    if (!targetDeviceId) {
        addLog('Please set target device first!', 'error');
        alert('Please set target device ID first!');
        return;
    }
    
    addLog('Starting video...', 'info');
    
    // Simulate video - you can replace with actual camera stream
    const videoElement = document.getElementById('videoPlayer');
    const placeholder = document.getElementById('videoPlaceholder');
    
    // For demo, we'll use a sample video
    videoElement.style.display = 'block';
    placeholder.style.display = 'none';
    videoElement.src = 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4';
    videoElement.play();
    
    // Send command to target
    sendCommandToTarget({
        type: 'start_video',
        from: currentDeviceId,
        data: { source: currentDeviceId }
    });
}

// Stop video
function stopVideo() {
    addLog('Stopping video...', 'info');
    stopVideoPlayback();
    
    sendCommandToTarget({
        type: 'stop_video',
        from: currentDeviceId
    });
}

// Stop video playback
function stopVideoPlayback() {
    const videoElement = document.getElementById('videoPlayer');
    const placeholder = document.getElementById('videoPlaceholder');
    
    videoElement.pause();
    videoElement.style.display = 'none';
    placeholder.style.display = 'flex';
}

// Play video on target
function playVideo(videoData) {
    addLog('Playing video on this device', 'success');
    const videoElement = document.getElementById('videoPlayer');
    const placeholder = document.getElementById('videoPlaceholder');
    
    videoElement.style.display = 'block';
    placeholder.style.display = 'none';
    videoElement.src = 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4';
    videoElement.play();
    
    if (autoVibrateEnabled) {
        executeVibration(50, 'pulse');
    }
}

// Send vibrate command
function sendVibrateCommand(source) {
    if (!targetDeviceId) {
        addLog('Please set target device first!', 'error');
        alert('Please set target device ID first!');
        return;
    }
    
    const intensity = document.getElementById('intensity').value;
    const pattern = document.getElementById('vibePattern').value;
    
    addLog(`Sending vibrate command (${pattern}) with ${intensity}% intensity`, 'info');
    
    sendCommandToTarget({
        type: 'vibrate',
        from: currentDeviceId,
        intensity: intensity,
        pattern: pattern
    });
    
    // Also vibrate current device if Bluetooth connected
    if (bluetoothCharacteristic) {
        sendBluetoothVibration(intensity, pattern);
    }
}

// Execute vibration on current device
function executeVibration(intensity, pattern) {
    addLog(`Vibrating with ${pattern} pattern at ${intensity}%`, 'vibrate');
    
    // Check if vibration API is available
    if ('vibrate' in navigator) {
        let duration = 200;
        switch(pattern) {
            case 'pulse':
                duration = 100;
                navigator.vibrate([duration, 100, duration, 100, duration]);
                break;
            case 'long':
                duration = 800;
                navigator.vibrate(duration);
                break;
            case 'short':
                duration = 100;
                navigator.vibrate(duration);
                break;
            case 'double':
                navigator.vibrate([200, 100, 200]);
                break;
            default:
                duration = 300;
                navigator.vibrate(duration);
        }
        
        // Adjust intensity (not all browsers support intensity)
        addLog(`Vibration executed!`, 'success');
    } else {
        addLog('Vibration not supported on this device', 'error');
        // Visual feedback
        document.body.style.backgroundColor = '#ffc107';
        setTimeout(() => document.body.style.backgroundColor = '', 300);
    }
}

// Toggle auto vibrate
function toggleAutoVibrate() {
    autoVibrateEnabled = !autoVibrateEnabled;
    document.getElementById('toggleAutoVibrate').innerHTML = 
        `<span class="btn-icon">🔄</span> Auto-Vibrate: ${autoVibrateEnabled ? 'ON' : 'OFF'}`;
    
    sendCommandToTarget({
        type: 'auto_vibrate',
        from: currentDeviceId,
        enabled: autoVibrateEnabled
    });
    
    addLog(`Auto-vibrate ${autoVibrateEnabled ? 'enabled' : 'disabled'}`, 'info');
}

// Update intensity
function updateIntensity() {
    const intensity = document.getElementById('intensity').value;
    document.getElementById('intensityValue').textContent = intensity + '%';
}

// Update pattern
function updatePattern() {
    const pattern = document.getElementById('vibePattern').value;
    addLog(`Vibration pattern changed to: ${pattern}`, 'info');
}

// Set target device
function setTargetDevice() {
    const targetInput = document.getElementById('targetDevice').value;
    if (targetInput && targetInput !== currentDeviceId) {
        targetDeviceId = targetInput;
        addLog(`Target device set to: ${targetDeviceId}`, 'success');
        
        // Update in Firebase
        const deviceRef = ref(window.database, `devices/${currentDeviceId}/target`);
        set(deviceRef, targetDeviceId);
    } else if (targetInput === currentDeviceId) {
        addLog('Cannot target yourself!', 'error');
        alert('Cannot target yourself!');
    } else {
        addLog('Please enter a valid device ID', 'error');
    }
}

// Send command to target device
function sendCommandToTarget(command) {
    if (!targetDeviceId) {
        addLog('No target device set', 'error');
        return;
    }
    
    const commandRef = ref(window.database, `commands/${targetDeviceId}`);
    set(commandRef, {
        ...command,
        timestamp: Date.now()
    }).then(() => {
        addLog(`Command sent to ${targetDeviceId}`, 'success');
    }).catch(error => {
        addLog(`Error sending command: ${error.message}`, 'error');
    });
}

// Connect Bluetooth
async function connectBluetooth() {
    try {
        addLog('Requesting Bluetooth device...', 'info');
        
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ['battery_service']
        });
        
        bluetoothDevice = device;
        addLog(`Connected to: ${device.name || 'Unknown device'}`, 'success');
        
        const server = await device.gatt.connect();
        addLog('GATT server connected', 'success');
        
        // For demo, we'll just show connection info
        document.getElementById('bluetoothInfo').innerHTML = `
            ✅ Connected to: ${device.name || 'Bluetooth Device'}<br>
            ID: ${device.id}
        `;
        
    } catch(error) {
        addLog(`Bluetooth error: ${error.message}`, 'error');
    }
}

// Send vibration via Bluetooth
function sendBluetoothVibration(intensity, pattern) {
    addLog(`Sending vibration via Bluetooth (${intensity}%)`, 'info');
    // This would need actual Bluetooth characteristic implementation
    // based on your specific Bluetooth device
}

// Copy device ID to clipboard
function copyDeviceId() {
    const deviceId = document.getElementById('deviceId').textContent;
    navigator.clipboard.writeText(deviceId).then(() => {
        addLog('Device ID copied to clipboard!', 'success');
        alert('Device ID copied!');
    });
}

// Add log message
function addLog(message, type = 'info') {
    const logContainer = document.getElementById('logMessages');
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        info: '#17a2b8',
        vibrate: '#ffc107',
        warning: '#ff9800'
    };
    
    logEntry.style.color = colors[type] || '#333';
    logEntry.innerHTML = `[${timestamp}] ${message}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Keep only last 50 messages
    while(logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

// Clear log
function clearLog() {
    document.getElementById('logMessages').innerHTML = '';
    addLog('Log cleared', 'info');
}

// Remove device from Firebase on page unload
window.addEventListener('beforeunload', () => {
    if (currentDeviceId && window.database) {
        const deviceRef = ref(window.database, `devices/${currentDeviceId}`);
        set(deviceRef, {
            id: currentDeviceId,
            status: 'offline',
            lastSeen: Date.now()
        });
    }
});vvvv
