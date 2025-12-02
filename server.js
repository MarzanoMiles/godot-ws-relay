// server.js — minimal WebSocket relay for Godot HTML5 clients
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log('WebSocket relay listening on port', PORT);

let rooms = {}; // roomId -> { clients: Set(ws), host: ws }

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

function createRoom(ws, name) {
  const roomId = Math.random().toString(36).substr(2, 8);
  ws._roomId = roomId;
  ws._name = name || "host";
  ws._peerId = Date.now() + Math.floor(Math.random() * 1000);
  rooms[roomId] = { clients: new Set([ws]), host: ws };
  send(ws, { type: 'host_ok', room: roomId });
  console.log(`Room ${roomId} created by ${ws._name}`);
}

function joinAnyRoom(ws, name) {
  const roomIds = Object.keys(rooms);
  if (roomIds.length === 0) {
    send(ws, { type: 'join_failed', reason: 'no_room' });
    return;
  }
  const target = roomIds[0];
  ws._roomId = target;
  ws._name = name || "player";
  ws._peerId = Date.now() + Math.floor(Math.random() * 1000);
  rooms[target].clients.add(ws);
  send(ws, { type: 'join_ok', room: target });
  console.log(`${ws._name} joined ${target}`);
  const joinNotice = { type: 'room_message', data: { type: 'host_joined', peer_id: ws._peerId, name: ws._name } };
  rooms[target].clients.forEach(c => { if (c !== ws) send(c, joinNotice); });
}

wss.on('connection', function connection(ws) {
  ws._roomId = null;
  ws._name = 'anon';
  ws._peerId = null;

  ws.on('message', function incoming(data) {
    let parsed;
    try { parsed = JSON.parse(data.toString()); } catch (e) { console.log('Invalid JSON:', data.toString()); return; }

    if (parsed.type === 'host') { createRoom(ws, parsed.name); return; }
    if (parsed.type === 'join') {
      if (parsed.room && rooms[parsed.room]) {
        ws._roomId = parsed.room;
        ws._name = parsed.name || "player";
        ws._peerId = Date.now() + Math.floor(Math.random() * 1000);
        rooms[parsed.room].clients.add(ws);
        send(ws, { type: 'join_ok', room: parsed.room });
        const joinNotice = { type: 'room_message', data: { type: 'host_joined', peer_id: ws._peerId, name: ws._name } };
        rooms[parsed.room].clients.forEach(c => { if (c !== ws) send(c, joinNotice); });
        console.log(`${ws._name} joined existing room ${parsed.room}`);
      } else { joinAnyRoom(ws, parsed.name); }
      return;
    }

    if (parsed.type === 'room_message') {
      const roomId = ws._roomId;
      if (!roomId || !rooms[roomId]) return;
      const inner = parsed.data || {};
      inner._from = ws._peerId;
      rooms[roomId].clients.forEach(c => { if (c !== ws) send(c, { type: 'room_message', data: inner }); });
      return;
    }

    if (parsed.type === 'leave') {
      const roomId = ws._roomId;
      if (roomId && rooms[roomId]) {
        rooms[roomId].clients.delete(ws);
        if (rooms[roomId].clients.size === 0) delete rooms[roomId];
      }
      ws._roomId = null;
      return;
    }

    console.log('Unknown message type:', parsed.type);
  });

  ws.on('close', function () {
    const roomId = ws._roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].clients.delete(ws);
      if (rooms[roomId].clients.size === 0) delete rooms[roomId];
    }
  });
});
