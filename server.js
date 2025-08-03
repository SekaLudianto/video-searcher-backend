// Import paket yang diperlukan
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config(); // Memuat variabel dari file .env
const { HttpsProxyAgent } = require('https-proxy-agent');

// Inisialisasi aplikasi Express
const app = express();
// PERBAIKAN: Gunakan port dari environment variable yang disediakan Render, atau 3000 untuk lokal
const PORT = process.env.PORT || 3000;

// Gunakan middleware CORS
app.use(cors());

// --- Manajemen dan Filter Proxy Otomatis ---
let rawProxyList = [];
let activeProxyList = []; // Daftar proxy yang sudah terbukti aktif

async function fetchProxyList() {
    const proxySourceUrl = 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.json';
    console.log(`INFO: Mengunduh daftar proxy dari ${proxySourceUrl}...`);
    try {
        const response = await axios.get(proxySourceUrl);
        rawProxyList = response.data.filter(p => p.protocol === 'https' && p.support && p.support.get);
        console.log(`SUKSES: Berhasil memuat ${rawProxyList.length} proxy mentah. Memulai pengujian...`);
        testAndFilterProxies();
    } catch (error) {
        console.error("KRITIS: Gagal mengunduh daftar proxy. Server akan menggunakan koneksi langsung.", error.message);
        rawProxyList = [];
    }
}

async function testAndFilterProxies() {
    const testUrl = 'https://www.google.com'; // Target yang andal untuk pengujian
    const testPromises = rawProxyList.map(proxyInfo => {
        const proxyUrl = `http://${proxyInfo.ip}:${proxyInfo.port}`;
        const agent = new HttpsProxyAgent(proxyUrl);
        return axios.get(testUrl, { 
            httpsAgent: agent, 
            timeout: 8000 // Beri waktu 8 detik untuk setiap proxy
        }).then(() => proxyInfo); // Jika berhasil, kembalikan info proxy
    });

    // Gunakan Promise.allSettled untuk menunggu semua pengujian selesai, baik berhasil maupun gagal
    const results = await Promise.allSettled(testPromises);
    
    const newActiveList = [];
    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            newActiveList.push(result.value);
        }
    });

    activeProxyList = newActiveList;
    console.log(`\n-----------------------------------------------------`);
    console.log(`INFO: Pengujian proxy selesai. Ditemukan ${activeProxyList.length} proxy aktif.`);
    console.log(`-----------------------------------------------------\n`);
}


// Fungsi untuk mendapatkan proxy acak dari daftar AKTIF
function getRandomProxyAgent() {
    const listToUse = activeProxyList.length > 0 ? activeProxyList : rawProxyList;
    
    if (listToUse.length === 0) {
        return { agent: null, url: 'Koneksi Langsung' };
    }
    const randomProxy = listToUse[Math.floor(Math.random() * listToUse.length)];
    const proxyUrl = `http://${randomProxy.ip}:${randomProxy.port}`;
    console.log(`   INFO: Menggunakan proxy acak: ${proxyUrl}`);
    return { agent: new HttpsProxyAgent(proxyUrl), url: proxyUrl };
}
// --- Akhir Perubahan Proxy ---

// --- Implementasi Caching Sederhana ---
const cache = new Map();
const CACHE_DURATION_MS = 5 * 60 * 1000;

// --- Counter Permintaan Sesi Ini ---
let requestStats = { twitter: 0, reddit: 0 };

// --- Logika Pengelolaan Kunci API Twitter ---

const apiKeys = [];
let i = 1;
while (process.env[`TWITTER_BEARER_TOKEN_${i}`]) {
    apiKeys.push(process.env[`TWITTER_BEARER_TOKEN_${i}`]);
    i++;
}

if (apiKeys.length === 0) {
    console.warn("PERINGATAN: Tidak ada TWITTER_BEARER_TOKEN yang ditemukan di file .env.");
} else {
    console.log(`INFO: Berhasil memuat ${apiKeys.length} kunci API Twitter.`);
}

let currentKeyIndex = 0;

const getNextApiKey = () => {
    const key = apiKeys[currentKeyIndex];
    const keyIndex = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return { key, index: keyIndex };
};

// --- Logika Autentikasi Reddit ---
const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET } = process.env;
let redditAccessToken = null;
let redditTokenExpiresAt = 0;

async function getRedditAccessToken() {
    if (redditAccessToken && Date.now() < redditTokenExpiresAt) {
        return redditAccessToken;
    }

    console.log("INFO: Token Reddit tidak ada atau sudah kedaluwarsa. Meminta token baru...");

    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
        throw new Error("Kredensial Reddit tidak lengkap di file .env.");
    }

    const authString = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');

    try {
        const { agent: proxyAgent } = getRandomProxyAgent();
        const response = await axios.post('https://www.reddit.com/api/v1/access_token', params, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'UniversalVideoSearcher/4.0'
            },
            httpsAgent: proxyAgent
        });

        const { access_token, expires_in } = response.data;
        redditAccessToken = access_token;
        redditTokenExpiresAt = Date.now() + (expires_in - 60) * 1000; 
        console.log("SUKSES: Berhasil mendapatkan token akses Reddit baru.");
        return redditAccessToken;
    } catch (error) {
        console.error("KRITIS: Gagal mendapatkan token akses Reddit.", error.response ? error.response.data : error.message);
        throw new Error("Autentikasi Reddit gagal.");
    }
}


// Buat endpoint/route untuk pencarian Twitter
app.get('/api/twitter/search', async (req, res) => {
    const { q: query, sort = 'latest' } = req.query; 

    if (!query) {
        return res.status(400).json({ message: 'Query pencarian (q) dibutuhkan' });
    }

    if (apiKeys.length === 0) {
        return res.status(500).json({ message: 'Tidak ada kunci API Twitter yang dikonfigurasi.' });
    }

    const twitterCacheKey = `twitter-${query}-${sort}`;
    const cachedData = cache.get(twitterCacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
        console.log(`\nINFO: Menemukan hasil untuk query Twitter "${query}" (sort: ${sort}) di cache.`);
        return res.json(cachedData.data);
    }

    console.log(`\nINFO: Tidak ada cache valid untuk query Twitter: "${query}" (sort: ${sort}). Memanggil API...`);

    const twitterApiEndpoint = 'https://api.twitter.com/2/tweets/search/recent';
    const params = {
        'query': `${query} has:videos -is:retweet`,
        'expansions': 'attachments.media_keys,author_id',
        'media.fields': 'preview_image_url,url,variants',
        'tweet.fields': 'attachments,author_id,public_metrics',
        'user.fields': 'name,username',
        'max_results': 50
    };
    
    const totalKeys = apiKeys.length;
    for (let attempt = 0; attempt < totalKeys; attempt++) {
        const { key: currentBearerToken, index: keyIndex } = getNextApiKey();
        console.log(`   [Percobaan ${attempt + 1}/${totalKeys}] Mencoba dengan Kunci API Twitter index ke-${keyIndex}...`);

        try {
            requestStats.twitter++;
            const { agent: proxyAgent, url: proxyUrl } = getRandomProxyAgent();
            const response = await axios.get(twitterApiEndpoint, {
                headers: { 'Authorization': `Bearer ${currentBearerToken}` },
                params: params,
                httpsAgent: proxyAgent
            });
            
            console.log(`   SUKSES: Permintaan Twitter berhasil dengan Kunci API index ke-${keyIndex}.`);

            if (response.data.data && sort === 'top') {
                response.data.data.sort((a, b) => {
                    const likesA = a.public_metrics ? a.public_metrics.like_count : 0;
                    const likesB = b.public_metrics ? b.public_metrics.like_count : 0;
                    return likesB - likesA;
                });
                console.log('   INFO: Hasil diurutkan berdasarkan popularitas (jumlah suka).');
            }

            const rateLimitInfo = {
                remaining: response.headers['x-rate-limit-remaining'],
                reset: response.headers['x-rate-limit-reset']
            };
            
            const responseData = {
                tweetData: response.data,
                rateLimit: rateLimitInfo,
                stats: requestStats,
                proxyUsed: proxyUrl
            };

            cache.set(twitterCacheKey, {
                timestamp: Date.now(),
                data: responseData
            });
            console.log(`   INFO: Hasil untuk query Twitter "${query}" (sort: ${sort}) disimpan di cache.`);

            return res.json(responseData);

        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.warn(`   GAGAL: Kunci API Twitter index ke-${keyIndex} terkena rate limit (429). Mencoba kunci berikutnya...`);
                if (attempt === totalKeys - 1) {
                    console.error("   KRITIS: Semua kunci API Twitter telah mencapai batas permintaan.");
                    break; 
                }
            } else {
                console.error('   KRITIS: Terjadi error fatal saat memanggil API Twitter.', error.response ? error.response.data : error.message);
                return res.status(error.response ? error.response.status : 500).json({ 
                    message: 'Gagal mengambil data dari API Twitter karena error tak terduga.',
                    details: error.response ? error.response.data : {}
                });
            }
        }
    }
    
    return res.status(429).json({ 
        message: 'Gagal mengambil data dari API Twitter: Semua kunci API telah mencapai batas permintaan. Silakan coba lagi nanti.'
    });
});

// Endpoint untuk pencarian di Reddit
app.get('/api/reddit/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ message: 'Query pencarian (q) dibutuhkan' });
    }

    const redditCacheKey = `reddit-${query}`;
    const cachedData = cache.get(redditCacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
        console.log(`\nINFO: Menemukan hasil untuk query Reddit "${query}" di cache.`);
        return res.json(cachedData.data);
    }

    try {
        const token = await getRedditAccessToken();

        console.log(`\nINFO: Tidak ada cache untuk query Reddit: "${query}". Memanggil Reddit API dengan token...`);

        const redditApiEndpoint = `https://oauth.reddit.com/search`;
        const params = {
            q: query,
            sort: 'relevance',
            t: 'all',
            limit: 50 
        };

        requestStats.reddit++;
        const { agent: proxyAgent, url: proxyUrl } = getRandomProxyAgent();
        const response = await axios.get(redditApiEndpoint, { 
            params: params,
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'UniversalVideoSearcher/4.0'
            },
            httpsAgent: proxyAgent
        });
        const posts = response.data.data.children;

        const videos = posts
            .filter(post => post.data.is_video && post.data.media && post.data.media.reddit_video)
            .map(post => ({
                thumbnailUrl: post.data.thumbnail,
                videoUrl: post.data.media.reddit_video.fallback_url.replace(/&amp;/g, '&'),
                authorUsername: post.data.author
            }));
        
        console.log(`   SUKSES: Ditemukan ${videos.length} video dari Reddit.`);

        const responseData = { 
            videos: videos,
            stats: requestStats,
            proxyUsed: proxyUrl
        };

        cache.set(redditCacheKey, {
            timestamp: Date.now(),
            data: responseData
        });
        
        return res.json(responseData);

    } catch (error) {
        console.error('   KRITIS: Terjadi error saat memanggil API Reddit.', error.response ? error.response.data : error.message);
        return res.status(error.response ? error.response.status : 500).json({ 
            message: 'Gagal mengambil data dari API Reddit.',
            details: error.response ? error.response.data : {}
        });
    }
});


// --- Menjalankan Server ---

async function startServer() {
    await fetchProxyList();

    // PERBAIKAN: Jalankan server HTTP standar, bukan HTTPS
    app.listen(PORT, () => {
        console.log(`Server backend berjalan di port ${PORT}`);
    });
}

startServer();
