/* 바이란 라운지 공통 스크립트 */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* 알림 띠: 4초 뒤 사라짐 */
  var toast = $('[data-toast]');
  if (toast) setTimeout(function () { toast.classList.add('hide'); }, 4200);

  /* 준비중인 곳: 눌러도 들어가지 않고 알림만 */
  var soon = (document.body.getAttribute('data-soon') || '').split(' ');
  function isSoon(p) {
    if (soon.indexOf('library') > -1 && /^\/library(\/\d+)?\/?$/.test(p)) return true;
    if (soon.indexOf('course') > -1 && /^\/(course|store)\/?$/.test(p)) return true;
    if (soon.indexOf('consult') > -1 && /^\/consult\/?$/.test(p)) return true;
    return false;
  }
  var soonTimer;
  function soonToast() {
    var t = document.querySelector('[data-soontoast]');
    if (!t) {
      t = document.createElement('div');
      t.className = 'lg-toast'; t.setAttribute('role', 'status'); t.setAttribute('data-soontoast', '');
      t.textContent = '준비중입니다. 조금만 기다려 주세요 🙏';
      document.body.appendChild(t);
    }
    t.classList.remove('hide');
    clearTimeout(soonTimer);
    soonTimer = setTimeout(function () { t.classList.add('hide'); }, 2600);
  }
  if (soon[0]) {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank') return;
      var u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
      if (u.origin !== location.origin || !isSoon(u.pathname)) return;
      e.preventDefault();
      soonToast();
    });
  }

  /* 확인 창이 필요한 버튼 */
  $$('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  /* 모달 */
  $$('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = document.getElementById(b.getAttribute('data-open'));
      if (d && d.showModal) d.showModal();
    });
  });
  $$('dialog').forEach(function (d) {
    $$('[data-close]', d).forEach(function (b) { b.addEventListener('click', function () { d.close(); }); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
  });

  /* 사진 줄이기: 긴 변 기준으로 줄여 JPEG 로 */
  function shrink(file, max, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height, r = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * r); c.height = Math.round(h * r);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // 한 장짜리 (글쓰기, 후기, 성과)
  $$('[data-image-form]').forEach(function (form) {
    var file = $('[data-file]', form), hidden = $('[data-image]', form), prev = $('[data-preview]', form), txt = $('[data-droptext]', form);
    if (!file || !hidden) return;
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (txt) txt.textContent = '사진 줄이는 중…';
      shrink(f, 1280, function (data) {
        if (!data) { if (txt) txt.textContent = '이 사진은 쓸 수 없어요'; return; }
        hidden.value = data;
        if (prev) { prev.src = data; prev.hidden = false; }
        if (txt) txt.textContent = '다른 사진으로 바꾸기';
      });
    });
  });

  // 여러 장 (관리자 프롬프트) — 눌러서 고르기 + 끌어다 놓기
  $$('[data-multi-image-form]').forEach(function (form) {
    var input = $('[data-multi-file]', form), row = $('[data-imgs]', form), zone = $('[data-dropzone]', form);
    if (!input) return;
    function addFiles(list) {
      var have = $$('input[name=images], input[name=keep]:checked', form).length;
      var files = Array.prototype.slice.call(list || []).filter(function (f) { return /^image\//.test(f.type); }).slice(0, Math.max(0, 8 - have));
      files.forEach(function (f) {
        shrink(f, 1400, function (data) {
          if (!data) return;
          var lab = document.createElement('div');
          lab.className = 'lg-adimg';
          lab.innerHTML = '<img alt=""><span><button type="button" class="lg-linkbtn sm">빼기</button></span>';
          $('img', lab).src = data;
          var h = document.createElement('input');
          h.type = 'hidden'; h.name = 'images'; h.value = data;
          lab.appendChild(h);
          $('button', lab).addEventListener('click', function () { lab.remove(); });
          row.appendChild(lab);
        });
      });
    }
    input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
    if (zone) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
      });
      zone.addEventListener('drop', function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });
    }
    // 붙여넣기(Ctrl+V)로 이미지 넣기
    form.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.files) || [];
      if (items.length) addFiles(items);
    });
  });

  /* 복사 */
  function copyText(text, btn) {
    function done() {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = '복사됨 ✓';
      setTimeout(function () { btn.textContent = old; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacy(text); done(); });
    } else { legacy(text); done(); }
  }
  function legacy(text) {
    var t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove();
  }
  $$('[data-copylink]').forEach(function (b) {
    b.addEventListener('click', function () { copyText(location.href.split('#')[0], b); });
  });
  $$('[data-copy-target]').forEach(function (b) {
    b.addEventListener('click', function () {
      var el = $(b.getAttribute('data-copy-target'));
      if (!el) return;
      copyText(el.textContent, b);
      var post = b.getAttribute('data-copied-post');
      if (post) fetch(post, { method: 'POST', headers: { Accept: 'application/json' } }).catch(function () {});
    });
  });

  /* 좋아요 · 즐겨찾기 */
  $$('[data-like]').forEach(function (b) {
    b.addEventListener('click', function () {
      fetch('/community/' + b.getAttribute('data-like') + '/like', { method: 'POST', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) { b.classList.toggle('on', d.liked); var n = $('[data-likes]', b); if (n) n.textContent = d.likes; })
        .catch(function () {});
    });
  });
  $$('[data-plike]').forEach(function (b) {
    b.addEventListener('click', function () {
      fetch('/prompts/' + b.getAttribute('data-plike') + '/like', { method: 'POST', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) { b.classList.toggle('on', d.liked); var t = $('[data-liketext]', b); if (t) t.textContent = d.liked ? '즐겨찾기됨' : '즐겨찾기'; })
        .catch(function () {});
    });
  });

  /* 프롬프트 이미지 넘기기 */
  $$('[data-gallery]').forEach(function (g) {
    var main = $('[data-main]', g);
    $$('[data-thumb]', g).forEach(function (t) {
      t.addEventListener('click', function () {
        main.src = t.getAttribute('data-thumb');
        $$('[data-thumb]', g).forEach(function (x) { x.classList.toggle('on', x === t); });
      });
    });
  });

  /* 실시간 채팅 (몇 초마다 새 메시지 확인) */
  $$('[data-chat]').forEach(function (box) {
    var list = $('[data-list]', box), form = $('[data-chatform]', box), onl = $('[data-online]', box);
    var after = parseInt(box.getAttribute('data-after'), 10) || 0;
    function add(m) {
      var empty = $('[data-emptyrow]', list); if (empty) empty.remove();
      var li = document.createElement('li');
      var b = document.createElement('b'); b.textContent = m.nick; if (m.admin) b.className = 'admin';
      var s = document.createElement('span'); s.textContent = m.body;
      li.appendChild(b); li.appendChild(s); list.appendChild(li);
      while (list.children.length > 60) list.removeChild(list.firstChild);
    }
    function scroll() { list.scrollTop = list.scrollHeight; }
    scroll();
    function poll() {
      if (document.hidden) return;
      fetch('/chat/messages?after=' + after, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (onl) onl.textContent = d.online ? '최근 30분 ' + d.online + '명' : '지금';
          if (d.items && d.items.length) { d.items.forEach(add); after = d.items[d.items.length - 1].id; scroll(); }
        }).catch(function () {});
    }
    poll();
    setInterval(poll, 6000);
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var inp = $('input', form), body = inp.value.trim();
        if (!body) return;
        inp.disabled = true;
        fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ body: body }) })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (x) {
            inp.disabled = false;
            if (!x.ok) { alertLine(x.d.error || '보내지 못했어요.'); return; }
            inp.value = ''; inp.focus(); poll();
          })
          .catch(function () { inp.disabled = false; });
      });
    }
    function alertLine(msg) {
      var li = document.createElement('li'); li.className = 'lg-muted'; li.textContent = msg; list.appendChild(li); scroll();
    }
  });
})();
