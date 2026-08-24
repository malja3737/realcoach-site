/* 문의 알림 — 홈페이지에 문의가 들어오면 텔레그램으로 알려 준다.
 *
 * 왜 서버가 필요한가
 *   전에는 방문자의 브라우저가 텔레그램에 직접 알림을 보냈다. 그러려면 봇 토큰이
 *   홈페이지 파일 안에 들어 있어야 해서, 누구나 「소스 보기」로 토큰을 가져갈 수 있었다.
 *   토큰을 가져간 사람은 센터장님 텔레그램으로 가짜 문의 알림을 보내거나
 *   봇을 통째로 빼앗을 수 있다. 그래서 알림 보내는 일을 이 서버 파일로 옮겼다.
 *   이제 토큰은 버셀 안에만 있고, 홈페이지 파일에는 흔적조차 없다.
 *
 * 버셀에 넣어 두어야 하는 값 (Settings → Environment Variables)
 *   TELEGRAM_TOKEN   BotFather 에서 받은 봇 토큰
 *   TELEGRAM_CHAT    알림을 받을 채팅 ID (아래 probe 로 찾을 수 있다)
 *   ADMIN_PIN        관리자 비밀번호 — 테스트·채팅ID찾기를 쓸 때 확인용
 *
 * 하는 일 세 가지
 *   {text}              문의 내용을 알림으로 보낸다 (홈페이지 문의폼이 부른다)
 *   {probe:true, pin}   봇과 나눈 대화에서 채팅 ID 를 찾아 준다 (관리자만)
 *   {test:true,  pin}   시험 메시지를 보내 연결을 확인한다 (관리자만)
 */

const TG = 'https://api.telegram.org/bot';
const MAX_LEN = 3000;          // 너무 긴 글은 잘라서 보낸다
const MAX_BODY = 8000;         // 이보다 큰 요청은 받지 않는다

/* 남이 이 주소로 장난 문의를 퍼붓지 못하게, 우리 홈페이지에서 온 요청만 받는다.
   완벽한 차단은 아니지만(주소는 흉내 낼 수 있다) 지나가는 장난은 대부분 막힌다.
   토큰이 공개돼 있던 예전보다는 훨씬 안전하다. */
function fromOurSite(req) {
  const allow = process.env.ALLOWED_ORIGIN;          // 예: https://www.realcoach1.com
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const host = req.headers.host || '';
  if (allow) {
    const list = allow.split(',').map(s => s.trim()).filter(Boolean);
    return list.some(a => origin === a || referer.indexOf(a) === 0);
  }
  if (!origin && !referer) return false;             // 브라우저가 아닌 요청
  try {
    const u = new URL(origin || referer);
    return u.host === host;                          // 같은 홈페이지에서 온 것만
  } catch (e) { return false; }
}

async function tg(token, method, payload) {
  const r = await fetch(TG + token + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(() => ({ ok: false }));
  return j;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST 로만 받습니다.' });
    return;
  }

  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT;
  const pin = process.env.ADMIN_PIN;

  if (!token) {
    res.status(200).json({ ok: false, error: '알림이 아직 연결되지 않았습니다. 버셀에 TELEGRAM_TOKEN 을 넣어 주세요.' });
    return;
  }

  const body = req.body || {};

  try {
    /* ── 관리자 전용: 채팅 ID 찾기 ────────────────────── */
    if (body.probe) {
      if (!pin || String(body.pin || '') !== String(pin)) {
        res.status(401).json({ ok: false, error: '비밀번호가 맞지 않습니다.' });
        return;
      }
      const j = await tg(token, 'getUpdates', {});
      if (!j.ok) { res.status(200).json({ ok: false, error: '봇 토큰이 올바르지 않습니다.' }); return; }
      let id = null;
      (j.result || []).forEach(function (u) {
        const m = u.message || u.channel_post;
        if (m && m.chat) id = m.chat.id;
      });
      if (!id) {
        res.status(200).json({ ok: false, error: '아직 봇과 나눈 대화가 없습니다. 텔레그램에서 내 봇을 찾아 /start 를 먼저 보내 주세요.' });
        return;
      }
      res.status(200).json({ ok: true, chat: String(id) });
      return;
    }

    /* ── 관리자 전용: 시험 전송 ───────────────────────── */
    if (body.test) {
      if (!pin || String(body.pin || '') !== String(pin)) {
        res.status(401).json({ ok: false, error: '비밀번호가 맞지 않습니다.' });
        return;
      }
      if (!chat) { res.status(200).json({ ok: false, error: '버셀에 TELEGRAM_CHAT 값이 없습니다.' }); return; }
      const j = await tg(token, 'sendMessage', {
        chat_id: chat,
        text: '✅ 홈페이지 알림 연결 성공!\n이제 문의가 접수되면 이 채팅으로 바로 알림이 도착합니다.',
      });
      res.status(200).json(j.ok ? { ok: true } : { ok: false, error: '전송 실패 — 채팅 ID 를 다시 확인해 주세요.' });
      return;
    }

    /* ── 홈페이지 문의 알림 ───────────────────────────── */
    if (!fromOurSite(req)) {
      res.status(403).json({ ok: false, error: '허용되지 않은 요청입니다.' });
      return;
    }
    if (!chat) {
      res.status(200).json({ ok: false, error: '알림 받을 채팅이 설정되지 않았습니다.' });
      return;
    }

    const raw = String(body.text || '');
    if (raw.length > MAX_BODY) { res.status(413).json({ ok: false, error: '내용이 너무 깁니다.' }); return; }
    const text = raw.trim().slice(0, MAX_LEN);
    if (!text) { res.status(400).json({ ok: false, error: '보낼 내용이 없습니다.' }); return; }

    const j = await tg(token, 'sendMessage', {
      chat_id: chat,
      text: '📩 홈페이지 새 문의가 도착했습니다!\n\n' + text,
    });
    res.status(200).json(j.ok ? { ok: true } : { ok: false, error: '전송 실패' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
