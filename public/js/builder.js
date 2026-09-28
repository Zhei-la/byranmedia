/* 바이란 프롬프트 생성기
   1) 패턴 고르기 → 2) 칸을 한국어로 채우기 → 3) [적용하기] → 영어 프롬프트 */
(function () {
  var root = document.querySelector('[data-builder]');
  if (!root) return;

  /* ---------- 칸 ---------- */
  // 버튼: [화면에 보이는 한국어, 실제로 들어갈 영어]
  var FIELDS = [
    { key: 'subject', label: '주인공 (누구 / 무엇)', tag: 'SUBJECT', required: true, ph: '예: 20대 한국 여성, 부드러운 인상',
      chips: [['20대 한국 여성', 'a Korean woman in her early 20s'], ['30대 한국 여성', 'a Korean woman in her 30s'], ['20대 한국 남성', 'a Korean man in his 20s'],
        ['40대 여성', 'a Korean woman in her 40s'], ['50대 여성', 'a warm Korean woman in her 50s'], ['귀여운 강아지', 'a small fluffy puppy'], ['고양이', 'a curious tabby cat']] },
    { key: 'shot', label: '구도 · 찍는 방식', tag: 'SHOT', ph: '예: 상반신, 자연스러운 스냅',
      chips: [['상반신', 'framed from the waist up'], ['얼굴 클로즈업', 'tight close-up on the face'], ['전신', 'full-body shot'],
        ['셀카 각도', 'handheld selfie from a slightly high angle'], ['거울 셀카', 'mirror selfie with the phone visible'], ['정면 중앙', 'centered frontal composition'],
        ['자연스러운 스냅', 'candid snapshot, caught mid-moment'], ['뒷모습', 'seen from behind']] },
    { key: 'hair', label: '헤어 · 메이크업', tag: 'HAIR & MAKEUP', ph: '예: 어깨까지 오는 갈색 웨이브, 내추럴 메이크업',
      chips: [['긴 생머리', 'long straight black hair'], ['웨이브', 'soft wavy shoulder-length hair'], ['단발', 'chin-length bob'],
        ['묶은 머리', 'loose low updo with face-framing strands'], ['포니테일', 'high ponytail'], ['내추럴 메이크업', 'natural clean makeup, glossy lips'],
        ['블러셔 강조', 'soft rosy blush across the cheeks'], ['민낯', 'bare face with no makeup']] },
    { key: 'outfit', label: '옷 · 소품', tag: 'WARDROBE', ph: '예: 크림색 니트 가디건, 연청 청바지, 은색 목걸이',
      chips: [['흰 티 + 청바지', 'plain white T-shirt and straight denim'], ['니트', 'cozy cream knit sweater'], ['셔츠', 'crisp oversized white shirt'],
        ['트렌치코트', 'beige trench coat'], ['원피스', 'simple flowy dress'], ['운동복', 'matching athleisure set'], ['한복', 'modern hanbok in soft pastel colors'],
        ['커피 들고', 'holding an iced coffee'], ['우산', 'holding a clear umbrella']] },
    { key: 'pose', label: '포즈 · 표정', tag: 'POSE & EXPRESSION', ph: '예: 턱을 괴고 카메라를 보며 살짝 웃음',
      chips: [['카메라 응시', 'looking straight into the camera'], ['은은한 미소', 'soft closed-lip smile'], ['활짝 웃음', 'bright laughing smile'],
        ['턱 괴기', 'resting her chin on one hand'], ['걷는 중', 'walking toward the camera mid-step'], ['앉아 있음', 'seated in a relaxed pose'],
        ['윙크', 'playful wink'], ['뒤돌아보기', 'glancing back over the shoulder'], ['머리 넘기기', 'tucking hair behind her ear']] },
    { key: 'scene', label: '장소 · 배경', tag: 'SCENE', ph: '예: 비 오는 날 카페 창가',
      chips: [['카페 창가', 'window seat of a cozy cafe with wooden tables'], ['내 방', 'a tidy bedroom with white bedding'], ['서울 골목', 'a quiet Seoul alley'],
        ['한강 공원', 'Han River park at dusk'], ['흰 벽', 'a plain cream wall with soft negative space'], ['스튜디오', 'a seamless studio backdrop'],
        ['바다', 'a calm beach with gentle waves'], ['벚꽃길', 'a street lined with cherry blossoms'], ['비 오는 거리', 'a rainy city street with reflections']] },
    { key: 'light', label: '빛 (조명)', tag: 'LIGHTING', ph: '예: 창가로 들어오는 부드러운 햇빛',
      chips: [['창가 햇빛', 'soft diffused window light'], ['골든아워', 'warm golden hour backlight'], ['흐린 날', 'even overcast daylight'],
        ['스튜디오 조명', 'large softbox key light with gentle fill'], ['네온', 'moody neon rim light'], ['폰 플래시', 'direct on-camera phone flash'], ['밤 가로등', 'warm street lamps at night']] },
    { key: 'camera', label: '카메라 · 렌즈', tag: 'CAMERA', ph: '예: 폰카 느낌',
      chips: [['폰카 느낌', 'shot on a recent iPhone, natural phone exposure'], ['50mm', '50mm lens, natural perspective'], ['85mm 화보', '85mm lens, shallow depth of field'],
        ['필름 카메라', '35mm film camera, subtle grain'], ['매크로', 'macro lens, crisp fine detail']] },
    { key: 'color', label: '색감', tag: 'COLOR', ph: '예: 따뜻하고 차분한 색',
      chips: [['따뜻한 뉴트럴', 'warm neutral palette, low saturation'], ['파스텔', 'soft pastel lavender and cream'], ['쿨톤', 'cool blue tones with warm accents'],
        ['선명하게', 'vivid clean colors'], ['필름 톤', 'faded film color grading'], ['흑백', 'black and white']] },
    { key: 'mood', label: '분위기', tag: 'MOOD', ph: '예: 편안하고 자연스러운',
      chips: [['편안한', 'cozy and relaxed'], ['청량한', 'fresh and airy'], ['시크한', 'chic and confident'], ['몽환적', 'dreamy and ethereal'],
        ['시네마틱', 'cinematic and moody'], ['사랑스러운', 'sweet and lovely'], ['감성', 'quiet emotional mood']] },
    { key: 'detail', label: '디테일', tag: 'DETAILS', ph: '예: 잔머리, 옷 주름',
      chips: [['잔머리', 'real flyaway hairs'], ['옷 주름', 'natural fabric creases'], ['자연스러운 손', 'natural hands with correct fingers'],
        ['주근깨', 'light natural freckles'], ['제품 선명하게', 'crisp product edges and accurate materials']] },
  ];
  var CHIP = {};
  FIELDS.forEach(function (f) { f.chips.forEach(function (c) { CHIP[c[0]] = c[1]; }); });

  /* ---------- 사진 느낌 ---------- */
  var REAL = {
    photo: 'ultra-realistic photograph that looks like a real unedited photo taken by a person; natural skin texture with visible pores and fine peach fuzz, subtle facial asymmetry, individual hair strands, true-to-life colors, natural light falloff, slight lens imperfections, real-world depth of field',
    phone: 'casual unedited smartphone photo, natural phone HDR, slight sensor noise, imperfect everyday framing, authentic candid moment, realistic skin with pores and small blemishes',
    editorial: 'high-end editorial magazine photograph, professional lighting, tack-sharp focus, realistic skin with only light natural retouching, true-to-life fabric texture',
    illust: 'high-quality illustration, clean line art, consistent character design, detailed shading',
  };
  var NEG_PHOTO = 'CGI, 3D render, illustration, cartoon, anime, painting, digital art, doll-like face, plastic or waxy skin, airbrushed, beauty filter, over-smoothed skin, uncanny valley, oversized eyes, extra or missing fingers, deformed hands, distorted face, text, watermark, logo, oversaturated, blown highlights';
  var NEG_ILLUST = 'photorealistic, 3D render, blurry, extra fingers, deformed hands, text, watermark, logo, messy lines';

  /* ---------- 패턴 (칸에는 한국어로 채워 둔다) ---------- */
  var PATTERNS = [
    { id: 'portrait', icon: '👩', name: '기본 인물', desc: '자연스러운 인물 사진', real: 'photo',
      fill: { shot: '상반신, 자연스러운 스냅', camera: '50mm', light: '창가 햇빛', mood: '편안한', detail: '잔머리, 자연스러운 손' } },
    { id: 'selfie', icon: '🤳', name: '폰카 셀카·일상', desc: '진짜 폰으로 찍은 느낌', real: 'phone',
      fill: { shot: '셀카 각도', camera: '폰카 느낌', light: '창가 햇빛', color: '따뜻한 뉴트럴', mood: '편안한', detail: '잔머리, 옷 주름' } },
    { id: 'fashion', icon: '👗', name: '패션 화보', desc: '매거진 에디토리얼', real: 'editorial',
      fill: { shot: '전신', camera: '85mm 화보', light: '스튜디오 조명', color: '필름 톤', mood: '시크한', detail: '옷 주름' } },
    { id: 'beauty', icon: '💄', name: '뷰티 클로즈업', desc: '피부·메이크업 강조', real: 'editorial',
      fill: { shot: '얼굴 클로즈업', hair: '내추럴 메이크업', camera: '매크로', light: '창가 햇빛', color: '파스텔', mood: '청량한', detail: '주근깨, 잔머리' } },
    { id: 'street', icon: '🌆', name: '거리 스냅', desc: '길에서 찍힌 한 장면', real: 'photo',
      fill: { shot: '자연스러운 스냅, 전신', scene: '서울 골목', camera: '필름 카메라', light: '골든아워', color: '필름 톤', mood: '시네마틱', detail: '옷 주름' } },
    { id: 'product', icon: '🧴', name: '음식·제품', desc: '광고 컷 · 연출 사진', real: 'editorial',
      fill: { shot: '정면 중앙', scene: '흰 벽', camera: '매크로', light: '스튜디오 조명', color: '선명하게', mood: '청량한', detail: '제품 선명하게' } },
    { id: 'anime', icon: '🎨', name: '애니·일러스트', desc: '그림체 캐릭터', real: 'illust',
      fill: { shot: '상반신', light: '골든아워', color: '파스텔', mood: '몽환적' } },
    { id: 'sticker', icon: '📸', name: '네컷 사진', desc: '포토부스 네 컷', real: 'phone',
      fill: { shot: 'four-panel photo booth strip, same person with a different pose in each frame', camera: '폰카 느낌', light: '폰 플래시', mood: '사랑스러운', detail: '잔머리' } },
  ];

  var state = { pattern: 'portrait', model: 'chatgpt', ratio: '4:5', real: 'photo', translated: null, dirty: false, negEdited: false };

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var patWrap = root.querySelector('[data-patterns]');
  var fieldWrap = root.querySelector('[data-fields]');
  var out = root.querySelector('[data-out]');
  var neg = root.querySelector('[data-neg]');
  var stale = root.querySelector('[data-stale]');
  var modeEl = root.querySelector('[data-mode]');
  var applyBtn = root.querySelector('[data-apply]');
  var realSel = root.querySelector('[data-opt=real]');

  /* ---------- 그리기 ---------- */
  PATTERNS.forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lg-bpat';
    b.setAttribute('role', 'radio');
    b.dataset.id = p.id;
    b.innerHTML = '<span class="i">' + p.icon + '</span><b>' + p.name + '</b><small>' + p.desc + '</small>';
    b.addEventListener('click', function () { applyPattern(p.id); });
    patWrap.appendChild(b);
  });

  FIELDS.forEach(function (f) {
    var box = document.createElement('div');
    box.className = 'lg-bfield';
    var id = 'bf-' + f.key;
    box.innerHTML =
      '<label class="lg-lb" for="' + id + '">' + f.label + (f.required ? ' <span class="req">*</span>' : '') + '</label>' +
      '<textarea id="' + id + '" class="lg-in" rows="' + (f.key === 'subject' ? 2 : 1) + '" placeholder="' + f.ph.replace(/"/g, '&quot;') + '"></textarea>' +
      '<div class="lg-bchips"></div><p class="lg-ben" hidden></p>';
    var ta = box.querySelector('textarea');
    ta.addEventListener('input', markDirty);
    var chipWrap = box.querySelector('.lg-bchips');
    f.chips.forEach(function (c) {
      var cb = document.createElement('button');
      cb.type = 'button';
      cb.textContent = '+ ' + c[0];
      cb.title = c[1];
      cb.addEventListener('click', function () {
        var cur = ta.value.trim();
        if (cur.split(/\s*,\s*/).indexOf(c[0]) !== -1) return;
        ta.value = cur ? cur.replace(/[,\s]+$/, '') + ', ' + c[0] : c[0];
        markDirty();
      });
      chipWrap.appendChild(cb);
    });
    fieldWrap.appendChild(box);
  });

  function ta(key) { return document.getElementById('bf-' + key); }

  function applyPattern(id) {
    state.pattern = id;
    var p = PATTERNS.filter(function (x) { return x.id === id; })[0];
    patWrap.querySelectorAll('.lg-bpat').forEach(function (b) {
      var on = b.dataset.id === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    FIELDS.forEach(function (f) {
      if (f.key === 'subject') return; // 주인공은 지키기
      ta(f.key).value = p.fill[f.key] || '';
    });
    if (p.real === 'illust') {
      state.real = 'illust';
      realSel.disabled = true;
    } else {
      realSel.disabled = false;
      state.real = p.real;
      realSel.value = p.real;
    }
    markDirty();
  }

  function markDirty() {
    state.dirty = true;
    var v = FIELDS.filter(function (f) { return ta(f.key).value.trim(); }).length;
    root.querySelector('[data-filled]').textContent = Math.round((v / FIELDS.length) * 100) + '% 채워짐';
    if (state.translated) stale.hidden = false;
  }

  /* ---------- 적용: 버튼 말 → 영어, 나머지 한국어 → 서버 번역 ---------- */
  function chipToEnglish(text) {
    return String(text || '').split(/\s*,\s*/).map(function (part) {
      var p = part.trim();
      return CHIP[p] || p;
    }).filter(Boolean).join(', ');
  }

  applyBtn.addEventListener('click', function () {
    var raw = {};
    FIELDS.forEach(function (f) { raw[f.key] = chipToEnglish(ta(f.key).value); });
    if (!raw.subject) {
      ta('subject').focus();
      out.value = '주인공 칸부터 채워 주세요. 예) 20대 한국 여성';
      out.classList.add('empty');
      return;
    }
    applyBtn.disabled = true;
    var old = applyBtn.textContent;
    applyBtn.textContent = '만드는 중…';
    fetch('/prompts/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields: raw }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) throw new Error(d.error);
        state.translated = d.fields || raw;
        state.dirty = false;
        stale.hidden = true;
        showEnglish();
        render();
        if (d.mode === 'ai') modeEl.textContent = 'AI가 한국어를 영어로 바꿨어요.';
        else if (d.mode === 'dict') modeEl.textContent = d.left ? '아는 단어는 영어로 바꿨고, 모르는 단어는 한국어 그대로 넣었어요. (챗지피티는 알아들어요)' : '모두 영어로 바꿨어요.';
        else modeEl.textContent = '영어 그대로 만들었어요.';
      })
      .catch(function (e) {
        state.translated = raw;
        render();
        modeEl.textContent = (e && e.message) || '번역을 못 해서 입력한 그대로 만들었어요.';
      })
      .then(function () { applyBtn.disabled = false; applyBtn.textContent = old; });
  });

  function showEnglish() {
    FIELDS.forEach(function (f) {
      var p = ta(f.key).parentNode.querySelector('.lg-ben');
      var v = state.translated && state.translated[f.key];
      var orig = ta(f.key).value.trim();
      if (v && v !== orig) { p.textContent = '→ ' + v; p.hidden = false; } else { p.hidden = true; }
    });
  }

  /* ---------- 프롬프트 조립 ---------- */
  function clean(s) { return String(s || '').trim().replace(/\s+/g, ' ').replace(/[,.\s]+$/, ''); }
  var RATIO_WORD = { '4:5': 'vertical 4:5', '9:16': 'vertical 9:16', '1:1': 'square 1:1', '2:3': 'vertical 2:3', '16:9': 'horizontal 16:9' };
  function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function build() {
    var v = {};
    FIELDS.forEach(function (f) { v[f.key] = clean(state.translated[f.key]); });
    var realKey = state.pattern === 'anime' ? 'illust' : state.real;
    var real = REAL[realKey];
    var negText = clean(neg.value);
    var isPhoto = realKey !== 'illust';

    if (state.model === 'flux') {
      var kw = [isPhoto ? 'RAW photo, photorealistic' : 'illustration'];
      FIELDS.forEach(function (f) { if (v[f.key]) kw.push(v[f.key]); });
      kw.push(real, RATIO_WORD[state.ratio] + ' aspect ratio');
      return kw.join(', ');
    }

    if (state.model === 'mj') {
      var s = [];
      var head = [v.shot, v.subject].filter(Boolean).join(' of ');
      if (head) s.push(capital(head));
      if (v.hair) s.push(capital(v.hair));
      if (v.outfit) s.push('Wearing ' + v.outfit);
      if (v.pose) s.push(capital(v.pose));
      if (v.scene) s.push('In ' + v.scene);
      if (v.light) s.push(capital(v.light));
      if (v.camera) s.push(capital(v.camera));
      if (v.color) s.push(capital(v.color));
      if (v.mood) s.push(capital(v.mood) + ' mood');
      if (v.detail) s.push(capital(v.detail));
      s.push(capital(real));
      var text = s.join('. ') + ' --ar ' + state.ratio + (isPhoto ? ' --style raw' : '') + ' --v 7';
      text += ' --no ' + negText.split(',').slice(0, 10).map(function (x) { return x.trim(); }).join(', ');
      return text;
    }

    // 챗지피티 · 나노바나나: 맨 위에 "바로 이미지를 만들어 달라" 요청
    var lines = [];
    lines.push(isPhoto
      ? 'Create one photorealistic image from the description below. Do not ask me any questions and do not reply with text — generate the image right away.'
      : 'Create one illustration from the description below. Do not ask me any questions and do not reply with text — generate the image right away.');
    lines.push('(아래 설명대로 이미지를 바로 만들어 주세요. 질문하지 말고 이미지만 생성해 주세요.)');
    lines.push('');
    FIELDS.forEach(function (f) {
      if (!v[f.key]) return;
      var t = v[f.key];
      if (f.key === 'shot') t = t + ', ' + RATIO_WORD[state.ratio] + ' aspect ratio';
      lines.push(f.tag + ': ' + t + '.');
    });
    if (!v.shot) lines.push('FORMAT: ' + RATIO_WORD[state.ratio] + ' aspect ratio.');
    lines.push('REALISM: ' + real + '.');
    lines.push('AVOID: ' + negText + '.');
    return lines.join('\n');
  }

  var countEl = root.querySelector('[data-count]');
  function render() {
    var realKey = state.pattern === 'anime' ? 'illust' : state.real;
    if (!state.negEdited) neg.value = realKey === 'illust' ? NEG_ILLUST : NEG_PHOTO;
    if (!state.translated) {
      out.value = '칸을 채우고 [적용하기]를 누르면 여기에 프롬프트가 만들어져요.';
      out.classList.add('empty');
      countEl.textContent = '0 words';
      return;
    }
    var t = build();
    out.value = t;
    out.classList.remove('empty');
    countEl.textContent = t.split(/\s+/).length + ' words';
  }

  neg.addEventListener('input', function () { state.negEdited = true; if (state.translated) render(); });
  root.querySelectorAll('[data-opt]').forEach(function (sel) {
    sel.addEventListener('change', function () { state[sel.dataset.opt] = sel.value; render(); });
  });
  root.querySelector('[data-reset]').addEventListener('click', function () {
    FIELDS.forEach(function (f) { ta(f.key).value = ''; });
    state.translated = null; state.negEdited = false; stale.hidden = true;
    showEnglish(); markDirty(); render();
  });

  /* ---------- 복사 · 저장 ---------- */
  function copy(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '복사됨 ✓';
      setTimeout(function () { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
    } else { fallback(text); done(); }
  }
  function fallback(text) {
    var t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove();
  }
  root.querySelector('[data-copy-out]').addEventListener('click', function (e) {
    if (out.classList.contains('empty')) return;
    copy(out.value, e.currentTarget);
  });
  root.querySelector('[data-copy-neg]').addEventListener('click', function (e) { copy(neg.value, e.currentTarget); });
  root.querySelector('[data-save-txt]').addEventListener('click', function () {
    if (out.classList.contains('empty')) return;
    var blob = new Blob([out.value + '\n\nNEGATIVE: ' + neg.value + '\n'], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'byran-prompt-' + Date.now() + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
  });

  var histWrap = root.querySelector('[data-history-wrap]');
  var histList = root.querySelector('[data-history]');
  function drawHistory() {
    var h = load('byranPromptHistory2', []);
    histWrap.hidden = !h.length;
    histList.innerHTML = '';
    h.forEach(function (item, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.title;
      b.addEventListener('click', function () {
        applyPattern(item.pattern);
        FIELDS.forEach(function (f) { ta(f.key).value = item.values[f.key] || ''; });
        markDirty();
        window.scrollTo({ top: root.offsetTop - 60, behavior: 'smooth' });
      });
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', '지우기');
      x.addEventListener('click', function () { h.splice(i, 1); save('byranPromptHistory2', h); drawHistory(); });
      li.appendChild(b); li.appendChild(x);
      histList.appendChild(li);
    });
  }
  root.querySelector('[data-remember]').addEventListener('click', function (e) {
    var values = {};
    FIELDS.forEach(function (f) { values[f.key] = ta(f.key).value; });
    if (!values.subject.trim()) return;
    var h = load('byranPromptHistory2', []);
    var p = PATTERNS.filter(function (x) { return x.id === state.pattern; })[0];
    var sub = values.subject.trim();
    h.unshift({ title: p.icon + ' ' + (sub.length > 36 ? sub.slice(0, 36) + '…' : sub), pattern: state.pattern, values: values });
    save('byranPromptHistory2', h.slice(0, 12));
    drawHistory();
    var btn = e.currentTarget, old = btn.textContent;
    btn.textContent = '저장됨 ✓';
    setTimeout(function () { btn.textContent = old; }, 1400);
  });

  applyPattern('portrait');
  state.translated = null;
  stale.hidden = true;
  render();
  drawHistory();
})();
