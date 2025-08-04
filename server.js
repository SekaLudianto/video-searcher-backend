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
const CACHE_DURATION_MS = 30 * 60 * 1000;

// --- Endpoint untuk Pencarian XNXX ---
app.get('/api/xnxx/search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) {
        return res.status(400).json({ message: 'Query pencarian (q) dibutuhkan' });
    }

    const cacheKey = `xnxx-${query}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
        console.log(`\nINFO: Mengembalikan hasil untuk query "${query}" dari cache.`);
        return res.json(cachedData.data);
    }

    console.log(`\nINFO: Tidak ada cache untuk query: "${query}". Memulai scraping...`);

    try {
        const searchUrl = `https://www.xnxx.com/search/${encodeURIComponent(query)}`;
        const { data: searchHtml } = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        const $ = cheerio.load(searchHtml);
        const videoPromises = [];

        $('.mozaique .thumb-block').slice(0, 20).each((i, element) => {
            const thumbLink = $(element).find('.thumb a');
            const pageUrl = thumbLink.attr('href');
            let thumbUrl = $(element).find('.thumb img').attr('data-src');

            if (pageUrl && thumbUrl) {
                const fullPageUrl = `https://www.xnxx.com${pageUrl}`;
                
                const videoPromise = axios.get(fullPageUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
                }).then(response => {
                    const pageHtml = response.data;
                    const highQualityMatch = pageHtml.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
                    const lowQualityMatch = pageHtml.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
                    
                    const bestUrl = highQualityMatch ? highQualityMatch[1] : (lowQualityMatch ? lowQualityMatch[1] : null);

                    if (bestUrl) {
                        return {
                            thumbnailUrl: thumbUrl,
                            videoUrl: bestUrl,
                            previewVideoUrl: lowQualityMatch ? lowQualityMatch[1] : bestUrl,
                            title: $(element).find('.title a').attr('title')
                        };
                    }
                    return null;
                }).catch(err => null);
                videoPromises.push(videoPromise);
            }
        });

        const results = await Promise.all(videoPromises);
        const videos = results.filter(v => v !== null);

        console.log(`SUKSES: Ditemukan ${videos.length} video.`);

        const responseData = { videos: videos };
        cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
        res.json(responseData);

    } catch (error) {
        console.error('KRITIS: Terjadi error saat scraping.', error.message);
        return res.status(500).json({ message: 'Gagal mengambil data dari sumber.', details: error.message });
    }
});

// --- PERBAIKAN: Endpoint untuk Simulasi Subtitle ---
app.get('/api/generate-subtitle', (req, res) => {
    console.log("INFO: Menerima permintaan untuk simulasi subtitle.");
    // Ini adalah contoh konten file VTT (subtitle)
    const vttContent = `WEBVTT

00:00:01.000 --> 00:00:05.000
Ini adalah contoh subtitle otomatis.

00:00:06.000 --> 00:00:10.000
Fitur ini mensimulasikan cara kerja Speech-to-Text API.

00:00:11.000 --> 00:00:15.000
Dalam aplikasi nyata, ini memerlukan layanan cloud berbayar.
`;
    res.header('Content-Type', 'text/vtt');
    res.send(vttContent);
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
            console.error("Pastikan file 'key.pem' dan 'cert.pem' ada untuk pengembangan lokal dengan HTTPS.");
            app.listen(PORT, () => {
                console.log(`Server backend berjalan di http://localhost:${PORT}`);
            });
        }
    }
};

startServer();
