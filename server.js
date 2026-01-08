// server.js — Railway-optimized WebSocket relay for Godot HTML5
const WebSocket = require('ws');
const http = require('http');

// Railway sets PORT environment variable
const PORT = process.env.PORT || 8080;

console.log('=== WebSocket Relay Server Starting ===');
console.log('Port:', PORT);
console.log('Environment:', process.env.NODE_ENV || 'development');

// Create HTTP server first (required for Railway)
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: Object.keys(rooms).length,
      clients: Array.from(rooms.values()).reduce((sum, room) => sum + room.clients.size, 0),
      uptime: process.uptime()
    }));
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('WebSocket relay server');
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ 
  server,
  // Railway-specific settings
  perMessageDeflate: false,
  clientTracking: true,
  maxPayload: 100 * 1024 * 1024 // 100MB
});

let rooms = {};

// Utility functions
function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch (e) {
    console.error('❌ Send error:', e.message);
    return false;
  }
}

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function createRoom(ws, name) {
  const roomId = generateRoomId();
  ws._roomId = roomId;
  ws._name = name || "Host";
  ws._peerId = Date.now() + Math.floor(Math.random() * 10000);
  ws._lastPing = Date.now();
  
  rooms[roomId] = { 
    clients: new Set([ws]), 
    host: ws,
    created: Date.now()
  };
  
  send(ws, { type: 'host_ok', room: roomId });
  console.log(`✓ Room ${roomId} created by ${ws._name} (ID: ${ws._peerId})`);
}

function joinRoom(ws, roomId, name) {
  if (!rooms[roomId]) {
    send(ws, { type: 'join_failed', reason: 'no_room' });
    console.log(`✗ Join failed - room ${roomId} not found`);
    return false;
  }
  
  // Check room capacity (max 2 players for this game)
  if (rooms[roomId].clients.size >= 2) {
    send(ws, { type: 'join_failed', reason: 'room_full' });
    console.log(`✗ Join failed - room ${roomId} is full`);
    return false;
  }
  
  ws._roomId = roomId;
  ws._name = name || "Player";
  ws._peerId = Date.now() + Math.floor(Math.random() * 10000);
  ws._lastPing = Date.now();
  
  rooms[roomId].clients.add(ws);
  send(ws, { type: 'join_ok', room: roomId });
  
  console.log(`✓ ${ws._name} (ID: ${ws._peerId}) joined room ${roomId}`);
  
  // Notify existing clients
  const joinNotice = {
    type: 'room_message',
    data: {
      type: 'host_joined',
      peer_id: ws._peerId,
      name: ws._name
    }
  };
  
  rooms[roomId].clients.forEach(c => {
    if (c !== ws && c.readyState === WebSocket.OPEN) {
      send(c, joinNotice);
    }
  });
  
  return true;
}

function broadcastToRoom(roomId, senderWs, message) {
  if (!rooms[roomId]) {
    return;
  }
  
  const wrapper = {
    type: 'room_message',
    data: message
  };
  
  let sentCount = 0;
  rooms[roomId].clients.forEach(c => {
    if (c !== senderWs && c.readyState === WebSocket.OPEN) {
      if (send(c, wrapper)) {
        sentCount++;
      }
    }
  });
  
  if (sentCount > 0) {
    console.log(`📤 ${message.type || 'message'} → ${sentCount} client(s) in ${roomId}`);
  }
}

function cleanupClient(ws) {
  const roomId = ws._roomId;
  const name = ws._name || 'Unknown';
  
  if (roomId && rooms[roomId]) {
    rooms[roomId].clients.delete(ws);
    
    // Notify remaining clients
    const leaveNotice = {
      type: 'room_message',
      data: {
        type: 'player_left',
        peer_id: ws._peerId,
        name: ws._name
      }
    };
    
    rooms[roomId].clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) {
        send(c, leaveNotice);
      }
    });
    
    if (rooms[roomId].clients.size === 0) {
      delete rooms[roomId];
      console.log(`🗑️  Room ${roomId} deleted (empty)`);
    } else {
      console.log(`👋 ${name} left room ${roomId} (${rooms[roomId].clients.size} remaining)`);
    }
  }
  
  ws._roomId = null;
}

// WebSocket connection handler
wss.on('connection', function connection(ws, req) {
  ws._roomId = null;
  ws._name = 'Anonymous';
  ws._peerId = null;
  ws._lastPing = Date.now();
  
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log('🔌 New connection from', clientIp);
  
  // Set up ping/pong for keep-alive (Railway requirement)
  ws.isAlive = true;
  ws.on('pong', function() {
    this.isAlive = true;
    this._lastPing = Date.now();
  });
  
  ws.on('message', function incoming(data) {
    let parsed;
    try {
      const text = data.toString();
      parsed = JSON.parse(text);
    } catch (e) {
      console.log('❌ Invalid JSON');
      return;
    }
    
    const msgType = parsed.type;
    
    switch (msgType) {
      case 'host':
        createRoom(ws, parsed.name);
        break;
        
      case 'join':
        const roomCode = parsed.room;
        if (roomCode && rooms[roomCode]) {
          joinRoom(ws, roomCode, parsed.name);
        } else if (!roomCode) {
          // Auto-join first available room
          const availableRooms = Object.keys(rooms).filter(
            rid => rooms[rid].clients.size < 2
          );
          if (availableRooms.length > 0) {
            joinRoom(ws, availableRooms[0], parsed.name);
          } else {
            send(ws, { type: 'join_failed', reason: 'no_room' });
          }
        } else {
          send(ws, { type: 'join_failed', reason: 'no_room' });
        }
        break;
        
      case 'room_message':
        const roomId = ws._roomId;
        if (!roomId || !rooms[roomId]) {
          return;
        }
        
        const inner = parsed.data || {};
        inner._from = ws._peerId;
        
        broadcastToRoom(roomId, ws, inner);
        break;
        
      case 'leave':
        cleanupClient(ws);
        break;
        
      case 'ping':
        ws._lastPing = Date.now();
        send(ws, { type: 'pong' });
        break;
        
      default:
        console.log('⚠️  Unknown type:', msgType);
    }
  });
  
  ws.on('close', function () {
    console.log(`🔌 Closed: ${ws._name}`);
    cleanupClient(ws);
  });
  
  ws.on('error', function (error) {
    console.error('❌ Socket error:', error.message);
    cleanupClient(ws);
  });
});

// Heartbeat interval to detect dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      console.log('💀 Terminating inactive connection:', ws._name);
      cleanupClient(ws);
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // Every 30 seconds

// Cleanup old rooms (over 2 hours old)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  
  for (const [roomId, room] of Object.entries(rooms)) {
    const age = now - room.created;
    if (age > twoHours) {
      console.log(`🧹 Cleaning old room ${roomId}`);
      room.clients.forEach(ws => {
        send(ws, { type: 'room_closed', reason: 'timeout' });
        ws.close();
      });
      delete rooms[roomId];
    }
  }
}, 30 * 60 * 1000); // Every 30 minutes

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, closing server...');
  clearInterval(heartbeatInterval);
  clearInterval(cleanupInterval);
  
  wss.clients.forEach(ws => {
    send(ws, { type: 'server_shutdown' });
    ws.close();
  });
  
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log('✓ Server listening on port', PORT);
  console.log('✓ WebSocket endpoint: wss://your-domain.up.railway.app');
  console.log('✓ Health check: https://your-domain.up.railway.app/health');
});

// Error handling
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});

wss.on('error', (error) => {
  console.error('❌ WebSocket server error:', error);
});
