/* 바이란 프롬프트 생성기 — 서버 없이 브라우저에서만 돈다 */
(function () {
  var root = document.querySelector('[data-builder]');
  if (!root) return;

  /* ---------- 칸 정의 ---------- */
  // 각 칸: key, 한국어 이름, 영어 머리말(상세형), 예시, 제안어 [한국어 표시, 영어 값]
  var FIELDS = [
    { key: 'shot', label: '구도 · 촬영 방식', tag: 'SHOT', ph: '예: candid portrait framed from the waist up',
      chips: [['상반신', 'framed from the waist up'], ['얼굴 클로즈업', 'tight close-up on the face'], ['전신', 'full-body shot'],
        ['셀카 각도', 'handheld selfie from a slightly high angle'], ['거울 셀카', 'mirror selfie'], ['정면 중앙', 'centered frontal composition'], ['자연스러운 스냅', 'candid snapshot feel']] },
    { key: 'subject', label: '주인공 (누구 / 무엇)', tag: 'SUBJECT', required: true, ph: '예: a 20-year-old Korean woman with a soft, friendly face',
      chips: [['20대 한국 여성', 'a Korean woman in her early 20s'], ['30대 한국 여성', 'a Korean woman in her 30s'], ['20대 한국 남성', 'a Korean man in his 20s'],
        ['50대 여성', 'a warm Korean woman in her 50s'], ['귀여운 강아지', 'a small fluffy puppy'], ['고양이', 'a curious tabby cat']] },
    { key: 'hair', label: '헤어 · 메이크업', tag: 'HAIR & MAKEUP', ph: '예: shoulder-length wavy dark brown hair, natural makeup',
      chips: [['긴 생머리', 'long straight black hair'], ['웨이브', 'soft wavy shoulder-length hair'], ['단발', 'chin-length bob'], ['묶은 머리', 'loose low updo with face-framing strands'],
        ['내추럴 메이크업', 'natural clean makeup, glossy lips'], ['블러셔 강조', 'soft rosy blush across the cheeks']] },
    { key: 'outfit', label: '의상', tag: 'WARDROBE', ph: '예: cream knit cardigan over a white tee, light denim',
      chips: [['흰 티 + 청바지', 'plain white T-shirt and straight denim'], ['니트', 'cozy cream knit sweater'], ['셔츠', 'crisp oversized white shirt'],
        ['트렌치코트', 'beige trench coat'], ['운동복', 'matching athleisure set'], ['한복', 'modern hanbok in soft pastel colors']] },
    { key: 'pose', label: '포즈 · 표정', tag: 'POSE & EXPRESSION', ph: '예: resting her chin on one hand, smiling softly at the camera',
      chips: [['카메라 응시', 'looking straight into the camera'], ['은은한 미소', 'soft closed-lip smile'], ['턱 괴기', 'resting her chin on one hand'],
        ['걷는 중', 'walking toward the camera mid-step'], ['앉아 있음', 'seated in a relaxed pose'], ['윙크', 'playful wink'], ['뒤돌아보기', 'glancing back over the shoulder']] },
    { key: 'scene', label: '장소 · 배경', tag: 'SCENE', ph: '예: a small sunlit cafe with wooden tables',
      chips: [['카페', 'a cozy cafe with wooden tables'], ['내 방', 'a tidy bedroom with white bedding'], ['서울 골목', 'a quiet Seoul alley'], ['한강 공원', 'Han River park at dusk'],
        ['흰 벽', 'a plain cream wall with soft negative space'], ['스튜디오', 'a seamless studio backdrop'], ['바다', 'a calm beach with gentle waves']] },
    { key: 'light', label: '조명', tag: 'LIGHTING', ph: '예: soft diffused window light from the left',
      chips: [['창가 햇빛', 'soft diffused window light'], ['골든아워', 'warm golden hour backlight'], ['흐린 날', 'even overcast daylight'],
        ['스튜디오 소프트', 'large softbox key light, gentle fill'], ['네온', 'moody neon rim light'], ['플래시', 'direct on-camera flash, candid party feel']] },
    { key: 'camera', label: '카메라 · 렌즈', tag: 'CAMERA', ph: '예: shot on a recent smartphone in portrait mode',
      chips: [['폰카 느낌', 'recent smartphone camera, portrait mode, natural phone exposure'], ['50mm', '50mm lens, natural perspective'], ['85mm 화보', '85mm lens, shallow depth of field'],
        ['필름 카메라', '35mm film camera, subtle grain'], ['매크로', 'macro lens, crisp fine detail']] },
    { key: 'color', label: '색감', tag: 'COLOR', ph: '예: warm neutral palette, low saturation',
      chips: [['따뜻한 뉴트럴', 'warm neutral palette, low saturation'], ['파스텔', 'soft pastel lavender and cream'], ['쿨톤', 'cool blue tones with warm accents'],
        ['선명하게', 'vivid clean colors'], ['흑백', 'black and white']] },
    { key: 'mood', label: '분위기', tag: 'MOOD', ph: '예: cozy, relaxed, effortlessly natural',
      chips: [['편안한', 'cozy and relaxed'], ['청량한', 'fresh and airy'], ['시크한', 'chic and confident'], ['몽환적', 'dreamy and ethereal'], ['시네마틱', 'cinematic and moody'], ['사랑스러운', 'sweet and lovely']] },
    { key: 'detail', label: '디테일 · 질감', tag: 'TEXTURE', ph: '예: realistic skin texture with fine pores, natural hands',
      chips: [['사실적인 피부', 'realistic skin texture with fine pores and subtle variation'], ['자연스러운 손', 'natural hands with correct fingers'], ['옷 주름', 'fabric creasing naturally'],
        ['잔머리', 'real flyaway hairs'], ['제품 선명하게', 'crisp product edges, accurate materials']] },
  ];

  var NEG_DEFAULT = 'plastic waxy skin, over-smoothed face, doll-like symmetry, oversized eyes, extra or missing fingers, distorted hands, readable text, logos, watermark, oversaturation, blown highlights, blurry face';

  /* ---------- 패턴 ---------- */
  var PATTERNS = [
    { id: 'portrait', icon: '👩', name: '기본 인물', desc: '자연스러운 인물 사진', level: '초급',
      fill: { shot: 'natural portrait framed from the waist up', camera: '50mm lens, natural perspective', light: 'soft diffused window light', mood: 'calm and natural', detail: 'realistic skin texture with fine pores and subtle variation' } },
    { id: 'selfie', icon: '🤳', name: '폰카 셀카·일상', desc: '진짜 폰으로 찍은 느낌', level: '초급',
      fill: { shot: 'handheld selfie from a slightly high angle, casual everyday snapshot', camera: 'recent smartphone camera, portrait mode, natural phone exposure, subtle sensor noise', light: 'soft diffused window light', color: 'warm neutral palette, low saturation', mood: 'cozy, candid, effortlessly natural', detail: 'realistic skin texture with fine pores, real flyaway hairs' } },
    { id: 'fashion', icon: '👗', name: '패션 화보', desc: '매거진 에디토리얼', level: '중급',
      fill: { shot: 'full-body fashion editorial shot', camera: '85mm lens, shallow depth of field', light: 'large softbox key light, gentle fill', color: 'muted tones with one accent color', mood: 'chic and confident', detail: 'fabric creasing naturally, crisp garment details' } },
    { id: 'beauty', icon: '💄', name: '뷰티 클로즈업', desc: '피부·메이크업 강조', level: '중급',
      fill: { shot: 'extreme close-up beauty shot on the face', camera: 'macro lens, crisp fine detail', light: 'soft beauty dish light, clean catchlights', color: 'soft pastel tones', mood: 'fresh and luminous', detail: 'realistic skin texture with fine pores, natural makeup detail' } },
    { id: 'cosplay', icon: '🧚', name: '캐릭터·코스프레', desc: '의상·소품 디테일', level: '중급',
      fill: { shot: 'three-quarter cosplay portrait', camera: '85mm lens, shallow depth of field', light: 'dramatic rim light with soft fill', mood: 'playful and vivid', detail: 'detailed costume materials, natural hands with correct fingers' } },
    { id: 'product', icon: '🧴', name: '음식·제품', desc: '광고 컷, 누끼 연출', level: '초급',
      fill: { shot: 'centered product hero shot', subject: '', camera: 'macro lens, crisp fine detail', scene: 'a clean marble surface with soft shadows', light: 'large softbox key light, gentle fill', color: 'vivid clean colors', mood: 'premium and fresh', detail: 'crisp product edges, accurate materials' } },
    { id: 'anime', icon: '🎨', name: '애니·일러스트', desc: '그림체 캐릭터', level: '초급',
      fill: { shot: 'anime key visual, medium shot', camera: 'illustration, no camera artifacts', light: 'soft cinematic lighting with bloom', color: 'soft pastel lavender and cream', mood: 'dreamy and ethereal', detail: 'clean line art, detailed eyes, painterly background' } },
    { id: 'sticker', icon: '📸', name: '네컷·스티커', desc: '여러 컷 한 장에', level: '중급',
      fill: { shot: 'four-panel photo booth strip, same person in each frame with different poses', camera: 'photo booth camera, bright even flash', light: 'direct on-camera flash, candid party feel', mood: 'sweet and lovely', detail: 'consistent face and outfit across all panels' } },
  ];

  var state = { pattern: 'portrait', values: {}, model: 'chatgpt', ratio: '4:5', style: 'detail', negEdited: false };

  /* ---------- 저장 (브라우저에만, 실패해도 괜찮게) ---------- */
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- 그리기 ---------- */
  var patWrap = root.querySelector('[data-patterns]');
  var fieldWrap = root.querySelector('[data-fields]');
  var out = root.querySelector('[data-out]');
  var neg = root.querySelector('[data-neg]');

  PATTERNS.forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lg-bpat';
    b.setAttribute('role', 'radio');
    b.dataset.id = p.id;
    b.innerHTML = '<span class="i">' + p.icon + '</span><b>' + p.name + '</b><small>' + p.desc + '</small><em>' + p.level + '</em>';
    b.addEventListener('click', function () { applyPattern(p.id, true); });
    patWrap.appendChild(b);
  });

  FIELDS.forEach(function (f) {
    var box = document.createElement('div');
    box.className = 'lg-bfield';
    var id = 'bf-' + f.key;
    box.innerHTML =
      '<label class="lg-lb" for="' + id + '">' + f.label + (f.required ? ' <span class="req">*</span>' : '') + '</label>' +
      '<textarea id="' + id + '" class="lg-in" rows="' + (f.key === 'subject' ? 2 : 1) + '" placeholder="' + f.ph.replace(/"/g, '&quot;') + '"></textarea>' +
      '<div class="lg-bchips"></div>';
    var ta = box.querySelector('textarea');
    ta.addEventListener('input', function () { state.values[f.key] = ta.value; render(); });
    var chipWrap = box.querySelector('.lg-bchips');
    f.chips.forEach(function (c) {
      var cb = document.createElement('button');
      cb.type = 'button';
      cb.textContent = '+ ' + c[0];
      cb.title = c[1];
      cb.addEventListener('click', function () {
        var cur = ta.value.trim();
        if (cur.indexOf(c[1]) !== -1) return;
        ta.value = cur ? cur.replace(/[,\s]+$/, '') + ', ' + c[1] : c[1];
        state.values[f.key] = ta.value;
        render();
      });
      chipWrap.appendChild(cb);
    });
    fieldWrap.appendChild(box);
  });

  function applyPattern(id, overwrite) {
    state.pattern = id;
    var p = PATTERNS.filter(function (x) { return x.id === id; })[0];
    patWrap.querySelectorAll('.lg-bpat').forEach(function (b) {
      var on = b.dataset.id === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    FIELDS.forEach(function (f) {
      var ta = document.getElementById('bf-' + f.key);
      var v = p.fill[f.key];
      if (v === undefined) return;
      if (overwrite || !ta.value.trim()) {
        // 주인공 칸은 사용자가 쓴 게 있으면 지키기
        if (f.key === 'subject' && ta.value.trim() && overwrite) return;
        ta.value = v;
        state.values[f.key] = v;
      }
    });
    render();
  }

  /* ---------- 문장 만들기 ---------- */
  function clean(s) { return String(s || '').trim().replace(/\s+/g, ' ').replace(/[,.\s]+$/, ''); }
  function vals() {
    var o = {};
    FIELDS.forEach(function (f) { o[f.key] = clean(document.getElementById('bf-' + f.key).value); });
    return o;
  }
  var RATIO_WORD = { '4:5': 'vertical 4:5', '9:16': 'vertical 9:16', '1:1': 'square 1:1', '2:3': 'vertical 2:3', '16:9': 'horizontal 16:9' };

  function build() {
    var v = vals();
    var model = state.model, style = state.style, ratio = state.ratio;
    var negText = clean(neg.value) || NEG_DEFAULT;

    if (model === 'flux') {
      var kw = FIELDS.map(function (f) { return v[f.key]; }).filter(Boolean);
      kw.push(RATIO_WORD[ratio] + ' aspect ratio', 'high detail', 'photorealistic');
      return kw.join(', ');
    }

    var parts;
    if (style === 'detail' && model !== 'mj') {
      parts = [];
      FIELDS.forEach(function (f) {
        if (!v[f.key]) return;
        var t = v[f.key];
        if (f.key === 'shot') t = t + ', ' + RATIO_WORD[ratio];
        parts.push(f.tag + ': ' + t + '.');
      });
      if (model === 'chatgpt' || model === 'any') parts.push('AVOID: ' + negText + '.');
      return parts.join('\n');
    }

    // 한 문단
    var s = [];
    var head = [v.shot, v.subject].filter(Boolean).join(' of ');
    if (head) s.push(capital(head));
    if (v.hair) s.push('Hair and makeup: ' + v.hair);
    if (v.outfit) s.push('Wearing ' + v.outfit);
    if (v.pose) s.push(capital(v.pose));
    if (v.scene) s.push('Setting: ' + v.scene);
    if (v.light) s.push('Lighting: ' + v.light);
    if (v.camera) s.push(capital(v.camera));
    if (v.color) s.push('Color: ' + v.color);
    if (v.mood) s.push('Mood: ' + v.mood);
    if (v.detail) s.push(capital(v.detail));
    var text = s.join('. ') + (s.length ? '.' : '');
    if (model === 'mj') {
      text = text.replace(/\.$/, '') + ' --ar ' + ratio + ' --style raw --v 7';
      text += ' --no ' + negText.split(',').slice(0, 8).map(function (x) { return x.trim(); }).join(', ');
    } else {
      text += ' Aspect ratio ' + ratio + '. Avoid: ' + negText + '.';
    }
    return text;
  }
  function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  var countEl = root.querySelector('[data-count]');
  var filledEl = root.querySelector('[data-filled]');
  function render() {
    if (!state.negEdited) neg.value = NEG_DEFAULT;
    var v = vals();
    var t = v.subject ? build() : '';
    out.value = t || '주인공 칸을 채우면 여기에 프롬프트가 만들어져요.';
    out.classList.toggle('empty', !t);
    var words = t ? t.split(/\s+/).length : 0;
    countEl.textContent = words + ' words';
    var n = FIELDS.filter(function (f) { return v[f.key]; }).length;
    filledEl.textContent = Math.round((n / FIELDS.length) * 100) + '% 채워짐';
  }

  neg.addEventListener('input', function () { state.negEdited = true; render(); });
  root.querySelectorAll('[data-opt]').forEach(function (sel) {
    sel.addEventListener('change', function () { state[sel.dataset.opt] = sel.value; render(); });
  });
  root.querySelector('[data-reset]').addEventListener('click', function () {
    FIELDS.forEach(function (f) { document.getElementById('bf-' + f.key).value = ''; });
    state.negEdited = false;
    render();
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
    var h = load('byranPromptHistory', []);
    histWrap.hidden = !h.length;
    histList.innerHTML = '';
    h.forEach(function (item, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.title;
      b.addEventListener('click', function () {
        state.pattern = item.pattern;
        applyPattern(item.pattern, false);
        FIELDS.forEach(function (f) {
          var ta = document.getElementById('bf-' + f.key);
          ta.value = item.values[f.key] || '';
        });
        render();
        window.scrollTo({ top: root.offsetTop - 60, behavior: 'smooth' });
      });
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', '지우기');
      x.addEventListener('click', function () { h.splice(i, 1); save('byranPromptHistory', h); drawHistory(); });
      li.appendChild(b); li.appendChild(x);
      histList.appendChild(li);
    });
  }
  root.querySelector('[data-remember]').addEventListener('click', function (e) {
    var v = vals();
    if (!v.subject) return;
    var h = load('byranPromptHistory', []);
    var p = PATTERNS.filter(function (x) { return x.id === state.pattern; })[0];
    h.unshift({ title: p.icon + ' ' + (v.subject.length > 40 ? v.subject.slice(0, 40) + '…' : v.subject), pattern: state.pattern, values: v });
    save('byranPromptHistory', h.slice(0, 12));
    drawHistory();
    var btn = e.currentTarget, old = btn.textContent;
    btn.textContent = '저장됨 ✓';
    setTimeout(function () { btn.textContent = old; }, 1400);
  });

  applyPattern('portrait', true);
  drawHistory();
})();
