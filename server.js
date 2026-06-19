const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// Ensure data and uploads directories exist
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'products.json');
const ADMIN_PASSWORD = 'ropita2024'; // Cambiar por tu contraseña

// Initialize DB
function getDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ products: [] }));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'No autorizado' });
}

// --- PUBLIC API ---

// Get all available products
app.get('/api/products', (req, res) => {
  const db = getDB();
  const products = db.products.filter(p => !p.sold);
  res.json(products);
});

// --- ADMIN API ---

// Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Contraseña incorrecta' });
  }
});

// Get all products (including sold)
app.get('/api/admin/products', requireAuth, (req, res) => {
  const db = getDB();
  res.json(db.products);
});

// Add product
app.post('/api/admin/products', requireAuth, upload.array('images', 5), (req, res) => {
  const { name, category, price, description, size } = req.body;
  if (!name || !category || !price) {
    return res.status(400).json({ error: 'Nombre, categoría y precio son requeridos' });
  }

  const images = req.files ? req.files.map(f => '/uploads/' + f.filename) : [];

  const product = {
    id: uuidv4(),
    name,
    category,
    price: parseFloat(price),
    description: description || '',
    size: size || '',
    images,
    sold: false,
    createdAt: new Date().toISOString()
  };

  const db = getDB();
  db.products.unshift(product);
  saveDB(db);

  res.json(product);
});

// Update product
app.put('/api/admin/products/:id', requireAuth, upload.array('newImages', 5), (req, res) => {
  const db = getDB();
  const idx = db.products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });

  const { name, category, price, description, size, sold, keepImages } = req.body;
  const product = db.products[idx];

  if (name) product.name = name;
  if (category) product.category = category;
  if (price) product.price = parseFloat(price);
  if (description !== undefined) product.description = description;
  if (size !== undefined) product.size = size;
  if (sold !== undefined) product.sold = sold === 'true';

  // Add new images
  if (req.files && req.files.length > 0) {
    const newImages = req.files.map(f => '/uploads/' + f.filename);
    product.images = [...product.images, ...newImages];
  }

  // Remove images if requested
  if (keepImages) {
    const keep = JSON.parse(keepImages);
    // Delete files that are removed
    product.images.forEach(img => {
      if (!keep.includes(img)) {
        const filePath = path.join(__dirname, 'public', img);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    });
    product.images = keep;
  }

  db.products[idx] = product;
  saveDB(db);
  res.json(product);
});

// Delete product
app.delete('/api/admin/products/:id', requireAuth, (req, res) => {
  const db = getDB();
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  // Delete image files
  product.images.forEach(img => {
    const filePath = path.join(__dirname, 'public', img);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  db.products = db.products.filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Panel de admin: http://localhost:${PORT}/admin.html`);
  console.log(`Contraseña admin: ${ADMIN_PASSWORD}`);
});
