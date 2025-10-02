const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

// Load Quran data
const quranData = JSON.parse(fs.readFileSync(path.join(__dirname, 'quran_v2.json'), 'utf8'));

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'static')));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Rate limit exceeded. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const docsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 requests per minute
  message: {
    error: 'Docs rate limit exceeded. Please try again later.'
  }
});

const fontLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: {
    error: 'Font rate limit exceeded. Please try again later.'
  }
});

// Apply rate limiting
app.use('/', generalLimiter);
app.use('/font', fontLimiter);

// Helper functions
function formatAyah(ayah, surah) {
  return {
    id: ayah.id,
    number: ayah.number,
    text: ayah.text,
    page: ayah.page,
    juz: ayah.juz,
    surah: {
      number: surah.number,
      name: surah.name,
    },
  };
}

function formatSurah(surah, includeAyahs = false) {
  const result = {
    number: surah.number,
    name: surah.name,
    ayah_count: surah.ayahs.length,
  };
  
  if (includeAyahs) {
    result.ayahs = surah.ayahs.map(ayah => formatAyah(ayah, surah));
  }
  
  return result;
}

function validateSurahNumber(number) {
  return number >= 1 && number <= 114;
}

function validateAyahNumber(surahNumber, ayahNumber) {
  if (!validateSurahNumber(surahNumber)) return false;
  const surah = quranData.surahs.find(s => s.number === surahNumber);
  if (!surah) return false;
  return ayahNumber >= 1 && ayahNumber <= surah.ayahs.length;
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    error: 'Internal server error',
    detail: 'Something went wrong on our side'
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({
    name: 'Quran API v2',
    version: '2.0.0',
    description: 'A public Quran API with Arabic text and metadata',
    endpoints: {
      surahs: '/surahs',
      surah: '/surahs/{number}',
      ayah: '/surahs/{number}/ayahs/{ayah_number}',
      ayahById: '/ayahs/{surah:ayah}',
      juz: '/juz/{number}',
      page: '/pages/{number}',
      font: '/font/info',
      fontDownload: '/font/download'
    },
    documentation: 'Visit /docs for API documentation'
  });
});

// Get all surahs
app.get('/surahs', (req, res) => {
  try {
    const surahs = quranData.surahs.map(surah => formatSurah(surah));
    res.json(surahs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve surahs list' });
  }
});

// Get specific surah
app.get('/surahs/:number', (req, res) => {
  try {
    const surahNumber = parseInt(req.params.number);
    
    if (!validateSurahNumber(surahNumber)) {
      return res.status(422).json({ error: 'Surah number must be between 1 and 114' });
    }
    
    const surah = quranData.surahs.find(s => s.number === surahNumber);
    if (!surah) {
      return res.status(404).json({ error: `Surah ${surahNumber} not found` });
    }
    
    res.json(formatSurah(surah, true));
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve surah' });
  }
});

// Get specific ayah
app.get('/surahs/:surahNumber/ayahs/:ayahNumber', (req, res) => {
  try {
    const surahNumber = parseInt(req.params.surahNumber);
    const ayahNumber = parseInt(req.params.ayahNumber);
    
    if (!validateSurahNumber(surahNumber)) {
      return res.status(422).json({ error: 'Surah number must be between 1 and 114' });
    }
    
    const surah = quranData.surahs.find(s => s.number === surahNumber);
    if (!surah) {
      return res.status(404).json({ error: `Surah ${surahNumber} not found` });
    }
    
    if (!validateAyahNumber(surahNumber, ayahNumber)) {
      return res.status(422).json({ 
        error: `Ayah number must be between 1 and ${surah.ayahs.length} for surah ${surahNumber}` 
      });
    }
    
    const ayah = surah.ayahs.find(a => a.number === ayahNumber);
    if (!ayah) {
      return res.status(404).json({ error: `Ayah ${ayahNumber} not found in surah ${surahNumber}` });
    }
    
    res.json(formatAyah(ayah, surah));
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve ayah' });
  }
});

// Get ayah by ID
app.get('/ayahs/:ayahId', (req, res) => {
  try {
    const ayahId = req.params.ayahId;
    
    if (!ayahId.includes(':')) {
      return res.status(400).json({ 
        error: 'Invalid ayah ID format. Use format "surah:ayah" (e.g., "1:1")' 
      });
    }
    
    const parts = ayahId.split(':');
    if (parts.length !== 2) {
      return res.status(400).json({ 
        error: 'Invalid ayah ID format. Use format "surah:ayah" (e.g., "1:1")' 
      });
    }
    
    const surahNumber = parseInt(parts[0]);
    const ayahNumber = parseInt(parts[1]);
    
    if (isNaN(surahNumber) || isNaN(ayahNumber)) {
      return res.status(400).json({ error: 'Surah and ayah must be valid numbers' });
    }
    
    // Reuse the existing ayah endpoint logic
    const surah = quranData.surahs.find(s => s.number === surahNumber);
    if (!surah) {
      return res.status(404).json({ error: `Surah ${surahNumber} not found` });
    }
    
    const ayah = surah.ayahs.find(a => a.number === ayahNumber);
    if (!ayah) {
      return res.status(404).json({ error: `Ayah ${ayahNumber} not found in surah ${surahNumber}` });
    }
    
    res.json(formatAyah(ayah, surah));
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve ayah by ID' });
  }
});

// Get juz
app.get('/juz/:number', (req, res) => {
  try {
    const juzNumber = parseInt(req.params.number);
    
    if (juzNumber < 1 || juzNumber > 30) {
      return res.status(422).json({ error: 'Juz number must be between 1 and 30' });
    }
    
    const results = [];
    quranData.surahs.forEach(surah => {
      surah.ayahs.forEach(ayah => {
        if (ayah.juz === juzNumber) {
          results.push(formatAyah(ayah, surah));
        }
      });
    });
    
    if (results.length === 0) {
      return res.status(404).json({ error: `Juz ${juzNumber} not found` });
    }
    
    res.json({
      juz: juzNumber,
      ayahs: results,
      count: results.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve juz' });
  }
});

// Get page
app.get('/pages/:number', (req, res) => {
  try {
    const pageNumber = parseInt(req.params.number);
    
    if (pageNumber < 1 || pageNumber > 604) {
      return res.status(422).json({ error: 'Page number must be between 1 and 604' });
    }
    
    const results = [];
    quranData.surahs.forEach(surah => {
      surah.ayahs.forEach(ayah => {
        if (ayah.page === pageNumber) {
          results.push(formatAyah(ayah, surah));
        }
      });
    });
    
    if (results.length === 0) {
      return res.status(404).json({ error: `Page ${pageNumber} not found` });
    }
    
    res.json({
      page: pageNumber,
      ayahs: results,
      count: results.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve page' });
  }
});

// Font info
app.get('/font/info', (req, res) => {
  try {
    res.json({
      name: 'Uthmanic Hafs v20',
      type: 'ttf',
      description: 'This font is required to properly display Quranic Arabic text with proper diacritics and glyph connections. Download and use this font in your application to ensure accurate rendering of the Arabic text from the Quran API.',
      download_url: '/font/download',
      usage_instructions: 'Download the font file and include it in your CSS using @font-face, or install it on your system for proper Arabic text rendering.'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve font info' });
  }
});

// Font download
app.get('/font/download', (req, res) => {
  try {
    const fontPath = path.join(__dirname, 'static', 'fonts', 'uthmanic_hafs_v20.ttf');
    
    if (!fs.existsSync(fontPath)) {
      return res.status(404).json({ error: 'Font file not found' });
    }
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="uthmanic_hafs_v20.ttf"');
    
    const fontStream = fs.createReadStream(fontPath);
    fontStream.pipe(res);
  } catch (error) {
    res.status(500).json({ error: 'Failed to download font' });
  }
});

// API documentation
app.get('/docs', docsLimiter, (req, res) => {
  const docs = `
<!DOCTYPE html>
<html>
<head>
    <title>Quran API v2 - Documentation</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .endpoint { background: #f4f4f4; padding: 15px; margin: 10px 0; border-left: 4px solid #007cba; }
        code { background: #eee; padding: 2px 6px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>Quran API v2 - Documentation</h1>
    <p>Welcome to the Quran API documentation. All endpoints support GET requests and return JSON responses.</p>
    
    <div class="endpoint">
        <h3>GET /surahs</h3>
        <p>List all surahs (basic info)</p>
        <code>https://your-api.com/surahs</code>
    </div>
    
    <div class="endpoint">
        <h3>GET /surahs/{number}</h3>
        <p>Get specific surah with all ayahs</p>
        <code>https://your-api.com/surahs/1</code>
    </div>
    
    <div class="endpoint">
        <h3>GET /surahs/{number}/ayahs/{ayah_number}</h3>
        <p>Get specific ayah within a surah</p>
        <code>https://your-api.com/surahs/1/ayahs/1</code>
    </div>
    
    <div class="endpoint">
        <h3>GET /ayahs/{surah:ayah}</h3>
        <p>Get ayah by ID</p>
        <code>https://your-api.com/ayahs/1:1</code>
    </div>
    
    <div class="endpoint">
        <h3>GET /juz/{number}</h3>
        <p>Get all ayahs in a juz (1-30)</p>
        <code>https://your-api.com/juz/1</code>
    </div>
    
    <div class="endpoint">
        <h3>GET /pages/{number}</h3>
        <p>Get all ayahs on a page (1-604)</p>
        <code>https://your-api.com/pages/1</code>
    </div>
    
    <div class="endpoint">
        <h3>GET /font/info</h3>
        <p>Get font metadata and usage instructions</p>
        <code>https://your-api.com/font/info</code>
    </div>
    
    <div class="endpoint">
        <h3>GET /font/download</h3>
        <p>Download the Quranic Arabic font file</p>
        <code>https://your-api.com/font/download</code>
    </div>
    
    <h2>Rate Limits</h2>
    <ul>
        <li>Main endpoints: 100 requests per 15 minutes</li>
        <li>Font endpoints: 50 requests per 15 minutes</li>
        <li>Documentation: 20 requests per minute</li>
    </ul>
</body>
</html>
  `;
  
  res.send(docs);
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Quran API v2 running on port ${PORT}`);
  console.log(`Documentation: http://localhost:${PORT}/docs`);
});

module.exports = app;