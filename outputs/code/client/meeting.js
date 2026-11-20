// 꿈도둑을 찾아라: 모닥불 회의 화면 (시작 알림 → 말로 토론 → 꿈도둑 지목 투표 → 결과). 게임 화면 위에 덮는다.
// 채팅은 없다. 카드만 보여 주고 토론은 교실에서 말로 한다. 카드에는 이름 대신 "맛 + 캐릭터".
// 서버가 보내는 room.meeting:
//   { stage, msLeft, reason, reporter?, found?, voted:[id], myVote?, canVote,
//     cards:[{ id, color, character, ghost, ejected }], result?:{ ejected, tie, counts, role? } }
import { playerLabel } from './shared/config.js';
import { MAF as IMP } from './mafiaconst.js';
import { KEYS } from './keys.js';

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
  let kbId = null; // 키보드(방향키)로 고른 카드 id 또는 'skip'
  const hasKeyboard = () => !document.documentElement.classList.contains('touch-only'); // keys.js watchKeyboard

  const label = (id) => {
    const c = m && m.cards ? m.cards.find((x) => x.id === id) : null;
    return c ? playerLabel(c.color, c.character) : '';
  };
  const myVote = () => (m && m.myVote) || sentVote;
  const canVoteNow = () => !who.teacher && m && m.stage === 'vote' && !!m.canVote && !myVote();

  function charCanvas(kind, color, halo) {
    const cv = document.createElement('canvas');
    cv.className = 'char';
    cv.dataset.kind = kind;
    cv.dataset.color = color;
    if (halo) cv.dataset.halo = '1'; // 꿈에 빠진 학생: 작은 천사 고리
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
      b.dataset.id = c.id;
      const mine = c.id === who.myId;
      b.classList.toggle('me', mine);
      b.classList.toggle('ghost', !!c.ghost);
      b.classList.toggle('voted', voted.has(c.id));
      b.classList.toggle('picked', pick === c.id || myVote() === c.id);
      if (m.stage === 'result' && m.result && m.result.ejected === c.id) b.classList.add('fly');
      b.append(charCanvas(c.character, c.color, !!c.ghost));
      const name = document.createElement('span');
      name.className = 'mt-name';
      name.textContent = playerLabel(c.color, c.character) + (mine ? ' (나)' : '');
      b.append(name);
      if (c.ghost) {
        const s = document.createElement('span');
        s.className = 'mt-badge ice';
        s.textContent = c.ejected ? '추방됨' : '꿈에 빠짐';
        b.append(s);
      }
      if (m.reason === 'report' && m.reporter && m.reporter === c.id) {
        const s = document.createElement('span');
        s.className = 'mt-badge alarm';
        s.textContent = '호루라기';
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
      b.setAttribute('aria-label', name.textContent + (c.ghost ? ', 꿈에 빠짐' : '') + (voted.has(c.id) ? ', 투표 완료' : ''));
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
      if (m.reason === 'report') return ['삐익! 호루라기!', m.found ? `꿈에 빠진 ${label(m.found)}${josa(label(m.found), '을', '를')} 찾았어요` : '꿈에 빠진 친구를 찾았어요'];
      return ['모닥불 회의!', '회의 종이 울렸어요. 모두 모여 이야기해요'];
    }
    if (m.stage === 'discuss') {
      const found = m.reason === 'report' && m.found ? `꿈에 빠진 친구: ${label(m.found)} · ` : '';
      return ['말로 토론해요', found + '누가 꿈도둑일까? 교실에서 말로 이야기해요. 곧 투표가 시작돼요'];
    }
    if (m.stage === 'vote') {
      if (who.teacher) return ['꿈도둑 지목 투표', '학생들이 투표하는 중이에요'];
      if (!m.canVote) return ['꿈도둑 지목 투표', '이번 회의는 지켜보기만 해요'];
      if (myVote()) return ['투표 완료', '다른 친구들이 투표를 끝낼 때까지 기다려요'];
      return ['꿈도둑 지목 투표', '꿈도둑이라고 생각하는 친구를 눌러요. 모르겠으면 기권!' + (hasKeyboard() ? ` (${KEYS.pick.label}로 고르고 ${KEYS.act.label})` : '')];
    }
    // 결과
    if (r.ejected) {
      const who2 = label(r.ejected);
      if (r.role === 'chaser') return ['투표 결과', `${who2}${josa(who2, '은', '는')} 꿈도둑이었어요!`];
      if (r.role === 'student') return ['투표 결과', `${who2}${josa(who2, '은', '는')} 꿈도둑이 아니었어요…`];
      return ['투표 결과', `${who2}${josa(who2, '이', '가')} 추방되었어요`];
    }
    return ['투표 결과', `아무도 추방되지 않았어요 (${r.tie ? '동점' : '기권이 많아요'})`];
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
    if (showConfirm) $('mt-confirm-text').textContent = `${label(pick)}${josa(label(pick), '을', '를')} 꿈도둑으로 지목할까요?`;
    // 건너뛰기
    const skip = $('mt-skip');
    const skipCount = m.result && m.result.counts ? m.result.counts.skip || 0 : null;
    skip.hidden = who.teacher ? m.stage !== 'result' : !(m.stage === 'vote' || m.stage === 'result');
    skip.disabled = !canVoteNow();
    skip.textContent = skipCount != null ? `기권 ${skipCount}표` : myVote() === 'skip' ? '기권 (투표함)' : '기권';
    skip.classList.toggle('picked', myVote() === 'skip');
    if (canVoteNow()) {
      // 키 글자: (방향키 → Space)
      const kh = document.createElement('small');
      kh.className = 'kh';
      kh.textContent = `(${KEYS.pick.label} → ${KEYS.act.label})`;
      skip.append(' ', kh);
    }
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
    markKb();
    tick();
  }

  // ───── 키보드: 방향키(또는 WASD)로 카드 고르기 → 스페이스·엔터로 확정 (마우스·터치는 그대로) ─────
  function kbTargets() {
    const out = [...$('mt-cards').querySelectorAll('.mt-card')].filter((b) => !b.disabled);
    const skip = $('mt-skip');
    if (!skip.hidden && !skip.disabled) out.push(skip);
    return out;
  }
  function markKb() {
    const list = canVoteNow() ? kbTargets() : [];
    const ids = list.map((b) => b.dataset.id || 'skip');
    if (kbId && !ids.includes(kbId)) kbId = null;
    for (const b of document.querySelectorAll('#meeting .kb-sel')) b.classList.remove('kb-sel');
    if (!kbId) return;
    const el = list[ids.indexOf(kbId)];
    if (el) el.classList.add('kb-sel');
  }
  function kbMove(step) {
    const list = kbTargets();
    if (!list.length) return;
    const ids = list.map((b) => b.dataset.id || 'skip');
    const i = ids.indexOf(kbId);
    kbId = ids[i < 0 ? (step > 0 ? 0 : ids.length - 1) : (i + step + ids.length) % ids.length];
    markKb();
  }
  const MOVE = { ArrowLeft: -1, KeyA: -1, ArrowUp: -1, KeyW: -1, ArrowRight: 1, KeyD: 1, ArrowDown: 1, KeyS: 1 };
  window.addEventListener('keydown', (e) => {
    if (!m || who.teacher) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const code = e.code || { ' ': 'Space' }[e.key] || e.key;
    const act = code === 'Space' || code === 'Enter' || code === 'NumpadEnter';
    if (act) e.preventDefault(); // 화면이 내려가거나 초점 버튼이 따로 눌리지 않게
    if (!canVoteNow()) return;
    const confirming = !$('mt-confirm').hidden;
    if (MOVE[code]) {
      e.preventDefault();
      if (confirming) $('mt-no').click();
      kbMove(MOVE[code]);
      return;
    }
    if (code === 'Escape' && confirming) {
      $('mt-no').click();
      return;
    }
    if (!act || e.repeat) return;
    if (confirming) return $('mt-yes').click();
    if (!kbId) return kbMove(1); // 처음 누르면 첫 카드를 고른다
    if (kbId === 'skip') return $('mt-skip').click();
    const el = $('mt-cards').querySelector(`.mt-card[data-id="${CSS.escape(kbId)}"]`);
    if (el && !el.disabled) el.click();
  });

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
    kbId = null;
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
