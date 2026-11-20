// 방해꾼 찾기: 회의 화면 (시작 알림 → 토론 → 투표 → 결과). 게임 화면 위에 덮는다.
// 채팅은 없다. 카드만 보여 주고 토론은 교실에서 말로 한다. 카드에는 이름 대신 "색 + 캐릭터".
// 서버가 보내는 room.meeting:
//   { stage, msLeft, reason, reporter?, found?, voted:[id], myVote?, canVote,
//     cards:[{ id, color, character, ghost, ejected }], result?:{ ejected, tie, counts, role? } }
import { playerLabel } from '/shared/config.js';
import { IMP } from '/impconst.js';

const $ = (id) => document.getElementById(id);
// 받침이 있으면 a, 없으면 b ("슬라임은" / "고양이는")
function josa(word, a, b) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return b;
  return code % 28 ? a : b;
}

function stageMs(stage) {
  return { intro: IMP.meetingIntroMs, discuss: IMP.discussMs, vote: IMP.voteMs, result: IMP.resultMs }[stage] || 1000;
}

/** opts: { send(msg), toast(msg) } */
export function initMeeting(opts) {
  let m = null; // 지금 회의 (room.meeting)
  let who = { teacher: false, myId: null };
  let endsAt = 0;
  let total = 1;
  let stage = '';
  let pick = null; // 투표하려고 누른 카드 (확인 전)
  let sentVote = null; // 내가 보낸 표 (서버 답을 기다리는 동안 버튼을 막는다)
  let extended = 0; // 선생님이 토론을 늘린 횟수 (서버가 알려 주지 않으면 이 화면에서 센다)
  let sig = '';
  let timer = 0;

  const label = (id) => {
    const c = m && m.cards ? m.cards.find((x) => x.id === id) : null;
    return c ? playerLabel(c.color, c.character) : '';
  };
  const myVote = () => (m && m.myVote) || sentVote;
  const canVoteNow = () => !who.teacher && m && m.stage === 'vote' && !!m.canVote && !myVote();

  function charCanvas(kind, color) {
    const cv = document.createElement('canvas');
    cv.className = 'char';
    cv.dataset.kind = kind;
    cv.dataset.color = color;
    cv.dataset.seed = (Math.random() * 3).toFixed(2);
    cv.width = cv.height = 160;
    return cv;
  }

  function renderCards() {
    const box = $('mt-cards');
    box.replaceChildren();
    const voted = new Set(m.voted || []);
    const counts = (m.result && m.result.counts) || null;
    for (const c of m.cards || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mt-card';
      const mine = c.id === who.myId;
      b.classList.toggle('me', mine);
      b.classList.toggle('ghost', !!c.ghost);
      b.classList.toggle('voted', voted.has(c.id));
      b.classList.toggle('picked', pick === c.id || myVote() === c.id);
      if (m.stage === 'result' && m.result && m.result.ejected === c.id) b.classList.add('fly');
      b.append(charCanvas(c.character, c.color));
      const name = document.createElement('span');
      name.className = 'mt-name';
      name.textContent = playerLabel(c.color, c.character) + (mine ? ' (나)' : '');
      b.append(name);
      if (c.ghost) {
        const s = document.createElement('span');
        s.className = 'mt-badge ice';
        s.textContent = c.ejected ? '제외됨' : '얼음';
        b.append(s);
      }
      if (m.reason === 'report' && m.reporter && m.reporter === c.id) {
        const s = document.createElement('span');
        s.className = 'mt-badge alarm';
        s.textContent = '신고';
        b.append(s);
      }
      if (voted.has(c.id)) {
        const s = document.createElement('span');
        s.className = 'mt-check';
        s.textContent = '✔';
        s.setAttribute('aria-label', '투표 완료');
        b.append(s);
      }
      if (counts) {
        const n = counts[c.id] || 0;
        const d = document.createElement('span');
        d.className = 'mt-dots';
        d.textContent = n ? '●'.repeat(Math.min(n, 10)) + ` ${n}표` : '0표';
        b.append(d);
      }
      const disabled = !canVoteNow() || mine || !!c.ghost;
      b.disabled = disabled;
      b.setAttribute('aria-label', name.textContent + (c.ghost ? ', 얼음' : '') + (voted.has(c.id) ? ', 투표 완료' : ''));
      if (!disabled) {
        b.addEventListener('click', () => {
          pick = c.id;
          sig = '';
          render();
        });
      }
      box.append(b);
    }
  }

  function texts() {
    const r = m.result || {};
    if (m.stage === 'intro') {
      if (m.reason === 'report') return ['신고!', m.found ? `${label(m.found)}의 얼음을 찾았어요` : '얼음 흔적을 찾았어요'];
      return ['긴급회의!', '모두 모여 이야기해요'];
    }
    if (m.stage === 'discuss') {
      const found = m.reason === 'report' && m.found ? `발견된 얼음: ${label(m.found)} · ` : '';
      return ['토론 시간', found + '교실에서 말로 이야기해요. 곧 투표가 시작돼요'];
    }
    if (m.stage === 'vote') {
      if (who.teacher) return ['투표 시간', '학생들이 투표하는 중이에요'];
      if (!m.canVote) return ['투표 시간', '이번 회의는 지켜보기만 해요'];
      if (myVote()) return ['투표 완료', '다른 친구들이 투표를 끝낼 때까지 기다려요'];
      return ['투표 시간', '방해꾼이라고 생각하는 친구를 눌러요. 모르겠으면 건너뛰기!'];
    }
    // 결과
    if (r.ejected) {
      const who2 = label(r.ejected);
      if (r.role === 'chaser') return ['투표 결과', `${who2}${josa(who2, '은', '는')} 방해꾼이었어요!`];
      if (r.role === 'student') return ['투표 결과', `${who2}${josa(who2, '은', '는')} 방해꾼이 아니었어요…`];
      return ['투표 결과', `${who2}${josa(who2, '이', '가')} 제외되었어요`];
    }
    return ['투표 결과', `아무도 제외되지 않았어요 (${r.tie ? '동점' : '건너뛰기'})`];
  }

  function render() {
    const el = $('meeting');
    el.hidden = false;
    el.classList.toggle('teacher', who.teacher);
    el.classList.toggle('intro', m.stage === 'intro');
    el.dataset.stage = m.stage;
    const [title, sub] = texts();
    $('mt-title').textContent = title;
    $('mt-sub').textContent = sub;
    // 확인 창 (실수로 누르지 않게 한 번 더)
    const showConfirm = !!pick && canVoteNow();
    $('mt-confirm').hidden = !showConfirm;
    if (showConfirm) $('mt-confirm-text').textContent = `${label(pick)}에게 투표할까요?`;
    // 건너뛰기
    const skip = $('mt-skip');
    const skipCount = m.result && m.result.counts ? m.result.counts.skip || 0 : null;
    skip.hidden = who.teacher ? m.stage !== 'result' : !(m.stage === 'vote' || m.stage === 'result');
    skip.disabled = !canVoteNow();
    skip.textContent = skipCount != null ? `건너뛰기 ${skipCount}표` : myVote() === 'skip' ? '건너뛰기 (투표함)' : '건너뛰기';
    skip.classList.toggle('picked', myVote() === 'skip');
    // 선생님 조작
    $('mt-teacher').hidden = !(who.teacher && m.stage === 'discuss');
    const used = typeof m.extended === 'number' ? m.extended : extended;
    $('mt-extend').disabled = used >= IMP.extendMax;
    $('mt-extend').textContent = `토론 ${Math.round(IMP.extendMs / 1000)}초 더 (${Math.max(0, IMP.extendMax - used)}번 남음)`;
    const s = JSON.stringify([m.stage, m.cards, m.voted, myVote(), m.result, m.canVote, pick, m.reporter, m.found]);
    if (s !== sig) {
      sig = s;
      renderCards();
    }
    tick();
  }

  function tick() {
    if (!m) return;
    const left = Math.max(0, endsAt - performance.now());
    $('mt-bar').style.width = Math.min(100, (left / total) * 100) + '%';
    $('mt-left').textContent = m.stage === 'intro' ? '' : `${Math.ceil(left / 1000)}초`;
  }

  function hide() {
    m = null;
    stage = '';
    pick = null;
    sentVote = null;
    sig = '';
    clearInterval(timer);
    timer = 0;
    $('meeting').hidden = true;
  }

  function update(meeting, info) {
    if (!meeting) return hide();
    who = { teacher: !!info.teacher, myId: info.myId || null };
    const fresh = !m;
    if (fresh) {
      extended = 0;
      sentVote = null;
      pick = null;
    }
    m = meeting;
    const msLeft = Math.max(0, m.msLeft || 0);
    if (m.stage !== stage) {
      stage = m.stage;
      total = Math.max(stageMs(stage), msLeft, 1);
      pick = null;
    } else total = Math.max(total, msLeft, 1);
    endsAt = performance.now() + msLeft;
    if (m.stage !== 'vote' && m.stage !== 'result') sentVote = null;
    if (m.myVote) sentVote = null;
    if (!timer) timer = setInterval(tick, 100);
    render();
  }

  // 버튼 연결 (한 번만)
  $('mt-yes').addEventListener('click', () => {
    if (!pick || !canVoteNow()) return;
    sentVote = pick;
    opts.send({ t: 'vote', target: pick });
    pick = null;
    sig = '';
    render();
  });
  $('mt-no').addEventListener('click', () => {
    pick = null;
    sig = '';
    render();
  });
  $('mt-skip').addEventListener('click', () => {
    if (!canVoteNow()) return;
    sentVote = 'skip';
    pick = null;
    opts.send({ t: 'vote', target: 'skip' });
    sig = '';
    render();
  });
  $('mt-extend').addEventListener('click', () => {
    extended++;
    opts.send({ t: 'meetingCtl', action: 'extend' });
    if (m) render();
  });
  $('mt-vote').addEventListener('click', () => opts.send({ t: 'meetingCtl', action: 'vote' }));

  return {
    update,
    hide,
    isOpen: () => !!m,
  };
}
