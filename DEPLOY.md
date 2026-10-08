# ENEREl 2D Mini Game — Cloudflare Pages + D1 суулгах заавар

## Файлын бүтэц
```
index.html            (өөрчлөгдсөн: 2 газар «PLAY 2D GAME» холбоос нэмэгдсэн)
style.css             (өөрчлөгдсөн: .btn-secondary нэмэгдсэн)
script.js             (өөрчлөгдөөгүй — IQ тест)
game.html             (шинэ)
game.css              (шинэ)
game.js               (шинэ)
functions/api/_shared.js      (шинэ — route биш, туслах код)
functions/api/save-score.js   (шинэ — POST /api/save-score)
functions/api/leaderboard.js  (шинэ — GET /api/leaderboard)
database/schema.sql           (шинэ)
wrangler.toml.example         (заавал биш)
```

## 1. D1 database үүсгэх
**Dashboard:** Cloudflare → Storage & Databases → D1 SQL Database → Create → нэр: `enerel-scores`.

**эсвэл CLI:**
```bash
npx wrangler login
npx wrangler d1 create enerel-scores
```

## 2. Хүснэгт үүсгэх (schema)
**Dashboard:** D1 → enerel-scores → Console → `database/schema.sql`-ийн агуулгыг хуулж → Execute.

**эсвэл CLI (production DB дээр):**
```bash
npx wrangler d1 execute enerel-scores --remote --file=database/schema.sql
```
Шалгах:
```bash
npx wrangler d1 execute enerel-scores --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```
`game_scores` гарч ирэх ёстой.

## 3. Pages төсөлд холбох (binding)
Workers & Pages → таны Pages төсөл → Settings → Bindings → Add → **D1 database**
- Variable name: **`DB`** (яг ийм, том үсгээр)
- D1 database: `enerel-scores`
- **Production** болон **Preview** хоёуланд нь нэмнэ.

> Repo-д `wrangler.toml` байвал dashboard-ын binding-ийг дарж бичнэ. Dashboard ашиглаж байгаа бол `wrangler.toml` ҮҮСГЭХГҮЙ.

## 4. Pages тохиргоо
- Framework preset: None
- Build command: (хоосон)
- Build output directory: `/` (эсвэл `.`) — index.html байгаа үндсэн хавтас
- `functions/` хавтас төслийн root-д байх ёстой.

## 5. Deploy
- **Git:** бүх файлыг commit → push → Pages автоматаар deploy хийнэ.
- **Direct upload / CLI:** `npx wrangler pages deploy . --project-name=<төслийн-нэр>`
  (Dashboard-ын drag & drop upload нь `functions/`-ийг ажиллуулдаггүй — Git эсвэл wrangler ашиглана.)
- Binding нэмсний ДАРАА заавал дахин deploy (Retry deployment) хийнэ — хуучин deployment binding-гүй хэвээр үлддэг.

## 6. Шалгах
```bash
curl https://<таны-домэйн>/api/leaderboard
# → {"ok":true,"scores":[]}

curl -X POST https://<таны-домэйн>/api/save-score \
  -H "Content-Type: application/json" \
  -d '{"name":"TEST","score":100}'
# → {"ok":true,"id":1,...,"rank":1}

curl -X POST https://<таны-домэйн>/api/save-score \
  -H "Content-Type: application/json" -d '{"name":"X","score":-5}'
# → 400 invalid_score
```
Тест мөрийг устгах:
`npx wrangler d1 execute enerel-scores --remote --command="DELETE FROM game_scores WHERE name='TEST';"`

## 7. Алдаа засах
| Шинж тэмдэг | Шалтгаан / засвар |
|---|---|
| `503 db_not_bound` | Binding байхгүй, нэр нь `DB` биш, эсвэл binding нэмсний дараа redeploy хийгээгүй |
| `500 db_error`, логт `no such table: game_scores` | Schema-г `--remote` дээр ажиллуулаагүй (зөвхөн `--local` хийсэн) |
| `/api/...` → 404 | `functions/` deploy-д ороогүй (drag & drop upload, буруу output dir, эсвэл хавтас root-д биш) |
| `429 too_many_requests` | Нэг нэрээр 5 секундэд 2 удаа хадгалсан — хэвийн хамгаалалт |
| Тоглоомд "Open the site through Cloudflare Pages" | Файлыг шууд (file://) нээсэн — API зөвхөн Pages дээр ажиллана |
| Preview дээр ажиллаад production дээр ажиллахгүй (эсвэл эсрэгээр) | Binding-ийг зөвхөн нэг орчинд нэмсэн |

Лог: Pages → Deployments → тухайн deployment → Functions → Real-time logs.

## Локал тест (заавал биш)
```bash
cp wrangler.toml.example wrangler.toml   # локалд database_id дурын байж болно
npx wrangler d1 execute enerel-scores --local --file=database/schema.sql
npx wrangler pages dev .
# http://localhost:8788/game.html
```
Dashboard binding ашиглаж байгаа бол тест дууссаны дараа `wrangler.toml`-ийг устгана.

## Аюулгүй байдал
- Хадгалах өгөгдөл: зөвхөн nickname, score, created_at. IP / төхөөрөмж / имэйл / утас хадгалахгүй.
- DB credential frontend-д огт байхгүй — D1-д зөвхөн серверийн `env.DB`-ээр хандана.
- Сервер шалгадаг: нэр (1–16 тэмдэгт, зөвшөөрөгдсөн тэмдэгт), оноо (бүхэл, 0–12000), JSON хэлбэр, хэмжээ (≤1KB), Content-Type. Schema-д мөн CHECK хязгаар бий.
- Анхаар: браузерын тоглоомын оноог 100% хуурамчаас хамгаалах боломжгүй (хүн хүсэлтийг гараар илгээж болно). Одоогийн хамгаалалт буруу/боломжгүй утгыг хаадаг; дээд хязгаар 12000 (бодит дээд оноо ≈10,400).
