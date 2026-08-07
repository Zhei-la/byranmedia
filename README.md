# 바이란미디어 허브

수강생 전용 도구 사이트. 로그인한 승인 회원만 도구를 쓸 수 있습니다.

- **스택**: Node 20 · Express · PostgreSQL · EJS (루월당과 동일)
- **배포**: Railway
- **핵심 구조**: 도구 파일은 `protected/` 안에 있어서 주소를 알아도 로그인 없이는 열 수 없습니다.

---

## 1. 폴더 구조

```
byranmedia/
├── package.json
├── railway.json
├── schema.sql              ← DB 테이블 정의
├── .env.example            ← 환경변수 견본
├── src/
│   ├── app.js              ← 서버 시작점
│   ├── db.js
│   ├── seed.js             ← 초기 설정 (테이블 생성 + 관리자 계정)
│   ├── middleware/auth.js  ← 로그인·승인·만료 검사
│   └── routes/
│       ├── auth.js         ← 가입 / 로그인 / 로그아웃
│       ├── hub.js          ← 도구 목록 / 도구 실행
│       └── admin.js        ← 수강생 관리 / 도구 관리
├── views/                  ← 화면 (EJS)
├── public/css/app.css
└── protected/tools/        ← ★ 도구 HTML 파일을 여기에 넣습니다
    └── blog-prompt-builder/
        └── index.html
```

---

## 2. 배포 순서

### 2-1. GitHub에 올리기

PowerShell에서 압축을 푼 폴더로 이동해서:

```powershell
cd C:\byranmedia

git init
git add .
git commit -m "바이란미디어 허브 최초 배포"
git branch -M main
git remote add origin https://github.com/Zhei-la/byranmedia.git
git push -u origin main
```

> GitHub에서 `byranmedia` 저장소를 **비공개(Private)** 로 먼저 만들어 두세요.

### 2-2. Railway 프로젝트 만들기

1. Railway → **New Project** → **Deploy from GitHub repo** → `byranmedia` 선택
2. 같은 프로젝트 안에서 **New** → **Database** → **Add PostgreSQL**
3. PostgreSQL을 추가하면 `DATABASE_URL` 변수가 자동으로 생깁니다

### 2-3. 환경변수 넣기

Railway 서비스 → **Variables** 탭에서 아래를 추가합니다.

| 변수 | 값 |
|---|---|
| `SESSION_SECRET` | 길고 무작위한 문자열 (아래 명령으로 생성) |
| `NODE_ENV` | `production` |
| `SITE_NAME` | `바이란미디어` |
| `CONTACT_INFO` | `문의: 카카오톡 채널 @바이란미디어` |
| `ADMIN_EMAIL` | 본인 이메일 |
| `ADMIN_PASSWORD` | 8자 이상 비밀번호 |
| `ADMIN_NAME` | `바이란` |

`SESSION_SECRET` 만드는 명령 (PowerShell):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
```

> `DATABASE_URL`은 PostgreSQL을 붙이면 자동으로 들어갑니다. 직접 넣지 마세요.

### 2-4. 초기 설정 한 번 실행

배포가 끝나면 Railway 서비스 화면에서 터미널을 열고:

```bash
npm run setup
```

테이블이 만들어지고 관리자 계정이 생깁니다. **이건 한 번만 하면 됩니다.**

> 터미널을 못 찾겠으면, `package.json`의 `start`를 잠깐
> `node src/seed.js && node src/app.js` 로 바꿔 배포한 뒤 다시 되돌려도 됩니다.

### 2-5. 도메인 연결

1. 도메인을 구입합니다 (가비아, 카페24, Cloudflare 등)
2. Railway 서비스 → **Settings** → **Networking** → **Custom Domain** → 도메인 입력
3. Railway가 알려주는 CNAME 값을 도메인 관리 화면의 DNS에 등록
   - 예: `호스트: @ 또는 www` / `타입: CNAME` / `값: xxxx.up.railway.app`
4. 10분~1시간이면 연결됩니다. HTTPS 인증서는 Railway가 자동으로 붙입니다

**도메인 이름 정할 때 참고**
- 루월당(`luwolsaju.com`)과 겹치지 않게 별도 도메인을 쓰는 게 좋습니다
- 수강생이 타이핑할 주소라 짧을수록 좋습니다
- `.com` / `.kr` / `.co.kr` 중 하나를 권합니다

---

## 3. 처음 해야 할 일

1. 사이트에 접속 → `ADMIN_EMAIL` / `ADMIN_PASSWORD` 로 로그인
2. 상단 **관리** 탭 확인
3. 수강생에게 사이트 주소를 알려주고 **등록 신청**을 받게 합니다
4. 관리 화면에서 명단과 대조한 뒤 **승인** + **기간 연장**

---

## 4. 도구 추가하는 방법

도구 하나를 추가하려면 **두 가지**를 해야 합니다.

**① 파일 넣기**

```
protected/tools/내도구이름/index.html
```

단일 HTML 파일이면 그대로 넣으면 됩니다. 이미지 등 부가 파일이 있으면
같은 폴더에 넣고 `/t/내도구이름/asset/파일명` 으로 부릅니다.

**② 목록에 등록하기**

관리 → 도구 탭 → **도구 추가**
- 주소용 이름(slug)을 **폴더 이름과 똑같이** 적습니다
- 분류를 적으면 허브 화면에서 그 이름으로 묶입니다

그다음 GitHub에 push 하면 자동으로 재배포됩니다.

```powershell
git add .
git commit -m "도구 추가: 만세력"
git push
```

**외부 사이트로 보내고 싶을 때** (예: 루월당)

`protected/tools/saju/index.html` 을 만들고 안에 이렇게만 넣으면 됩니다.

```html
<!DOCTYPE html>
<meta charset="utf-8">
<script>location.replace('https://luwolsaju.com');</script>
```

---

## 5. 회원 상태의 뜻

| 상태 | 뜻 |
|---|---|
| **승인 대기** | 가입은 했지만 아직 도구를 쓸 수 없음 |
| **이용 중** | 정상 사용 가능 |
| **기간 만료** | 만료일이 지나 자동으로 막힘 (연장하면 바로 풀림) |
| **이용 중지** | 관리자가 막아둔 상태 |

만료일을 비워두면 무기한입니다. 기수제로 운영한다면 만료일을 꼭 넣으세요.

상태 변경은 **다음 요청부터 바로 반영**됩니다. 로그인 중인 사람도 즉시 막힙니다.

---

## 6. 로컬에서 돌려보기

```powershell
npm install
Copy-Item .env.example .env    # 그리고 .env 안의 값을 채웁니다
npm run setup
npm run dev
```

브라우저에서 `http://localhost:3000`

---

## 7. 확인해 둘 것

- `.env` 파일은 **절대 GitHub에 올리지 마세요.** `.gitignore`에 이미 넣어뒀습니다
- `SESSION_SECRET`을 바꾸면 모든 사람이 로그아웃됩니다
- 관리자 계정은 본인 것 하나만 두는 게 안전합니다
- 수강생에게 **계정 공유 금지**를 안내하세요. 화면 하단에도 문구가 있습니다
- 누가 어떤 도구를 썼는지는 관리 화면 아래 **최근 사용 기록**에서 볼 수 있습니다

---

## 8. 문제가 생겼을 때

| 증상 | 확인할 것 |
|---|---|
| 배포는 됐는데 500 오류 | Railway 로그에서 `DATABASE_URL` / `SESSION_SECRET` 누락 여부 |
| 로그인이 계속 풀림 | `NODE_ENV=production` 인지, 도메인이 HTTPS인지 |
| 도구를 눌러도 빈 화면 | `protected/tools/{slug}/index.html` 파일이 실제로 올라갔는지 |
| 도구 목록에 안 보임 | 관리 → 도구 탭에서 "목록에 보이기"가 켜져 있는지 |
| 승인했는데 못 들어감 | 만료일이 오늘보다 이전인지 |

---

## 9. 카카오 로그인 설정

카카오 키를 넣지 않으면 카카오 버튼은 나타나지 않고, 이메일 로그인만 동작합니다.
아래를 끝내면 버튼이 자동으로 생깁니다.

### 9-1. 카카오 개발자 화면에서 할 일

[developers.kakao.com](https://developers.kakao.com) → 내 애플리케이션 → 만들어 둔 앱 선택

**① 앱 키 복사**
- 요약 정보 → **REST API 키** 복사 (JavaScript 키가 아닙니다)

**② 카카오 로그인 켜기**
- 제품 설정 → 카카오 로그인 → **활성화 설정**을 ON

**③ Redirect URI 등록** (가장 많이 틀리는 부분)
- 카카오 로그인 → **Redirect URI 등록**
- 아래 주소를 **글자 하나까지 똑같이** 넣습니다.

```
https://byranmedia.com/auth/kakao/callback
```

- Railway 임시 주소로 먼저 시험한다면 그 주소도 함께 등록해 두세요.

```
https://내프로젝트.up.railway.app/auth/kakao/callback
```

**④ 동의 항목 설정**
- 카카오 로그인 → 동의항목
- **닉네임**: 필수 동의 (또는 선택 동의)
- **카카오계정(이메일)**: 선택 동의 권장

> 이메일 동의를 받지 않아도 로그인은 됩니다. 다만 이메일이 없으면
> 기존에 만들어 둔 계정과 자동으로 이어지지 않고 새 계정이 만들어집니다.

**⑤ 보안 설정** (선택)
- 카카오 로그인 → 보안 → Client Secret을 **사용함**으로 두었다면 그 값도 복사

### 9-2. Railway 변수에 넣기

| 변수 | 값 |
|---|---|
| `KAKAO_REST_API_KEY` | 위에서 복사한 REST API 키 |
| `BASE_URL` | `https://byranmedia.com` (끝에 / 없이) |
| `KAKAO_CLIENT_SECRET` | Client Secret을 쓰는 경우에만 |

저장하면 자동으로 다시 배포되고, 로그인 화면에 노란 버튼이 생깁니다.

### 9-3. 카카오로 들어온 사람은

이메일 가입과 똑같이 **승인 대기** 상태로 들어옵니다.
관리 화면에서 승인해야 도구를 쓸 수 있습니다.

이미 이메일로 만든 계정이 있고 카카오 이메일이 같다면, 두 계정이 자동으로 이어집니다.
그다음부터는 어느 쪽으로 로그인해도 같은 계정입니다.

### 9-4. 잘 안 될 때

| 화면에 뜨는 말 | 확인할 것 |
|---|---|
| KOE006 / 잘못된 Redirect URI | 카카오에 등록한 주소와 `BASE_URL`이 정확히 같은지. `www` 유무, 끝의 `/`까지 확인 |
| KOE101 / 앱 키 오류 | JavaScript 키를 넣지 않았는지. REST API 키여야 합니다 |
| 버튼이 안 보임 | `KAKAO_REST_API_KEY`가 비어 있는지 |
| 로그인 요청이 만료됐습니다 | 오래 머물다 돌아온 경우입니다. 다시 누르면 됩니다 |
