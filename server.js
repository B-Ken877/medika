const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { AccessToken } = require('livekit-server-sdk');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);

// ─── Simple JSON File Database ───────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Upload Storage ──────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Resolve per-consultation upload directory.
// Returns the absolute path; creates the directory if it doesn't exist.
// Falls back to UPLOADS_DIR/general when no consultationId is provided.
function getConsultationUploadDir(consultationId) {
  const safeId = (consultationId && /^[a-zA-Z0-9_-]+$/.test(consultationId))
    ? consultationId
    : 'general';
  const dir = path.join(UPLOADS_DIR, safeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // consultationId may come from query string or form body
    const consultationId = req.query.consultationId || req.body?.consultationId;
    cb(null, getConsultationUploadDir(consultationId));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}_${uuidv4().substring(0, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    // Accept any audio/, image/, or video/ MIME type outright.
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      return cb(null, true);
    }
    // For generic types (application/octet-stream, */*, binary/octet-stream),
    // try to guess from the file extension so clients that don't set a proper
    // MIME type can still upload valid media files.
    const ext = path.extname(file.originalname).toLowerCase();
    const extToMime = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.mp4': 'video/mp4', '.3gp': 'video/3gp', '.webm': 'video/webm',
      '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
      '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.weba': 'audio/webm',
      '.amr': 'audio/amr', '.flac': 'audio/flac'
    };
    if (extToMime[ext]) {
      // Override the mimetype with the guessed one so downstream code sees
      // the correct type.
      file.mimetype = extToMime[ext];
      return cb(null, true);
    }
    cb(new Error(`File type not allowed: ${file.mimetype} (${file.originalname})`));
  }
});

// ─── LiveKit Config ──────────────────────────────────────────────────────
const LIVEKIT_URL = 'http://host.docker.internal:7880';
const LIVEKIT_API_KEY = 'medikakey';
const LIVEKIT_API_SECRET = '7GD6FdL2cP9KTmTLkJVUKNj7XfJjWAMS';

function loadData(key) {
  const fp = path.join(DATA_DIR, `${key}.json`);
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return []; }
}

function saveData(key, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

// ─── Specialty Pricing Helper ────────────────────────────────────────────────
const PLATFORM_FEE = 250; // Secret platform fee per consultation

function getSpecialtyPrice(specialtyName) {
  const specialties = loadData('specialties');
  const spec = specialties.find(s => s.name === specialtyName);
  return spec ? spec.price : 750; // Default fallback
}

function getSpecialties() {
  return loadData('specialties');
}

function saveSpecialties(data) {
  saveData('specialties', data);
}


// ─── Static file serving for uploads ─────────────────────────────────────────

app.use('/uploads', express.static(UPLOADS_DIR));

// ─── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });
const userSockets = new Map(); // userId -> Set<ws>

wss.on('connection', (ws) => {
  let userId = null;
  console.log('[WS] New connection');

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === 'auth') {
      userId = data.userId;
      if (!userSockets.has(userId)) userSockets.set(userId, new Set());
      userSockets.get(userId).add(ws);
      console.log(`[WS] User ${userId} authenticated (${userSockets.get(userId).size} socket(s))`);

      // ─── Message catch-up: send unread messages for active consultations ──
      try {
        const consultations = loadData('consultations');
        const messages = loadData('messages');
        const userConsultations = consultations.filter(c => c.patient_id === userId || c.doctor_id === userId);
        const userConsIds = new Set(userConsultations.map(c => c.id));
        const recentMessages = messages.filter(m => userConsIds.has(m.consultation_id));
        // Send only last 50 messages as catch-up
        const last50 = recentMessages.slice(-50);
        if (last50.length > 0) {
          console.log(`[WS] Sending ${last50.length} catch-up messages to ${userId}`);
          for (const m of last50) {
            const catchUpMsg = {
              type: 'message:new',
              id: m.id,
              consultationId: m.consultation_id,
              senderId: m.sender_id,
              senderName: m.sender_name,
              text: m.text || '',
              timestamp: (m.created_at || Math.floor(Date.now() / 1000)) * 1000,
              messageType: m.message_type || 'text',
              fileUrl: m.file_url || null,
              duration: m.duration || null,
              fileSize: m.file_size || null
            };
            ws.send(JSON.stringify(catchUpMsg));
          }
        }
      } catch (err) {
        console.error('[WS] Error during message catch-up:', err.message);
      }
      return;
    }

    if (!userId) return;

    if (data.type === 'message:send') {
      const { consultationId, senderId, senderName, text, messageType, fileUrl, duration, fileSize } = data;
      if (!consultationId) return;
      // Allow empty text for media messages (voice/image/video)
      if (!text && messageType !== 'voice' && messageType !== 'image' && messageType !== 'video') return;

      const consultations = loadData('consultations');
      const consultation = consultations.find(c =>
        c.id === consultationId && (c.patient_id === userId || c.doctor_id === userId)
      );
      if (!consultation) {
        console.log(`[MSG] REJECTED: user ${userId} not in consultation ${consultationId}`);
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized for this consultation' }));
        return;
      }

      console.log(`[MSG] From ${senderId} (${senderName}) in ${consultationId}, type=${messageType || 'text'}`);

      // Save message
      const messages = loadData('messages');
      const newMsg = {
        id: messages.length > 0 ? Math.max(...messages.map(m => m.id)) + 1 : 1,
        consultation_id: consultationId,
        sender_id: senderId,
        sender_name: senderName,
        text: text || '',
        created_at: Math.floor(Date.now() / 1000),
        message_type: messageType || 'text',
        file_url: fileUrl || null,
        duration: duration || null,
        file_size: fileSize || null
      };
      messages.push(newMsg);
      saveData('messages', messages);

      const wsMsg = {
        type: 'message:new',
        id: newMsg.id,
        consultationId,
        senderId,
        senderName,
        text: text || '',
        timestamp: Date.now(),
        messageType: messageType || 'text',
        fileUrl: fileUrl || null,
        duration: duration || null,
        fileSize: fileSize || null
      };

      // Echo to sender
      sendToUser(userId, JSON.stringify(wsMsg));

      // Send to recipient
      const recipientId = consultation.patient_id === userId
        ? consultation.doctor_id : consultation.patient_id;
      if (recipientId) {
        const sent = sendToUser(recipientId, JSON.stringify(wsMsg));
        console.log(`[MSG] Delivered to recipient ${recipientId}: ${sent ? 'YES' : 'NO (no open socket)'}`);
      } else {
        console.log(`[MSG] No recipient found for consultation ${consultationId}`);
      }
    }

    if (data.type === 'typing') {
      const { consultationId, isTyping } = data;
      const consultations = loadData('consultations');
      const consultation = consultations.find(c =>
        c.id === consultationId && (c.patient_id === userId || c.doctor_id === userId)
      );
      if (!consultation) return;
      const recipientId = consultation.patient_id === userId
        ? consultation.doctor_id : consultation.patient_id;
      if (recipientId) sendToUser(recipientId, JSON.stringify({
        type: 'typing', consultationId, senderId: userId, isTyping
      }));
    }

    // ─── Call signaling via main WebSocket ─────────────────────
    if (data.type === 'call:start') {
      const { consultationId, callType, roomName, callerName } = data;
      console.log(`[CALL] ${userId} starting ${callType} call in room ${roomName}`);
      const consultations = loadData('consultations');
      const consultation = consultations.find(c => c.id === consultationId);
      if (!consultation) return;
      const recipientId = consultation.patient_id === userId
        ? consultation.doctor_id : consultation.patient_id;
      if (recipientId) {
        sendToUser(recipientId, JSON.stringify({
          type: 'call:incoming',
          from: userId,
          fromName: callerName,
          consultationId,
          callType,
          roomName,
          timestamp: Date.now()
        }));
      }
    }

    if (data.type === 'call:accept') {
      const { consultationId } = data;
      console.log(`[CALL] ${userId} accepted call in ${consultationId}`);
      const consultations = loadData('consultations');
      const consultation = consultations.find(c => c.id === consultationId);
      if (!consultation) return;
      const recipientId = consultation.patient_id === userId
        ? consultation.doctor_id : consultation.patient_id;
      if (recipientId) {
        sendToUser(recipientId, JSON.stringify({
          type: 'call:accepted',
          from: userId,
          consultationId,
          timestamp: Date.now()
        }));
      }
    }

    if (data.type === 'call:reject') {
      const { consultationId } = data;
      console.log(`[CALL] ${userId} rejected call in ${consultationId}`);
      const consultations = loadData('consultations');
      const consultation = consultations.find(c => c.id === consultationId);
      if (!consultation) return;
      const recipientId = consultation.patient_id === userId
        ? consultation.doctor_id : consultation.patient_id;
      if (recipientId) {
        sendToUser(recipientId, JSON.stringify({
          type: 'call:rejected',
          from: userId,
          consultationId,
          timestamp: Date.now()
        }));
      }
    }

    if (data.type === 'call:end') {
      const { consultationId } = data;
      console.log(`[CALL] ${userId} ended call in ${consultationId}`);
      const consultations = loadData('consultations');
      const consultation = consultations.find(c => c.id === consultationId);
      if (!consultation) return;
      const recipientId = consultation.patient_id === userId
        ? consultation.doctor_id : consultation.patient_id;
      if (recipientId) {
        sendToUser(recipientId, JSON.stringify({
          type: 'call:ended',
          from: userId,
          consultationId,
          timestamp: Date.now()
        }));
      }
    }
  });

  ws.on('close', () => {
    if (userId && userSockets.has(userId)) {
      userSockets.get(userId).delete(ws);
      console.log(`[WS] User ${userId} disconnected (${userSockets.get(userId).size} socket(s) remaining)`);
      if (userSockets.get(userId).size === 0) userSockets.delete(userId);
    }
  });

  ws.on('pong', () => { ws.isAlive = true; });
});

// Returns true if at least one socket received the message
function sendToUser(userId, message) {
  const sockets = userSockets.get(userId);
  if (sockets) {
    let sent = false;
    for (const s of sockets) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(message);
        sent = true;
      }
    }
    return sent;
  }
  return false;
}

// Broadcast to all users of a given role
function broadcastToRole(role, message) {
  const users = loadData('users');
  for (const u of users) {
    if (u.role === role) sendToUser(u.id, message);
  }
}

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ─── Express Middleware ───────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  const userId = authHeader.substring(7);
  const users = loadData('users');
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  req.user = { id: user.id, username: user.username, role: user.role, name: user.name };
  next();
}

// ─── File Upload Endpoint ────────────────────────────────────────────────────

app.post('/api/upload', authenticate, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[UPLOAD] Error:', err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 50MB)' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    // Build the public URL. If the file was saved inside a per-consultation
    // subfolder, the URL must include that subfolder so clients can fetch it.
    const consultationId = req.query.consultationId || req.body?.consultationId;
    const safeId = (consultationId && /^[a-zA-Z0-9_-]+$/.test(consultationId))
      ? consultationId
      : null;
    const fileUrl = safeId
      ? `/uploads/${safeId}/${req.file.filename}`
      : `/uploads/${req.file.filename}`;
    console.log(`[UPLOAD] ${req.user.id} uploaded ${req.file.originalname} -> ${fileUrl} (${(req.file.size / 1024).toFixed(1)}KB)`);
    res.json({
      url: fileUrl,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const users = loadData('users');
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const { password_hash, ...safeUser } = user;
  res.json({ token: user.id, user: safeUser });
});

// ─── LiveKit Token Generation ─────────────────────────────────────────────────

app.post('/api/call/token', authenticate, async (req, res) => {
  try {
    const { consultationId, isVideo } = req.body;
    if (!consultationId) return res.status(400).json({ error: 'consultationId required' });

    const consultations = loadData('consultations');
    const consultation = consultations.find(c =>
      c.id === consultationId && (c.patient_id === req.user.id || c.doctor_id === req.user.id)
    );
    if (!consultation) return res.status(403).json({ error: 'Not part of this consultation' });

    const roomName = 'medika_' + consultationId;
    const participantName = req.user.name;

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: req.user.id,
      name: participantName,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    console.log(`[LIVEKIT] Token generated for ${req.user.id} -> room ${roomName}`);
    res.json({
      token,
      url: 'ws://167.86.124.101:7880',
      roomName,
      participantIdentity: req.user.id
    });
  } catch (err) {
    console.error('[LIVEKIT] Token error:', err);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});


// ─── Public: Get Specialty Price (for Android app) ───────────────────────────
app.get('/api/specialties/prices', (req, res) => {
  const specialties = getSpecialties();
  res.json(specialties.map(s => ({ id: s.id, name: s.name, price: s.price })));
});

app.get('/api/specialties/price', (req, res) => {
  const { specialty } = req.query;
  if (!specialty) return res.status(400).json({ error: 'specialty query param required' });
  const price = getSpecialtyPrice(specialty);
  res.json({ specialty, price });
});

// ─── Consultations ────────────────────────────────────────────────────────────

app.post('/api/consultations', authenticate, (req, res) => {
  if (req.user.role !== 'patient') return res.status(403).json({ error: 'Patient only' });
  const { description, specialtyNeeded, urgencyLevel, aiSummary, aiExplanation, doctorId, patientAge } = req.body;
  const id = 'cons_' + uuidv4().substring(0, 8);

  const consultations = loadData('consultations');
  const newCons = {
    id, patient_id: req.user.id, patient_name: req.user.name, patient_age: patientAge || null,
    doctor_id: doctorId || null, description: description || '',
    specialty_needed: specialtyNeeded || 'Medecine Generale', urgency_level: urgencyLevel || 'Moyenne',
    ai_summary: aiSummary || '', ai_explanation: aiExplanation || '',
    status: 'RECHERCHE_MEDECIN', prescription: null,
    created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000)
  };
  consultations.push(newCons);
  saveData('consultations', consultations);

  const newNotif = JSON.stringify({ type: 'consultation:new', id, patientName: req.user.name, description, specialtyNeeded, urgencyLevel });
  sendToUser(req.user.id, newNotif);
  if (doctorId) {
    sendToUser(doctorId, newNotif);
  } else {
    broadcastToRole('doctor', newNotif);
  }

  res.status(201).json(newCons);
});

app.get('/api/consultations', authenticate, (req, res) => {
  const consultations = loadData('consultations');
  let result;
  if (req.user.role === 'patient') {
    result = consultations.filter(c => c.patient_id === req.user.id);
  } else if (req.user.role === 'doctor') {
    result = consultations.filter(c => c.doctor_id === req.user.id || (c.doctor_id === null && c.status === 'RECHERCHE_MEDECIN'));
  } else {
    result = consultations;
  }
  result.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  res.json(result);
});

app.get('/api/consultations/:id', authenticate, (req, res) => {
  const consultations = loadData('consultations');
  const c = consultations.find(x => x.id === req.params.id);
  if (!c) return res.json(null);
  if (req.user.role !== 'admin' && c.patient_id !== req.user.id && c.doctor_id !== req.user.id) {
    return res.json(null);
  }
  res.json(c);
});

app.get('/api/consultations/:id/messages', authenticate, (req, res) => {
  const consultations = loadData('consultations');
  const c = consultations.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && c.patient_id !== req.user.id && c.doctor_id !== req.user.id) {
    return res.status(404).json({ error: 'Not found' });
  }
  const messages = loadData('messages').filter(m => m.consultation_id === req.params.id);
  messages.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  res.json(messages);
});

app.put('/api/consultations/:id/accept', authenticate, (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Doctor only' });
  const consultations = loadData('consultations');
  const c = consultations.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });

  c.doctor_id = req.user.id;
  c.status = 'EN_COURS';
  c.updated_at = Math.floor(Date.now() / 1000);
  saveData('consultations', consultations);

  // Pre-create the per-consultation uploads directory so the patient and
  // doctor can immediately exchange voice/media messages into a shared folder.
  try {
    const dir = getConsultationUploadDir(c.id);
    console.log(`[CONSULTATION] Accepted ${c.id} — uploads dir: ${dir}`);
  } catch (e) {
    console.error(`[CONSULTATION] Failed to create uploads dir for ${c.id}:`, e.message);
  }

  const messages = loadData('messages');
  messages.push({
    id: messages.length > 0 ? Math.max(...messages.map(m => m.id)) + 1 : 1,
    consultation_id: req.params.id, sender_id: 'system',
    sender_name: 'Systeme', text: `Le ${req.user.name} a accepte votre demande. La session de chat est ouverte.`,
    created_at: Math.floor(Date.now() / 1000)
  });
  saveData('messages', messages);

  const acceptNotif = JSON.stringify({ type: 'consultation:updated', ...c });
  sendToUser(c.patient_id, acceptNotif);
  if (c.doctor_id) sendToUser(c.doctor_id, acceptNotif);
  res.json(c);
});

app.put('/api/consultations/:id/reject', authenticate, (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Doctor only' });
  const consultations = loadData('consultations');
  const c = consultations.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });

  c.status = 'REFUSE';
  c.updated_at = Math.floor(Date.now() / 1000);
  saveData('consultations', consultations);

  const rejectNotif = JSON.stringify({ type: 'consultation:updated', ...c });
  sendToUser(c.patient_id, rejectNotif);
  if (c.doctor_id) sendToUser(c.doctor_id, rejectNotif);
  res.json(c);
});

app.put('/api/consultations/:id/prescription', authenticate, (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Doctor only' });
  const { prescription } = req.body;
  if (!prescription) return res.status(400).json({ error: 'Prescription required' });

  const consultations = loadData('consultations');
  const c = consultations.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });

  c.prescription = prescription;
  c.status = 'TERMINE';
  c.updated_at = Math.floor(Date.now() / 1000);
  saveData('consultations', consultations);

  const messages = loadData('messages');
  messages.push({
    id: messages.length > 0 ? Math.max(...messages.map(m => m.id)) + 1 : 1,
    consultation_id: req.params.id, sender_id: 'system',
    sender_name: 'Systeme', text: `Ordonnance redigee par ${req.user.name}. Consultation clôturée.`,
    created_at: Math.floor(Date.now() / 1000)
  });
  saveData('messages', messages);

  const rxNotif = JSON.stringify({ type: 'consultation:updated', ...c });
  sendToUser(c.patient_id, rxNotif);
  if (c.doctor_id) sendToUser(c.doctor_id, rxNotif);
  res.json(c);
});

app.get('/api/profile', authenticate, (req, res) => {
  const users = loadData('users');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password_hash, ...safeUser } = user;
  res.json(safeUser);
});

app.put('/api/profile', authenticate, (req, res) => {
  const { name, email, phone, age, gender } = req.body;
  const users = loadData('users');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (name) user.name = name;
  if (email) user.email = email;
  if (phone) user.phone = phone;
  if (age) user.age = age;
  if (gender) user.gender = gender;
  saveData('users', users);
  const { password_hash, ...safeUser } = user;
  res.json(safeUser);
});

app.put('/api/doctor/availability', authenticate, (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Doctor only' });
  const { isAvailable } = req.body;
  const users = loadData('users');
  const user = users.find(u => u.id === req.user.id);
  if (user) {
    user.is_available = isAvailable ? 1 : 0;
    saveData('users', users);
  }
  res.json({ success: true, isAvailable: !!isAvailable });
});

app.get('/api/doctors', authenticate, (req, res) => {
  const users = loadData('users');
  let doctors = users.filter(u => u.role === 'doctor');

  if (req.query.specialty) {
    doctors = doctors.filter(u => u.specialty === req.query.specialty);
  }

  res.json(doctors.map(u => {
    const { password_hash, ...s } = u; return s;
  }));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Registration (patients only, doctors created by admin) ───────────────────

app.post('/api/auth/register', (req, res) => {
  const { username, password, name, email, phone, age, gender } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, password and name are required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const users = loadData('users');
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const newUser = {
    id: 'patient_' + uuidv4().substring(0, 8),
    username,
    password_hash: bcrypt.hashSync(password, 10),
    role: 'patient',
    name,
    email: email || null,
    phone: phone || null,
    age: age || null,
    gender: gender || 'Homme',
    is_available: 1
  };
  users.push(newUser);
  saveData('users', users);

  const { password_hash, ...safeUser } = newUser;
  res.status(201).json({ token: newUser.id, user: safeUser });
});


// ─── Admin Authentication Middleware ─────────────────────────────────────────

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  const userId = authHeader.substring(7);
  const users = loadData('users');
  const user = users.find(u => u.id === userId && u.role === 'admin');
  if (!user) return res.status(403).json({ error: 'Admin access required' });
  req.user = { id: user.id, username: user.username, role: user.role, name: user.name };
  next();
}

// ─── Admin Auth ──────────────────────────────────────────────────────────────

app.post('/api/admin/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const users = loadData('users');
  const user = users.find(u => u.username === username && u.role === 'admin');
  if (!user) return res.status(401).json({ error: 'Invalid admin credentials' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const { password_hash, ...safeUser } = user;
  res.json({ token: user.id, user: safeUser });
});

// ─── Admin Stats ─────────────────────────────────────────────────────────────

app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const users = loadData('users');
  const consultations = loadData('consultations');
  const messages = loadData('messages');
  const doctors = users.filter(u => u.role === 'doctor');
  const patients = users.filter(u => u.role === 'patient');
  const completedConsultations = consultations.filter(c => c.status === 'TERMINE');
  const activeConsultations = consultations.filter(c => c.status === 'EN_COURS');
  const pendingConsultations = consultations.filter(c => c.status === 'RECHERCHE_MEDECIN');
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Per-specialty pricing with platform fee split
  const calcRevenue = (consList) => {
    let total = 0, doctorTotal = 0, medikaTotal = 0;
    consList.forEach(c => {
      const price = getSpecialtyPrice(c.specialty_needed);
      total += price;
      doctorTotal += price - PLATFORM_FEE;
      medikaTotal += PLATFORM_FEE;
    });
    return { total, doctorTotal, medikaTotal };
  };

  const allRev = calcRevenue(completedConsultations);
  const totalRevenue = allRev.total;
  const totalDoctorEarnings = allRev.doctorTotal;
  const totalMedikaEarnings = allRev.medikaTotal;

  const monthlyCompleted = completedConsultations.filter(c => {
    const d = new Date((c.created_at || 0) * 1000);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });
  const monthRev = calcRevenue(monthlyCompleted);
  const monthlyRevenue = monthRev.total;
  const monthlyDoctorEarnings = monthRev.doctorTotal;
  const monthlyMedikaEarnings = monthRev.medikaTotal;

  const monthNames = ['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];
  const monthlyBreakdown = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - i, 1);
    const m = d.getMonth();
    const y = d.getFullYear();
    const mc = completedConsultations.filter(c => {
      const cd = new Date((c.created_at || 0) * 1000);
      return cd.getMonth() === m && cd.getFullYear() === y;
    });
    const mr = calcRevenue(mc);
    monthlyBreakdown.push({ month: monthNames[m], year: y, count: mc.length, revenue: mr.total, doctorEarnings: mr.doctorTotal, medikaEarnings: mr.medikaTotal });
  }

  const doctorEarnings = doctors.map(doc => {
    const docCompleted = completedConsultations.filter(c => c.doctor_id === doc.id);
    const docMonthly = docCompleted.filter(c => {
      const d = new Date((c.created_at || 0) * 1000);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    const docTotalRev = calcRevenue(docCompleted);
    const docMonthRev = calcRevenue(docMonthly);
    return {
      id: doc.id, name: doc.name, specialty: doc.specialty || 'N/A',
      totalConsultations: docCompleted.length, totalEarnings: docTotalRev.doctorTotal,
      monthlyConsultations: docMonthly.length, monthlyEarnings: docMonthRev.doctorTotal,
      rating: doc.rating || 0
    };
  }).sort((a, b) => b.monthlyEarnings - a.monthlyEarnings);

  res.json({
    totalDoctors: doctors.length, totalPatients: patients.length,
    totalConsultations: consultations.length, completedConsultations: completedConsultations.length,
    activeConsultations: activeConsultations.length, pendingConsultations: pendingConsultations.length,
    totalMessages: messages.length, totalRevenue, monthlyRevenue,
    totalDoctorEarnings, totalMedikaEarnings, monthlyDoctorEarnings, monthlyMedikaEarnings,
    monthlyCompleted: monthlyCompleted.length, monthlyBreakdown, doctorEarnings
  });
});

// ─── Admin: Doctor CRUD ──────────────────────────────────────────────────────

app.get('/api/admin/doctors', authenticateAdmin, (req, res) => {
  const users = loadData('users');
  const consultations = loadData('consultations');
  let doctors = users.filter(u => u.role === 'doctor');

  if (req.query.specialty) doctors = doctors.filter(u => u.specialty === req.query.specialty);
  if (req.query.search) {
    const s = req.query.search.toLowerCase();
    doctors = doctors.filter(u => u.name.toLowerCase().includes(s) || (u.username && u.username.toLowerCase().includes(s)) || (u.email && u.email.toLowerCase().includes(s)));
  }

  doctors = doctors.map(d => {
    const dc = consultations.filter(c => c.doctor_id === d.id);
    const completed = dc.filter(c => c.status === 'TERMINE');
    return { ...d, password_hash: undefined, consultationCount: dc.length, completedCount: completed.length, totalEarnings: completed.reduce((sum, c) => sum + getSpecialtyPrice(c.specialty_needed) - PLATFORM_FEE, 0) };
  }).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  res.json(doctors);
});

app.post('/api/admin/doctors', authenticateAdmin, (req, res) => {
  const { username, password, name, email, phone, age, gender, specialty, licenseNumber, location, hospital, biography, avatarUrl } = req.body;
  if (!username || !password || !name || !specialty) return res.status(400).json({ error: 'Username, password, name, and specialty are required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const users = loadData('users');
  if (users.find(u => u.username === username)) return res.status(409).json({ error: 'Username already taken' });

  const newDoctor = {
    id: 'doctor_' + uuidv4().substring(0, 8), username,
    password_hash: bcrypt.hashSync(password, 10), role: 'doctor', name,
    email: email || null, phone: phone || null, age: age || null,
    gender: gender || 'Homme', specialty, license_number: licenseNumber || null,
    location: location || null, hospital: hospital || null,
    biography: biography || null, avatar_url: avatarUrl || null,
    rating: 5.0, is_available: 1, created_at: Math.floor(Date.now() / 1000)
  };
  users.push(newDoctor);
  saveData('users', users);
  const { password_hash, ...safeDoctor } = newDoctor;
  res.status(201).json(safeDoctor);
});

app.get('/api/admin/doctors/:id', authenticateAdmin, (req, res) => {
  const users = loadData('users');
  const user = users.find(u => u.id === req.params.id && u.role === 'doctor');
  if (!user) return res.status(404).json({ error: 'Doctor not found' });
  const { password_hash, ...safeUser } = user;
  res.json(safeUser);
});

app.put('/api/admin/doctors/:id', authenticateAdmin, (req, res) => {
  const { name, email, phone, age, gender, specialty, licenseNumber, location, hospital, biography, avatarUrl, isAvailable, rating, password } = req.body;
  const users = loadData('users');
  const user = users.find(u => u.id === req.params.id && u.role === 'doctor');
  if (!user) return res.status(404).json({ error: 'Doctor not found' });

  if (name) user.name = name;
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;
  if (age !== undefined) user.age = age;
  if (gender) user.gender = gender;
  if (specialty) user.specialty = specialty;
  if (licenseNumber !== undefined) user.license_number = licenseNumber;
  if (location !== undefined) user.location = location;
  if (hospital !== undefined) user.hospital = hospital;
  if (biography !== undefined) user.biography = biography;
  if (avatarUrl !== undefined) user.avatar_url = avatarUrl;
  if (isAvailable !== undefined) user.is_available = isAvailable ? 1 : 0;
  if (rating !== undefined) user.rating = rating;
  if (password && password.length >= 4) user.password_hash = bcrypt.hashSync(password, 10);

  saveData('users', users);
  const { password_hash, ...safeUser } = user;
  res.json(safeUser);
});

app.delete('/api/admin/doctors/:id', authenticateAdmin, (req, res) => {
  const users = loadData('users');
  const idx = users.findIndex(u => u.id === req.params.id && u.role === 'doctor');
  if (idx === -1) return res.status(404).json({ error: 'Doctor not found' });
  const removed = users.splice(idx, 1)[0];
  saveData('users', users);
  res.json({ success: true, deleted: removed.id, name: removed.name });
});

// ─── Admin: Patient Management ───────────────────────────────────────────────

app.get('/api/admin/patients', authenticateAdmin, (req, res) => {
  const users = loadData('users');
  const consultations = loadData('consultations');
  let patients = users.filter(u => u.role === 'patient');

  if (req.query.search) {
    const s = req.query.search.toLowerCase();
    patients = patients.filter(u => u.name.toLowerCase().includes(s) || (u.username && u.username.toLowerCase().includes(s)) || (u.email && u.email.toLowerCase().includes(s)));
  }

  patients = patients.map(p => {
    const pc = consultations.filter(c => c.patient_id === p.id);
    return { ...p, password_hash: undefined, consultationCount: pc.length };
  }).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  res.json(patients);
});

app.delete('/api/admin/patients/:id', authenticateAdmin, (req, res) => {
  const users = loadData('users');
  const idx = users.findIndex(u => u.id === req.params.id && u.role === 'patient');
  if (idx === -1) return res.status(404).json({ error: 'Patient not found' });
  const removed = users.splice(idx, 1)[0];
  saveData('users', users);
  res.json({ success: true, deleted: removed.id, name: removed.name });
});

// ─── Admin: Consultations ────────────────────────────────────────────────────

app.get('/api/admin/consultations', authenticateAdmin, (req, res) => {
  const consultations = loadData('consultations');
  const users = loadData('users');

  let result = consultations.map(c => {
    const patient = users.find(u => u.id === c.patient_id);
    const doctor = users.find(u => u.id === c.doctor_id);
    return { ...c, patient_email: patient?.email || null, patient_phone: patient?.phone || null,
      doctor_name: doctor?.name || null, doctor_specialty: doctor?.specialty || null };
  });

  if (req.query.status) result = result.filter(c => c.status === req.query.status);
  if (req.query.doctor_id) result = result.filter(c => c.doctor_id === req.query.doctor_id);
  if (req.query.patient_id) result = result.filter(c => c.patient_id === req.query.patient_id);

  result.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  res.json(result);
});

app.get('/api/admin/consultations/:id', authenticateAdmin, (req, res) => {
  const consultations = loadData('consultations');
  const c = consultations.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

app.get('/api/admin/consultations/:id/messages', authenticateAdmin, (req, res) => {
  const messages = loadData('messages').filter(m => m.consultation_id === req.params.id);
  messages.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  res.json(messages);
});

app.delete('/api/admin/consultations/:id', authenticateAdmin, (req, res) => {
  const consultations = loadData('consultations');
  const idx = consultations.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Consultation not found' });
  consultations.splice(idx, 1);
  saveData('consultations', consultations);
  const messages = loadData('messages');
  saveData('messages', messages.filter(m => m.consultation_id !== req.params.id));
  res.json({ success: true });
});

// ─── Admin: Finance ──────────────────────────────────────────────────────────

app.get('/api/admin/finance', authenticateAdmin, (req, res) => {
  const consultations = loadData('consultations');
  const users = loadData('users');
  const completed = consultations.filter(c => c.status === 'TERMINE');
  const now = new Date();
  const cm = now.getMonth(), cy = now.getFullYear();
  const monthlyCompleted = completed.filter(c => {
    const d = new Date((c.created_at || 0) * 1000);
    return d.getMonth() === cm && d.getFullYear() === cy;
  });
  const monthNames = ['Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aou','Sep','Oct','Nov','Dec'];

  // Per-specialty pricing with platform fee split
  const calcFin = (consList) => {
    let total = 0, docTotal = 0, medikaTotal = 0;
    consList.forEach(c => {
      const p = getSpecialtyPrice(c.specialty_needed);
      total += p; docTotal += p - PLATFORM_FEE; medikaTotal += PLATFORM_FEE;
    });
    return { total, doctorEarnings: docTotal, medikaEarnings: medikaTotal };
  };

  const mFin = calcFin(monthlyCompleted);
  const tFin = calcFin(completed);

  const doctors = users.filter(u => u.role === 'doctor');
  const doctorEarnings = doctors.map(doc => {
    const dm = monthlyCompleted.filter(c => c.doctor_id === doc.id);
    const dt = completed.filter(c => c.doctor_id === doc.id);
    const dmFin = calcFin(dm);
    const dtFin = calcFin(dt);
    return { id: doc.id, name: doc.name, specialty: doc.specialty || 'N/A',
      monthlyConsultations: dm.length, monthlyEarnings: dmFin.doctorEarnings,
      totalConsultations: dt.length, totalEarnings: dtFin.doctorEarnings };
  }).sort((a, b) => b.monthlyEarnings - a.monthlyEarnings);

  const history = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(cy, cm - i, 1);
    const m = d.getMonth(), y = d.getFullYear();
    const mc = completed.filter(c => { const cd = new Date((c.created_at || 0) * 1000); return cd.getMonth() === m && cd.getFullYear() === y; });
    const mcFin = calcFin(mc);
    history.push({ month: monthNames[m], year: y, label: `${monthNames[m]} ${y}`, count: mc.length, revenue: mcFin.total, doctorEarnings: mcFin.doctorEarnings, medikaEarnings: mcFin.medikaEarnings });
  }

  const recentTransactions = monthlyCompleted.slice(-20).reverse().map(c => {
    const doctor = users.find(u => u.id === c.doctor_id);
    const p = getSpecialtyPrice(c.specialty_needed);
    return { id: c.id, patientName: c.patient_name, doctorName: doctor?.name || 'N/A',
      specialty: c.specialty_needed || 'N/A', amount: p, doctorEarning: p - PLATFORM_FEE, medikaEarning: PLATFORM_FEE, date: c.created_at };
  });

  res.json({
    currentMonth: { name: monthNames[cm], year: cy, label: `${monthNames[cm]} ${cy}`,
      consultations: monthlyCompleted.length, revenue: mFin.total, doctorEarnings: mFin.doctorEarnings, medikaEarnings: mFin.medikaEarnings },
    total: { consultations: completed.length, revenue: tFin.total, doctorEarnings: tFin.doctorEarnings, medikaEarnings: tFin.medikaEarnings },
    doctorEarnings, history, recentTransactions
  });
});

// ─── Admin: Reset Password ───────────────────────────────────────────────────

app.put('/api/admin/users/:id/reset-password', authenticateAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const users = loadData('users');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.password_hash = bcrypt.hashSync(newPassword, 10);
  saveData('users', users);
  res.json({ success: true, message: `Password reset for ${user.name}` });
});

// ─── Admin: Upload ───────────────────────────────────────────────────────────

app.post('/api/admin/upload', authenticateAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.filename, mimetype: req.file.mimetype, size: req.file.size });
  });
});


// ─── Admin: Specialty Pricing Management ─────────────────────────────────────

app.get('/api/admin/specialties', authenticateAdmin, (req, res) => {
  const specialties = getSpecialties();
  res.json(specialties);
});

app.put('/api/admin/specialties', authenticateAdmin, (req, res) => {
  const { specialties } = req.body;
  if (!Array.isArray(specialties)) return res.status(400).json({ error: 'specialties array required' });

  // Validate and update prices
  const current = getSpecialties();
  const updated = current.map(spec => {
    const incoming = specialties.find(s => s.id === spec.id);
    if (incoming && typeof incoming.price === 'number' && incoming.price > 0) {
      spec.price = incoming.price;
    }
    return spec;
  });
  saveSpecialties(updated);
  res.json({ success: true, count: updated.length });
});

app.put('/api/admin/specialties/:id', authenticateAdmin, (req, res) => {
  const { price } = req.body;
  if (typeof price !== 'number' || price <= 0) return res.status(400).json({ error: 'Valid price required' });

  const specialties = getSpecialties();
  const spec = specialties.find(s => s.id === req.params.id);
  if (!spec) return res.status(404).json({ error: 'Specialty not found' });

  spec.price = price;
  saveSpecialties(specialties);
  res.json({ success: true, specialty: spec });
});

// ─── Seed Data ────────────────────────────────────────────────────────────────

function seedIfEmpty() {
  const users = loadData('users');

  // Always ensure admin user exists
  if (!users.find(u => u.role === 'admin')) {
    const adminPw = bcrypt.hashSync('algebrain', 10);
    users.push({
      id: 'admin_1', username: 'admin', password_hash: adminPw,
      role: 'admin', name: 'Administrateur', email: 'admin@medika.ht', is_available: 1
    });
    saveData('users', users);
    console.log('[DB] Admin user created: admin / algebrain');
  }

  if (users.length > 1) {
    console.log(`[DB] ${users.length} user(s) exist, skipping seed.`);
    return;
  }

  console.log('[DB] Seeding...');
  const pw = bcrypt.hashSync('algebrain', 10);

  saveData('users', [
    ...users,
    {
      id: 'patient_sarah', username: 'patient.sarah', password_hash: pw,
      role: 'patient', name: 'Sarah Joseph', email: 'sarah.joseph@gmail.com',
      phone: '+509 3712-3456', age: 28, gender: 'Femme', is_available: 1
    },
    {
      id: 'doctor_martin', username: 'dr.martin', password_hash: pw,
      role: 'doctor', name: 'Dr. Martin Fils-Aime', email: 'martin.filsaime@medika.ht',
      phone: '+509 3700-0001', age: 45, gender: 'Homme',
      specialty: 'Medecine Generale', license_number: 'MSPP-87241',
      location: 'Port-au-Prince, Haiti', hospital: 'Hopital Universitaire de Port-au-Prince',
      biography: 'Medecin generaliste avec 15 ans d\'experience en Haiti. Specialise en medecine familiale et teleconsultation.',
      avatar_url: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=200',
      rating: 4.9, is_available: 1
    }
  ]);
  console.log('[DB] Seeded! Credentials:');
  console.log('  Admin:   admin         / algebrain');
  console.log('  Patient: patient.sarah / algebrain');
  console.log('  Doctor:  dr.martin     / algebrain');
}

seedIfEmpty();

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=== Medika Backend ===`);
  console.log(`  REST:    http://0.0.0.0:${PORT}/api`);
  console.log(`  WS:      ws://0.0.0.0:${PORT}/ws`);
  console.log(`  Uploads: http://0.0.0.0:${PORT}/uploads`);
  console.log(`  LiveKit: ${LIVEKIT_URL}`);
  console.log(`  Health:  http://0.0.0.0:${PORT}/api/health\n`);
});