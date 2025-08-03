// Import paket yang diperlukan
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
require('dotenv').config();
const cheerio = require('cheerio'); // Library untuk web scraping

// Inisialisasi aplikasi Express
const app = express();
const PORT = 3000;

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
        console.log(`\nINFO: Mengembalikan hasil untuk query XNXX "${query}" dari cache.`);
        return res.json(cachedData.data);
    }

    console.log(`\nINFO: Tidak ada cache untuk query XNXX: "${query}". Memulai scraping...`);

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

        console.log(`SUKSES: Ditemukan ${videos.length} video dari XNXX.`);

        const responseData = { videos: videos };
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: responseData
        });

        res.json(responseData);

    } catch (error) {
        console.error('KRITIS: Terjadi error saat scraping XNXX.', error.message);
        return res.status(500).json({ 
            message: 'Gagal mengambil data dari XNXX.',
            details: error.message
        });
    }
});

// --- PERBAIKAN: Endpoint untuk Pencarian Xhamster ---
app.get('/api/xhamster/search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) {
        return res.status(400).json({ message: 'Query pencarian (q) dibutuhkan' });
    }

    const cacheKey = `xhamster-${query}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
        console.log(`\nINFO: Mengembalikan hasil untuk query Xhamster "${query}" dari cache.`);
        return res.json(cachedData.data);
    }

    console.log(`\nINFO: Tidak ada cache untuk query Xhamster: "${query}". Memulai scraping...`);

    try {
        const searchUrl = `https://xhamster.com/search/${encodeURIComponent(query)}`;
        const { data: searchHtml } = await axios.get(searchUrl);
        const $ = cheerio.load(searchHtml);
        const videos = [];

        $('div.video-thumb-container__link').slice(0, 20).each((i, element) => {
            const pageUrl = $(element).attr('href');
            const title = $(element).find('.video-thumb-info__name').text().trim();
            const thumbnailElement = $(element).find('img.video-thumb__image');
            const thumbnailUrl = thumbnailElement.attr('src');
            const previewVideoUrl = $(element).find('video.video-thumb__preview-video').attr('src');

            if (pageUrl && title && thumbnailUrl && previewVideoUrl) {
                // Untuk Xhamster, kita tidak perlu ke halaman detail karena URL video ada di data
                const videoUrlMatch = pageUrl.match(/-(\d+)$/);
                if (videoUrlMatch) {
                    const videoId = videoUrlMatch[1];
                    // URL video seringkali bisa direkonstruksi, tapi kita akan ambil dari halaman detail untuk kualitas terbaik
                    videos.push({ pageUrl, title, thumbnailUrl, previewVideoUrl });
                }
            }
        });

        const videoPromises = videos.map(video => 
            axios.get(video.pageUrl).then(response => {
                const pageHtml = response.data;
                const videoUrlMatch = pageHtml.match(/"videoUrl":"(https?:\/\/[^"]+)"/);
                if (videoUrlMatch && videoUrlMatch[1]) {
                    return {
                        ...video,
                        videoUrl: videoUrlMatch[1].replace(/\\u002F/g, '/')
                    };
                }
                return null;
            }).catch(err => null)
        );

        const detailedVideos = (await Promise.all(videoPromises)).filter(v => v !== null);

        console.log(`SUKSES: Ditemukan ${detailedVideos.length} video dari Xhamster.`);
        const responseData = { videos: detailedVideos };
        cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
        res.json(responseData);
    } catch (error) {
        console.error('KRITIS: Terjadi error saat scraping Xhamster.', error.message);
        return res.status(500).json({ message: 'Gagal mengambil data dari Xhamster.', details: error.message });
    }
});

// --- PERBAIKAN: Endpoint untuk Pencarian Eporner ---
app.get('/api/eporner/search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) {
        return res.status(400).json({ message: 'Query pencarian (q) dibutuhkan' });
    }

    const cacheKey = `eporner-${query}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
        console.log(`\nINFO: Mengembalikan hasil untuk query Eporner "${query}" dari cache.`);
        return res.json(cachedData.data);
    }

    console.log(`\nINFO: Tidak ada cache untuk query Eporner: "${query}". Memulai scraping...`);

    try {
        const searchUrl = `https://www.eporner.com/search/${encodeURIComponent(query)}/`;
        const { data: searchHtml } = await axios.get(searchUrl);
        const $ = cheerio.load(searchHtml);
        const videoPromises = [];

        $('#vidresults .mb').slice(0, 20).each((i, element) => {
            const linkElement = $(element).find('a');
            const pageUrl = `https://www.eporner.com${linkElement.attr('href')}`;
            const title = $(element).find('.mbtit').text().trim();
            const thumbnailElement = $(element).find('img');
            const thumbnailUrl = thumbnailElement.attr('src');
            const previewVideoUrl = thumbnailElement.attr('data-preview');

            if (pageUrl && title && thumbnailUrl) {
                const videoPromise = axios.get(pageUrl).then(response => {
                    const pageHtml = response.data;
                    const sourceMatch = pageHtml.match(/<source src="([^"]+)" type="video\/mp4"/);
                    if (sourceMatch && sourceMatch[1]) {
                        return {
                            thumbnailUrl,
                            previewVideoUrl,
                            videoUrl: sourceMatch[1],
                            title
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

        console.log(`SUKSES: Ditemukan ${videos.length} video dari Eporner.`);
        const responseData = { videos: videos };
        cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
        res.json(responseData);
    } catch (error) {
        console.error('KRITIS: Terjadi error saat scraping Eporner.', error.message);
        return res.status(500).json({ message: 'Gagal mengambil data dari Eporner.', details: error.message });
    }
});


// --- Menjalankan Server dengan HTTPS ---
try {
    const options = {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem'),
    };

    https.createServer(options, app).listen(PORT, () => {
        console.log(`Server backend berjalan di https://localhost:${PORT}`);
    });

} catch (error) {
    console.error("\nKRITIS: Gagal menjalankan server HTTPS. Pastikan file 'key.pem' dan 'cert.pem' ada di direktori yang sama.");
}
