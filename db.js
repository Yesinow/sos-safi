
// db.js — petit helper IndexedDB pour photos (offline)
export const DB_NAME = 'sos-safi';
export const DB_VERSION = 1;
let _db;

/** Ouvre la base et crée les stores si besoin */
export function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if(!db.objectStoreNames.contains('photos')){
        const st = db.createObjectStore('photos', { keyPath: 'id' });
        st.createIndex('byRef', 'refKey', { unique: false });
        st.createIndex('byCreated', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
function db(){ if(_db) return _db; throw new Error('DB non ouverte: appelez openDB()'); }
const txr = (store, mode='readonly') => db().transaction(store, mode).objectStore(store);
const q = (req) => new Promise((res,rej)=>{ req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); });

export const createRefKey = (type, refId) => `${type}:${refId}`;

/** Ajoute / met à jour une photo */
export async function putPhoto({ id, blob, type, refId, note='' }){
  if(!_db) await openDB();
  const rec = {
    id: id || ('P-' + Math.random().toString(36).slice(2,10)),
    createdAt: Date.now(),
    type, refId,
    refKey: createRefKey(type, refId),
    note: note || '',
    blob
  };
  await q(txr('photos','readwrite').put(rec));
  return rec.id;
}

export async function getPhoto(id){
  if(!_db) await openDB();
  return await q(txr('photos').get(id));
}
export async function deletePhoto(id){
  if(!_db) await openDB();
  await q(txr('photos','readwrite').delete(id));
}
export async function listPhotosByRef(type, refId){
  if(!_db) await openDB();
  const idx = txr('photos').index('byRef');
  const res = [];
  return new Promise((resolve, reject) => {
    const req = idx.openCursor(IDBKeyRange.only(createRefKey(type, refId)));
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if(cur){ res.push(cur.value); cur.continue(); }
      else resolve(res);
    };
    req.onerror = () => reject(req.error);
  });
}
export async function listAllPhotos(limit=500){
  if(!_db) await openDB();
  const idx = txr('photos').index('byCreated');
  const res = [];
  return new Promise((resolve, reject) => {
    const req = idx.openCursor(null, 'prev'); // plus récentes d'abord
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if(cur && res.length < limit){ res.push(cur.value); cur.continue(); }
      else resolve(res);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Convertit un Blob en dataURL (pour export JSON) */
export function blobToDataURL(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
