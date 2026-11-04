const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// 정적 파일 (클라이언트)
app.use(express.static(path.join(__dirname, 'public')));

// 루트 경로에서 index.html 명시적으로 제공
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 플레이어 상태 저장
const players = {};

io.on('connection', (socket) => {
  console.log('접속:', socket.id);

  // 새 플레이어 등록
  players[socket.id] = {
    id: socket.id,
    name: 'Player',
    x: 0,
    y: 0,
    z: 0,
    color: Math.floor(Math.random() * 0xffffff)
  };

  // 현재 플레이어 목록 전송
  socket.emit('currentPlayers', players);
  // 다른 사람들에게 새 플레이어 알림
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // 위치 업데이트
  socket.on('playerMove', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        x: data.x,
        y: data.y,
        z: data.z
      });
    }
  });

  // 이름 변경
  socket.on('updateName', (name) => {
    if (players[socket.id]) {
      players[socket.id].name = name || 'Player';
      io.emit('playerUpdated', players[socket.id]);
    }
  });

  // 색상 변경
  socket.on('updateColor', (color) => {
    if (players[socket.id]) {
      players[socket.id].color = color;
      io.emit('playerUpdated', players[socket.id]);
    }
  });

  // 접속 종료
  socket.on('disconnect', () => {
    console.log('퇴장:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행: ${PORT}`);
});