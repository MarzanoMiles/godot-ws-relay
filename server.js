// server.js — WebSocket relay with landing page
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

console.log('=== WebSocket Relay Server Starting ===');

let rooms = {};

// Create HTTP server with landing page
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: Object.keys(rooms).length,
      clients: Array.from(rooms.values()).reduce((sum, room) => sum + room.clients.size, 0),
      uptime: Math.floor(process.uptime())
    }));
    return;
  }
  
  // Landing page
  if (req.url === '/' || req.url === '') {
    const roomCount = Object.keys(rooms).length;
    const clientCount = Array.from(rooms.values()).reduce((sum, room) => sum + room.clients.size, 0);
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Godot WebSocket Relay</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            max-width: 600px;
            width: 100%;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          }
          h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-align: center;
          }
          .status {
            text-align: center;
            font-size: 1.2em;
            color: #4ecca3;
            margin-bottom: 30px;
            font-weight: bold;
          }
          .stats {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            padding: 20px;
            margin: 20px 0;
          }
          .stat-item {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          }
          .stat-item:last-child { border-bottom: none; }
          .stat-label { opacity: 0.8; }
          .stat-value { font-weight: bold; color: #4ecca3; }
          .endpoint {
            background: rgba(0, 0, 0, 0.3);
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            font-family: 'Courier New', monospace;
            word-break: break-all;
            text-align: center;
            font-size: 0.9em;
          }
          .test-button {
            width: 100%;
            background: #4ecca3;
            color: #1a1a2e;
            border: none;
            padding: 15px;
            border-radius: 10px;
            font-size: 1.1em;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
            margin-top: 20px;
          }
          .test-button:hover {
            background: #45b393;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(78, 204, 163, 0.4);
          }
          .test-button:active {
            transform: translateY(0);
          }
          #testResult {
            margin-top: 20px;
            padding: 15px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 10px;
            display: none;
            max-height: 300px;
            overflow-y: auto;
          }
          .result-line {
            padding: 5px 0;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
          }
          .success { color: #4ecca3; }
          .error { color: #ff6b6b; }
          .info { color: #ffd93d; }
          .footer {
            text-align: center;
            margin-top: 30px;
            opacity: 0.7;
            font-size: 0.9em;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎮 Godot Relay</h1>
          <div class="status">✅ Server Online</div>
          
          <div class="stats">
            <div class="stat-item">
              <span class="stat-label">Active Rooms</span>
              <span class="stat-value" id="roomCount">${roomCount}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Connected Clients</span>
              <span class="stat-value" id="clientCount">${clientCount}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Server Uptime</span>
              <span class="stat-value" id="uptime">${Math.floor(process.uptime())}s</span>
            </div>
          </div>
          
          <h3 style="margin-top: 30px; margin-bottom: 10px;">WebSocket Endpoint</h3>
          <div class="endpoint">wss://${req.headers.host}</div>
          
          <button class="test-button" onclick="testConnection()">
            🔌 Test Connection
          </button>
          
          <div id="testResult"></div>
          
          <div class="footer">
            Godot WebSocket Relay Server<br>
            <small>Built for multiplayer game connections</small>
          </div>
        </div>
        
        <script>
          // Auto-refresh stats every 5 seconds
          setInterval(async () => {
            try {
              const response = await fetch('/health');
              const data = await response.json();
              document.getElementById('roomCount').textContent = data.rooms;
              document.getElementById('clientCount').textContent = data.clients;
              document.getElementById('uptime').textContent = data.uptime + 's';
            } catch (e) {
              console.error('Failed to refresh stats:', e);
            }
          }, 5000);
          
          function addResult(message, className = '') {
            const result = document.getElementById('testResult');
            const line = document.createElement('div');
            line.className = 'result-line ' + className;
            line.textContent = message;
            result.appendChild(line);
            result.scrollTop = result.scrollHeight;
          }
          
          function testConnection() {
            const result = document.getElementById('testResult');
            result.style.display = 'block';
            result.innerHTML = '';
            
            addResult('🔄 Connecting to WebSocket server...', 'info');
            
            const ws = new WebSocket('wss://${req.headers.host}');
            let connected = false;
            
            const timeout = setTimeout(() => {
              if (!connected) {
                addResult('❌ Connection timeout (10s)', 'error');
                ws.close();
              }
            }, 10000);
            
            ws.onopen = function() {
              connected = true;
              clearTimeout(timeout);
              addResult('✅ Connected successfully!', 'success');
              addResult('📤 Sending test message...', 'info');
              
              ws.send(JSON.stringify({ 
                type: 'host', 
                name: 'WebTester' 
              }));
            };
            
            ws.onmessage = function(event) {
              addResult('📥 Received: ' + event.data, 'success');
              
              try {
                const data = JSON.parse(event.data);
                if (data.type === 'host_ok') {
                  addResult('🎉 Room created successfully!', 'success');
                  addResult('🔑 Room code: ' + data.room, 'success');
                  addResult('✅ Test completed - server is working!', 'success');
                  setTimeout(() => ws.close(), 1000);
                }
              } catch (e) {
                addResult('⚠️ Could not parse response', 'error');
              }
            };
            
            ws.onerror = function(error) {
              addResult('❌ WebSocket error occurred', 'error');
              console.error('WebSocket error:', error);
            };
            
            ws.onclose = function(event) {
              if (event.wasClean) {
                addResult('🔌 Connection closed cleanly', 'info');
              } else {
                addResult('❌ Connection closed unexpectedly', 'error');
                addResult('   Code: ' + event.code, 'error');
              }
            };
          }
        </script>
      </body>
      </html>
    `);
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// WebSocket server
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false,
  clientTracking: true
});

function send(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(obj));
    return true;
  } catch (e) {
    console.error('Send error:', e.message);
    return false;
  }
}

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function createRoom(ws, name, customRoomId = null) {
  // Use custom room ID if provided, otherwise generate random
  let roomId = customRoomId;
  
  if (customRoomId) {
    // Validate custom room code
    if (!/^[A-Z0-9]{4,8}$/.test(customRoomId)) {
      send(ws, { type: 'join_failed', reason: 'invalid_code' });
      console.log(`✗ Invalid room code format: ${customRoomId}`);
      return;
    }
    
    // Check if room already exists
    if (rooms[customRoomId]) {
      send(ws, { type: 'join_failed', reason: 'room_exists' });
      console.log(`✗ Room ${customRoomId} already exists`);
      return;
    }
  } else {
    roomId = generateRoomId();
  }
  
  ws._roomId = roomId;
  ws._name = name || "Host";
  ws._peerId = Date.now() + Math.floor(Math.random() * 10000);
  
  rooms[roomId] = { 
    clients: new Set([ws]), 
    host: ws,
    created: Date.now()
  };
  
  send(ws, { type: 'host_ok', room: roomId });
  console.log(`✓ Room ${roomId} created by ${ws._name}`);
}

function joinRoom(ws, roomId, name) {
  if (!rooms[roomId]) {
    send(ws, { type: 'join_failed', reason: 'no_room' });
    return false;
  }
  
  if (rooms[roomId].clients.size >= 2) {
    send(ws, { type: 'join_failed', reason: 'room_full' });
    return false;
  }
  
  ws._roomId = roomId;
  ws._name = name || "Player";
  ws._peerId = Date.now() + Math.floor(Math.random() * 10000);
  
  rooms[roomId].clients.add(ws);
  send(ws, { type: 'join_ok', room: roomId });
  
  console.log(`✓ ${ws._name} joined ${roomId}`);
  
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
  if (!rooms[roomId]) return;
  
  const wrapper = { type: 'room_message', data: message };
  
  rooms[roomId].clients.forEach(c => {
    if (c !== senderWs && c.readyState === WebSocket.OPEN) {
      send(c, wrapper);
    }
  });
}

function cleanupClient(ws) {
  const roomId = ws._roomId;
  
  if (roomId && rooms[roomId]) {
    rooms[roomId].clients.delete(ws);
    
    if (rooms[roomId].clients.size === 0) {
      delete rooms[roomId];
      console.log(`🗑️  Room ${roomId} deleted`);
    } else {
      console.log(`👋 ${ws._name} left ${roomId}`);
    }
  }
}

wss.on('connection', function(ws) {
  ws._roomId = null;
  ws._name = 'Anonymous';
  ws._peerId = null;
  
  console.log('🔌 New connection');
  
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  
  ws.on('message', function(data) {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    
    switch (parsed.type) {
      case 'host':
        createRoom(ws, parsed.name, parsed.room);
        break;
      case 'join':
        const roomCode = parsed.room;
        if (roomCode && rooms[roomCode]) {
          joinRoom(ws, roomCode, parsed.name);
        } else if (!roomCode) {
          const available = Object.keys(rooms).filter(
            rid => rooms[rid].clients.size < 2
          );
          if (available.length > 0) {
            joinRoom(ws, available[0], parsed.name);
          } else {
            send(ws, { type: 'join_failed', reason: 'no_room' });
          }
        } else {
          send(ws, { type: 'join_failed', reason: 'no_room' });
        }
        break;
      case 'room_message':
        const roomId = ws._roomId;
        if (roomId && rooms[roomId]) {
          const inner = parsed.data || {};
          inner._from = ws._peerId;
          broadcastToRoom(roomId, ws, inner);
        }
        break;
      case 'leave':
        cleanupClient(ws);
        break;
    }
  });
  
  ws.on('close', () => {
    console.log(`🔌 Closed: ${ws._name}`);
    cleanupClient(ws);
  });
  
  ws.on('error', (error) => {
    console.error('Socket error:', error.message);
    cleanupClient(ws);
  });
});

// Heartbeat
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      cleanupClient(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Cleanup old rooms
const cleanup = setInterval(() => {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  
  for (const [roomId, room] of Object.entries(rooms)) {
    if (now - room.created > twoHours) {
      console.log(`🧹 Cleaning room ${roomId}`);
      room.clients.forEach(ws => ws.close());
      delete rooms[roomId];
    }
  }
}, 30 * 60 * 1000);

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  clearInterval(heartbeat);
  clearInterval(cleanup);
  wss.clients.forEach(ws => ws.close());
  server.close(() => process.exit(0));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server listening on port ${PORT}`);
  console.log(`✓ WebSocket: wss://your-domain.up.railway.app`);
  console.log(`✓ Health: https://your-domain.up.railway.app/health`);
});
