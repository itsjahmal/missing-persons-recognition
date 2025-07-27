class Database {
    constructor() {
        this.dbName = 'MissingPersonsDB';
        this.version = 2;
        this.db = null;
        this.initialized = false;
        this.init();
    }

    async init() {
        try {
            this.db = await this.openDatabase();
            this.initialized = true;
            console.log('Database initialized successfully');
        } catch (error) {
            console.error('Database initialization failed:', error);
            // Still mark as initialized to prevent blocking the UI
            this.initialized = true;
        }
    }

    openDatabase() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('IndexedDB not supported'));
                return;
            }

            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => {
                console.error('Database error:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                console.log('Database opened successfully');
                resolve(request.result);
            };
            
            request.onupgradeneeded = (event) => {
                console.log('Database upgrade needed');
                const db = event.target.result;
                
                // Missing persons store
                if (!db.objectStoreNames.contains('missingPersons')) {
                    const personStore = db.createObjectStore('missingPersons', { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    personStore.createIndex('name', 'name', { unique: false });
                    personStore.createIndex('dateAdded', 'dateAdded', { unique: false });
                }
                
                // Detections store
                if (!db.objectStoreNames.contains('detections')) {
                    const detectionStore = db.createObjectStore('detections', { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    detectionStore.createIndex('personName', 'personName', { unique: false });
                    detectionStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // Settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { 
                        keyPath: 'key' 
                    });
                }
            };
        });
    }

    async waitForInit() {
        if (this.initialized) return;
        
        // Wait for initialization
        let attempts = 0;
        while (!this.initialized && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (!this.initialized) {
            throw new Error('Database initialization timeout');
        }
    }

    async addMissingPerson(personData) {
        try {
            await this.waitForInit();
            if (!this.db) throw new Error('Database not available');
            
            const transaction = this.db.transaction(['missingPersons'], 'readwrite');
            const store = transaction.objectStore('missingPersons');
            const result = await this.promisifyRequest(store.add(personData));
            console.log('Person added successfully:', result);
            return result;
        } catch (error) {
            console.error('Error adding person:', error);
            throw error;
        }
    }

    async getAllMissingPersons() {
        try {
            await this.waitForInit();
            if (!this.db) return [];
            
            const transaction = this.db.transaction(['missingPersons'], 'readonly');
            const store = transaction.objectStore('missingPersons');
            const result = await this.promisifyRequest(store.getAll());
            return result;
        } catch (error) {
            console.error('Error getting persons:', error);
            return [];
        }
    }

    async getMissingPerson(id) {
        try {
            await this.waitForInit();
            if (!this.db) return null;
            
            const transaction = this.db.transaction(['missingPersons'], 'readonly');
            const store = transaction.objectStore('missingPersons');
            const result = await this.promisifyRequest(store.get(id));
            return result;
        } catch (error) {
            console.error('Error getting person:', error);
            return null;
        }
    }

    async updateMissingPerson(personData) {
        try {
            await this.waitForInit();
            if (!this.db) throw new Error('Database not available');
            
            const transaction = this.db.transaction(['missingPersons'], 'readwrite');
            const store = transaction.objectStore('missingPersons');
            const result = await this.promisifyRequest(store.put(personData));
            return result;
        } catch (error) {
            console.error('Error updating person:', error);
            throw error;
        }
    }

    async deleteMissingPerson(id) {
        try {
            await this.waitForInit();
            if (!this.db) throw new Error('Database not available');
            
            const transaction = this.db.transaction(['missingPersons'], 'readwrite');
            const store = transaction.objectStore('missingPersons');
            await this.promisifyRequest(store.delete(id));
            console.log('Person deleted successfully');
        } catch (error) {
            console.error('Error deleting person:', error);
            throw error;
        }
    }

    async saveDetection(detectionData) {
        try {
            await this.waitForInit();
            if (!this.db) throw new Error('Database not available');
            
            const transaction = this.db.transaction(['detections'], 'readwrite');
            const store = transaction.objectStore('detections');
            const result = await this.promisifyRequest(store.add(detectionData));
            console.log('Detection saved successfully:', result);
            return result;
        } catch (error) {
            console.error('Error saving detection:', error);
            throw error;
        }
    }

    async getAllDetections() {
        try {
            await this.waitForInit();
            if (!this.db) return [];
            
            const transaction = this.db.transaction(['detections'], 'readonly');
            const store = transaction.objectStore('detections');
            const result = await this.promisifyRequest(store.getAll());
            // Sort by timestamp (most recent first)
            return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } catch (error) {
            console.error('Error getting detections:', error);
            return [];
        }
    }

    async getDetectionsByPerson(personName) {
        try {
            await this.waitForInit();
            if (!this.db) return [];
            
            const transaction = this.db.transaction(['detections'], 'readonly');
            const store = transaction.objectStore('detections');
            const index = store.index('personName');
            const result = await this.promisifyRequest(index.getAll(personName));
            return result;
        } catch (error) {
            console.error('Error getting detections by person:', error);
            return [];
        }
    }

    async clearAllDetections() {
        try {
            await this.waitForInit();
            if (!this.db) throw new Error('Database not available');
            
            const transaction = this.db.transaction(['detections'], 'readwrite');
            const store = transaction.objectStore('detections');
            await this.promisifyRequest(store.clear());
            console.log('All detections cleared');
        } catch (error) {
            console.error('Error clearing detections:', error);
            throw error;
        }
    }

    async exportData() {
        try {
            const [persons, detections] = await Promise.all([
                this.getAllMissingPersons(),
                this.getAllDetections()
            ]);
            
            return {
                missingPersons: persons,
                detections: detections,
                exportDate: new Date().toISOString(),
                version: this.version
            };
        } catch (error) {
            console.error('Error exporting data:', error);
            throw error;
        }
    }

    async importData(data) {
        try {
            if (data.missingPersons) {
                for (const person of data.missingPersons) {
                    delete person.id; // Let auto-increment assign new IDs
                    await this.addMissingPerson(person);
                }
            }
            
            if (data.detections) {
                for (const detection of data.detections) {
                    delete detection.id; // Let auto-increment assign new IDs
                    await this.saveDetection(detection);
                }
            }
            
            console.log('Data imported successfully');
        } catch (error) {
            console.error('Error importing data:', error);
            throw error;
        }
    }

    promisifyRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// Global database instance
const db = new Database();
