# 학교 서버에 올리기 — 한밤의 랜턴 대작전

목표 주소
- 학생: https://lab.ches.es.kr/lantern/
- 선생님: https://lab.ches.es.kr/lantern/teacher/

이 순서표는 **이미 다른 프로그램이 돌고 있는 서버**에 게임을 "옆에 하나 더" 얹는 방법입니다.
기존 프로그램과 겹치지 않게 모든 것을 따로 둡니다.

| 무엇 | 이 게임 전용 값 |
|---|---|
| 서버 사용자 | `lantern` (로그인 안 되는 전용 계정) |
| 프로그램 폴더 | `/opt/lantern` |
| Node.js | `lantern` 사용자 혼자 쓰는 Node 22 (nvm) |
| 서비스 이름 | `lantern` (systemd) |
| 내부 포트 | `127.0.0.1:3600` (바깥에서는 안 보임) |
| nginx | `/lantern` 으로 시작하는 주소만 넘기는 조각 파일 하나 |

읽는 법
- 회색 상자 하나 = 명령 한 줄입니다. 상자 하나씩 복사해서 서버 터미널(SSH 창)에 붙여 넣고 Enter 를 누르세요.
- `sudo` = "관리자 권한으로 실행". 비밀번호를 물으면 서버 계정 비밀번호를 넣습니다.
- 명령이 빨간 글씨(error)로 끝나면 다음으로 가지 말고 멈춘 뒤 그 화면을 보여 주세요.

---

## 시작하기 전에 꼭 할 일 (내 PC에서)
이 순서표는 GitHub 저장소에 **주소 앞부분(/lantern) 지원과 이 deploy 폴더가 올라가 있어야** 동작합니다.
2026-11-20 에 push 되어 있습니다 (커밋 `bd5de24` 이후). 그 뒤 PC 에서 더 고친 것이 있으면 push 한 뒤에 진행하세요.

---

## 0) 시작 전 점검

**0-1. 3600 번 포트가 비어 있는지 확인** (2026-11-21 확인: 3100 은 다른 프로그램이 쓰고 있어 3600 으로 정했고, 3600 은 비어 있었습니다)
```
sudo ss -tlnp | grep ':3600'
```
- 아무것도 안 나오면 비어 있음 → 그대로 진행.
- 무언가 나오면 다른 프로그램이 쓰는 중 → 다른 번호(예: 3101)를 고릅니다. `sudo ss -tlnp | grep ':3101'` 로 비었는지 다시 보고,
  아래 두 군데의 `3600` 을 모두 그 번호로 바꿉니다.
  - 3단계 `.env` 의 `PORT=3600`
  - 5단계 nginx 조각 파일 안의 `127.0.0.1:3600` (3곳)

**0-2. 이 서버의 nginx 설정 방식 확인** (확인 필요 — 서버마다 다릅니다)
```
ls /etc/nginx/sites-enabled /etc/nginx/conf.d
```
```
sudo grep -rln "lab.ches.es.kr" /etc/nginx/
```
- 두 번째 명령이 보여 주는 파일이 lab.ches.es.kr 설정 파일입니다. (예: `/etc/nginx/sites-available/default` 또는 `/etc/nginx/conf.d/lab.conf`)
  이 파일 경로를 메모해 두세요. 5단계에서 씁니다.
- HTTPS(자물쇠) 설정이 어느 블록에 있는지 보기:
```
sudo nginx -T 2>/dev/null | grep -n "server_name\|listen\|ssl_certificate "
```
  `listen 443 ssl` 과 `server_name lab.ches.es.kr` 이 같이 있는 블록이 우리가 쓸 곳입니다.

**0-3. 기존 nginx 설정 통째로 백업** (문제 생기면 비교·복구용)
```
sudo cp -a /etc/nginx /etc/nginx.backup-$(date +%Y%m%d-%H%M)
```

**0-4. 필요한 도구 확인** (버전 숫자가 나오면 OK)
```
git --version
```
```
curl --version
```
없다고 나오면 설치합니다 (다른 프로그램에 영향 없음): `sudo apt install -y git curl`

---

## 1) Node.js 22 설치 — nvm 방식, 전용 사용자에게만

**왜 nvm 인가요?**
- NodeSource 방식은 서버 전체의 `node`(/usr/bin/node)를 22 로 바꿉니다. 이미 돌고 있는 다른 프로그램이 다른 버전의 Node 를 쓰고 있으면 그 프로그램이 고장 날 수 있습니다.
- nvm 방식은 `lantern` 사용자 폴더 안에만 Node 22 를 넣습니다. 서버의 다른 프로그램이 쓰는 Node 는 그대로입니다.

그래서 먼저 전용 사용자를 만들고, 그 사용자에게만 Node 를 설치합니다.

**1-1. 전용 사용자 `lantern` 만들기** (로그인 불가, 집 폴더 /var/lib/lantern)
```
sudo useradd --system --create-home --home-dir /var/lib/lantern --shell /usr/sbin/nologin lantern
```

**1-2. nvm 설치** (nvm 공식 저장소의 설치 스크립트, 버전 0.40.1 고정)
```
sudo -u lantern -H bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
```

**1-3. Node 22 설치**
```
sudo -u lantern -H bash -c '. ~/.nvm/nvm.sh && nvm install 22 && nvm alias default 22'
```

**1-4. 확인** (`v22.` 로 시작하는 숫자가 나오면 성공)
```
sudo -u lantern -H bash -c '. ~/.nvm/nvm.sh && node -v'
```

---

## 2) 게임 내려받기와 라이브러리 설치

저장소 https://github.com/UP-HAN/school-game 은 공개 저장소이고, 비밀번호 같은 비밀 값은 올라가 있지 않습니다.

**2-1. 프로그램 폴더 만들기**
```
sudo mkdir -p /opt/lantern
```
```
sudo chown lantern:lantern /opt/lantern
```

**2-2. 내려받기**
```
sudo -u lantern -H git clone https://github.com/UP-HAN/school-game.git /opt/lantern
```

**2-3. 라이브러리 설치** (실행에 필요한 것만)
```
sudo -u lantern -H bash -c 'cd /opt/lantern/outputs/code && . ~/.nvm/nvm.sh && npm install --omit=dev'
```

---

## 3) 설정 파일(.env) 만들기 — 견본을 복사만 하면 됩니다

선생님 비밀번호는 쓰지 않습니다. 선생님들께는 선생님 주소(https://lab.ches.es.kr/lantern/teacher/)만 알려 드리고,
누구나 '방 만들기' 버튼으로 방을 만듭니다. 대신 서버가 버틸 수 있게 방 수를 제한합니다 (견본에 기본값이 들어 있음).

**3-1. 견본 복사** (이것만 하면 됩니다)
```
sudo cp /opt/lantern/outputs/code/deploy/.env.production.example /opt/lantern/outputs/code/.env
```

**3-2. (필요할 때만) 값 고치기**
```
sudo nano /opt/lantern/outputs/code/.env
```
- 0-1 에서 포트를 바꿨다면 `PORT=` 만 바꿉니다. 나머지 줄은 그대로 둡니다.
- 방 수 제한(`MAX_ROOMS` 등)을 바꾸고 싶을 때만 그 숫자를 고칩니다. 각 줄의 설명은 파일 안에 있습니다.
- **예전 `.env` 에 비밀번호가 적혀 있다면**: `TEACHER_PASSWORD=` 뒤의 글자를 지워 `TEACHER_PASSWORD=` 만 남깁니다.
  (비워 두면 비밀번호 없이 방을 만듭니다. 값이 있으면 선생님 화면에 비밀번호 칸이 다시 나오고, 방을 만들 때 비밀번호를 물어요)
- 저장: `Ctrl+O` → Enter, 나가기: `Ctrl+X`
- `.env` 를 고친 뒤에는 `sudo systemctl restart lantern` 으로 다시 켜야 반영됩니다 (서비스 등록 전인 처음 설치 때는 필요 없음).

**3-3. 아무도 못 보게 잠그기** (관리자만 읽기·쓰기 = 권한 600)
```
sudo chown root:root /opt/lantern/outputs/code/.env
```
```
sudo chmod 600 /opt/lantern/outputs/code/.env
```
(systemd 가 관리자 권한으로 이 파일을 읽어 게임에 넘겨 주므로, 게임 사용자가 직접 읽을 필요는 없습니다.)

---

## 4) 서비스로 등록하기 (서버가 켜질 때 자동 시작, 꺼지면 자동 재시작)

**4-1. 서비스 파일 복사**
```
sudo cp /opt/lantern/outputs/code/deploy/lantern.service /etc/systemd/system/lantern.service
```

**4-2. systemd 에 새 파일 알리기**
```
sudo systemctl daemon-reload
```

**4-3. 켜기 + 부팅 때 자동 시작**
```
sudo systemctl enable --now lantern
```

**4-4. 상태 보기** (`active (running)` 이 초록색이면 성공. 나가기는 `q`)
```
sudo systemctl status lantern
```

**4-5. 로그(기록) 보기** — `게임 서버가 켜졌어요`, `여는 주소(HOST): 127.0.0.1:3600`, `TRUST_PROXY): 켜짐` 이 보이면 정상
```
sudo journalctl -u lantern -n 50 --no-pager
```
실시간으로 계속 보기 (나가기 `Ctrl+C`):
```
sudo journalctl -u lantern -f
```

**4-6. 서버 안에서 접속 시험** (`HTTP/1.1 200 OK` 가 나오면 성공)
```
curl -sI http://127.0.0.1:3600/lantern/
```

---

## 5) nginx 에 /lantern 길 열어 주기

**5-1. 조각 파일 복사** (새 파일을 하나 추가할 뿐, 기존 파일은 그대로)
```
sudo mkdir -p /etc/nginx/snippets
```
```
sudo cp /opt/lantern/outputs/code/deploy/nginx-lantern.conf.snippet /etc/nginx/snippets/lantern.conf
```

**5-2. lab.ches.es.kr 설정에 한 줄 넣기** (이 단계만 손으로 합니다)
0-2 에서 메모한 파일을 엽니다. 예:
```
sudo nano /etc/nginx/sites-available/default
```
- `listen 443 ssl` 과 `server_name lab.ches.es.kr` 이 있는 `server { ... }` 블록을 찾습니다.
- 그 블록 안, 다른 `location` 들 바로 위(또는 아래)에 **다음 한 줄만** 추가합니다. 다른 줄은 고치지 않습니다.
```
include snippets/lantern.conf;
```
- 저장 `Ctrl+O` → Enter, 나가기 `Ctrl+X`
- 주의: 같은 블록에 이미 `location /lantern` 이 있으면 겹칩니다. 그럴 땐 멈추고 물어봐 주세요.
  확인: `sudo nginx -T 2>/dev/null | grep -n "lantern"`

**5-3. 문법 검사** (`syntax is ok` 와 `test is successful` 이 나와야 함)
```
sudo nginx -t
```
- 실패하면 **reload 하지 말고** 5-2 에서 넣은 줄을 다시 지운 뒤 `sudo nginx -t` 로 원래대로 돌아왔는지 확인하세요.

**5-4. 설정 다시 읽기** — `reload` 는 접속 중인 다른 프로그램 사용자를 끊지 않습니다.
```
sudo systemctl reload nginx
```
`restart` 는 쓰지 마세요. (잠깐이지만 서버 전체가 끊깁니다)

---

## 6) 확인

**6-1. 서버에서**
```
curl -sI https://lab.ches.es.kr/lantern/
```
`200` 이 나오면 성공.

**6-2. 컴퓨터 브라우저에서**
- https://lab.ches.es.kr/lantern/ → 학생 입장 화면(방 번호·이름 칸)이 나오는지
- https://lab.ches.es.kr/lantern/teacher/ → 선생님 화면('방 만들기' 버튼)이 나오는지
- 선생님 화면에서 '방 만들기'를 눌러 방을 만들고, 다른 창(시크릿 창)에서 학생으로 들어가 보기
- 같은 서버의 **다른 프로그램 주소도 평소처럼 열리는지** 꼭 한 번 확인

**6-3. 휴대폰에서** (와이파이 말고 LTE/5G 로도 한 번)
- 학생 주소로 들어가 방 번호를 넣고 입장 → 캐릭터가 움직이는지
- 화면 아래에 "서버에 연결하는 중" 이 계속 떠 있으면 웹소켓(실시간 통신)이 막힌 것 → 10) 자주 하는 실수 참고

---

## 7) 업데이트하는 법 (새 버전이 GitHub 에 올라온 뒤)

수업 중에는 하지 마세요. 게임 서버를 다시 켜면 열려 있던 방이 모두 닫힙니다.

```
sudo -u lantern -H git -C /opt/lantern pull
```
```
sudo -u lantern -H bash -c 'cd /opt/lantern/outputs/code && . ~/.nvm/nvm.sh && npm install --omit=dev'
```
```
sudo systemctl restart lantern
```
```
sudo systemctl status lantern
```
(`restart lantern` 은 이 게임만 다시 켭니다. nginx·다른 프로그램은 영향 없음)

deploy 폴더의 `lantern.service` 나 nginx 조각이 바뀐 경우에만 4-1~4-2, 5-1·5-3·5-4 를 다시 합니다.

---

## 8) 문제가 생기면 되돌리기

**8-1. nginx 에서 /lantern 빼기**
- 5-2 에서 연 파일을 다시 열어 `include snippets/lantern.conf;` 줄 맨 앞에 `#` 을 붙입니다 (또는 줄을 지웁니다).
```
sudo nginx -t
```
```
sudo systemctl reload nginx
```
- 조각 파일은 지우지 않고 이름만 바꿔 보관해도 됩니다:
```
sudo mv /etc/nginx/snippets/lantern.conf /etc/nginx/snippets/lantern.conf.off
```

**8-2. 게임 서버 끄기 + 자동 시작 해제**
```
sudo systemctl stop lantern
```
```
sudo systemctl disable lantern
```

**8-3. 그래도 nginx 가 이상하면** 0-3 에서 만든 백업 폴더(`/etc/nginx.backup-날짜`)와 지금 파일을 비교해 보세요.
```
sudo diff -r /etc/nginx.backup-여기에날짜 /etc/nginx
```
(백업 폴더 이름은 `ls -d /etc/nginx.backup-*` 로 확인. 백업으로 통째로 덮어쓰는 것은 그 뒤에 바뀐 다른 설정까지 되돌리므로, 하기 전에 먼저 물어봐 주세요.)

---

## 9) Lightsail 방화벽

- Lightsail 콘솔 → 인스턴스 → **네트워킹** 탭의 방화벽에는 `SSH(22)`, `HTTP(80)`, `HTTPS(443)` 만 열려 있으면 됩니다.
- **3600 은 열지 마세요.** 게임 서버는 nginx 를 통해서만 들어오는 내부 전용입니다.
  (게임 서버가 127.0.0.1 에만 열려 있어 열어도 접속은 안 되지만, 불필요한 구멍은 만들지 않습니다.)
- 서버 안 방화벽(ufw)도 따로 바꿀 필요 없습니다. 상태만 보려면: `sudo ufw status`

---

## 10) 자주 하는 실수

| 증상 | 원인 | 해결 |
|---|---|---|
| `sudo nginx -t` 에서 `"location" directive is not allowed here` | include 줄을 server 블록 **밖**에 넣음 | `server { ... }` 중괄호 안으로 옮기기 |
| `duplicate location "/lantern/"` | 같은 블록에 include 를 두 번 넣었거나 이미 /lantern 규칙이 있음 | 한 줄만 남기기 / 멈추고 문의 |
| http 로는 되는데 https 로는 404 | include 를 80번(http) 블록에만 넣음 | `listen 443 ssl` 블록에 넣기 (0-2 참고) |
| 502 Bad Gateway | 게임 서버가 꺼져 있거나 포트가 다름 | `sudo systemctl status lantern`, `.env` 의 PORT 와 조각의 3600 이 같은지 |
| 화면은 나오는데 "서버에 연결하는 중" 계속 | 웹소켓이 넘어가지 않음 | 조각 파일이 바뀌지 않았는지, 5-4 reload 를 했는지 확인 |
| 선생님 화면에 비밀번호 칸이 나옴 | `.env` 의 `TEACHER_PASSWORD=` 뒤에 글자가 남아 있음 | 3-2 처럼 값을 지우고 `sudo systemctl restart lantern` |
| "지금은 방이 꽉 찼어요" | 서버 전체에 열린 방이 `MAX_ROOMS`(기본 40)개 | 안 쓰는 방이 자동으로 닫히길 기다리거나(선생님 끊김 30분·활동 없음 2시간) `MAX_ROOMS` 를 올리고 재시작 |
| "같은 곳에서 연 방이 8개라…" | 같은 학교(같은 인터넷 주소)에서 동시에 연 방이 `MAX_ROOMS_PER_IP`(기본 8)개 | 안 쓰는 방을 '방 닫기'로 닫기. 학교 선생님이 많으면 숫자를 올리고 재시작 |
| "방을 너무 많이 만들었어요. N분 뒤에…" | 같은 주소에서 1시간에 `ROOM_CREATE_PER_HOUR`(기본 20)번 넘게 만듦 | 안내된 시간만큼 기다리기, 또는 숫자를 올리고 재시작 |
| (비밀번호를 쓰는 경우) 몇 번 틀리면 1분간 잠김 | 정상 동작 (같은 기기에서 5번 틀리면 1분 잠금) | 1분 기다리기. 다른 기기는 잠기지 않음 |
| `status=203/EXEC` 로 서비스가 안 켜짐 | nvm/Node 가 `lantern` 사용자에게 설치되지 않음 | 1-2 ~ 1-4 다시 확인 |
| `nginx restart` 를 해 버림 | — | 다음부터는 `reload`. 다른 프로그램도 잠깐 끊겼을 수 있으니 확인 |
| `.env` 를 git 에 올리려 함 | — | `.env` 는 서버에만 둡니다. git 에는 견본(.example)만 |

---

## 확인 필요 (서버를 직접 봐야 알 수 있는 것)
- nginx 설정이 `sites-enabled` 방식인지 `conf.d` 방식인지, HTTPS 블록이 어느 파일에 있는지 → 0-2 명령으로 확인.
- 서버 앞에 Lightsail 로드밸런서나 CDN 이 따로 있는지. 있다면 nginx 가 보는 주소가 학생 주소가 아니어서 주소별 방 제한(같은 주소 동시 8개·1시간 20개)이 모두에게 같이 걸릴 수 있습니다 (이때는 알려 주세요).
- Ubuntu 버전이 아주 오래되면(18.04 이하) systemd 일부 보호 옵션이 무시될 수 있습니다 (동작에는 지장 없음). 확인: `lsb_release -a`
- 이 서버 메모리가 작으면(1GB 이하) 서비스 파일의 메모리 한도 512M 를 조정해야 할 수 있습니다. 확인: `free -h`
