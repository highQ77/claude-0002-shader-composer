'use strict';
/* =========================================================================
 * 範例節點圖
 *  build(N, L)：
 *    N(type, x, y, { values, params }) → 建立節點並回傳 id
 *    L(fromId, fromPort, toId, toPort) → 建立連線
 *  mesh：載入時切換的預覽網格（省略則維持目前網格）
 * ========================================================================= */

const EXAMPLES = [
  /* ----------------------------- 2D 圖案 ----------------------------- */
  {
    id: 'rings', group: '2D 圖案', label: '同心波紋',
    desc: '距離 × 頻率 − 時間 → sin → 調色盤',
    build(N, L) {
      const cuv = N('centeredUV', 40, 40);
      const len = N('length', 260, 40); L(cuv, 'uv', len, 'v');
      const mul = N('multiply', 480, 40, { values: { b: 10 } }); L(len, 'out', mul, 'a');
      const t = N('time', 480, 330);
      const sub = N('subtract', 700, 120); L(mul, 'out', sub, 'a'); L(t, 'time', sub, 'b');
      const sin = N('sin', 920, 120); L(sub, 'out', sin, 'x');
      const pal = N('palette', 1140, 120); L(sin, 'out', pal, 't');
      const out = N('output', 1380, 180); L(pal, 'rgb', out, 'color');
    },
  },
  {
    id: 'plasma', group: '2D 圖案', label: '電漿',
    desc: '三組 sin 波（水平、垂直、放射）相加後上色',
    build(N, L) {
      const cuv = N('centeredUV', 40, 200);
      const sp = N('split', 260, 40); L(cuv, 'uv', sp, 'v');
      const t = N('time', 40, 520);
      const t2 = N('multiply', 260, 520, { values: { b: 1.3 } }); L(t, 'time', t2, 'a');

      const mx = N('multiply', 480, 0, { values: { b: 6 } }); L(sp, 'x', mx, 'a');
      const ax = N('add', 700, 0); L(mx, 'out', ax, 'a'); L(t, 'time', ax, 'b');
      const sx = N('sin', 920, 0); L(ax, 'out', sx, 'x');

      const my = N('multiply', 480, 260, { values: { b: 5 } }); L(sp, 'y', my, 'a');
      const ay = N('add', 700, 260); L(my, 'out', ay, 'a'); L(t2, 'out', ay, 'b');
      const sy = N('sin', 920, 260); L(ay, 'out', sy, 'x');

      const len = N('length', 260, 760); L(cuv, 'uv', len, 'v');
      const mr = N('multiply', 480, 760, { values: { b: 8 } }); L(len, 'out', mr, 'a');
      const ar = N('subtract', 700, 760); L(mr, 'out', ar, 'a'); L(t, 'time', ar, 'b');
      const sr = N('sin', 920, 760); L(ar, 'out', sr, 'x');

      const s1 = N('add', 1140, 120); L(sx, 'out', s1, 'a'); L(sy, 'out', s1, 'b');
      const s2 = N('add', 1360, 300); L(s1, 'out', s2, 'a'); L(sr, 'out', s2, 'b');
      const k = N('multiply', 1580, 300, { values: { b: 0.35 } }); L(s2, 'out', k, 'a');
      const pal = N('palette', 1800, 300, { params: { preset: 'neon' } }); L(k, 'out', pal, 't');
      const out = N('output', 2040, 340); L(pal, 'rgb', out, 'color');
    },
  },
  {
    id: 'spiral', group: '2D 圖案', label: '催眠螺旋',
    desc: '極座標：角度 × 臂數 + 半徑 − 時間 → fract → smoothstep',
    build(N, L) {
      const cuv = N('centeredUV', 40, 40);
      const pol = N('polar', 260, 40); L(cuv, 'uv', pol, 'p');
      const sp = N('split', 480, 40); L(pol, 'out', sp, 'v');
      const arms = N('multiply', 700, 0, { values: { b: 5 } }); L(sp, 'x', arms, 'a');
      const rad = N('multiply', 700, 260, { values: { b: 6 } }); L(sp, 'y', rad, 'a');
      const t = N('time', 480, 480);
      const tm = N('multiply', 700, 520, { values: { b: 0.6 } }); L(t, 'time', tm, 'a');
      const s1 = N('add', 920, 60); L(arms, 'out', s1, 'a'); L(rad, 'out', s1, 'b');
      const s2 = N('subtract', 1140, 100); L(s1, 'out', s2, 'a'); L(tm, 'out', s2, 'b');
      const fr = N('fract', 1360, 100); L(s2, 'out', fr, 'x');
      const st = N('smoothstep', 1580, 100, { values: { edge0: 0.45, edge1: 0.55 } }); L(fr, 'out', st, 'x');
      const dark = N('color', 1360, 420, { params: { color: '#1b1035' } });
      const hot = N('color', 1580, 420, { params: { color: '#ff3d7f' } });
      const mix = N('mix', 1800, 160); L(dark, 'rgb', mix, 'a'); L(hot, 'rgb', mix, 'b'); L(st, 'out', mix, 't');
      const out = N('output', 2040, 200); L(mix, 'out', out, 'color');
    },
  },
  {
    id: 'checker', group: '2D 圖案', label: '旋轉棋盤',
    desc: 'Rotate 2D 隨時間旋轉座標 → Checker，再加上暗角',
    build(N, L) {
      const t = N('time', 40, 40);
      const ang = N('multiply', 260, 40, { values: { b: 0.4 } }); L(t, 'time', ang, 'a');
      const rot = N('rotate', 480, 40); L(ang, 'out', rot, 'angle');
      const ch = N('checker', 700, 40, { values: { count: 4 } }); L(rot, 'out', ch, 'p');
      const c1 = N('color', 700, 330, { params: { color: '#22313f' } });
      const c2 = N('color', 700, 470, { params: { color: '#f5f0e6' } });
      const mix = N('mix', 940, 120); L(c1, 'rgb', mix, 'a'); L(c2, 'rgb', mix, 'b'); L(ch, 'out', mix, 't');
      const cuv = N('centeredUV', 40, 380);
      const len = N('length', 260, 380); L(cuv, 'uv', len, 'v');
      const ss = N('smoothstep', 480, 380, { values: { edge0: 0.5, edge1: 1.5 } }); L(len, 'out', ss, 'x');
      const om = N('oneMinus', 700, 640); L(ss, 'out', om, 'x');
      const mul = N('multiply', 1180, 200); L(mix, 'out', mul, 'a'); L(om, 'out', mul, 'b');
      const out = N('output', 1420, 240); L(mul, 'out', out, 'color');
    },
  },
  {
    id: 'neon', group: '2D 圖案', label: '霓虹光環',
    desc: 'Circle SDF 的半徑隨時間脈動，0.02 ÷ |d| 做出發光效果',
    build(N, L) {
      const t = N('time', 40, 320);
      const tm = N('multiply', 260, 320, { values: { b: 2 } }); L(t, 'time', tm, 'a');
      const sn = N('sin', 480, 320); L(tm, 'out', sn, 'x');
      const amp = N('multiply', 700, 320, { values: { b: 0.08 } }); L(sn, 'out', amp, 'a');
      const rad = N('add', 920, 320, { values: { b: 0.55 } }); L(amp, 'out', rad, 'a');
      const circ = N('circle', 1140, 40); L(rad, 'out', circ, 'radius');
      const ab = N('abs', 1360, 40); L(circ, 'd', ab, 'x');
      const glow = N('divide', 1580, 40, { values: { a: 0.02 } }); L(ab, 'out', glow, 'b');
      const col = N('color', 1580, 360, { params: { color: '#ff4fd8' } });
      const mul = N('multiply', 1820, 120); L(col, 'rgb', mul, 'a'); L(glow, 'out', mul, 'b');
      const out = N('output', 2060, 160); L(mul, 'out', out, 'color');
    },
  },
  {
    id: 'hueWheel', group: '2D 圖案', label: '色相環',
    desc: '極座標角度 → 色相、半徑 → 飽和度，圓外以 alpha 透明',
    build(N, L) {
      const cuv = N('centeredUV', 40, 40);
      const pol = N('polar', 260, 40); L(cuv, 'uv', pol, 'p');
      const sp = N('split', 480, 40); L(pol, 'out', sp, 'v');
      const t = N('time', 260, 360);
      const tm = N('multiply', 480, 360, { values: { b: 0.1 } }); L(t, 'time', tm, 'a');
      const hue = N('add', 700, 0); L(sp, 'x', hue, 'a'); L(tm, 'out', hue, 'b');
      const hsv = N('hsv', 940, 40); L(hue, 'out', hsv, 'h'); L(sp, 'y', hsv, 's');
      const stp = N('step', 700, 300, { values: { edge: 0.9 } }); L(sp, 'y', stp, 'x');
      const mask = N('oneMinus', 940, 340); L(stp, 'out', mask, 'x');
      const out = N('output', 1180, 120); L(hsv, 'rgb', out, 'color'); L(mask, 'out', out, 'alpha');
    },
  },
  {
    id: 'clouds', group: '2D 圖案', label: 'FBM 雲',
    desc: 'UV 隨時間平移 → FBM → 在兩個顏色間內插',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const t = N('time', 40, 300);
      const tm = N('multiply', 260, 300, { values: { b: 0.06 } }); L(t, 'time', tm, 'a');
      const add = N('add', 480, 80); L(uv, 'uv', add, 'a'); L(tm, 'out', add, 'b');
      const fbm = N('fbm', 700, 80, { values: { scale: 4 } }); L(add, 'out', fbm, 'p');
      const c1 = N('color', 700, 400, { params: { color: '#173a7a' } });
      const c2 = N('color', 920, 400, { params: { color: '#f4f7ff' } });
      const mix = N('mix', 1140, 120); L(c1, 'rgb', mix, 'a'); L(c2, 'rgb', mix, 'b'); L(fbm, 'out', mix, 't');
      const out = N('output', 1380, 180); L(mix, 'out', out, 'color');
    },
  },
  {
    id: 'cells', group: '2D 圖案', label: 'Voronoi 細胞',
    desc: 'Voronoi 距離 → 霓虹調色盤，並以 smoothstep 做出發光核心',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const t = N('time', 40, 300);
      const vor = N('voronoi', 260, 80, { values: { scale: 6 } }); L(uv, 'uv', vor, 'p'); L(t, 'time', vor, 'time');
      const pal = N('palette', 520, 40, { params: { preset: 'neon' } }); L(vor, 'd', pal, 't');
      const ss = N('smoothstep', 520, 340, { values: { edge0: 0, edge1: 0.7 } }); L(vor, 'd', ss, 'x');
      const om = N('oneMinus', 760, 340); L(ss, 'out', om, 'x');
      const mul = N('multiply', 1000, 120); L(pal, 'rgb', mul, 'a'); L(om, 'out', mul, 'b');
      const out = N('output', 1240, 180); L(mul, 'out', out, 'color');
    },
  },

  /* ----------------------------- 互動 ----------------------------- */
  {
    id: 'mouseGlow', group: '互動', label: '滑鼠光暈', mesh: 'quad',
    desc: '在預覽視窗移動滑鼠：UV 與滑鼠的距離 → 光暈',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const m = N('mouse', 40, 300);
      const d = N('distance', 260, 120); L(uv, 'uv', d, 'a'); L(m, 'pos', d, 'b');
      const ss = N('smoothstep', 480, 120, { values: { edge0: 0, edge1: 0.5 } }); L(d, 'out', ss, 'x');
      const om = N('oneMinus', 700, 120); L(ss, 'out', om, 'x');
      const pw = N('power', 920, 120, { values: { b: 2 } }); L(om, 'out', pw, 'a');
      const t = N('time', 700, 420);
      const tm = N('multiply', 920, 420, { values: { b: 0.2 } }); L(t, 'time', tm, 'a');
      const pal = N('palette', 1140, 400, { params: { preset: 'rainbow' } }); L(tm, 'out', pal, 't');
      const boost = N('multiply', 1140, 120, { values: { b: 1.6 } }); L(pw, 'out', boost, 'a');
      const col = N('multiply', 1380, 160); L(pal, 'rgb', col, 'a'); L(boost, 'out', col, 'b');
      const out = N('output', 1620, 200); L(col, 'out', out, 'color');
    },
  },

  /* ----------------------------- 3D 材質 ----------------------------- */
  {
    id: 'rim', group: '3D 材質', label: 'Fresnel 邊緣光', mesh: 'sphere',
    desc: 'Lambert 漫反射 + Specular 高光 + Fresnel 邊緣光',
    build(N, L) {
      const lam = N('lambert', 40, 40);
      const base = N('color', 40, 300, { params: { color: '#4b2bb3' } });
      const m1 = N('multiply', 280, 80); L(base, 'rgb', m1, 'a'); L(lam, 'out', m1, 'b');
      const spec = N('specular', 280, 330, { values: { shininess: 48 } });
      const a1 = N('add', 520, 120); L(m1, 'out', a1, 'a'); L(spec, 'out', a1, 'b');
      const fr = N('fresnel', 520, 400, { values: { power: 2.5 } });
      const rim = N('color', 760, 470, { params: { color: '#5ee7ff' } });
      const m2 = N('multiply', 760, 220); L(rim, 'rgb', m2, 'a'); L(fr, 'out', m2, 'b');
      const a2 = N('add', 1000, 140); L(a1, 'out', a2, 'a'); L(m2, 'out', a2, 'b');
      const out = N('output', 1240, 180); L(a2, 'out', out, 'color');
    },
  },
  {
    id: 'toon', group: '3D 材質', label: '卡通渲染', mesh: 'torus',
    desc: 'Lambert 量化成 3 階色帶，step 做出硬邊高光與黑色輪廓線',
    build(N, L) {
      const lam = N('lambert', 40, 40);
      const bands = N('multiply', 260, 40, { values: { b: 3 } }); L(lam, 'out', bands, 'a');
      const fl = N('floor', 480, 40); L(bands, 'out', fl, 'x');
      const q = N('divide', 700, 40, { values: { b: 3 } }); L(fl, 'out', q, 'a');
      const lit = N('remap', 940, 40, { values: { inMin: 0, inMax: 1, outMin: 0.35, outMax: 1 } }); L(q, 'out', lit, 'x');
      const base = N('color', 940, 380, { params: { color: '#ff8a3d' } });
      const shade = N('multiply', 1180, 120); L(base, 'rgb', shade, 'a'); L(lit, 'out', shade, 'b');
      const fr = N('fresnel', 700, 560, { values: { power: 4 } });
      const edge = N('step', 940, 600, { values: { edge: 0.5 } }); L(fr, 'out', edge, 'x');
      const om = N('oneMinus', 1180, 600); L(edge, 'out', om, 'x');
      const outl = N('multiply', 1420, 200); L(shade, 'out', outl, 'a'); L(om, 'out', outl, 'b');
      const spec = N('specular', 1180, 840, { values: { shininess: 40 } });
      const hi = N('step', 1420, 840, { values: { edge: 0.5 } }); L(spec, 'out', hi, 'x');
      const fin = N('add', 1660, 280); L(outl, 'out', fin, 'a'); L(hi, 'out', fin, 'b');
      const out = N('output', 1900, 320); L(fin, 'out', out, 'color');
    },
  },
  {
    id: 'hologram', group: '3D 材質', label: '全息投影', mesh: 'torus',
    desc: 'Fresnel 輪廓 × 世界座標 Y 方向的移動掃描線，並輸出到 alpha 呈現半透明',
    build(N, L) {
      const fr = N('fresnel', 40, 40, { values: { power: 1.5 } });
      const glow = N('add', 280, 40, { values: { b: 0.3 } }); L(fr, 'out', glow, 'a');
      const col = N('color', 1380, 600, { params: { color: '#3ef0ff' } });
      const wp = N('worldPos', 40, 400);
      const sp = N('split', 260, 400); L(wp, 'pos', sp, 'v');
      const t = N('time', 260, 760);
      const ys = N('multiply', 480, 400, { values: { b: 40 } }); L(sp, 'y', ys, 'a');
      const tt = N('multiply', 480, 760, { values: { b: 4 } }); L(t, 'time', tt, 'a');
      const sub = N('subtract', 700, 480); L(ys, 'out', sub, 'a'); L(tt, 'out', sub, 'b');
      const sn = N('sin', 920, 480); L(sub, 'out', sn, 'x');
      const lines = N('remap', 1140, 480, { values: { inMin: -1, inMax: 1, outMin: 0.35, outMax: 1 } }); L(sn, 'out', lines, 'x');
      const inten = N('multiply', 1380, 100); L(glow, 'out', inten, 'a'); L(lines, 'out', inten, 'b');
      const bright = N('multiply', 1380, 360, { values: { b: 1.6 } }); L(inten, 'out', bright, 'a');
      const rgb = N('multiply', 1620, 160); L(col, 'rgb', rgb, 'a'); L(bright, 'out', rgb, 'b');
      const out = N('output', 1860, 200); L(rgb, 'out', out, 'color'); L(inten, 'out', out, 'alpha');
    },
  },

  /* ----------------------------- 頂點位移 ----------------------------- */
  {
    id: 'terrain', group: '頂點位移', label: '地形', mesh: 'plane',
    desc: 'FBM 同時驅動頂點高度與顏色（依位移重算法線）',
    build(N, L) {
      const uv = N('uv', 40, 60);
      const fbm = N('fbm', 260, 60, { values: { scale: 3 } }); L(uv, 'uv', fbm, 'p');
      const hgt = N('multiply', 520, 40, { values: { b: 0.8 } }); L(fbm, 'out', hgt, 'a');
      const vout = N('vertexOutput', 780, 40, { params: { normals: 'flat' } }); L(hgt, 'out', vout, 'displacement');
      const low = N('color', 260, 380, { params: { color: '#1d5e3a' } });
      const high = N('color', 260, 540, { params: { color: '#efe6d2' } });
      const ss = N('smoothstep', 520, 300, { values: { edge0: 0.35, edge1: 0.75 } }); L(fbm, 'out', ss, 'x');
      const mix = N('mix', 780, 300); L(low, 'rgb', mix, 'a'); L(high, 'rgb', mix, 'b'); L(ss, 'out', mix, 't');
      const lam = N('lambert', 780, 600);
      const lit = N('remap', 1020, 600, { values: { inMin: 0, inMax: 1, outMin: 0.25, outMax: 1.1 } }); L(lam, 'out', lit, 'x');
      const mul = N('multiply', 1260, 340); L(mix, 'out', mul, 'a'); L(lit, 'out', mul, 'b');
      const out = N('output', 1500, 380); L(mul, 'out', out, 'color');
    },
  },
  {
    id: 'water', group: '頂點位移', label: '水面波浪', mesh: 'plane',
    desc: '兩組 sin 波推動頂點，Fresnel 決定深淺水色，再加上高光',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const sp = N('split', 260, 40); L(uv, 'uv', sp, 'v');
      const t = N('time', 40, 420);
      const t1 = N('multiply', 260, 420, { values: { b: 2 } }); L(t, 'time', t1, 'a');
      const t2 = N('multiply', 260, 600, { values: { b: 1.4 } }); L(t, 'time', t2, 'a');
      const wx = N('multiply', 480, 0, { values: { b: 14 } }); L(sp, 'x', wx, 'a');
      const ax = N('add', 700, 0); L(wx, 'out', ax, 'a'); L(t1, 'out', ax, 'b');
      const sx = N('sin', 920, 0); L(ax, 'out', sx, 'x');
      const wy = N('multiply', 480, 280, { values: { b: 9 } }); L(sp, 'y', wy, 'a');
      const ay = N('add', 700, 280); L(wy, 'out', ay, 'a'); L(t2, 'out', ay, 'b');
      const sy = N('sin', 920, 280); L(ay, 'out', sy, 'x');
      const sum = N('add', 1140, 120); L(sx, 'out', sum, 'a'); L(sy, 'out', sum, 'b');
      const amp = N('multiply', 1360, 120, { values: { b: 0.04 } }); L(sum, 'out', amp, 'a');
      const vout = N('vertexOutput', 1600, 120, { params: { normals: 'flat' } }); L(amp, 'out', vout, 'displacement');
      const fr = N('fresnel', 1140, 520, { values: { power: 3 } });
      const deep = N('color', 1140, 820, { params: { color: '#06324f' } });
      const light = N('color', 1360, 820, { params: { color: '#7fd8f2' } });
      const mix = N('mix', 1600, 520); L(deep, 'rgb', mix, 'a'); L(light, 'rgb', mix, 'b'); L(fr, 'out', mix, 't');
      const spec = N('specular', 1600, 820, { values: { shininess: 64 } });
      const fin = N('add', 1840, 560); L(mix, 'out', fin, 'a'); L(spec, 'out', fin, 'b');
      const out = N('output', 2080, 600); L(fin, 'out', out, 'color');
    },
  },
  {
    id: 'lava', group: '頂點位移', label: '熔岩星球', mesh: 'sphere',
    desc: '世界座標三個投影面的 FBM 取平均（無 UV 接縫），高處為岩石、低處為發光熔岩',
    build(N, L) {
      const wp = N('worldPos', 40, 300);
      const sp = N('split', 260, 300); L(wp, 'pos', sp, 'v');
      const pxy = N('combine', 480, 0); L(sp, 'x', pxy, 'x'); L(sp, 'y', pxy, 'y');
      const pyz = N('combine', 480, 300); L(sp, 'y', pyz, 'x'); L(sp, 'z', pyz, 'y');
      const pzx = N('combine', 480, 600); L(sp, 'z', pzx, 'x'); L(sp, 'x', pzx, 'y');
      const f1 = N('fbm', 720, 0, { values: { scale: 2.5 } }); L(pxy, 'xy', f1, 'p');
      const f2 = N('fbm', 720, 300, { values: { scale: 2.5 } }); L(pyz, 'xy', f2, 'p');
      const f3 = N('fbm', 720, 600, { values: { scale: 2.5 } }); L(pzx, 'xy', f3, 'p');
      const s1 = N('add', 960, 120); L(f1, 'out', s1, 'a'); L(f2, 'out', s1, 'b');
      const s2 = N('add', 1180, 300); L(s1, 'out', s2, 'a'); L(f3, 'out', s2, 'b');
      const avg = N('multiply', 1400, 300, { values: { b: 0.3333 } }); L(s2, 'out', avg, 'a');
      const disp = N('multiply', 1640, 40, { values: { b: 0.3 } }); L(avg, 'out', disp, 'a');
      const vout = N('vertexOutput', 1880, 40, { params: { normals: 'flat' } }); L(disp, 'out', vout, 'displacement');
      const ss = N('smoothstep', 1640, 300, { values: { edge0: 0.3, edge1: 0.36 } }); L(avg, 'out', ss, 'x');
      const lava = N('oneMinus', 1880, 320); L(ss, 'out', lava, 'x');
      const rock = N('color', 1640, 600, { params: { color: '#3a2620' } });
      const hot = N('color', 1880, 600, { params: { color: '#ff5a1f' } });
      const lam = N('lambert', 1880, 760);
      const lit = N('remap', 2120, 760, { values: { inMin: 0, inMax: 1, outMin: 0.15, outMax: 1.2 } }); L(lam, 'out', lit, 'x');
      const rockLit = N('multiply', 2360, 560); L(rock, 'rgb', rockLit, 'a'); L(lit, 'out', rockLit, 'b');
      const glow = N('multiply', 2120, 300); L(hot, 'rgb', glow, 'a'); L(lava, 'out', glow, 'b');
      const fin = N('add', 2600, 380); L(rockLit, 'out', fin, 'a'); L(glow, 'out', fin, 'b');
      const out = N('output', 2840, 420); L(fin, 'out', out, 'color');
    },
  },
  {
    id: 'textured', group: '頂點位移', label: '貼圖 + 位移', mesh: 'sphere',
    desc: 'Texture 上色，亮度同時作為高度圖（可上傳自己的圖片）',
    build(N, L) {
      const tex = N('texture', 40, 60);
      const lam = N('lambert', 320, 40);
      const lit = N('remap', 560, 40, { values: { inMin: 0, inMax: 1, outMin: 0.3, outMax: 1.1 } }); L(lam, 'out', lit, 'x');
      const mul = N('multiply', 820, 120); L(tex, 'rgb', mul, 'a'); L(lit, 'out', mul, 'b');
      const out = N('output', 1060, 160); L(mul, 'out', out, 'color');
      const lum = N('grayscale', 320, 420); L(tex, 'rgb', lum, 'rgb');
      const amt = N('multiply', 560, 420, { values: { b: 0.12 } }); L(lum, 'out', amt, 'a');
      const vout = N('vertexOutput', 820, 460); L(amt, 'out', vout, 'displacement');
    },
  },

  /* ----------------------------- 其他 ----------------------------- */
  {
    id: 'blank', group: '其他', label: '空白',
    build(N) { N('output', 400, 160); },
  },
];
