const express = require('express');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Defensive init: if env vars are missing the function still starts
// (login works, but DB calls will return a config error)
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ropita2024';

// Memory storage: no disk writes (required for Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Solo imágenes')),
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files in local dev (Vercel serves public/ via CDN automatically)
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
}

// ---- Helpers ----

function uploadBuffer(buffer) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: 'vitrina', resource_type: 'image' }, (err, result) =>
        err ? reject(err) : resolve(result.secure_url)
      )
      .end(buffer);
  });
}

function cloudinaryPublicId(url) {
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
  return m ? m[1] : null;
}

function deleteImage(url) {
  const pid = cloudinaryPublicId(url);
  return pid ? cloudinary.uploader.destroy(pid) : Promise.resolve();
}

function requireAuth(req, res, next) {
  if (req.headers['x-admin-token'] === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'No autorizado' });
}

function requireDB(req, res, next) {
  if (!supabase) return res.status(503).json({ error: 'Base de datos no configurada. Verificá las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_KEY en Vercel.' });
  next();
}

// ---- Public API ----

app.get('/api/products', requireDB, async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('sold', false)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---- Admin API ----

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ token: ADMIN_PASSWORD });
  else res.status(401).json({ error: 'Contraseña incorrecta' });
});

app.get('/api/admin/products', requireAuth, requireDB, async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/products', requireAuth, requireDB, upload.array('images', 5), async (req, res) => {
  const { name, category, price, description, size } = req.body;
  if (!name || !category || !price)
    return res.status(400).json({ error: 'Nombre, categoría y precio son requeridos' });

  const images = await Promise.all((req.files || []).map(f => uploadBuffer(f.buffer)));

  const { data, error } = await supabase
    .from('products')
    .insert([{
      name,
      category,
      price: parseFloat(price),
      description: description || '',
      size: size || '',
      images,
      sold: false,
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/admin/products/:id', requireAuth, requireDB, upload.array('newImages', 5), async (req, res) => {
  const { data: current, error: fetchErr } = await supabase
    .from('products').select('*').eq('id', req.params.id).single();
  if (fetchErr || !current) return res.status(404).json({ error: 'No encontrado' });

  // Handle image deletions
  let images = current.images;
  if (req.body.keepImages !== undefined) {
    const keep = JSON.parse(req.body.keepImages);
    await Promise.all(current.images.filter(img => !keep.includes(img)).map(deleteImage));
    images = keep;
  }

  // Upload new images
  if (req.files?.length) {
    const newUrls = await Promise.all(req.files.map(f => uploadBuffer(f.buffer)));
    images = [...images, ...newUrls];
  }

  const update = { images };
  const { name, category, price, description, size, sold } = req.body;
  if (name)        update.name        = name;
  if (category)    update.category    = category;
  if (price)       update.price       = parseFloat(price);
  if (description !== undefined) update.description = description;
  if (size        !== undefined) update.size        = size;
  if (sold        !== undefined) update.sold        = sold === 'true';

  const { data, error } = await supabase
    .from('products').update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/admin/products/:id', requireAuth, requireDB, async (req, res) => {
  const { data: product } = await supabase
    .from('products').select('images').eq('id', req.params.id).single();
  if (product?.images) await Promise.all(product.images.map(deleteImage));

  const { error } = await supabase.from('products').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Local dev server
if (require.main === module) {
  app.listen(3000, () => {
    console.log('Servidor: http://localhost:3000');
    console.log('Admin:    http://localhost:3000/admin.html');
  });
}

module.exports = app;
