# TEGTAT — Isometric дөрвөн үеийн шинэчлэл

## TEGTAT VERSUS — шинэ тусдаа тоглоом

`versus.html` / `versus.js` / `versus.css`: 10 original дүртэй хажуу талаас харагдах arena fighter. CPU (3 хүндрэл), 3 өрсөлдөгчийн arcade, нэг keyboard дээр 2 тоглогчийн горим; best of three, 75 сек round; mobile pointer controls, 3-hit combo, parry/guard break, air attacks, dash, ranged attacks, assist болон 10 өөр special. Original canvas artwork; reference mechanics: https://en.gameslol.net/bleach-vs-naruto-3-3-1397.html . Reference assets/code are not used. Gender/name mapping follows the supplied order and can be corrected without changing combat definitions.

`node tests/versus.cjs`: skill geometry/resource rules, jumping/platforms, dodge windows, guard/parry, all ten specials, round transitions, timer normalization and CPU match completion.

`game.html` нь isometric тулаант тоглоомын хуудас. `game-iso.js` нь ground-space хөдөлгөөн, мөргөлдөөн, depth sorting, AI, skill болон arena flow-ийг удирдана. `index.html` дахь IQ тест, `tegtat.html` дахь 3D жолоодлого тусдаа хэвээр.

Үеийн дараалал: Төвшөө + Ганаа → Эрхмээ + Тэка → Anhaa → Морьт Teka.
Anhaa-г ялсны дараа зэвсэг +20% damage өгнө. WASD/сум: 8 чиглэл, Space/K: үсрэх, J: combo, F: guard, Q/E/R: skill.
Ground-space логик тест: `node tests/isometric.cjs`; combat reward тест: `node tests/combat-progression.cjs`.
Full-bundle integration: `node tests/runtime.cjs` executes the shipped scripts with a deterministic DOM/canvas host and checks finite drawing geometry. It covers all four stages, boss phases, rewards, victory/death/restart, skills, held combos, exact energy rewards, pause and touch cancellation. This complements real Chrome checks; it does not replace device testing.

Combat: three-hit combo with 220ms input buffer and idle reset, nearby aim assist when standing, paid dodge cancel after swing startup, 160ms perfect dodge (+8 energy and a counter window, once per dash). Weapon hits restore 2 energy; recovery takes 20% extra damage. Enemy windups lock aim and show ground warnings; at most two enemies commit attacks together. Jump clears ground projectiles. Skill costs and Anhaa's run-only weapon reward stay unchanged.

Spatial combat: projected ground cones share the exact sword hit range/angle, with 135-unit finisher reach vs 110 for normal swings. A ground facing indicator and skill radius previews clarify direction and range. Hits push enemies in world coordinates (boss resistance applies); melee approach assigned flanks, ranged enemies retreat inside 190 units, and arena props stop projectiles. Recovery displays OPEN above enemies.

Expanded arenas: stages 1–3 use 1600×1250 world units; the final mounted boss uses 2000×1550. Roads, extra buildings/trees/rocks/ovoo and a minimap support navigation. Exploration HP, energy and score supplies stay until collected; combat drops retain their expiry. Waves spawn near the player so the larger map does not create long empty walks. The hero has blue/gold armor and a cape; enemy outfits and size silhouettes distinguish roles. Dash adds fading character trails, power creates a world-space shockwave, and ultimate creates a storm with persistent target bolts. Ground effects follow world positions as the camera moves; detail mode reduces decorative work.

Mongolian visual details include deel hem embroidery, side-fastening buttons, belt buckles, upturned boots, traditional hats for Ganaa/Teka, and laced lamellar armor over coloured clothing. Erhmee retains the zodog/shuudag wrestler silhouette. Enemy role timing/reach differs: Tuvshuu fast strikes, Ganaa advancing club windup, Erhmee a full-second telegraphed ground slam that can be jumped, Teka lateral movement between shots, Anhaa longer polearm sweeps, mounted Teka deliberate windup/charge. Windup labels explain attacks; health and base damage are unchanged.

Quality pass: moody terrain lighting, cached procedural ground textures, richer ger/house/ovoo details, offscreen threat pointers, building transparency around the hero, cooldown numbers and a separate minimap position. Attacks can be held to chain; world facing matches the attack pose. Energy rewards are counted once (2 per weapon hit; no per-target skill refund). Enemy stagger/parry/phase durations are respected; obstacle steering helps enemies navigate props. Wave breaks supply health/energy; full-health/full-energy pickups wait for need. Boss phase 3 warns three separated lightning zones; residual threats clear after death. Particle/text positions follow camera movement, drops are located before drawing even during hitstop, and death/transition time is excluded from run time.

Visual reference: [V Rising Art & Mood](https://blog.stunlock.com/v-rising-dev-update-3-art-mood/). The reference informs atmosphere, readable silhouettes and distinct weapon effects; all character costumes, environment drawings and game assets here are original procedural art with Mongolian themes.

- Тал нутаг, гэр хороолол, уулын гурван орчны байгалийн өнгө, уулын бүтэц, зөөлөн үүл, утаа.
- Газрын жижиг чулуу, шороо, салхинд найгах өвс, гэрэл, манан, агаарт хөвөх тоос.
- Дүрийн хувцас, арьсны гэрэл-сүүдэр, нүүрний хажуу дүрс, зөөлөн газарт тусах сүүдэр.
- Туулсан зайтай уялдсан алхалт, хурдасгалд бие хазайх, газардалтын нугаралт, хөлийн мөр.
- Хөдөлгөөний чиглэл рүү зөөлөн дагах камер.
- **Settings → Орчны нэмэлт эффект**: өвс, манан, гэрэл, агаарт хөвөх тоосыг унтрааж болно. Сонголт хадгалагдана; reduced-motion тохиргоотой үед анхнаасаа унтраалттай.

## Ажиллуулах ба шалгах

Build шаардлагагүй. `python3 -m http.server 8080` ажиллуулаад `http://localhost:8080/game.html` нээнэ.
`game-world.js`-ийг `game.js`-ийн өмнө ачаална; гараар сайт руу хуулбал энэ шинэ файлыг хамтад нь оруулна.
Орчны текстур кодоор үүсэж, theme тус бүрээр cache хийгдэнэ. Гаднаас зураг татахгүй.

Cloudflare Workers Builds нь `wrangler.jsonc`-г ашиглана. `main` branch дээр `npx wrangler deploy`, бусад branch/PR дээр `npx wrangler preview` ажиллана. `.assetsignore` нь Git metadata, тест болон архивуудыг public asset болгохоос хамгаална.

Браузерын regression шалгалт: Playwright суулгасан орчинд `node tests/game-smoke.cjs`.
Хэрэв шаардлагатай бол `npm install --no-save playwright`, дараа нь `npx playwright install chromium`.
Өөрийн Chromium ашиглах бол `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` тохируулна.
`TEGTAT_SCREENSHOTS` тохируулбал дөрвөн үеийн зураг хадгална.

Leaderboard нь `api-worker.js` доторх `/api/leaderboard`, `/api/save-score` endpoint болон `wrangler.jsonc`-ийн `DB` D1 binding-ийг ашиглана. Workers Preview нь тусдаа `previews.d1_databases` binding шаарддаг; энэ тохиргоо production-той ижил nickname/score жагсаалтыг ашиглана.

---

# TEGTAT 2D — Гол дүрийн дуут хэллэг (Character Voice System)

Тоглоом энэ хавтаснаас дуут файл уншина. **Файл байхгүй үед тоглоом хэвийн ажиллана** — түр зуурын
синтез хоолой ("ёо!" маягийн дуу) + дүрийн толгой дээр бичвэр (subtitle) гарна. Жинхэнэ Монгол бичлэгээ
хийвэл тухайн хэллэг автоматаар бичлэгээр солигдоно.

## 1. Файлуудаа энд хийнэ

```
audio/voice/
├── voice-lines.json      ← тохиргоо (энэ файлд "enabled": true болгоно)
├── hurt_01.mp3           Ёоё, писда!               (цохиулахад — гол хэллэг, бусдаасаа 4 дахин их гарна)
├── hurt_02.mp3           Өө, хөөе!
├── hurt_03.mp3           Боль л доо!
├── hurt_04.mp3           Арай ч дээ!
├── hurt_05.mp3           Яасан хатуу цохидог юм!
├── low_hp_01.mp3         Өө, хэцүүдлээ!            (HP 25%-иас доош ороход)
├── low_hp_02.mp3         Амь хүрэхгүй нь!
├── skill_01.mp3          За ав!                    (E POWER / R ULTIMATE)
├── skill_02.mp3          Одоо хар!
├── boss_defeat_01.mp3    За, дууслаа!              (Морьт ТЭКА ялагдахад — үргэлж)
└── teka_taunt_01.mp3     Гэчий минь!               (ТЭКА хүчтэй дайралт хийхэд)
```

## 2. Идэвхжүүлэх

`voice-lines.json` доторх `"enabled": false` → **`"enabled": true`** болгоод deploy хийнэ.
(Файлгүй үед 404 алдаа консолд гарахгүйн тулд анхдагчаар унтраалттай.)

Файлын нэр өөр бол `"file"`-ийг өөрчилнө (зөвхөн үсэг, тоо, `_ - .`). `"weight"` — давтамж.
`"text"` — subtitle-д гарах бичвэр.

## Текагийн шинэ тулаан ба skill-ийн ялгаа

- Морьт Тека 1400 HP-тай. Хөөх хурд 259–296 world units/s (гол дүр 215); хол зайд урт дайралт ба угтсан аянга ээлжилнэ. Дайралтын чиглэл сүүлийн 0.25 сек түгжигдэнэ; дайралтын дараа 0.65–0.9 сек эсрэг цохилт хийх боломжтой.
- Ойр зайд 220 хүрээтэй тойрог сэлэм: 0.72 сек анхааруулга, үсэрч эсвэл бултаж зайлна. Аянга 0.8+ сек газрын тэмдэгтэй, 2/3/5 бүс болж нэмэгдэнэ. Phase 2/3-д 3 салаа аянгын сум нэмэгдэнэ.
- Q: 22 damage-тай зүсэж бултах, нэг дайсанд нэг удаа. E: урагш түрэх, 360 хүрээтэй нарийн чиглэсэн 58 damage, 4 сек armor break. R: урагш 240 зайд 220 хүрээтэй тогтмол шуурга, 0.6 сек зайтай 3 цохилт (boss-д 48, бусдад 38); байрлалаа сольсон ч шуурга үргэлжилнэ.
- Regression: `node tests/isometric.cjs` хөөх хурд, хол дайралт, чиглэл түгжих, аянгаас гарах, тойрог сэлэм болон гурван skill-ийн ялгааг шалгана.

## 3. Бичлэгийн зөвлөмж

- Байгалийн, илэрхийлэлтэй Монгол эрэгтэй хоолой — гайхсан / өвдсөн өнгө.
- Богино: 0.4–1.5 сек. Эхэн ба төгсгөлийн чимээгүйг таслах.
- MP3 (128 kbps, mono, 44.1/48 kHz) — бүх браузерт ажиллана. Нэг файл ≤ 60 KB орчим.
- Дууны түвшинг бүгдийг нь ойролцоо (≈ −3 dBFS peak) болгох.

## 4. Тоглоомд хэрхэн гардаг

| Бүлэг | Хэзээ | Магадлал / cooldown |
|---|---|---|
| hurt | Гол дүр цохиулахад | 45%, 3.5 сек cooldown, дараалан ижил хэллэг давтагдахгүй |
| lowHp | HP ≤ 25% болоход (40%-иас дээш эдгэртэл дахин гарахгүй) | Үргэлж |
| skill | E эсвэл R ашиглахад | 70%, 2.5 сек cooldown |
| bossDefeat | Морьт ТЭКА ялагдахад | Үргэлж |
| tekaTaunt | ТЭКА хүчтэй дайралт хийхэд | 65%, 5.5 сек cooldown |

Бүх хэллэг хооронд дор хаяж 1.2 сек зай. Хэллэг тоглох үед хөгжим түр намсна.
Дууны түвшин: **Settings → Voice** (0–100). Subtitle: **Settings → Дуут хэллэгийн бичвэр**.
