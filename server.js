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

// --- Endpoint untuk Pencarian Eporner ---
app.get('/api/eporner/search', async (req, res) => {
    const { q: query } = req.query;
    if (!query) {
        return res.status(400).json({ message: 'Query pencarian (q) dibutuhkan' });
    }

    const cacheKey = `eporner-${query}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
        console.log(`\nINFO: Mengembalikan hasil untuk query "${query}" dari cache.`);
        return res.json(cachedData.data);
    }

    console.log(`\nINFO: Tidak ada cache untuk query: "${query}". Memulai scraping Eporner...`);

    try {
        const searchUrl = `https://www.eporner.com/search/${encodeURIComponent(query)}/`;
        const { data: searchHtml } = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        const $ = cheerio.load(searchHtml);
        const videoPromises = [];

        $('div.mb').slice(0, 20).each((i, element) => {
            const linkElement = $(element).find('a');
            const pageUrl = 'https://www.eporner.com' + linkElement.attr('href');
            const title = $(element).find('p.mbtit').text().trim();
            const thumbnailUrl = $(element).find('img').attr('src'); 

            if (pageUrl && title && thumbnailUrl && !pageUrl.includes('https://www.eporner.com/ad/')) {
                const videoPromise = axios.get(pageUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
                }).then(response => {
                    const pageHtml = response.data;
                    
                    // PERBAIKAN: Kembali menggunakan metode parsing 'flashvars' dari script
                    const scriptContentMatch = pageHtml.match(/var\s+flashvars_\d+\s*=\s*({.*?});/s);
                    if (scriptContentMatch && scriptContentMatch[1]) {
                        // Membersihkan string JSON dari kemungkinan komentar atau karakter aneh
                        const jsonString = scriptContentMatch[1].replace(/(\r\n|\n|\r)/gm, "").replace(/\s+/g, ' ');
                        const flashvars = JSON.parse(jsonString);
                        
                        // Mencari sumber video (biasanya dalam array)
                        const sources = Object.values(flashvars).find(val => Array.isArray(val) && val[0] && val[0].src);
                        if(sources && sources.length > 0) {
                           // Mengambil URL video dengan kualitas tertinggi (biasanya yang terakhir di array)
                           const videoUrl = sources[sources.length - 1].src;
                            return {
                                thumbnailUrl: thumbnailUrl,
                                videoUrl: videoUrl.startsWith('http') ? videoUrl : 'https:' + videoUrl,
                                previewVideoUrl: null,
                                title: title
                            };
                        }
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
        
        if (videos.length === 0) {
             console.log("PERINGATAN: Tidak ada video yang ditemukan. Struktur situs mungkin telah berubah.");
        }

        const responseData = { videos: videos };
        cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
        res.json(responseData);

    } catch (error) {
        console.error('KRITIS: Terjadi error saat scraping Eporner.', error.message);
        return res.status(500).json({ 
            message: 'Gagal mengambil data dari Eporner.',
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

