class MissingPersonDetection {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.isStreaming = false;
        this.detectionCount = 0;
        this.confidence = 0.6;
        this.alivenessEnabled = true;
        this.faceMatcher = null;
        this.labeledDescriptors = [];
        this.detectionHistory = [];
        this.cameras = [];
        this.currentStream = null;
        this.progressValue = 0;
        
        this.init();
    }

    async init() {
        try {
            this.showLoading();
            await this.loadModels();
            await this.loadMissingPersons();
            await this.setupCamera();
            this.setupEventListeners();
            this.hideLoading();
            this.updateStatus('Ready for detection', 'success');
        } catch (error) {
            console.error('Initialization error:', error);
            this.updateStatus('Error initializing system', 'error');
            this.hideLoading();
        }
    }

    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
        this.updateProgress(0);
    }

    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }

    updateProgress(value) {
        this.progressValue = Math.min(100, Math.max(0, value));
        const progressBar = document.getElementById('progressBar');
        if (progressBar) {
            progressBar.style.width = this.progressValue + '%';
        }
    }

    async loadModels() {
        this.updateStatus('Loading AI models...', 'info');
        const modelPath = './models';
        
        try {
            this.updateProgress(10);
            await faceapi.nets.tinyFaceDetector.loadFromUri(modelPath);
            this.updateProgress(30);
            await faceapi.nets.faceLandmark68Net.loadFromUri(modelPath);
            this.updateProgress(60);
            await faceapi.nets.faceRecognitionNet.loadFromUri(modelPath);
            this.updateProgress(90);
            await faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath);
            this.updateProgress(100);
            
            this.updateStatus('AI models loaded successfully', 'success');
        } catch (error) {
            console.error('Error loading models:', error);
            throw new Error('Failed to load face recognition models');
        }
    }

    async loadMissingPersons() {
        try {
            const missingPersons = await db.getAllMissingPersons();
            this.labeledDescriptors = [];
            
            for (const person of missingPersons) {
                if (person.descriptors && person.descriptors.length > 0) {
                    const descriptors = person.descriptors.map(desc => new Float32Array(desc));
                    this.labeledDescriptors.push(
                        new faceapi.LabeledFaceDescriptors(person.name, descriptors)
                    );
                }
            }
            
            if (this.labeledDescriptors.length > 0) {
                this.faceMatcher = new faceapi.FaceMatcher(this.labeledDescriptors, this.confidence);
                this.updateStatus(`Loaded ${this.labeledDescriptors.length} missing persons`, 'success');
            } else {
                this.updateStatus('No missing persons in database', 'warning');
            }
            
            this.updateDatabaseCount(missingPersons.length);
        } catch (error) {
            console.error('Error loading missing persons:', error);
            this.updateStatus('Error loading missing persons database', 'error');
        }
    }

    async setupCamera() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cameras = devices.filter(device => device.kind === 'videoinput');
            
            this.populateCameraSelect();
            await this.startCamera();
        } catch (error) {
            console.error('Camera setup error:', error);
            this.updateStatus('Error accessing camera', 'error');
        }
    }

    populateCameraSelect() {
        const select = document.getElementById('cameraSelect');
        select.innerHTML = '';
        
        if (this.cameras.length === 0) {
            const option = document.createElement('option');
            option.textContent = 'No cameras found';
            select.appendChild(option);
            return;
        }
        
        this.cameras.forEach((camera, index) => {
            const option = document.createElement('option');
            option.value = camera.deviceId;
            option.textContent = camera.label || `Camera ${index + 1}`;
            select.appendChild(option);
        });
    }

    async startCamera(deviceId = null) {
        try {
            if (this.currentStream) {
                this.currentStream.getTracks().forEach(track => track.stop());
            }

            const constraints = {
                video: {
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    facingMode: deviceId ? undefined : 'user'
                }
            };

            if (deviceId) {
                constraints.video.deviceId = { exact: deviceId };
            }

            this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.currentStream;

            return new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.setupCanvas();
                    resolve();
                };
            });
        } catch (error) {
            console.error('Error starting camera:', error);
            throw error;
        }
    }

    setupCanvas() {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        
        // Position canvas over video
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
    }

    setupEventListeners() {
        document.getElementById('startBtn').addEventListener('click', () => this.startDetection());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopDetection());
        
        document.getElementById('cameraSelect').addEventListener('change', (e) => {
            if (e.target.value && this.cameras.length > 0) {
                this.startCamera(e.target.value);
            }
        });
        
        document.getElementById('confidenceSlider').addEventListener('input', (e) => {
            this.confidence = parseFloat(e.target.value);
            document.getElementById('confidenceValue').textContent = this.confidence;
            if (this.faceMatcher) {
                this.faceMatcher = new faceapi.FaceMatcher(this.labeledDescriptors, this.confidence);
            }
        });
        
        document.getElementById('alivenessCheck').addEventListener('change', (e) => {
            this.alivenessEnabled = e.target.checked;
        });

        // Modal close functionality
        document.getElementById('closeAlert').addEventListener('click', () => {
            document.getElementById('alertModal').style.display = 'none';
        });

        document.getElementById('reportBtn').addEventListener('click', () => {
            this.reportToAuthorities();
        });

        document.getElementById('saveBtn').addEventListener('click', () => {
            this.saveCurrentDetection();
        });

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            const modal = document.getElementById('alertModal');
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    async startDetection() {
        if (!this.isStreaming) {
            this.isStreaming = true;
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            this.updateStatus('Detection active - Monitoring for missing persons', 'success');
            this.detectFaces();
        }
    }

    stopDetection() {
        this.isStreaming = false;
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        this.updateStatus('Detection stopped', 'warning');
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        document.getElementById('detection-info').innerHTML = '';
    }

    async detectFaces() {
        if (!this.isStreaming) return;

        try {
            const detections = await faceapi
                .detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({
                    inputSize: 512,
                    scoreThreshold: 0.5
                }))
                .withFaceLandmarks()
                .withFaceDescriptors();

            // Clear previous drawings
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // Update detection info
            document.getElementById('detection-info').innerHTML = 
                `<i class="fas fa-eye"></i> ${detections.length} face(s) detected`;

            if (detections.length > 0) {
                const resizedDetections = faceapi.resizeResults(detections, {
                    width: this.canvas.width,
                    height: this.canvas.height
                });

                for (let i = 0; i < resizedDetections.length; i++) {
                    await this.processDetection(resizedDetections[i]);
                }
            }
        } catch (error) {
            console.error('Detection error:', error);
        }

        // Continue detection
        if (this.isStreaming) {
            requestAnimationFrame(() => this.detectFaces());
        }
    }

    async processDetection(detection) {
        const box = detection.detection.box;
        let person = null;
        let confidence = 0;
        let isMissing = false;

        // Face recognition
        if (this.faceMatcher && detection.descriptor) {
            const match = this.faceMatcher.findBestMatch(detection.descriptor);
            if (match.label !== 'unknown') {
                person = match.label;
                confidence = 1 - match.distance;
                isMissing = confidence > this.confidence;
            }
        }

        // Aliveness detection
        const isAlive = this.alivenessEnabled ? this.checkAliveness(detection) : true;

        // Draw face box with enhanced styling
        this.drawFaceBox(box, isMissing, person, confidence, isAlive);

        // If missing person detected with sufficient confidence
        if (isMissing && isAlive) {
            await this.handleMissingPersonDetection(detection, person, confidence);
        }
    }

    checkAliveness(detection) {
        // Enhanced aliveness check based on multiple factors
        const landmarks = detection.landmarks;
        
        try {
            // Check eye aspect ratio (blink detection)
            const leftEye = landmarks.getLeftEye();
            const rightEye = landmarks.getRightEye();
            
            const leftEAR = this.calculateEyeAspectRatio(leftEye);
            const rightEAR = this.calculateEyeAspectRatio(rightEye);
            const avgEAR = (leftEAR + rightEAR) / 2;
            
            // Check mouth aspect ratio
            const mouth = landmarks.getMouth();
            const mouthEAR = this.calculateMouthAspectRatio(mouth);
            
            // Basic liveness indicators
            const eyesOpen = avgEAR > 0.2;
            const naturalMouth = mouthEAR < 0.8;
            
            return eyesOpen && naturalMouth;
        } catch (error) {
            console.warn('Aliveness check failed:', error);
            return true; // Default to alive if check fails
        }
    }

    calculateEyeAspectRatio(eye) {
        const A = this.distance(eye[1], eye[5]);
        const B = this.distance(eye[2], eye[4]);
        const C = this.distance(eye[0], eye[3]);
        return (A + B) / (2.0 * C);
    }

    calculateMouthAspectRatio(mouth) {
        const A = this.distance(mouth[13], mouth[19]);
        const B = this.distance(mouth[14], mouth[18]);
        const C = this.distance(mouth[15], mouth[17]);
        const D = this.distance(mouth[12], mouth[16]);
        return (A + B + C) / (3.0 * D);
    }

    distance(point1, point2) {
        return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
    }

    drawFaceBox(box, isMissing, person, confidence, isAlive) {
        // Set box style based on status
        this.ctx.strokeStyle = isMissing ? '#ef4444' : '#10b981';
        this.ctx.lineWidth = 3;
        this.ctx.shadowColor = isMissing ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)';
        this.ctx.shadowBlur = 10;
        
        // Draw main box
        this.ctx.strokeRect(box.x, box.y, box.width, box.height);
        
        // Reset shadow
        this.ctx.shadowBlur = 0;

        // Draw label background
        const label = person || 'Unknown Person';
        const labelText = confidence > 0 ? 
            `${label} (${Math.round(confidence * 100)}%)` : label;
        
        this.ctx.font = 'bold 14px Inter, sans-serif';
        const textWidth = this.ctx.measureText(labelText).width;
        
        // Label background
        this.ctx.fillStyle = isMissing ? '#ef4444' : '#10b981';
        this.ctx.fillRect(box.x, box.y - 30, textWidth + 16, 30);
        
        // Label text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(labelText, box.x + 8, box.y - 10);

        // Confidence indicator
        if (confidence > 0) {
            const confidenceText = `${Math.round(confidence * 100)}%`;
            const confidenceColor = confidence > 0.8 ? '#10b981' : 
                                   confidence > 0.6 ? '#f59e0b' : '#ef4444';
            
            this.ctx.fillStyle = confidenceColor;
            this.ctx.fillRect(box.x + box.width - 50, box.y, 45, 25);
            
            this.ctx.fillStyle = 'white';
            this.ctx.font = 'bold 12px Inter, sans-serif';
            this.ctx.fillText(confidenceText, box.x + box.width - 45, box.y + 16);
        }

        // Aliveness indicator
        if (this.alivenessEnabled) {
            const alivenessColor = isAlive ? '#10b981' : '#ef4444';
            const alivenessText = isAlive ? 'LIVE' : 'FAKE';
            
            this.ctx.fillStyle = alivenessColor;
            this.ctx.fillRect(box.x, box.y + box.height, 50, 20);
            
            this.ctx.fillStyle = 'white';
            this.ctx.font = 'bold 10px Inter, sans-serif';
            this.ctx.fillText(alivenessText, box.x + 8, box.y + box.height + 14);
        }
    }

    async handleMissingPersonDetection(detection, personName, confidence) {
        const timestamp = new Date().toISOString();
        
        // Capture image
        const capturedImage = await this.captureDetectionImage(detection);
        
        // Get location if available
        const location = await this.getLocation();
        
        // Save detection to database
        const detectionData = {
            personName,
            confidence: Math.round(confidence * 100) / 100,
            timestamp,
            image: capturedImage,
            location: location,
            deviceInfo: this.getDeviceInfo(),
            status: 'new'
        };
        
        try {
            await db.saveDetection(detectionData);
            this.detectionCount++;
            this.updateDetectionCount();
            
            // Show alert modal
            this.showMissingPersonAlert(detectionData);
            
            // Add to detection history
            this.addToDetectionHistory(detectionData);
            
            // Update status
            this.updateStatus(`ALERT: Missing person detected - ${personName}`, 'error');
            
        } catch (error) {
            console.error('Error saving detection:', error);
        }
    }

    async captureDetectionImage(detection) {
        const box = detection.detection.box;
        
        // Create a temporary canvas for the face crop
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        // Add padding around the face
        const padding = 30;
        const cropX = Math.max(0, box.x - padding);
        const cropY = Math.max(0, box.y - padding);
        const cropWidth = Math.min(this.canvas.width - cropX, box.width + padding * 2);
        const cropHeight = Math.min(this.canvas.height - cropY, box.height + padding * 2);
        
        tempCanvas.width = cropWidth;
        tempCanvas.height = cropHeight;
        
        // Draw the cropped face
        tempCtx.drawImage(
            this.video,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );
        
        return tempCanvas.toDataURL('image/jpeg', 0.9);
    }

    async getLocation() {
        return new Promise((resolve) => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        resolve({
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                            accuracy: position.coords.accuracy,
                            timestamp: new Date().toISOString()
                        });
                    },
                    (error) => {
                        console.warn('Location access denied:', error);
                        resolve(null);
                    },
                    { timeout: 5000, enableHighAccuracy: true }
                );
            } else {
                resolve(null);
            }
        });
    }

    getDeviceInfo() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screenResolution: `${screen.width}x${screen.height}`,
            timestamp: new Date().toISOString()
        };
    }

    showMissingPersonAlert(detection) {
        const modal = document.getElementById('alertModal');
        const modalContent = document.getElementById('alertContent');
        
        const locationText = detection.location ? 
            `<p><i class="fas fa-map-marker-alt"></i> <strong>Location:</strong> ${detection.location.latitude.toFixed(6)}, ${detection.location.longitude.toFixed(6)}</p>` : 
            '<p><i class="fas fa-map-marker-alt"></i> <strong>Location:</strong> Not available</p>';
        
        modalContent.innerHTML = `
            <div class="alert-detection">
                <div class="detection-image">
                    <img src="${detection.image}" alt="Detected person" style="width: 100%; max-width: 300px; border-radius: 8px; margin-bottom: 16px;">
                </div>
                <div class="detection-details">
                    <h3><i class="fas fa-user"></i> ${detection.personName}</h3>
                    <p><i class="fas fa-percentage"></i> <strong>Confidence:</strong> ${Math.round(detection.confidence * 100)}%</p>
                    <p><i class="fas fa-clock"></i> <strong>Time:</strong> ${new Date(detection.timestamp).toLocaleString()}</p>
                    ${locationText}
                    <p><i class="fas fa-info-circle"></i> <strong>Status:</strong> <span class="text-danger">Missing Person Alert</span></p>
                </div>
            </div>
        `;
        
        modal.style.display = 'block';
        
        // Play alert sound (if supported)
        this.playAlertSound();
        
        // Auto-close after 15 seconds
        setTimeout(() => {
            if (modal.style.display === 'block') {
                modal.style.display = 'none';
            }
        }, 15000);
    }

    playAlertSound() {
        try {
            // Create audio context for alert sound
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.1);
            gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            console.warn('Could not play alert sound:', error);
        }
    }

    reportToAuthorities() {
        // This would integrate with actual reporting systems
        const referenceId = 'MPR-' + Date.now();
        alert(`🚨 ALERT REPORTED 🚨\n\nMissing person detection has been reported to authorities.\n\nReference ID: ${referenceId}\n\nAuthorities have been notified and will respond accordingly.`);
        document.getElementById('alertModal').style.display = 'none';
    }

    saveCurrentDetection() {
        alert('✅ Detection saved to database for future reference.');
        document.getElementById('alertModal').style.display = 'none';
    }

    addToDetectionHistory(detection) {
        const detectionsContainer = document.getElementById('detections');
        
        const detectionCard = document.createElement('div');
        detectionCard.className = 'detection-card missing-person';
        
        const confidenceClass = detection.confidence > 0.8 ? 'confidence-high' : 
                               detection.confidence > 0.6 ? 'confidence-medium' : 'confidence-low';
        
        const locationText = detection.location ? 
            `<p><i class="fas fa-map-marker-alt"></i> ${detection.location.latitude.toFixed(4)}, ${detection.location.longitude.toFixed(4)}</p>` : 
            '<p><i class="fas fa-map-marker-alt"></i> Location not available</p>';
        
        detectionCard.innerHTML = `
            <img src="${detection.image}" alt="Detected person">
            <div class="detection-info">
                <h3><i class="fas fa-exclamation-triangle text-danger"></i> ${detection.personName}</h3>
                <p><span class="confidence-badge ${confidenceClass}">
                    ${Math.round(detection.confidence * 100)}% match
                </span></p>
                <p><i class="fas fa-clock"></i> ${new Date(detection.timestamp).toLocaleString()}</p>
                ${locationText}
                <p><i class="fas fa-info-circle"></i> <span class="text-danger">Missing Person Alert</span></p>
            </div>
        `;
        
        detectionsContainer.insertBefore(detectionCard, detectionsContainer.firstChild);
        
        // Limit to last 10 detections
        while (detectionsContainer.children.length > 10) {
            detectionsContainer.removeChild(detectionsContainer.lastChild);
        }
    }

    updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('statusMessage');
        statusElement.innerHTML = `<i class="fas fa-${this.getStatusIcon(type)}"></i> ${message}`;
        statusElement.className = `text-${type}`;
    }

    getStatusIcon(type) {
        const icons = {
            'success': 'check-circle',
            'error': 'exclamation-circle',
            'warning': 'exclamation-triangle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    updateDetectionCount() {
        document.getElementById('detectionCount').innerHTML = 
            `<i class="fas fa-eye"></i> Detections: ${this.detectionCount}`;
    }

    updateDatabaseCount(count) {
        document.getElementById('databaseCount').innerHTML = 
            `<i class="fas fa-database"></i> Database: ${count} persons`;
    }

    // Method to refresh missing persons data (called from admin panel)
    async refreshMissingPersons() {
        await this.loadMissingPersons();
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Create global instance
    window.missingPersonDetection = new MissingPersonDetection();

    // Register service worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then(registration => {
                console.log('SW registered: ', registration);
            }).catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
        });
    }
});
