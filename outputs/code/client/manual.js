// "놀이 방법 보기" 창 (선생님·학생 모두). 첫 화면·대기방의 .open-manual 버튼으로 연다.
const $ = (id) => document.getElementById(id);

const PAGES = {
  sleep: `
    <h3>잠귀신 술래잡기</h3>
    <ul>
      <li>한밤의 학교에 잠 안개가 피어올랐어요. <b>학생</b>은 꺼진 <b>퀴즈 랜턴</b>을 찾아 퀴즈를 맞히고 불을 켜요.</li>
      <li>랜턴을 켤수록 <b>새벽빛</b>이 올라가요. 새벽빛이 100%가 되면 아침이 와서 학생 팀이 이겨요.</li>
      <li><b>잠귀신</b>에게 닿으면 그 자리에서 <b>꿈에 빠져요</b>. 친구가 옆에서 버튼을 꾹 눌러 <b>깨워 주면</b> 다시 움직일 수 있어요.</li>
      <li>잠귀신은 퀴즈를 맞혀 <b>꿈 구슬</b>을 모아야 친구를 꿈에 빠뜨릴 수 있어요. 시간이 끝날 때까지 아침이 안 오거나, 모두 꿈에 빠지면 잠귀신이 이겨요.</li>
      <li>시간이 지나면 <b>잠 안개</b>가 점점 좁혀 와요. 안개 밖은 느리고 어둡고, 오래 있으면 졸려서 잠들어요.</li>
      <li><b>보급 상자</b>가 방 안 가구 속에 숨겨져요. 찾아서 꾹 눌러 열면 아이템이 가방에 들어가요.</li>
      <li>개구멍·미끄럼틀은 학생만 탈 수 있어요. 잠귀신은 따라오지 못해요.</li>
    </ul>`,
  mafia: `
    <h3>꿈도둑을 찾아라</h3>
    <p class="note"><b>꿈도둑</b>은 마피아 게임의 마피아, 어몽어스의 임포스터와 같은 역할이에요.</p>
    <ul>
      <li>학생들 사이에 <b>꿈도둑</b>이 몰래 숨어 있어요. 누가 꿈도둑인지는 꿈도둑끼리만 알아요.</li>
      <li>학생은 퀴즈 랜턴을 켜서 새벽빛을 모아요. 꿈도둑도 학생인 척 퀴즈를 풀어요.</li>
      <li>꿈도둑은 몰래 학생을 <b>꿈에 빠뜨려요</b>. 꿈에 빠진 학생은 머리 위에 고리가 생기고, 말은 못 하지만 랜턴은 계속 켤 수 있어요.</li>
      <li>꿈에 빠진 친구를 보면 <b>호루라기</b>를 불거나 <b>회의 종</b>을 울려 <b>모닥불 회의</b>를 열어요.</li>
      <li>회의에서는 말로 이야기한 뒤, 꿈도둑 같은 친구를 <b>지목</b>해요. 모르겠으면 <b>기권</b>해도 돼요. 표를 가장 많이 받은 사람은 추방돼요.</li>
      <li>꿈도둑을 모두 찾거나 새벽빛이 100%가 되면 학생 팀 승리! 학생이 꿈도둑만큼 줄어들거나 시간이 끝나면 꿈도둑 승리예요.</li>
      <li>꿈도둑은 <b>작전</b>도 써요: 안개 뿌리기(앞이 어두워져요), 문 막기(덩굴로 문을 막아요), 변신(다른 친구 모습이 돼요).</li>
    </ul>`,
  keys: `
    <h3>조작 방법</h3>
    <ul>
      <li>움직이기: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 또는 화살표. 태블릿은 화면을 누른 채 끌어요.</li>
      <li><kbd>스페이스</kbd> (또는 <kbd>엔터</kbd>): 지금 할 수 있는 행동 하나. 오른쪽 아래 큰 동그라미 버튼에 무슨 일이 일어날지 적혀 있어요. 깨우기·상자 열기는 꾹 누르고 있어요.</li>
      <li><kbd>Q</kbd> 가방 (아이템 쓰기) · <kbd>B</kbd> 퀴즈 수첩 · <kbd>Tab</kbd> 작은 지도</li>
      <li>꿈도둑만: <kbd>F</kbd> 꿈에 빠뜨리기 · <kbd>G</kbd> 작전 (그다음 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>)</li>
      <li>게임 중에는 이름 대신 <b>맛 + 캐릭터</b>(예: 딸기 고양이)로 불러요.</li>
    </ul>`,
};

export function initManual() {
  const dlg = $('dlg-manual');
  const tabs = { sleep: $('mn-tab-sleep'), mafia: $('mn-tab-mafia'), keys: $('mn-tab-keys') };
  function showPage(key) {
    $('mn-body').innerHTML = PAGES[key]; // 이 파일 안의 고정 글만 넣는다
    for (const [k, b] of Object.entries(tabs)) b.setAttribute('aria-selected', String(k === key));
  }
  for (const [k, b] of Object.entries(tabs)) b.addEventListener('click', () => showPage(k));
  $('mn-close').addEventListener('click', () => dlg.close());
  // mode: 'sleep-tag' | 'mafia' (지금 대기방 설정에 맞춰 먼저 보여 줄 쪽)
  function open(mode) {
    showPage(mode === 'mafia' ? 'mafia' : 'sleep');
    if (!dlg.open) dlg.showModal();
  }
  return { open };
}
