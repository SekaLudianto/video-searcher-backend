// Import paket yang diperlukan
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
require('dotenv').config();
const cheerio = require('cheerio');

// Inisialisasi aplikasi Express
const app = express();
const PORT = process.env.PORT || 3000;

// Gunakan middleware CORS
app.use(cors());

// --- Implementasi Caching Sederhana ---
const cache = new Map();
const CACHE_DURATION_MS = 30 * 60 * 1000; // Cache selama 30 menit

// --- Endpoint untuk Pencarian MissAV ---
app.get('/api/missav/search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) {
        return res.status(400).json({ message: 'Query pencarian (q) dibutuhkan' });
    }

    const cacheKey = `missav-${query}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
        console.log(`\nINFO: Mengembalikan hasil untuk query "${query}" dari cache.`);
        return res.json(cachedData.data);
    }

    console.log(`\nINFO: Tidak ada cache untuk query: "${query}". Memulai scraping MissAV...`);

    try {
        // PERBAIKAN: Menggunakan domain dan URL pencarian yang baru
        const searchUrl = `https://missav.ws/search/${encodeURIComponent(query)}`;
        const { data: searchHtml } = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        const $ = cheerio.load(searchHtml);
        const videoPromises = [];

        // PERBAIKAN: Menggunakan selector yang diperbarui
        $('div.grid > div').slice(0, 20).each((i, element) => {
            const linkElement = $(element).find('a');
            const pageUrl = linkElement.attr('href');
            const title = $(element).find('div.text-secondary').text().trim();
            const thumbnailUrl = $(element).find('img').attr('data-src');

            if (pageUrl && title && thumbnailUrl) {
                const videoPromise = axios.get(pageUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
                }).then(response => {
                    const pageHtml = response.data;
                    // PERBAIKAN: Mencari URL video (M3U8) di dalam tag script
                    const videoUrlMatch = pageHtml.match(/player\.src\(\{\s*type:\s*'application\/x-mpegURL',\s*src:\s*'([^']+)'/);
                    if (videoUrlMatch && videoUrlMatch[1]) {
                        return {
                            thumbnailUrl: thumbnailUrl,
                            videoUrl: videoUrlMatch[1],
                            previewVideoUrl: null, 
                            title: title
                        };
                    }
                    return null;
                }).catch(err => {
                    console.error(`Gagal mengambil detail dari ${pageUrl}:`, err.message);
                    return null;
                });
                videoPromises.push(videoPromise);
            }
        });

        const results = await Promise.all(videoPromises);
        const videos = results.filter(v => v !== null);

        console.log(`SUKSES: Ditemukan ${videos.length} video dari MissAV.`);

        const responseData = { videos: videos };
        cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
        res.json(responseData);

    } catch (error) {
        console.error('KRITIS: Terjadi error saat scraping MissAV.', error.message);
        return res.status(500).json({ 
            message: 'Gagal mengambil data dari MissAV.',
            details: error.message
        });
    }
});

// --- Menjalankan Server ---
const startServer = () => {
    if (process.env.NODE_ENV === 'production') {
        app.listen(PORT, () => {
            console.log(`Server backend berjalan di port ${PORT}`);
        });
    } else {
        try {
            const options = {
                key: fs.readFileSync('key.pem'),
                cert: fs.readFileSync('cert.pem'),
            };
            https.createServer(options, app).listen(PORT, () => {
                console.log(`Server backend berjalan di https://localhost:${PORT}`);
            });
        } catch (error) {
            console.error("\nPERINGATAN: Gagal menjalankan server HTTPS. Menjalankan sebagai HTTP.", error.message);
            app.listen(PORT, () => {
                console.log(`Server backend berjalan di http://localhost:${PORT}`);
            });
        }
    }
};

startServer();
