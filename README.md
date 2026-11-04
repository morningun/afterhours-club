# AFTERHOURS — 3D Club (multiplayer)

Three.js 기반 단일 HTML 3D 클럽 사이트와, 여러 사람이 같은 공간에서 함께 걷게 해주는
접속 중계 서버입니다. 사이트는 CDN 없이 완전히 자립한 `index.html` 한 파일로 빌드됩니다.

- 사이트: https://morningun.github.io/afterhours-club/
- 중계 서버: https://afterhours-lobby.onrender.com (Render 무료 플랜)

## 폴더

```
src/                 편집하는 소스 (여기만 고치면 됩니다)
  app.src.js         앱 로직 전체 (씬, 캐릭터, 입력, 네트워킹, UI)
  imports.js         three.js / 포스트프로세싱 import
  shell_head.html    <head> + UI 마크업 + CSS
  shell_tail.html    닫는 태그
build.sh             src → index.html 빌드
index.html           빌드 결과물 (직접 고치지 마세요)
server/              접속 중계 WebSocket 서버 (Node + ws)
render.yaml          Render Blueprint 배포 설정
```

## 빌드

```bash
npm install
npm run build          # ./build.sh 와 동일
```

`src/app.src.js` 를 고친 뒤 `npm run build` 를 실행하면 `index.html` 이 갱신됩니다.
`npm run serve` 로 http://localhost:8080 에서 로컬 확인이 가능합니다.

## 서버

```bash
npm start              # node server/server.js, 기본 포트 8080
PORT=9000 npm start
```

`GET /` 은 `afterhours-lobby ok · N online` 을 반환합니다.

## 프로토콜 (JSON 텍스트 프레임)

| 방향 | 타입 | 내용 |
| --- | --- | --- |
| client → server | `hi` | 접속 직후 `{x,z,yaw}` (닉네임을 정했으면 `name` 포함) |
| server → client | `welcome` | `{id,name,color,peers,n}` 현재 접속자 명단 포함 |
| server → client | `you` | 내 닉네임·색이 확정/변경됨 |
| client → server | `m` | 이동 `{x,z,yaw,on,dance}` 초당 12회로 제한 |
| client → server | `set` | 닉네임·복장 `{name,color}` |
| server → client | `set` | 누군가의 닉네임·복장이 바뀜 |
| server → client | `join` / `left` / `count` | 입장, 퇴장, 인원 |
| client → server | `bye` | 페이지를 떠날 때 |

닉네임은 서버가 `긴 밤의 올빼미`, `스파클 고래` 같은 조합으로 자동 생성하고,
사용자가 바꾸면 그 이름을 쓰게 됩니다. 옷 색은 10가지 팔레트에서 서버가 빈 색을 배정합니다.

## 끊김 처리

소켓이 끊겨도 페이지는 그대로 동작합니다. 1.2초부터 시작해 9초까지 간격을 늘려가며
재접속하고, 다시 붙으면 현재 접속자 명단을 받아 그 자리에서 다시 나타납니다.
로컬에서 열면 `ws://127.0.0.1:8080` 에, 공개 사이트에서는 위 Render 주소에 연결됩니다.
`?lobby=wss://호스트` 로 주소를 직접 지정할 수도 있습니다.
