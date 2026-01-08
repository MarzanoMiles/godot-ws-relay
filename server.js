// server.js — improved WebSocket relay for Godot HTML5 clients
const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log('=== WebSocket Relay Server Started ===');
console.log('Listening on port:', PORT);

let rooms = {}; // roomId -> { clients: Set(ws), host: ws }

function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) {
    console.log('⚠️  Cannot send - socket not open');
    return false;
  }
  try {
    const json = JSON.stringify(obj);
    ws.send(json);
    return true;
  } catch (e) {
    console.error('❌ Error sending:', e);
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
  
  rooms[roomId] = { 
    clients: new Set([ws]), 
    host: ws,
    created: new Date()
  };
  
  send(ws, { type: 'host_ok', room: roomId });
  console.log(`✓ Room ${roomId} created by ${ws._name} (ID: ${ws._peerId})`);
}

function joinRoom(ws, roomId, name) {
  if (!rooms[roomId]) {
    send(ws, { type: 'join_failed', reason: 'no_room' });
    console.log(`✗ ${name} failed to join ${roomId} - room not found`);
    return false;
  }
  
  ws._roomId = roomId;
  ws._name = name || "Player";
  ws._peerId = Date.now() + Math.floor(Math.random() * 10000);
  
  rooms[roomId].clients.add(ws);
  send(ws, { type: 'join_ok', room: roomId });
  
  console.log(`✓ ${ws._name} (ID: ${ws._peerId}) joined room ${roomId}`);
  
  // Notify existing players
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
    console.log(`⚠️  Cannot broadcast - room ${roomId} not found`);
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
  
  console.log(`📤 Broadcast in ${roomId}: ${message.type} (sent to ${sentCount} clients)`);
}

function cleanupClient(ws) {
  const roomId = ws._roomId;
  const name = ws._name || 'Unknown';
  
  if (roomId && rooms[roomId]) {
    rooms[roomId].clients.delete(ws);
    
    if (rooms[roomId].clients.size === 0) {
      delete rooms[roomId];
      console.log(`🗑️  Room ${roomId} deleted (empty)`);
    } else {
      console.log(`👋 ${name} left room ${roomId} (${rooms[roomId].clients.size} remaining)`);
    }
  }
  
  ws._roomId = null;
}

wss.on('connection', function connection(ws) {
  ws._roomId = null;
  ws._name = 'Anonymous';
  ws._peerId = null;
  
  console.log('🔌 New connection established');
  
  ws.on('message', function incoming(data) {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch (e) {
      console.log('❌ Invalid JSON received:', data.toString());
      return;
    }
    
    const msgType = parsed.type;
    console.log(`📥 Received: ${msgType}`, parsed.name ? `from ${parsed.name}` : '');
    
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
          const roomIds = Object.keys(rooms);
          if (roomIds.length > 0) {
            joinRoom(ws, roomIds[0], parsed.name);
          } else {
            send(ws, { type: 'join_failed', reason: 'no_room' });
            console.log('✗ No rooms available for auto-join');
          }
        } else {
          send(ws, { type: 'join_failed', reason: 'no_room' });
          console.log(`✗ Invalid room code: ${roomCode}`);
        }
        break;
        
      case 'room_message':
        const roomId = ws._roomId;
        if (!roomId || !rooms[roomId]) {
          console.log('⚠️  room_message ignored - client not in a room');
          return;
        }
        
        const inner = parsed.data || {};
        inner._from = ws._peerId;
        
        broadcastToRoom(roomId, ws, inner);
        break;
        
      case 'leave':
        cleanupClient(ws);
        break;
        
      default:
        console.log('⚠️  Unknown message type:', msgType);
    }
  });
  
  ws.on('close', function () {
    console.log(`🔌 Connection closed: ${ws._name}`);
    cleanupClient(ws);
  });
  
  ws.on('error', function (error) {
    console.error('❌ WebSocket error:', error.message);
  });
});

// Periodic room cleanup (remove stale rooms)
setInterval(() => {
  const now = new Date();
  for (const [roomId, room] of Object.entries(rooms)) {
    const age = now - room.created;
    const hourInMs = 60 * 60 * 1000;
    
    if (age > hourInMs) {
      console.log(`🧹 Cleaning up old room ${roomId} (${age / hourInMs} hours old)`);
      delete rooms[roomId];
    }
  }
}, 30 * 60 * 1000); // Every 30 minutes

console.log('✓ Server ready to accept connections');
