/* ==========================================================================
   ENEREl — IQ Test
   Sections: data · svg rendering · state · timer · test flow · scoring ·
   result rendering · init
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------------ */
  const TEST_DURATION_MS = 15 * 60 * 1000;
  const ADVANCE_DELAY_MS = 380;     // time the chosen answer stays visible
  const SWAP_DURATION_MS = 220;     // question slide/fade
  const LETTERS = ["A", "B", "C", "D"];

  /* ------------------------------------------------------------------------
     VISUAL SPEC HELPERS
     Visual answers and figures are small specs rendered to inline SVG.
     ------------------------------------------------------------------------ */
  const shape = (kind, count, fill) => ({ type: "shapes", kind, count, fill: fill || "none" });
  const lines = (...set) => ({ type: "lines", set });
  const arrow = (deg) => ({ type: "arrow", deg });
  const poly = (cells) => ({ type: "poly", cells });

  // Polyomino transforms (screen coordinates, y grows downward)
  function normalize(cells) {
    const minX = Math.min(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    return cells
      .map(([x, y]) => [x - minX, y - minY])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
  const rotateCW = (cells) => normalize(cells.map(([x, y]) => [-y, x]));
  const mirrorX = (cells) => normalize(cells.map(([x, y]) => [-x, y]));
  const rotateTimes = (cells, times) => {
    let result = normalize(cells);
    for (let i = 0; i < times; i += 1) result = rotateCW(result);
    return result;
  };
  const L_SHAPE = normalize([[0, 0], [0, 1], [0, 2], [1, 2]]);

  /* ------------------------------------------------------------------------
     DATA — 20 questions, difficulty rises every five
     ------------------------------------------------------------------------ */
  const QUESTIONS = [
    {
      id: 1,
      category: "Тоон дараалал",
      difficulty: "easy",
      question: "Дараагийн тоо аль нь вэ?",
      figure: { type: "sequence", items: [2, 4, 8, 16, "?"] },
      answers: ["24", "30", "32", "36"],
      correctAnswer: 2,
      explanation: "Тоо бүр өмнөхөөсөө 2 дахин их байна: 16 × 2 = 32."
    },
    {
      id: 2,
      category: "Аналоги",
      difficulty: "easy",
      question: "Нүд : харах = Чих : ?",
      note: "Эхний хос үгийн холбоотой адил холбоо бүхий үгийг сонгоно уу.",
      answers: ["Ярих", "Сонсох", "Дуу", "Толгой"],
      correctAnswer: 1,
      explanation: "Нүд нь харах эрхтэн, чих нь сонсох эрхтэн. Холбоо нь «эрхтэн → түүний үүрэг»."
    },
    {
      id: 3,
      category: "Дүрсийн зүй тогтол",
      difficulty: "easy",
      question: "Дараагийн дүрс аль нь вэ?",
      figure: { type: "strip", cells: [arrow(0), arrow(90), arrow(180)] },
      answerType: "visual",
      answers: [arrow(0), arrow(90), arrow(45), arrow(270)],
      answerLabels: ["дээш заасан сум", "баруун тийш заасан сум", "баруун дээш заасан сум", "зүүн тийш заасан сум"],
      correctAnswer: 3,
      explanation: "Сум алхам бүрт цагийн зүүний дагуу 90°-аар эргэнэ: дээш → баруун → доош → зүүн."
    },
    {
      id: 4,
      category: "Ялгаатайг олох",
      difficulty: "easy",
      question: "Аль нь бусдаасаа ялгаатай вэ?",
      answers: ["Алим", "Лууван", "Банана", "Усан үзэм"],
      correctAnswer: 1,
      explanation: "Алим, банана, усан үзэм бол жимс. Лууван бол хүнсний ногоо."
    },
    {
      id: 5,
      category: "Логик",
      difficulty: "easy",
      question: "Бат Доржоос өндөр. Дорж Сүхээс өндөр. Хамгийн намхан нь хэн бэ?",
      answers: ["Бат", "Дорж", "Сүх", "Хэлэх боломжгүй"],
      correctAnswer: 2,
      explanation: "Бат > Дорж > Сүх гэсэн дараалал гарна. Хамгийн намхан нь Сүх."
    },
    {
      id: 6,
      category: "Тоон дараалал",
      difficulty: "medium",
      question: "Дараагийн тоо аль нь вэ?",
      figure: { type: "sequence", items: [2, 3, 5, 8, 12, "?"] },
      answers: ["16", "17", "18", "20"],
      correctAnswer: 1,
      explanation: "Тоонуудын зөрүү 1, 2, 3, 4 гэж нэг нэгээр өснө. Дараагийн зөрүү 5 тул 12 + 5 = 17."
    },
    {
      id: 7,
      category: "Pattern recognition",
      difficulty: "medium",
      question: "«?»-ийн оронд аль дүрс тохирох вэ?",
      figure: {
        type: "matrix",
        cells: [
          shape("circle", 1, "solid"), shape("square", 1, "none"), shape("triangle", 1, "stripe"),
          shape("circle", 1, "none"), shape("square", 1, "stripe"), shape("triangle", 1, "solid"),
          shape("circle", 1, "stripe"), shape("square", 1, "solid")
        ]
      },
      answerType: "visual",
      answers: [shape("triangle", 1, "solid"), shape("triangle", 1, "stripe"), shape("circle", 1, "none"), shape("triangle", 1, "none")],
      answerLabels: ["дүүрэн гурвалжин", "судалтай гурвалжин", "хоосон тойрог", "хоосон гурвалжин"],
      correctAnswer: 3,
      explanation: "Багана бүрт дүрс ижил байна. Мөр, багана бүрт дүүрэн, хоосон, судалтай бөглөлт тус бүр нэг удаа орно. Сүүлийн нүдэнд хоосон гурвалжин үлдэнэ."
    },
    {
      id: 8,
      category: "Математик сэтгэлгээ",
      difficulty: "medium",
      question: "5 машин 5 эд ангийг 5 минутад хийдэг. 100 машин 100 эд ангийг хэдэн минутад хийх вэ?",
      answers: ["5 минут", "1 минут", "20 минут", "100 минут"],
      correctAnswer: 0,
      explanation: "Машин бүр 5 минутад 1 эд анги хийнэ. 100 машин зэрэг ажиллахад 100 эд анги мөн 5 минутад бэлэн болно."
    },
    {
      id: 9,
      category: "Орон зай",
      difficulty: "medium",
      question: "Дүрсийг цагийн зүүний дагуу 90° эргүүлбэл аль нь болох вэ?",
      note: "Зөвхөн эргүүлнэ, толинд тусгахгүй.",
      figure: { type: "single", spec: poly(L_SHAPE) },
      answerType: "visual",
      answers: [poly(rotateTimes(L_SHAPE, 3)), poly(rotateTimes(L_SHAPE, 1)), poly(mirrorX(L_SHAPE)), poly(rotateTimes(L_SHAPE, 2))],
      answerLabels: ["цагийн зүүний эсрэг эргүүлсэн дүрс", "цагийн зүүний дагуу эргүүлсэн дүрс", "толинд тусгасан дүрс", "180° эргүүлсэн дүрс"],
      correctAnswer: 1,
      explanation: "Босоо хэсэг хэвтээ болж, доод хөл нь зүүн доод буланд шилжинэ. Толины дүрсийг эргүүлэхээр гаргах боломжгүй."
    },
    {
      id: 10,
      category: "Дедукц",
      difficulty: "medium",
      question: "Бүх сарлаг хөхтөн амьтан. Зарим хөхтөн амьтан усанд сэлдэг. Аль нь гарцаагүй үнэн бэ?",
      answers: ["Бүх сарлаг усанд сэлдэг", "Зарим сарлаг усанд сэлдэг", "Ямар ч сарлаг усанд сэлдэггүй", "Эдгээрийн аль нь ч гарцаагүй үнэн биш"],
      correctAnswer: 3,
      explanation: "Усанд сэлдэг «зарим хөхтөн» дотор сарлаг байж ч болно, байхгүй ч байж болно. Өгөгдлөөс сарлагийн талаар гарцаагүй дүгнэлт хийх боломжгүй."
    },
    {
      id: 11,
      category: "Хийсвэр хувиргалт",
      difficulty: "medium-hard",
      question: "«?»-ийн оронд аль дүрс тохирох вэ?",
      note: "Мөр бүрийн эхний хоёр нүд гурав дахь нүдийг тодорхойлно.",
      figure: {
        type: "matrix",
        cells: [
          lines("H"), lines("V"), lines("H", "V"),
          lines("D1"), lines("O"), lines("D1", "O"),
          lines("V"), lines("D2")
        ]
      },
      answerType: "visual",
      answers: [lines("D2"), lines("H", "D2"), lines("V", "D2"), lines("V")],
      answerLabels: ["ганц ташуу зураас", "хэвтээ ба ташуу зураас", "босоо ба ташуу зураас", "ганц босоо зураас"],
      correctAnswer: 2,
      explanation: "Гурав дахь нүд нь эхний хоёр нүдийг давхарласан дүн. Босоо зураас ба ташуу зураасыг давхарлана."
    },
    {
      id: 12,
      category: "Тоон дараалал",
      difficulty: "medium-hard",
      question: "Дараагийн тоо аль нь вэ?",
      figure: { type: "sequence", items: [2, 6, 12, 20, 30, "?"] },
      answers: ["42", "40", "36", "48"],
      correctAnswer: 0,
      explanation: "Зөрүүнүүд 4, 6, 8, 10 гэж өснө. Дараагийн зөрүү 12 тул 30 + 12 = 42. Өөрөөр бол n × (n + 1): 6 × 7 = 42."
    },
    {
      id: 13,
      category: "Математик сэтгэлгээ",
      difficulty: "medium-hard",
      question: "Бат дүүгээсээ 3 дахин ах. 10 жилийн дараа тэр дүүгээсээ 2 дахин ах болно. Бат одоо хэдэн настай вэ?",
      answers: ["24", "27", "30", "33"],
      correctAnswer: 2,
      explanation: "Дүү x настай бол Бат 3x. 10 жилийн дараа 3x + 10 = 2(x + 10), эндээс x = 10. Бат 30 настай."
    },
    {
      id: 14,
      category: "Аналоги",
      difficulty: "medium-hard",
      question: "Үсэг бүрийг цагаан толгойн дараагийн үсгээр солив: НОМ → ОӨН. Тэгвэл ГЭР → ?",
      answers: ["ДЭС", "ДЮС", "ВЮС", "ДЮР"],
      correctAnswer: 1,
      explanation: "Монгол цагаан толгойд Г-ийн дараа Д, Э-ийн дараа Ю, Р-ийн дараа С орно. ГЭР → ДЮС."
    },
    {
      id: 15,
      category: "Орон зай",
      difficulty: "medium-hard",
      question: "Дүрсэнд нийт хэдэн гурвалжин байна вэ?",
      figure: { type: "single", spec: { type: "triangles" } },
      answers: ["5", "6", "7", "8"],
      correctAnswer: 1,
      explanation: "Дээд хэсэгт 3 гурвалжин (зүүн, баруун, хоёулаа нийлсэн), доод хэсэгт 3 гурвалжин (зүүн том, баруун том, бүхэл гурвалжин). Нийт 6."
    },
    {
      id: 16,
      category: "Абстракт сэтгэлгээ",
      difficulty: "hard",
      question: "«?»-ийн оронд аль дүрс тохирох вэ?",
      note: "Мөр бүрийн эхний хоёр нүд гурав дахь нүдийг тодорхойлно.",
      figure: {
        type: "matrix",
        cells: [
          lines("H", "V"), lines("V", "D1"), lines("H", "D1"),
          lines("D1", "D2", "O"), lines("D2"), lines("D1", "O"),
          lines("H", "D2"), lines("H", "V", "O")
        ]
      },
      answerType: "visual",
      answers: [lines("H", "V", "D2", "O"), lines("V", "O"), lines("H", "D2", "O"), lines("V", "D2", "O")],
      answerLabels: ["хэвтээ, босоо, ташуу зураас ба тойрог", "босоо зураас ба тойрог", "хэвтээ, ташуу зураас ба тойрог", "босоо, ташуу зураас ба тойрог"],
      correctAnswer: 3,
      explanation: "Хоёр нүдэнд хоёуланд нь байгаа зураас арилж, зөвхөн нэгд нь байгаа нь үлдэнэ. Хэвтээ зураас хоёуланд байгаа тул арилж, ташуу, босоо зураас ба тойрог үлдэнэ."
    },
    {
      id: 17,
      category: "Тоон дараалал",
      difficulty: "hard",
      question: "Дараагийн тоо аль нь вэ?",
      figure: { type: "sequence", items: [2, 6, 7, 21, 22, 66, "?"] },
      answers: ["132", "68", "198", "67"],
      correctAnswer: 3,
      explanation: "Хоёр үйлдэл ээлжилнэ: ×3, +1, ×3, +1, ×3. Дараагийнх нь +1 тул 66 + 1 = 67."
    },
    {
      id: 18,
      category: "Дедукц",
      difficulty: "hard",
      question: "Нэг арал дээр үнэнч хүн үргэлж үнэн, худалч хүн үргэлж худал хэлдэг. А: «Бид хоёулаа худалч». А, Б хэн бэ?",
      answers: ["А үнэнч, Б худалч", "Хоёулаа худалч", "А худалч, Б үнэнч", "Хоёулаа үнэнч"],
      correctAnswer: 2,
      explanation: "А үнэнч бол өөрийгөө худалч гэж хэлэхгүй, тиймээс А худалч. Түүний үг худал тул «хоёулаа худалч» биш, Б үнэнч."
    },
    {
      id: 19,
      category: "Орон зай",
      difficulty: "hard",
      question: "Задлалыг шоо болгож эвхэхэд 1-ийн эсрэг талд аль тоо байх вэ?",
      figure: { type: "single", spec: { type: "net" } },
      answers: ["5", "2", "3", "4"],
      correctAnswer: 2,
      explanation: "Босоо эгнээний 1, 2, 3, 4 талууд нэг нэгээ алгасаж эсрэгцэнэ: 1 ↔ 3, 2 ↔ 4. Хажуугийн 5 ↔ 6."
    },
    {
      id: 20,
      category: "Математик сэтгэлгээ",
      difficulty: "hard",
      question: "Цаг 3:15-ыг заахад цагийн зүү, минутын зүү хоёрын хоорондох өнцөг хэд вэ?",
      figure: { type: "single", spec: { type: "clock" } },
      answers: ["15°", "0°", "22.5°", "7.5°"],
      correctAnswer: 3,
      explanation: "Минутын зүү 3 дээр (90°) байна. Цагийн зүү 15 минутад 3-аас ¼ цагийн зай буюу 7.5°-аар урагшилж 97.5° дээр байна. Зөрүү 7.5°."
    }
  ];

  /* ------------------------------------------------------------------------
     SVG RENDERING
     ------------------------------------------------------------------------ */
  const INK = "currentColor";
  const STROKE = `stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"`;

  function polygonPoints(sides, cx, cy, radius, startDeg) {
    const points = [];
    for (let i = 0; i < sides; i += 1) {
      const angle = ((startDeg + (360 * i) / sides) * Math.PI) / 180;
      points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`);
    }
    return points.join(" ");
  }

  function renderShape(kind, cx, cy, size, fill) {
    const fillValue = fill === "solid" ? INK : fill === "stripe" ? "url(#hatch)" : "none";
    if (kind === "circle") return `<circle cx="${cx}" cy="${cy}" r="${(size * 0.95).toFixed(1)}" fill="${fillValue}" ${STROKE}/>`;
    if (kind === "square") return `<polygon points="${polygonPoints(4, cx, cy, size * 1.2, -45)}" fill="${fillValue}" ${STROKE}/>`;
    if (kind === "triangle") return `<polygon points="${polygonPoints(3, cx, cy + size * 0.14, size * 1.15, -90)}" fill="${fillValue}" ${STROKE}/>`;
    return "";
  }

  const SHAPE_LAYOUT = {
    1: [[50, 50, 24]],
    2: [[29, 50, 15], [71, 50, 15]],
    3: [[50, 30, 13], [29, 69, 13], [71, 69, 13]]
  };

  const LINE_MARKUP = {
    H: '<line x1="14" y1="50" x2="86" y2="50"/>',
    V: '<line x1="50" y1="14" x2="50" y2="86"/>',
    D1: '<line x1="22" y1="22" x2="78" y2="78"/>',
    D2: '<line x1="78" y1="22" x2="22" y2="78"/>',
    O: '<circle cx="50" cy="50" r="27"/>'
  };

  function renderPolyomino(cells) {
    const width = Math.max(...cells.map((c) => c[0])) + 1;
    const height = Math.max(...cells.map((c) => c[1])) + 1;
    const unit = Math.min(21, 74 / Math.max(width, height));
    const offsetX = 50 - (width * unit) / 2;
    const offsetY = 50 - (height * unit) / 2;
    return cells
      .map(([x, y]) => `<rect x="${(offsetX + x * unit).toFixed(1)}" y="${(offsetY + y * unit).toFixed(1)}" width="${unit.toFixed(1)}" height="${unit.toFixed(1)}" rx="2.5" fill="${INK}" stroke="#FFFDFB" stroke-width="1.8"/>`)
      .join("");
  }

  function renderTriangleFigure() {
    return `<g fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
      <polygon points="50,6 6,94 94,94"/><line x1="50" y1="6" x2="50" y2="94"/><line x1="28" y1="50" x2="72" y2="50"/></g>`;
  }

  function renderCubeNet() {
    const layout = { 1: [1, 0], 2: [1, 1], 3: [1, 2], 4: [1, 3], 5: [0, 1], 6: [2, 1] };
    const unit = 22;
    const ox = 17;
    const oy = 6;
    return Object.keys(layout).map((face) => {
      const x = ox + layout[face][0] * unit;
      const y = oy + layout[face][1] * unit;
      const isTarget = face === "1";
      return `<rect x="${x}" y="${y}" width="${unit}" height="${unit}" fill="${isTarget ? "#F5E6E9" : "none"}" stroke="${INK}" stroke-width="1.6"/>
        <text x="${x + unit / 2}" y="${y + unit / 2 + 5}" text-anchor="middle" font-size="13" font-weight="700" font-family="Golos Text, sans-serif" fill="${isTarget ? "#7A1F35" : INK}">${face}</text>`;
    }).join("");
  }

  function renderClock() {
    let ticks = "";
    for (let i = 0; i < 12; i += 1) {
      const angle = (i * 30 * Math.PI) / 180;
      const inner = i % 3 === 0 ? 33 : 36;
      ticks += `<line x1="${(50 + inner * Math.sin(angle)).toFixed(1)}" y1="${(50 - inner * Math.cos(angle)).toFixed(1)}" x2="${(50 + 40 * Math.sin(angle)).toFixed(1)}" y2="${(50 - 40 * Math.cos(angle)).toFixed(1)}" stroke="${INK}" stroke-width="${i % 3 === 0 ? 2.4 : 1.4}" stroke-linecap="round"/>`;
    }
    const hourAngle = 97.5;
    const minuteAngle = 90;
    const hand = (deg, length, width, color) => {
      const rad = (deg * Math.PI) / 180;
      return `<line x1="50" y1="50" x2="${(50 + length * Math.sin(rad)).toFixed(1)}" y2="${(50 - length * Math.cos(rad)).toFixed(1)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
    };
    return `<circle cx="50" cy="50" r="44" fill="none" stroke="${INK}" stroke-width="2.4"/>${ticks}
      ${hand(hourAngle, 22, 4.2, INK)}${hand(minuteAngle, 33, 2.6, "#7A1F35")}<circle cx="50" cy="50" r="3" fill="${INK}"/>`;
  }

  function renderSpecInner(spec) {
    switch (spec.type) {
      case "shapes":
        return SHAPE_LAYOUT[spec.count].map(([x, y, s]) => renderShape(spec.kind, x, y, s, spec.fill)).join("");
      case "lines":
        return `<g fill="none" stroke="${INK}" stroke-width="4.2" stroke-linecap="round">${["H", "V", "D1", "D2", "O"].filter((k) => spec.set.includes(k)).map((k) => LINE_MARKUP[k]).join("")}</g>`;
      case "arrow":
        return `<g transform="rotate(${spec.deg} 50 50)"><path d="M50 14 L70 40 H58 V84 H42 V40 H30 Z" fill="${INK}"/></g>`;
      case "poly":
        return renderPolyomino(spec.cells);
      case "triangles":
        return renderTriangleFigure();
      case "net":
        return renderCubeNet();
      case "clock":
        return renderClock();
      default:
        return "";
    }
  }

  function renderSvg(spec, label) {
    const a11y = label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"';
    return `<svg viewBox="0 0 100 100" ${a11y} focusable="false">${renderSpecInner(spec)}</svg>`;
  }

  function renderFigure(figure) {
    if (!figure) return "";
    if (figure.type === "sequence") {
      const items = figure.items
        .map((item) => (item === "?" ? '<span class="is-unknown" aria-label="тодорхойгүй тоо">?</span>' : `<span>${item}</span>`))
        .join("");
      return `<div class="figure"><div class="sequence">${items}</div></div>`;
    }
    if (figure.type === "matrix" || figure.type === "strip") {
      const cells = figure.cells.map((spec) => `<div class="cell">${renderSvg(spec)}</div>`).join("");
      return `<div class="figure" role="img" aria-label="Дүрсийн зүй тогтол"><div class="${figure.type}">${cells}<div class="cell is-unknown" aria-hidden="true">?</div></div></div>`;
    }
    if (figure.type === "single") {
      return `<div class="figure"><div class="figure-single">${renderSvg(figure.spec, "Асуултын зураг")}</div></div>`;
    }
    return "";
  }

  /* ------------------------------------------------------------------------
     UTILITIES
     ------------------------------------------------------------------------ */
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  const pad2 = (n) => String(n).padStart(2, "0");

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    return `${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`;
  }

  const isVisual = (question) => question.answerType === "visual";
  const isNumeric = (value) => typeof value === "string" && /^[\d.,°]+$/.test(value);
  const prefersReducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function answerLabel(question, index) {
    if (index === null || index === undefined) return "Хариулаагүй";
    return isVisual(question) ? question.answerLabels[index] : question.answers[index];
  }

  /* ------------------------------------------------------------------------
     STATE
     ------------------------------------------------------------------------ */
  const state = {
    currentIndex: 0,
    answers: [],
    startedAt: 0,
    endsAt: 0,
    finishedAt: 0,
    finishReason: null,
    isLocked: false,
    isRunning: false,
    timerId: null,
    pendingTimeouts: []
  };

  function resetState() {
    clearPending();
    stopTimer();
    state.currentIndex = 0;
    state.answers = new Array(QUESTIONS.length).fill(null);
    state.startedAt = 0;
    state.endsAt = 0;
    state.finishedAt = 0;
    state.finishReason = null;
    state.isLocked = false;
    state.isRunning = false;
  }

  function later(fn, ms) {
    const id = window.setTimeout(() => {
      state.pendingTimeouts = state.pendingTimeouts.filter((t) => t !== id);
      fn();
    }, ms);
    state.pendingTimeouts.push(id);
  }

  function clearPending() {
    state.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    state.pendingTimeouts = [];
  }

  /* ------------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------------ */
  const dom = {
    screens: {
      landing: document.getElementById("screen-landing"),
      test: document.getElementById("screen-test"),
      result: document.getElementById("screen-result")
    },
    startButton: document.getElementById("start-button"),
    restartButton: document.getElementById("restart-button"),
    timer: document.getElementById("timer"),
    timerValue: document.getElementById("timer-value"),
    progressCount: document.getElementById("progress-count"),
    progressCategory: document.getElementById("progress-category"),
    progressTrack: document.getElementById("progress-track"),
    progressFill: document.getElementById("progress-fill"),
    stage: document.getElementById("question-stage"),
    resultTitle: document.getElementById("result-title"),
    resultTimeout: document.getElementById("result-timeout"),
    ringValue: document.getElementById("ring-value"),
    scoreNumber: document.getElementById("score-number"),
    scoreLevel: document.getElementById("score-level"),
    scoreRange: document.getElementById("score-range"),
    statCorrect: document.getElementById("stat-correct"),
    statPercent: document.getElementById("stat-percent"),
    statTime: document.getElementById("stat-time"),
    reviewSummary: document.getElementById("review-summary"),
    reviewList: document.getElementById("review-list")
  };

  function showScreen(name) {
    Object.entries(dom.screens).forEach(([key, element]) => {
      const active = key === name;
      element.hidden = !active;
      element.classList.toggle("is-active", active);
    });
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------------
     TIMER
     ------------------------------------------------------------------------ */
  function startTimer() {
    stopTimer();
    updateTimer();
    state.timerId = window.setInterval(updateTimer, 250);
  }

  function stopTimer() {
    if (state.timerId) window.clearInterval(state.timerId);
    state.timerId = null;
  }

  function updateTimer() {
    if (!state.isRunning) return;
    const remaining = state.endsAt - Date.now();
    dom.timerValue.textContent = formatDuration(remaining);
    dom.timer.classList.toggle("is-low", remaining <= 60 * 1000);
    if (remaining <= 0) finishTest("timeout");
  }

  /* ------------------------------------------------------------------------
     TEST FLOW
     ------------------------------------------------------------------------ */
  function startTest() {
    resetState();
    state.startedAt = Date.now();
    state.endsAt = state.startedAt + TEST_DURATION_MS;
    state.isRunning = true;
    showScreen("test");
    renderQuestion(0, false);
    updateProgress();
    startTimer();
  }

  function updateProgress() {
    const answered = state.answers.filter((a) => a !== null).length;
    const question = QUESTIONS[state.currentIndex];
    dom.progressCount.textContent = `${pad2(state.currentIndex + 1)} / ${QUESTIONS.length}`;
    dom.progressCategory.textContent = question ? question.category : "";
    dom.progressFill.style.width = `${(answered / QUESTIONS.length) * 100}%`;
    dom.progressTrack.setAttribute("aria-valuenow", String(answered));
    dom.progressTrack.setAttribute("aria-valuetext", `${QUESTIONS.length}-аас ${answered} асуултад хариулсан`);
  }

  function questionMarkup(question, index) {
    const visual = isVisual(question);
    const listClass = visual ? "answers is-visual" : "answers is-text";
    const answers = question.answers.map((answer, answerIndex) => {
      const letter = LETTERS[answerIndex];
      const label = `${letter} хариулт: ${answerLabel(question, answerIndex)}`;
      const content = visual
        ? `<span class="answer-visual">${renderSvg(answer)}</span>`
        : `<span class="answer-text${isNumeric(answer) ? " is-number" : ""}">${escapeHtml(answer)}</span>`;
      return `<li><button type="button" class="answer" data-answer="${answerIndex}" aria-label="${escapeHtml(label)}">
        <span class="answer-letter" aria-hidden="true">${letter}</span>${content}</button></li>`;
    }).join("");

    return `<article class="question" data-index="${index}">
      <h2 class="question-text" tabindex="-1">${escapeHtml(question.question)}</h2>
      ${question.note ? `<p class="question-note">${escapeHtml(question.note)}</p>` : ""}
      ${renderFigure(question.figure)}
      <ul class="${listClass}" aria-label="Хариултууд">${answers}</ul>
      <p class="keyboard-hint" aria-hidden="true">Товчлуураар: <kbd>1</kbd>–<kbd>4</kbd> эсвэл <kbd>A</kbd>–<kbd>D</kbd></p>
    </article>`;
  }

  function renderQuestion(index, animate) {
    state.currentIndex = index;
    state.isLocked = false;
    dom.stage.innerHTML = questionMarkup(QUESTIONS[index], index);
    const article = dom.stage.querySelector(".question");

    if (animate && !prefersReducedMotion()) {
      article.classList.add("is-entering");
      // force layout so the entering state is painted before it transitions away
      void article.offsetWidth;
      article.classList.remove("is-entering");
    }

    updateProgress();
    const heading = article.querySelector(".question-text");
    if (heading && animate) heading.focus({ preventScroll: true });
  }

  function selectAnswer(answerIndex) {
    if (!state.isRunning || state.isLocked) return;
    const question = QUESTIONS[state.currentIndex];
    if (answerIndex < 0 || answerIndex >= question.answers.length) return;

    state.isLocked = true;
    state.answers[state.currentIndex] = answerIndex;

    const list = dom.stage.querySelector(".answers");
    list.classList.add("is-locked");
    list.querySelectorAll(".answer").forEach((button) => {
      const chosen = Number(button.dataset.answer) === answerIndex;
      button.classList.toggle("is-selected", chosen);
      button.classList.toggle("is-dimmed", !chosen);
      if (chosen) button.setAttribute("aria-pressed", "true");
    });
    updateProgress();

    const isLast = state.currentIndex === QUESTIONS.length - 1;
    later(() => {
      if (!state.isRunning) return;
      if (isLast) {
        finishTest("complete");
        return;
      }
      goToQuestion(state.currentIndex + 1);
    }, ADVANCE_DELAY_MS);
  }

  function goToQuestion(index) {
    const article = dom.stage.querySelector(".question");
    if (!article || prefersReducedMotion()) {
      renderQuestion(index, true);
      return;
    }
    article.classList.add("is-leaving");
    later(() => {
      if (!state.isRunning) return;
      renderQuestion(index, true);
    }, SWAP_DURATION_MS);
  }

  function finishTest(reason) {
    if (!state.isRunning) return;
    state.isRunning = false;
    state.finishReason = reason;
    state.finishedAt = Math.min(Date.now(), state.endsAt);
    stopTimer();
    clearPending();
    const result = calculateResult(state.answers);
    renderResult(result);
    showScreen("result");
    animateResult(result);
    dom.resultTitle.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------------
     SCORING — informal, based on the number of correct answers
     ------------------------------------------------------------------------ */
  const LEVELS = [
    { min: 19, label: "Маш өндөр" },
    { min: 16, label: "Өндөр" },
    { min: 13, label: "Дундаас дээгүүр" },
    { min: 9, label: "Дундаж" },
    { min: 5, label: "Суурь түвшин" },
    { min: 0, label: "Дахин нэг оролдоод үзээрэй" }
  ];

  // 0 correct → 70, each correct answer adds 3.5 → 20 correct → 140
  function estimateIq(correct) {
    return Math.round(70 + correct * 3.5);
  }

  function calculateResult(answers) {
    let correct = 0;
    let incorrect = 0;
    let skipped = 0;

    const details = QUESTIONS.map((question, index) => {
      const chosen = answers[index];
      let status;
      if (chosen === null || chosen === undefined) {
        skipped += 1;
        status = "skipped";
      } else if (chosen === question.correctAnswer) {
        correct += 1;
        status = "correct";
      } else {
        incorrect += 1;
        status = "incorrect";
      }
      return { question, chosen, status };
    });

    const iq = estimateIq(correct);
    const level = LEVELS.find((l) => correct >= l.min).label;

    return {
      correct,
      incorrect,
      skipped,
      total: QUESTIONS.length,
      percent: Math.round((correct / QUESTIONS.length) * 100),
      iq,
      rangeLow: iq - 5,
      rangeHigh: iq + 5,
      level,
      details
    };
  }

  /* ------------------------------------------------------------------------
     RESULT RENDERING
     ------------------------------------------------------------------------ */
  const RING_LENGTH = 2 * Math.PI * 86;

  function renderResult(result) {
    dom.resultTimeout.hidden = state.finishReason !== "timeout";
    dom.scoreNumber.textContent = "0";
    dom.scoreLevel.textContent = result.level;
    dom.scoreRange.textContent = `Ойролцоогоор ${result.rangeLow}–${result.rangeHigh} хооронд · албан бус тооцоо`;
    dom.statCorrect.textContent = `${result.correct} / ${result.total}`;
    dom.statPercent.textContent = `${result.percent}%`;
    dom.statTime.textContent = formatDuration(state.finishedAt - state.startedAt);

    const parts = [`${result.correct} зөв`, `${result.incorrect} буруу`];
    if (result.skipped) parts.push(`${result.skipped} хариулаагүй`);
    dom.reviewSummary.textContent = parts.join(" · ");

    dom.ringValue.style.transition = "none";
    dom.ringValue.style.strokeDasharray = RING_LENGTH.toFixed(2);
    dom.ringValue.style.strokeDashoffset = RING_LENGTH.toFixed(2);

    dom.reviewList.innerHTML = result.details.map(reviewItemMarkup).join("");
  }

  function reviewItemMarkup(detail, index) {
    const { question, chosen, status } = detail;
    const statusMeta = {
      correct: { icon: "✓", text: "Зөв" },
      incorrect: { icon: "×", text: "Буруу" },
      skipped: { icon: "–", text: "Хариулаагүй" }
    }[status];

    const visual = isVisual(question);
    const valueMarkup = (answerIndex) => {
      if (answerIndex === null || answerIndex === undefined) return "";
      return visual ? `<span class="mini-visual">${renderSvg(question.answers[answerIndex])}</span>` : "";
    };
    const valueText = (answerIndex) => {
      if (answerIndex === null || answerIndex === undefined) return "Хариулаагүй";
      return `${LETTERS[answerIndex]} · ${answerLabel(question, answerIndex)}`;
    };

    const userRowClass = status === "correct" ? "is-correct" : status === "incorrect" ? "is-incorrect" : "";
    const userRow = `<div class="answer-row ${userRowClass}">
        <span><span class="answer-row-label">Таны хариулт</span><span class="answer-row-value">${escapeHtml(valueText(chosen))}</span></span>
        ${valueMarkup(chosen)}
      </div>`;
    const correctRow = status === "correct" ? "" : `<div class="answer-row is-correct">
        <span><span class="answer-row-label">Зөв хариулт</span><span class="answer-row-value">${escapeHtml(valueText(question.correctAnswer))}</span></span>
        ${valueMarkup(question.correctAnswer)}
      </div>`;

    return `<details class="review-item is-${status}">
      <summary>
        <span class="review-status" aria-hidden="true">${statusMeta.icon}</span>
        <span class="review-label">
          <span class="review-number">${pad2(index + 1)} · ${statusMeta.text}</span>
          <span class="review-question">${escapeHtml(question.question)}</span>
        </span>
        <svg class="review-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </summary>
      <div class="review-body">
        <p class="question-text">${escapeHtml(question.question)}</p>
        ${renderFigure(question.figure)}
        <div class="answer-pair">${userRow}${correctRow}</div>
        <p class="explanation"><strong>Тайлбар.</strong> ${escapeHtml(question.explanation)}</p>
      </div>
    </details>`;
  }

  function animateResult(result) {
    const targetOffset = RING_LENGTH * (1 - result.correct / result.total);

    if (prefersReducedMotion()) {
      dom.ringValue.style.transition = "none";
      dom.ringValue.style.strokeDashoffset = targetOffset.toFixed(2);
      dom.scoreNumber.textContent = String(result.iq);
      return;
    }

    // Two frames: paint the empty ring, then animate to the score
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        dom.ringValue.style.transition = "";
        dom.ringValue.style.strokeDashoffset = targetOffset.toFixed(2);
      });
    });

    const from = 60;
    const to = result.iq;
    const duration = 1300;
    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      dom.scoreNumber.textContent = String(Math.round(from + (to - from) * easeOut(progress)));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------------------
     EVENTS
     ------------------------------------------------------------------------ */
  const KEY_TO_INDEX = { "1": 0, "2": 1, "3": 2, "4": 3, a: 0, b: 1, c: 2, d: 3, "а": 0, "б": 1, "в": 2, "г": 3 };

  function bindEvents() {
    dom.startButton.addEventListener("click", startTest);
    dom.restartButton.addEventListener("click", startTest);

    dom.stage.addEventListener("click", (event) => {
      const button = event.target.closest(".answer");
      if (!button) return;
      selectAnswer(Number(button.dataset.answer));
    });

    document.addEventListener("keydown", (event) => {
      if (!state.isRunning || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key in KEY_TO_INDEX) {
        event.preventDefault();
        selectAnswer(KEY_TO_INDEX[key]);
      }
    });

    // Keep the countdown honest when the phone wakes or the tab returns
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.isRunning) updateTimer();
    });
  }

  /* ------------------------------------------------------------------------
     INIT
     ------------------------------------------------------------------------ */
  function validateQuestions() {
    QUESTIONS.forEach((q) => {
      if (q.answers.length !== 4) console.warn(`Question ${q.id} does not have 4 answers`);
      if (!(q.correctAnswer >= 0 && q.correctAnswer < 4)) console.warn(`Question ${q.id} has an invalid correctAnswer`);
      if (isVisual(q) && (!q.answerLabels || q.answerLabels.length !== 4)) console.warn(`Question ${q.id} is missing answer labels`);
    });
  }

  resetState();
  validateQuestions();
  bindEvents();
})();
