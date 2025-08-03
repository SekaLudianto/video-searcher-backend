// Import paket yang diperlukan
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const cheerio = require('cheerio');

// Inisialisasi aplikasi Express
const app = express();
// Gunakan port dari environment variable yang disediakan Render, atau 3000 untuk lokal
const PORT = process.env.PORT || 3000;

// Gunakan middleware CORS
app.use(cors());

// --- Implementasi Caching Sederhana ---
const cache = new Map();
const CACHE_DURATION_MS = 30 * 60 * 1000; // Cache selama 30 menit

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
                    const videoUrlMatch = pageHtml.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
                    const previewUrlMatch = pageHtml.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
                    if (videoUrlMatch && videoUrlMatch[1]) {
                        return {
                            thumbnailUrl: thumbUrl,
                            videoUrl: videoUrlMatch[1],
                            previewVideoUrl: previewUrlMatch ? previewUrlMatch[1] : videoUrlMatch[1],
                            title: $(element).find('.title a').attr('title')
                        };
                    }
                    return null;
                }).catch(err => {
                    console.error(`Gagal mengambil detail dari ${fullPageUrl}:`, err.message);
                    return null;
                });
                videoPromises.push(videoPromise);
            }
        });

        const results = await Promise.all(videoPromises);
        const videos = results.filter(v => v !== null);

        console.log(`SUKSES: Ditemukan ${videos.length} video.`);

        const responseData = { videos: videos };
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: responseData
        });

        res.json(responseData);

    } catch (error) {
        console.error('KRITIS: Terjadi error saat scraping.', error.message);
        return res.status(500).json({ 
            message: 'Gagal mengambil data dari sumber.',
            details: error.message
        });
    }
});

// Jalankan server HTTP standar
app.listen(PORT, () => {
    console.log(`Server backend berjalan di port ${PORT}`);
});
