# 한밤의 랜턴 대작전 — 안내 영상 제작 틀

1920×1080 · 30fps · H.264+AAC. 화면은 HTML/CSS/SVG 코드 + 게임 캡처·일러스트, 음악·효과음은 코드 합성(생성 AI 없음).
모든 움직임은 `seek(t)`(초) 의 순수 함수다. 실시간 타이머·CSS animation 을 쓰지 않는다.

## 폴더
| 경로 | 내용 |
|---|---|
| `work/lib.js` | 엔진(`makeVideo`) + 장면 부품 `Q.*` + 글자 등장 `MG.text` + 전환 7종 |
| `work/video.css` | 밤 테마 스타일 (색 토큰은 `:root`) |
| `work/demo.html` | 부품 시연 구성. `?cut=reel` 은 29초 묶음, `?mood=teacher&bpm=112` 로 음악 바꿔 보기, `?ui=1` 은 시간 손잡이 |
| `work/demo_assets/seq/night-park/` | flipbook 시연용 연속 그림(게임 녹화 `outputs/video/night-park-8players.mp4` 60~64초를 12fps 로 뽑음) |
| `shots/` | 게임 캡처 (다른 담당이 채움). 연속 그림은 `shots/seq/<이름>/0001.png…` |
| `_common.mjs` | 크롬 실행 도우미 (기존 playwright-core·크로미움을 경로로 사용, 새 설치 없음) |
| `events.mjs` `audio.mjs` `render.mjs` `thumbs.mjs` `preview.mjs` | 아래 명령 참고 |
| `output/` | 완성 mp4 |

## 명령 (guide 폴더에서)
```
node thumbs.mjs  teacher                 # 장면마다 2장 → work/teacher_thumbs/
node thumbs.mjs  demo --q "cut=reel" --at 3.2,7.5   # 특정 시각만
node preview.mjs teacher                 # 장면표 한 장 → work/sheet_teacher.jpg
node events.mjs  teacher                 # 사건(효과음) 목록 → work/events_teacher.json
node audio.mjs   teacher                 # events 로 music/sfx/mix_teacher.wav
node render.mjs  teacher --out output/teacher.mp4   # 위 전부 + 프레임 캡처 → mp4 (약 10프레임/초)
node render.mjs  demo --q "cut=reel" --from 5 --to 12 --out output/part.mp4   # 일부만
```
구성 이름 = `work/<이름>.html`. `--q` 는 주소 뒤 쿼리. `--tag` 로 산출물 이름을 바꿀 수 있다.

## 구성 파일 쓰는 법
`demo.html` 을 복사해 `work/teacher.html` 등으로 만들고 `makeVideo` 만 바꾼다.
```js
makeVideo({
  bpm: 112, mood: 'teacher',            // mood: promo(126~132) | teacher(108~116) | student(132~140)
  scenes: [
    { name: '오프닝', bars: 3, bg: 'deep', build: el => Q.logo(el, { sub: '…' }) },
    { name: '3단계', bars: 4, trans: 'lantern', tx: 300, ty: 400, section: 'build',
      build: el => Q.steps(el, { title: '…', steps: [[아이콘, 제목, 설명], …],
        caps: [[0.5, 6.8, '자막 <b>강조</b> <em>민트 강조</em>']] }) },
    { name: '끝', bars: 2.5, still: true, moon: true, section: 'outro', trans: 'flip',
      build: (el, c) => Q.end(el, { dur: c.dur, urls: [['학생', '주소', 'var(--mint)']], cta: '…' }) },
  ],
});
```
- `bars`: 장면 길이(마디). 0.5 단위(=2박)로 맞추면 장면 경계가 박자에 떨어진다. **모든 장면 길이를 같게 하지 말 것.**
- `trans`: 들어올 때 전환 — `lantern`(빛 원, `tx`,`ty`로 중심) · `fog`(안개 쓸기) · `slide`(미끄럼틀 곡선+별똥별) · `door`(문 닫혔다 열림) · `flip`(카드 뒤집기) · `punch`(줌 펀치) · `push`(위로 밀기) · 없음=컷. `td` 로 길이(초) 바꿈.
- `bg`: `night` `violet` `deep` `dawn` `ember` `mint` (BG 표는 lib.js). `moon:true` 달, `stars:false` 별 끔.
- `still:true`: 엔드카드용. 1.3초 뒤 배경도 멈춤(2~5초 정지 규칙).
- `section`: 음악 구간 시작 표시 `build`(드럼 시작) / `drop`(가장 신남) / `outro`(마지막 화음). 
- `thumbs:[초,…]`: 썸네일 찍을 장면 안 시각(선택).
- 모든 부품 공통 옵션: `badge`(왼쪽 위 단계 이름표), `caps`([[시작, 끝, 'html']] 자막).
- 그림 경로: `'s_lobby.png'` → `shots/`, `'@art/illust/win.png'` → `outputs/art/…`, `'@demo/…'` → `work/demo_assets/…`. 없는 그림은 회색 자리표시로 그린다(멈추지 않음).

## 부품 (Q.*) 과 주요 인자
| 부품 | 인자 (기본값) | 효과음 |
|---|---|---|
| `logo` | `bg`, `title`(글자 스펙), `tag`, `sub`, `litAt`(0.9), `lx`,`ly` | swish·lantern·pop2·type |
| `hero` / `title` | `bg`(선택), `lines:[{t, style, y, x, size, color, at, mark, font}]`, `chips:[{t,x,y,at}]` | 글자 스타일별 |
| `tiles` | `title`, `tiles:[[아이콘,제목,설명]]`(3~4), `at`, `step` | pop |
| `device` (`laptop`/`tablet`/`phone`) | `device`, `img`, `img2`+`swap`, `x,y,w`, `path:[[도착초,배율,cx,cy]]`, `enter:'rise'|'left'|'right'|'drop'`, `callouts:[{t,x,y,at,out,tx}]`, `chips`, `rings:[{x,y,w,h,at}]`, `label` | swish·pop·tick·sparkle |
| `dual` | `pc`, `mob`, `pathPc`, `pathMob`, `callouts`, `chips` | |
| `address` | `device`, `img`, `rows:[[누구,주소,색]]`, `ring`, `urlSize` | lantern(줄마다 전구 점등) |
| `maps` | `maps:[[그림,이름]]`, `title`, `titleMark`, `focusAt`, `focusStep` | deal·tick |
| `end` | `dur`(필수: `c.dur`), `title`, `sub`, `urls`, `cta`, `fadeOut` | lantern·chime |
| `lanternReveal` | `img`, `lx`,`ly`(빛 중심), `at`(점등), `r`(빛 반지름), `openAt`(전체 공개), `title`, `sub`, `from` | lantern·sparkle·rise |
| `fogShrink` | `img`, `cx`,`cy`, `stages:[{at, r, label}]`, `warn`(0.6초 전 노란 점선), `title`, `titleMark` | fog·tick |
| `modeSplit` | `left`/`right:{icon,title,line,items[],color}`, `itemsAt`, `itemStep`, `vsAt`, `focus:[{at, side:'left'|'right'|null}]` | swish·thud·tick |
| `likeCard` | `title`, `pairs:[[재미, 우리 게임, 위 작은 글?, 오른쪽 작은 글?]]`(1~3), `step`, `fromLabel`, `toLabel` — 글자만 | tick·swish·lantern |
| `flipbook` | `name`(→`shots/seq/<name>/`) 또는 `dir`, `frames`(필수), `fps`(12), `speed`, `loop`(true), `pingpong`, `start`, `ext`('png'), `pad`(4), `device`(없으면 전체 화면), `path`, `label` | |
| `quizPop` | `bg`, `q`, `choices[4]`, `answer`, `at`, `pickAt`, `gauge:{from,to,label}`|false, `x,y,scale`(창 위치), `stamp` | pop·tick·click·correct·lantern·rise |
| `gauge` | `type:'dawn'|'moon'|'both'`, `from`,`to`,`at`,`dur`,`label`, `clock:{from초,to초,at,dur,label}` | rise·lantern·pop·bell |
| `steps` | `title`, `steps:[[아이콘,제목,설명]]`(2~4), `at`, `segDur` | pop·lantern |
| `roleCards` | `cards:[[아이콘,이름,설명]]`, `reveal:{index, icon, name, desc, at, label}`, `title` | deal·swish·flip·sparkle |
| `itemRain` | `items:[[이모지,이름]]`, `title`, `at`, `cols` | boing(착지마다, 불규칙 간격) |
| `spinCrash` | `text`, `icon`, `hitAt`, `spin`(초), `boom`, `sub`, `subAt`, `wall` | swish·thud·spin |
| `meeting` | `people:[[이모지,이름,색]]`, `target`, `voters`, `bellAt`, `voteAt`, `resultAt`, `result`, `title` | bell·vote·stamp |

## 글자 등장 (MG.text 또는 hero 의 lines)
`style`: `pop`(튀어나오기) · `type`(타자) · `mask`(마스크 올라오기) · `wobble`(글자별 흔들림 정착) · `stack`(크기 차등 스택) · `marker`(형광펜, `mark:[단어번호]`, 기본 마지막 단어) · `glow`(랜턴 점등).
글자 스펙: `'문장'` 또는 `[['단어', {s:크기, w:굵기, c:색, f:'body'|'jua'}], …]` — 단어마다 크기·굵기·색을 달리 줄 수 있다.

## 조절 토큰
`lib.js` 맨 위 `TOK`: 공간 이동 0.4/0.55/0.7초, 색·투명도 0.15/0.2/0.3초, 스태거 0.06/0.1/0.14초, 흔들림 16px. 전환 길이 `TRD`.
`?calm=1`(또는 브라우저의 동작 줄이기 설정, 렌더 때는 무시): 흔들림·번쩍임·빙글 회전 끔.

## 효과음 이름 (audio.mjs SFX)
lantern(랜턴 딩) · correct(정답) · swish/whoosh(휙) · thud(쿵) · bell(회의 종) · fog(안개 스윕) · pop/pop2(등장) · tick · type · marker · flip · deal · sparkle · click · stamp · rise · boing · spin · vote · door · chime.
부품 events 에 `[초, '이름']` 으로 연결된다. 모르는 이름은 pop 으로 대신 낸다.
