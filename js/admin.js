class AdminPanel {
    constructor() {
        this.currentPersons = [];
        this.currentDetections = [];
        this.modelsLoaded = false;
        this.init();
    }

    async init() {
        try {
            // Initialize admin panel without waiting for models
            this.setupEventListeners();
            await this.loadPersons();
            await this.loadRecentDetections();
            this.hideLoading();
            
            // Load models in background
            this.loadModelsInBackground();
            
            console.log('Admin panel initialized successfully');
        } catch (error) {
            console.error('Admin panel initialization error:', error);
            this.hideLoading();
            this.showAlert('Error initializing admin panel: ' + error.message, 'error');
        }
    }

    async loadModelsInBackground() {
        try {
            console.log('Loading face-api models in background...');
            const modelPath = './models';
            
            // Check if models directory exists and is accessible
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
                faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
                faceapi.nets.faceRecognitionNet.loadFromUri(modelPath)
            ]);
            
            this.modelsLoaded = true;
            console.log('Face-api models loaded successfully');
            this.showAlert('Face recognition models loaded successfully!', 'success');
        } catch (error) {
            console.warn('Could not load face recognition models:', error);
            console.warn('You can still add persons, but face recognition will not work');
            this.showAlert('Warning: Face recognition models failed to load. You can still manage persons manually.', 'warning');
        }
    }

    setupEventListeners() {
        // Add person form
        const addPersonForm = document.getElementById('addPersonForm');
        if (addPersonForm) {
            addPersonForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addPerson();
            });
        }

        // Photo upload
        const photoUpload = document.getElementById('photoUpload');
        if (photoUpload) {
            photoUpload.addEventListener('change', (e) => {
                this.previewPhotos(e.target.files);
            });
        }

        // Export/Import
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportData();
            });
        }

        const importBtn = document.getElementById('importBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                this.importData();
            });
        }

        // Search
        const searchPersons = document.getElementById('searchPersons');
        if (searchPersons) {
            searchPersons.addEventListener('input', (e) => {
                this.filterPersons(e.target.value);
            });
        }

        // Clear detections
        const clearDetections = document.getElementById('clearDetections');
        if (clearDetections) {
            clearDetections.addEventListener('click', () => {
                this.clearAllDetections();
            });
        }

        // Setup drag and drop
        this.setupDragAndDrop();
    }

    setupDragAndDrop() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('photoUpload');

        if (!uploadArea || !fileInput) return;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.remove('drag-over');
            }, false);
        });

        uploadArea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            fileInput.files = files;
            this.previewPhotos(files);
        }, false);
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    previewPhotos(files) {
        const preview = document.getElementById('photoPreview');
        if (!preview) return;
        
        preview.innerHTML = '';
        
        if (files.length === 0) return;
        
        Array.from(files).forEach((file, index) => {
            if (file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                img.onload = () => URL.revokeObjectURL(img.src);
                
                const container = document.createElement('div');
                container.className = 'photo-item';
                container.appendChild(img);
                
                preview.appendChild(container);
            }
        });

        // Update upload area appearance
        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea) {
            uploadArea.style.borderColor = '#10b981';
            uploadArea.style.backgroundColor = 'rgba(16, 185, 129, 0.02)';
        }
    }

    async addPerson() {
        const form = document.getElementById('addPersonForm');
        const photoFiles = document.getElementById('photoUpload').files;
        
        // Validate required fields
        const name = document.getElementById('personName').value.trim();
        if (!name) {
            this.showAlert('Please enter a person name', 'error');
            return;
        }

        if (photoFiles.length === 0) {
            this.showAlert('Please upload at least one photo', 'error');
            return;
        }

        try {
            this.showLoading();

            let descriptors = [];
            
            // Only try to extract face descriptors if models are loaded
            if (this.modelsLoaded) {
                try {
                    descriptors = await this.extractFaceDescriptors(photoFiles);
                    
                    if (descriptors.length === 0) {
                        this.showAlert('Warning: No faces detected in photos. Person will be added but face recognition will not work.', 'warning');
                    }
                } catch (error) {
                    console.warn('Face extraction failed:', error);
                    this.showAlert('Warning: Face extraction failed. Person will be added without face recognition data.', 'warning');
                }
            } else {
                this.showAlert('Info: Person will be added without face recognition data (models not loaded)', 'info');
            }

            const personData = {
                name: name,
                age: parseInt(document.getElementById('personAge').value) || null,
                description: document.getElementById('personDescription').value.trim(),
                contactInfo: document.getElementById('contactInfo').value.trim(),
                descriptors: descriptors,
                photos: await this.convertPhotosToBase64(photoFiles),
                dateAdded: new Date().toISOString(),
                status: 'active'
            };

            await db.addMissingPerson(personData);
            
            form.reset();
            document.getElementById('photoPreview').innerHTML = '';
            this.resetUploadArea();
            
            await this.loadPersons();
            this.showAlert(`${personData.name} has been added to the database successfully!`, 'success');
            
            // Refresh the main detection system if it's running
            if (window.missingPersonDetection) {
                await window.missingPersonDetection.refreshMissingPersons();
            }
            
        } catch (error) {
            console.error('Error adding person:', error);
            this.showAlert('Error adding person: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    resetUploadArea() {
        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea) {
            uploadArea.style.borderColor = '';
            uploadArea.style.backgroundColor = '';
        }
    }

    async extractFaceDescriptors(photoFiles) {
        const descriptors = [];
        
        for (let i = 0; i < photoFiles.length; i++) {
            try {
                const img = await this.fileToImage(photoFiles[i]);
                const detection = await faceapi
                    .detectSingleFace(img, new faceapi.SsdMobilenetv1Options())
                    .withFaceLandmarks()
                    .withFaceDescriptor();
                
                if (detection) {
                    descriptors.push(Array.from(detection.descriptor));
                    console.log(`Face detected in image ${i + 1}`);
                } else {
                    console.warn(`No face detected in image ${i + 1}`);
                }
            } catch (error) {
                console.error(`Error processing image ${i + 1}:`, error);
            }
        }
        
        return descriptors;
    }

    fileToImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    async convertPhotosToBase64(photoFiles) {
        const photos = [];
        
        for (const file of photoFiles) {
            const base64 = await this.fileToBase64(file);
            photos.push(base64);
        }
        
        return photos;
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async loadPersons() {
        try {
            this.currentPersons = await db.getAllMissingPersons();
            this.displayPersons(this.currentPersons);
            this.updatePersonCount(this.currentPersons.length);
        } catch (error) {
            console.error('Error loading persons:', error);
            this.showAlert('Error loading persons from database', 'error');
        }
    }

    displayPersons(persons) {
        const container = document.getElementById('personsList');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (persons.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>No missing persons in database</p>
                    <small>Add persons using the form above</small>
                </div>
            `;
            return;
        }
        
        persons.forEach(person => {
            const personCard = document.createElement('div');
            personCard.className = 'person-card';
            
            const photoHtml = person.photos && person.photos.length > 0 ? 
                `<img src="${person.photos[0]}" alt="${person.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px; margin-bottom: 10px;">` : 
                '<div style="width: 60px; height: 60px; background: #f3f4f6; border-radius: 6px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center;"><i class="fas fa-user text-secondary"></i></div>';
            
            personCard.innerHTML = `
                ${photoHtml}
                <h3>${person.name}</h3>
                ${person.age ? `<p><i class="fas fa-birthday-cake"></i> Age: ${person.age}</p>` : ''}
                ${person.description ? `<p><i class="fas fa-align-left"></i> ${person.description.substring(0, 100)}${person.description.length > 100 ? '...' : ''}</p>` : ''}
                <p><i class="fas fa-calendar"></i> Added: ${new Date(person.dateAdded).toLocaleDateString()}</p>
                <p><i class="fas fa-images"></i> Photos: ${person.photos ? person.photos.length : 0}</p>
                <div class="person-actions">
                    <button class="btn btn-info btn-small" onclick="adminPanel.viewPerson(${person.id})">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn btn-success btn-small" onclick="adminPanel.viewDetections(${person.id})">
                        <i class="fas fa-search"></i> Detections
                    </button>
                    <button class="btn btn-danger btn-small" onclick="adminPanel.deletePerson(${person.id}, '${person.name}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            `;
            
            container.appendChild(personCard);
        });
    }

    filterPersons(searchTerm) {
        const filtered = this.currentPersons.filter(person => 
            person.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (person.description && person.description.toLowerCase().includes(searchTerm.toLowerCase()))
        );
        this.displayPersons(filtered);
    }

    updatePersonCount(count) {
        const element = document.getElementById('personCount');
        if (element) {
            element.textContent = `${count} persons`;
        }
    }

    async deletePerson(id, name) {
        if (confirm(`Are you sure you want to delete ${name} from the database?\n\nThis action cannot be undone.`)) {
            try {
                await db.deleteMissingPerson(id);
                await this.loadPersons();
                this.showAlert(`${name} has been removed from the database`, 'success');
                
                // Refresh the main detection system
                if (window.missingPersonDetection) {
                    await window.missingPersonDetection.refreshMissingPersons();
                }
            } catch (error) {
                console.error('Error deleting person:', error);
                this.showAlert('Error deleting person', 'error');
            }
        }
    }

    async viewPerson(id) {
        try {
            const person = await db.getMissingPerson(id);
            if (person) {
                this.showPersonModal(person);
            }
        } catch (error) {
            console.error('Error loading person details:', error);
            this.showAlert('Error loading person details', 'error');
        }
    }

    showPersonModal(person) {
        const modal = document.getElementById('personModal');
        const content = document.getElementById('personModalContent');
        
        if (!modal || !content) {
            this.showAlert('Modal not found', 'error');
            return;
        }
        
        const photosHtml = person.photos && person.photos.length > 0 ? 
            person.photos.map(photo => `<img src="${photo}" style="width: 150px; height: 150px; object-fit: cover; border-radius: 8px; margin: 5px;">`).join('') :
            '<p>No photos available</p>';
        
        content.innerHTML = `
            <div class="person-details">
                <div class="photos-section">
                    <h3><i class="fas fa-images"></i> Photos</h3>
                    <div class="photos-grid">
                        ${photosHtml}
                    </div>
                </div>
                
                <div class="info-section">
                    <h3><i class="fas fa-user"></i> Information</h3>
                    <p><strong>Name:</strong> ${person.name}</p>
                    ${person.age ? `<p><strong>Age:</strong> ${person.age}</p>` : ''}
                    ${person.description ? `<p><strong>Description:</strong> ${person.description}</p>` : ''}
                    ${person.contactInfo ? `<p><strong>Contact:</strong> ${person.contactInfo}</p>` : ''}
                    <p><strong>Date Added:</strong> ${new Date(person.dateAdded).toLocaleString()}</p>
                    <p><strong>Face Descriptors:</strong> ${person.descriptors ? person.descriptors.length : 0}</p>
                </div>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    async viewDetections(personId) {
        try {
            const person = await db.getMissingPerson(personId);
            if (person) {
                const detections = await db.getDetectionsByPerson(person.name);
                this.showDetectionsModal(person, detections);
            }
        } catch (error) {
            console.error('Error loading detections:', error);
            this.showAlert('Error loading detections', 'error');
        }
    }

    showDetectionsModal(person, detections) {
        const modal = document.getElementById('personModal');
        const content = document.getElementById('personModalContent');
        
        if (!modal || !content) return;
        
        const detectionsHtml = detections.length > 0 ? 
            detections.map(detection => `
                <div class="detection-item">
                    <img src="${detection.image}" style="width: 100px; height: 100px; object-fit: cover; border-radius: 6px;">
                    <div class="detection-info">
                        <p><strong>Confidence:</strong> ${Math.round(detection.confidence * 100)}%</p>
                        <p><strong>Time:</strong> ${new Date(detection.timestamp).toLocaleString()}</p>
                        ${detection.location ? `
                            <p><strong>Location:</strong> ${detection.location.latitude.toFixed(4)}, ${detection.location.longitude.toFixed(4)}</p>
                        ` : ''}
                    </div>
                </div>
            `).join('') :
            '<p class="text-center">No detections found for this person.</p>';
        
        content.innerHTML = `
            <div class="detections-view">
                <h3><i class="fas fa-search"></i> Detections for ${person.name}</h3>
                <p class="text-secondary mb-3">Total detections: ${detections.length}</p>
                <div class="detections-list">
                    ${detectionsHtml}
                </div>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    async loadRecentDetections() {
        try {
            this.currentDetections = await db.getAllDetections();
            this.displayRecentDetections(this.currentDetections.slice(0, 20)); // Show last 20
        } catch (error) {
            console.error('Error loading detections:', error);
        }
    }

    displayRecentDetections(detections) {
        const container = document.getElementById('recentDetections');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (detections.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-eye"></i>
                    <p>No detections yet</p>
                    <small>Detections will appear here when missing persons are detected</small>
                </div>
            `;
            return;
        }
        
        detections.forEach(detection => {
            const detectionCard = document.createElement('div');
            detectionCard.className = 'detection-card missing-person';
            
            const confidenceClass = detection.confidence > 0.8 ? 'confidence-high' : 
                                   detection.confidence > 0.6 ? 'confidence-medium' : 'confidence-low';
            
            const locationText = detection.location ? 
                `<p><i class="fas fa-map-marker-alt"></i> ${detection.location.latitude.toFixed(4)}, ${detection.location.longitude.toFixed(4)}</p>` : 
                '<p><i class="fas fa-map-marker-alt"></i> Location not available</p>';
            
            detectionCard.innerHTML = `
                <img src="${detection.image}" alt="Detection">
                <div class="detection-info">
                    <h3><i class="fas fa-exclamation-triangle text-danger"></i> ${detection.personName}</h3>
                    <p><span class="confidence-badge ${confidenceClass}">
                        ${Math.round(detection.confidence * 100)}% confidence
                    </span></p>
                    <p><i class="fas fa-clock"></i> ${new Date(detection.timestamp).toLocaleString()}</p>
                    ${locationText}
                </div>
            `;
            
            container.appendChild(detectionCard);
        });
    }

    async clearAllDetections() {
        if (confirm('Are you sure you want to clear all detection history?\n\nThis action cannot be undone.')) {
            try {
                await db.clearAllDetections();
                await this.loadRecentDetections();
                this.showAlert('All detections have been cleared', 'success');
            } catch (error) {
                console.error('Error clearing detections:', error);
                this.showAlert('Error clearing detections', 'error');
            }
        }
    }

    async exportData() {
        try {
            this.showLoading();
            const data = await db.exportData();
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { 
                type: 'application/json' 
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `missing-persons-data-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showAlert('Data exported successfully', 'success');
        } catch (error) {
            console.error('Error exporting data:', error);
            this.showAlert('Error exporting data: ' + error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    async importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                this.showLoading();
                const text = await file.text();
                const data = JSON.parse(text);
                
                await db.importData(data);
                await this.loadPersons();
                await this.loadRecentDetections();
                
                this.showAlert('Data imported successfully', 'success');
                
                // Refresh the main detection system
                if (window.missingPersonDetection) {
                    await window.missingPersonDetection.refreshMissingPersons();
                }
            } catch (error) {
                console.error('Error importing data:', error);
                this.showAlert('Error importing data. Please check the file format.', 'error');
            } finally {
                this.hideLoading();
            }
        };
        
        input.click();
    }

    showLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'flex';
        }
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }

    showAlert(message, type = 'info') {
        // Create alert element
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.innerHTML = `
            <i class="fas fa-${this.getAlertIcon(type)}"></i>
            <span>${message}</span>
            <button class="alert-close">&times;</button>
        `;
        
        // Style the alert
        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            min-width: 300px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            animation: slideIn 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        
        // Set background color based on type
        const colors = {
            'success': '#10b981',
            'error': '#ef4444',
            'warning': '#f59e0b',
            'info': '#3b82f6'
        };
        alert.style.backgroundColor = colors[type] || colors.info;
        
        // Add close functionality
        alert.querySelector('.alert-close').onclick = () => {
            alert.remove();
        };
        
        document.body.appendChild(alert);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => alert.remove(), 300);
            }
        }, 5000);
    }

    getAlertIcon(type) {
        const icons = {
            'success': 'check-circle',
            'error': 'exclamation-circle',
            'warning': 'exclamation-triangle',
            'info': 'info-circle'
        };
        return icons[type] || 'info-circle';
    }
}

// CSS for alerts animation and additional styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    .alert-close {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        margin-left: auto;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #6b7280;
    }
    
    .empty-state i {
        font-size: 3rem;
        margin-bottom: 16px;
        opacity: 0.5;
    }
    
    .photos-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 20px;
    }
    
    .detection-item {
        display: flex;
        gap: 12px;
        padding: 12px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        margin-bottom: 12px;
        background: #f9fafb;
    }
    
    .detection-item:last-child {
        margin-bottom: 0;
    }
    
    .upload-area.drag-over {
        border-color: #3b82f6 !important;
        background-color: rgba(59, 130, 246, 0.05) !important;
    }

    .loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: none;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        color: white;
    }

    .spinner {
        width: 60px;
        height: 60px;
        border: 6px solid rgba(255, 255, 255, 0.3);
        border-top: 6px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 20px;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);

// Close modal functionality
document.addEventListener('DOMContentLoaded', () => {
    // Close modal when clicking the X
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('close')) {
            e.target.closest('.modal').style.display = 'none';
        }
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });
});

// Initialize admin panel
let adminPanel;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize without waiting for models
    adminPanel = new AdminPanel();
});
