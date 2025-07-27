const CACHE_NAME = 'missing-persons-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/admin.html',
    '/css/style.css',
    '/js/main.js',
    '/js/admin.js',
    '/js/database.js',
    '/face-api.min.js',
    '/manifest.json',
    '/models/tiny_face_detector_model-weights_manifest.json',
    '/models/tiny_face_detector_model-shard1',
    '/models/ssd_mobilenetv1_model-weights_manifest.json',
    '/models/ssd_mobilenetv1_model-shard1',
    '/models/ssd_mobilenetv1_model-shard2',
    '/models/face_recognition_model-weights_manifest.json',
    '/models/face_recognition_model-shard1',
    '/models/face_recognition_model-shard2',
    '/models/face_landmark_68_model-weights_manifest.json',
    '/models/face_landmark_68_model-shard1',
    '/models/mtcnn_model-weights_manifest.json',
    '/models/mtcnn_model-shard1'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});
