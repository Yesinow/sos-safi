/**
 * server.js — API minimale pour SOS Safi
 * Endpoints:
 *  - POST /api/login  {username, password} -> {token}
 *  - GET  /api/bins   (auth) -> liste
 *  - POST /api/bins   (auth, agent/admin) -> créer/maj
 *  - GET  /api/black  (auth)
 *  - POST /api/black  (auth)
 *  - POST /api/photos (auth, multipart) -> upload image
 *  - GET  /api/photos/:id (auth) -> image
 *
 * NB: à utiliser uniquement si vous avez besoin de synchro multi-appareils en temps réel.
 */
import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit:'5mb' }));

const upload = multer({ dest: UPLOAD_DIR });

let db;
async function initDB(){
  db = await open({ filename: process.env.DB_FILE || './data.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT);
    CREATE TABLE IF NOT EXISTS bins (id TEXT PRIMARY KEY, lat REAL, lng REAL, full INTEGER, updatedAt INTEGER);
    CREATE TABLE IF NOT EXISTS blackspots (id TEXT PRIMARY KEY, lat REAL, lng REAL, note TEXT, open INTEGER, createdAt INTEGER);
    CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, type TEXT, refId TEXT, path TEXT, note TEXT, createdAt INTEGER);
  `);
  // dev seed user
  await db.run(`INSERT OR IGNORE INTO users(username,password,role) VALUES('admin','admin','admin'),('agent','agent','agent')`);
}
function auth(req,res,next){
  const hdr = req.headers.authorization||'';
  const token = hdr.startsWith('Bearer ')?hdr.slice(7):null;
  if(!token) return res.status(401).json({error:'no token'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }catch(e){ return res.status(401).json({error:'bad token'}); }
}
function sign(u){ return jwt.sign({ id:u.id, username:u.username, role:u.role }, JWT_SECRET, { expiresIn:'7d' }); }

app.post('/api/login', async (req,res)=>{
  const { username, password } = req.body||{};
  const u = await db.get('SELECT * FROM users WHERE username=? AND password=?', username, password);
  if(!u) return res.status(401).json({ error:'bad credentials' });
  res.json({ token: sign(u), role:u.role });
});

app.get('/api/bins', auth, async (req,res)=>{
  const rows = await db.all('SELECT * FROM bins');
  res.json(rows);
});
app.post('/api/bins', auth, async (req,res)=>{
  const b = req.body;
  await db.run('INSERT INTO bins(id,lat,lng,full,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,full=excluded.full,updatedAt=excluded.updatedAt',
    b.id, b.lat, b.lng, b.full?1:0, b.updatedAt||Date.now());
  res.json({ ok:true });
});

app.get('/api/black', auth, async (req,res)=>{
  res.json(await db.all('SELECT * FROM blackspots'));
});
app.post('/api/black', auth, async (req,res)=>{
  const s = req.body;
  await db.run('INSERT INTO blackspots(id,lat,lng,note,open,createdAt) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,note=excluded.note,open=excluded.open,createdAt=excluded.createdAt',
    s.id, s.lat, s.lng, s.note||'', s.open?1:0, s.createdAt||Date.now());
  res.json({ ok:true });
});

app.post('/api/photos', auth, upload.single('photo'), async (req,res)=>{
  const { type, refId, note='' } = req.body;
  const id = 'P-'+Math.random().toString(36).slice(2,10);
  const rel = path.relative('.', req.file.path);
  await db.run('INSERT INTO photos(id,type,refId,path,note,createdAt) VALUES(?,?,?,?,?,?)', id, type, refId, rel, note, Date.now());
  res.json({ id });
});
app.get('/api/photos/:id', auth, async (req,res)=>{
  const row = await db.get('SELECT * FROM photos WHERE id=?', req.params.id);
  if(!row) return res.status(404).end();
  res.sendFile(path.resolve(row.path));
});

const PORT = process.env.PORT || 3000;
initDB().then(()=>{
  app.listen(PORT, ()=>console.log('API SOS Safi on http://localhost:'+PORT));
});
