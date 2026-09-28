/* 프롬프트 생성기용 한국어 → 영어
   1) 서버에 AI 키가 있으면 AI 로 번역 (OPENAI_API_KEY 또는 ANTHROPIC_API_KEY)
   2) 없으면 단어장으로 아는 말만 바꾸고 나머지는 그대로 둔다 */

const HANGUL = /[가-힣]/;

// 자주 쓰는 말. 긴 말이 먼저 맞도록 나중에 길이순으로 정렬한다.
const DICT = {
  // 사람
  '한국 여성': 'Korean woman', '한국 여자': 'Korean woman', '한국 남성': 'Korean man', '한국 남자': 'Korean man',
  '일본 여성': 'Japanese woman', '여성': 'woman', '여자': 'woman', '남성': 'man', '남자': 'man', '소녀': 'young girl', '소년': 'young boy',
  '아이': 'child', '아기': 'baby', '할머니': 'grandmother', '할아버지': 'grandfather', '엄마': 'mother', '아빠': 'father', '커플': 'couple',
  '친구들': 'friends', '대학생': 'college student', '직장인': 'office worker', '모델': 'model', '한국인': 'Korean', '한국': 'Korean',
  '강아지': 'puppy', '고양이': 'cat', '토끼': 'rabbit', '햄스터': 'hamster', '곰인형': 'teddy bear',
  // 얼굴·표정
  '웃는': 'smiling', '웃음': 'smile', '미소': 'soft smile', '은은한 미소': 'soft closed-lip smile', '활짝 웃는': 'beaming smile', '수줍은': 'shy',
  '무표정': 'neutral expression', '윙크': 'playful wink', '눈 감은': 'eyes closed', '카메라 응시': 'looking straight into the camera',
  '카메라를 보는': 'looking at the camera', '옆모습': 'side profile', '뒷모습': 'seen from behind', '뒤돌아보는': 'glancing back over the shoulder',
  '턱 괴기': 'resting her chin on one hand', '턱을 괸': 'resting her chin on one hand', '손하트': 'making a finger heart',
  '브이': 'making a V sign', '볼 감싸기': 'cupping her cheeks with both hands', '머리 넘기는': 'tucking hair behind her ear',
  '청순한': 'innocent and fresh-faced', '귀여운': 'cute', '예쁜': 'beautiful', '잘생긴': 'handsome', '시크한': 'chic', '도도한': 'aloof',
  '자연스러운': 'natural', '주근깨': 'freckles', '보조개': 'dimples',
  // 포즈
  '앉아 있는': 'sitting', '앉은': 'sitting', '서 있는': 'standing', '걷는': 'walking', '누워 있는': 'lying down', '기대어': 'leaning',
  '달리는': 'running', '산책하는': 'taking a stroll', '산책': 'stroll', '쇼핑하는': 'shopping', '요리하는': 'cooking', '운동하는': 'working out', '공부하는': 'studying', '일하는': 'working', '기다리는': 'waiting', '노트북': 'laptop', '책': 'book', '휴대폰': 'phone', '춤추는': 'dancing', '셀카': 'selfie', '거울 셀카': 'mirror selfie', '셀카 각도': 'handheld selfie from a slightly high angle',
  '들고': 'holding', '든': 'holding', '입은': 'wearing', '쓴': 'wearing', '신은': 'wearing', '낀': 'wearing', '안은': 'hugging', '안고': 'hugging', '들고 있는': 'holding', '마시는': 'drinking', '먹는': 'eating', '읽는': 'reading', '보는': 'looking at',
  // 헤어
  '긴 생머리': 'long straight black hair', '생머리': 'straight hair', '긴 머리': 'long hair', '단발': 'chin-length bob', '단발머리': 'chin-length bob',
  '웨이브': 'soft wavy hair', '웨이브 머리': 'soft wavy hair', '묶은 머리': 'loose low updo with face-framing strands', '포니테일': 'ponytail',
  '양갈래': 'twin tails', '앞머리': 'see-through bangs', '똥머리': 'messy top bun', '올림머리': 'updo', '갈색 머리': 'brown hair', '검은 머리': 'black hair',
  '금발': 'blonde hair', '잔머리': 'flyaway baby hairs', '젖은 머리': 'damp hair',
  // 메이크업
  '내추럴 메이크업': 'natural clean makeup', '민낯': 'bare face with no makeup', '블러셔': 'soft blush', '블러셔 강조': 'soft rosy blush across the cheeks',
  '립글로스': 'glossy lips', '빨간 립': 'red lipstick', '속눈썹': 'long eyelashes',
  // 옷
  '흰 티': 'plain white T-shirt', '흰 티셔츠': 'plain white T-shirt', '흰 티 + 청바지': 'plain white T-shirt and straight denim', '청바지': 'blue jeans',
  '니트': 'cozy knit sweater', '가디건': 'cardigan', '셔츠': 'oversized white shirt', '블라우스': 'blouse', '원피스': 'dress', '꽃무늬 원피스': 'floral dress',
  '트렌치코트': 'beige trench coat', '코트': 'wool coat', '패딩': 'puffer jacket', '후드티': 'hoodie', '맨투맨': 'sweatshirt', '슬랙스': 'slacks',
  '치마': 'skirt', '미니스커트': 'mini skirt', '롱스커트': 'long skirt', '반바지': 'shorts', '정장': 'tailored suit', '교복': 'school uniform',
  '잠옷': 'pajamas', '운동복': 'athleisure set', '레깅스': 'leggings', '수영복': 'swimsuit', '한복': 'modern hanbok', '앞치마': 'apron',
  '모자': 'hat', '캡모자': 'baseball cap', '비니': 'beanie', '안경': 'glasses', '선글라스': 'sunglasses', '귀걸이': 'earrings', '목걸이': 'necklace',
  '반지': 'ring', '가방': 'bag', '우산': 'umbrella', '꽃다발': 'bouquet of flowers', '커피': 'coffee', '아이스 아메리카노': 'iced americano',
  '흰색': 'white', '검은색': 'black', '베이지': 'beige', '크림색': 'cream', '분홍색': 'pink', '하늘색': 'sky blue', '빨간색': 'red', '노란색': 'yellow',
  // 장소
  '카페': 'cozy cafe', '카페 창가': 'window seat of a cozy cafe', '창가': 'by the window', '내 방': 'tidy bedroom', '침실': 'bedroom', '침대': 'bed',
  '거실': 'living room', '부엌': 'kitchen', '욕실': 'bathroom', '사무실': 'office', '교실': 'classroom', '도서관': 'library', '편의점': 'convenience store',
  '지하철': 'subway', '버스': 'bus', '거리': 'street', '서울 골목': 'quiet Seoul alley', '골목': 'narrow alley', '한강': 'Han River park',
  '한강 공원': 'Han River park at dusk', '공원': 'park', '바다': 'calm beach', '해변': 'beach', '산': 'mountain', '숲': 'forest', '꽃밭': 'flower field',
  '벚꽃': 'cherry blossoms', '옥상': 'rooftop', '흰 벽': 'plain cream wall with soft negative space', '스튜디오': 'seamless studio backdrop',
  '포토부스': 'photo booth', '놀이공원': 'amusement park', '캠핑장': 'campsite', '호텔': 'hotel room', '제주도': 'Jeju Island',
  // 날씨·시간·계절
  '비 오는 날': 'rainy day', '비': 'rain', '눈 오는 날': 'snowy day', '눈': 'snow', '맑은 날': 'clear sunny day', '흐린 날': 'overcast day',
  '아침': 'morning', '낮': 'daytime', '오후': 'afternoon', '저녁': 'evening', '밤': 'night', '노을': 'sunset glow', '새벽': 'dawn',
  '봄': 'spring', '여름': 'summer', '가을': 'autumn', '겨울': 'winter', '크리스마스': 'Christmas',
  // 빛
  '창가 햇빛': 'soft diffused window light', '햇빛': 'natural sunlight', '자연광': 'natural light', '골든아워': 'warm golden hour backlight',
  '역광': 'backlight', '스튜디오 소프트': 'large softbox key light with gentle fill', '네온': 'moody neon rim light', '플래시': 'direct on-camera flash',
  '조명': 'lighting', '어두운': 'dim', '밝은': 'bright', '따뜻한 빛': 'warm light', '촛불': 'candlelight',
  // 카메라·구도
  '상반신': 'framed from the waist up', '얼굴 클로즈업': 'tight close-up on the face', '클로즈업': 'close-up', '전신': 'full-body shot',
  '정면': 'frontal', '정면 중앙': 'centered frontal composition', '자연스러운 스냅': 'candid snapshot', '스냅': 'candid snapshot',
  '폰카': 'smartphone photo', '폰카 느낌': 'recent smartphone camera, natural phone exposure', '아이폰': 'iPhone photo', '필름 카메라': '35mm film camera',
  '필름 느낌': 'film photo look with subtle grain', '아웃포커싱': 'shallow depth of field with soft background blur', '광각': 'wide-angle',
  '로우앵글': 'low angle', '하이앵글': 'high angle',
  // 색감·분위기
  '따뜻한 뉴트럴': 'warm neutral palette, low saturation', '따뜻한': 'warm', '차가운': 'cool-toned', '파스텔': 'soft pastel tones',
  '쿨톤': 'cool blue tones', '웜톤': 'warm tones', '선명하게': 'vivid clean colors', '흑백': 'black and white', '빈티지': 'vintage',
  '편안한': 'cozy and relaxed', '청량한': 'fresh and airy', '몽환적': 'dreamy and ethereal', '몽환적인': 'dreamy', '시네마틱': 'cinematic and moody',
  '사랑스러운': 'sweet and lovely', '감성': 'emotional, soft mood', '감성적인': 'emotional', '우울한': 'melancholic', '신비로운': 'mysterious',
  '고급스러운': 'luxurious', '깔끔한': 'clean', '일상': 'everyday life', '일상적인': 'everyday', '분위기': 'mood',
  // 질감
  '사실적인 피부': 'realistic skin texture with visible pores', '자연스러운 손': 'natural hands with correct fingers', '옷 주름': 'natural fabric creases',
  '제품 선명하게': 'crisp product edges and accurate materials',
  // 음식·제품
  '케이크': 'cake', '디저트': 'dessert', '라면': 'ramen', '떡볶이': 'tteokbokki', '김밥': 'gimbap', '치킨': 'fried chicken', '과일': 'fruit',
  '화장품': 'cosmetic product', '향수': 'perfume bottle', '립스틱': 'lipstick', '대리석': 'marble surface', '나무 테이블': 'wooden table',
  // 연결어
  '그리고': 'and', '같은': 'like', '느낌': 'feel', '스타일': 'style', '사진': 'photo', '이미지': 'image',
};
// 두 글자 이상은 문장 속에서도 찾고, 한 글자(비·눈·산 등)는 낱말일 때만 바꾼다
const KEYS = Object.keys(DICT).filter((k) => k.replace(/\s/g, '').length >= 2).sort((a, b) => b.length - a.length);
const PARTICLES = ['에서', '으로', '에게', '하고', '이랑', '처럼', '까지', '부터', '은', '는', '이', '가', '을', '를', '에', '의', '로', '와', '과', '도', '랑'];

function dictTranslate(text) {
  let s = String(text || '').trim();
  if (!s || !HANGUL.test(s)) return { text: s, left: false };
  // 숫자 표현
  s = s.replace(/(\d+)\s*대(?![가-힣])/g, ' in their $1s ').replace(/(\d+)\s*(살|세)/g, ' $1-year-old ');
  // 긴 말부터 바꾸기
  for (const k of KEYS) {
    if (s.includes(k)) s = s.split(k).join(` ${DICT[k]} `);
  }
  // 남은 한국어: 조사를 떼고 다시 찾아보기
  s = s.replace(/[가-힣]+/g, (w) => {
    if (DICT[w]) return ` ${DICT[w]} `;
    for (const p of PARTICLES) {
      if (w.length > p.length && w.endsWith(p)) {
        const base = w.slice(0, -p.length);
        if (DICT[base]) return ` ${DICT[base]} `;
        if (!HANGUL.test(base)) return base;
      }
    }
    if (PARTICLES.includes(w)) return ' ';
    return w;
  });
  s = s.replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
  return { text: s, left: HANGUL.test(s) };
}

async function aiTranslate(fields) {
  const sys =
    'You translate Korean image-prompt fields into concise, vivid English phrases for a photorealistic image generator. ' +
    'Keep any English as it is. Do not add new ideas, do not explain. ' +
    'Return ONLY a JSON object with exactly the same keys and the translated strings as values.';
  const user = JSON.stringify(fields);
  const model = process.env.PROMPT_AI_MODEL;

  if (process.env.OPENAI_API_KEY) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || 'openai error');
    return JSON.parse(j.choices[0].message.content);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5',
        max_tokens: 1200,
        system: sys,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || 'anthropic error');
    const txt = (j.content || []).map((c) => c.text || '').join('');
    const m = txt.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : txt);
  }
  return null;
}

const aiReady = () => !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);

/** { key: 한국어/영어 섞인 글 } → { fields: {key: 영어}, mode, left } */
async function translateFields(input) {
  const fields = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!/^[a-z]{2,12}$/.test(k)) continue;
    fields[k] = String(v || '').slice(0, 600);
  }
  const needs = Object.fromEntries(Object.entries(fields).filter(([, v]) => HANGUL.test(v)));
  if (!Object.keys(needs).length) return { fields, mode: 'none', left: false };

  if (aiReady()) {
    try {
      const out = await aiTranslate(needs);
      const res = { ...fields };
      for (const k of Object.keys(needs)) if (typeof out[k] === 'string') res[k] = out[k].trim();
      return { fields: res, mode: 'ai', left: Object.values(res).some((v) => HANGUL.test(v)) };
    } catch (e) {
      console.error('[프롬프트 번역]', e.message);
    }
  }
  const res = { ...fields };
  let left = false;
  for (const k of Object.keys(needs)) {
    const t = dictTranslate(needs[k]);
    res[k] = t.text;
    left = left || t.left;
  }
  return { fields: res, mode: 'dict', left };
}

module.exports = { translateFields, aiReady, dictTranslate };
