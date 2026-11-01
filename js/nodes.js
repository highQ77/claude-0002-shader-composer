'use strict';
/* =========================================================================
 * 節點定義 + 型別系統
 *  - 型別：float / vec2 / vec3 / vec4，以及泛型 'T'
 *  - 泛型 T 會解析為「已連接的 T 輸入中維度最大者」，未連接時為 float
 * ========================================================================= */

const TYPE_DIM = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
const TYPE_COLOR = { float: '#9aa7b8', vec2: '#4fc3f7', vec3: '#ffca28', vec4: '#f06292' };

// 置中、保持比例的 UV（範圍約 -1..1）
const CENTERED_UV = '((vUv - 0.5) * vec2(u_aspect, 1.0) * 2.0)';
const N_EXPR = 'normalize(vNormal)';
const V_EXPR = 'normalize(u_camPos - vWorldPos)';

function widerType(a, b) { return TYPE_DIM[b] > TYPE_DIM[a] ? b : a; }

function convertType(expr, from, to) {
  if (from === to) return expr;
  if (from === 'float') return `${to}(${expr})`;
  if (to === 'float') return `(${expr}).x`;
  const f = TYPE_DIM[from], t = TYPE_DIM[to];
  if (t < f) return `(${expr}).${'xyzw'.slice(0, t)}`;
  if (from === 'vec2' && to === 'vec3') return `vec3(${expr}, 0.0)`;
  if (from === 'vec2' && to === 'vec4') return `vec4(${expr}, 0.0, 1.0)`;
  if (from === 'vec3' && to === 'vec4') return `vec4(${expr}, 1.0)`;
  return expr;
}

function glslFloat(v) {
  let n = Number(v);
  if (!isFinite(n)) n = 0;
  let s = n.toFixed(5).replace(/0+$/, '');
  if (s.endsWith('.')) s += '0';
  if (s === '-0.0') s = '0.0';
  return s;
}

function hexToVec3(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return `vec3(${glslFloat((n >> 16 & 255) / 255)}, ${glslFloat((n >> 8 & 255) / 255)}, ${glslFloat((n & 255) / 255)})`;
}

/* ---- GLSL 輔助函式（依宣告順序輸出，相依者需排在後面） ---- */
const HELPERS = {
  hash: `float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}`,
  noise: `float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
  fbm: `float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
  return v;
}`,
  voronoi: `float voronoi(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash21(i + g), hash21(i + g + 17.0));
    o = 0.5 + 0.5 * sin(t + 6.2831 * o);
    d = min(d, length(g + o - f));
  }
  return d;
}`,
  rotate: `vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, s, -s, c) * p;
}`,
  box: `float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}`,
  hsv: `vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}`,
};

const CATEGORIES = [
  { id: 'input', label: '輸入', color: '#3b82f6' },
  { id: 'math', label: '數學', color: '#10b981' },
  { id: 'vector', label: '向量 / UV', color: '#f59e0b' },
  { id: 'pattern', label: '形狀與雜訊', color: '#8b5cf6' },
  { id: 'light', label: '光照', color: '#06b6d4' },
  { id: 'color', label: '顏色', color: '#ec4899' },
  { id: 'output', label: '輸出', color: '#ef4444' },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

const PALETTES = {
  rainbow: { label: '彩虹', a: [.5, .5, .5], b: [.5, .5, .5], c: [1, 1, 1], d: [0, .33, .67] },
  sunset: { label: '夕陽', a: [.5, .5, .5], b: [.5, .5, .5], c: [1, 1, 1], d: [0, .1, .2] },
  ocean: { label: '海洋', a: [.5, .5, .5], b: [.5, .5, .5], c: [1, 1, .5], d: [.8, .9, .3] },
  neon: { label: '霓虹', a: [.5, .5, .5], b: [.5, .5, .5], c: [2, 1, 0], d: [.5, .2, .25] },
  forest: { label: '森林', a: [.8, .5, .4], b: [.2, .4, .2], c: [2, 1, 1], d: [0, .25, .25] },
};

const NODE_DEFS = {};
function defNode(d) {
  d.inputs = d.inputs || [];
  d.outputs = d.outputs || [];
  d.params = d.params || [];
  d.helpers = d.helpers || [];
  NODE_DEFS[d.type] = d;
}

/* ---------------------------- 輸入 ---------------------------- */
defNode({ type: 'uv', title: 'UV', category: 'input', desc: '網格的貼圖座標 (0..1)',
  outputs: [{ name: 'uv', type: 'vec2' }], glsl: () => ({ uv: 'vUv' }) });
defNode({ type: 'centeredUV', title: 'Centered UV', category: 'input', desc: '置中且保持長寬比的 UV (-1..1)',
  outputs: [{ name: 'uv', type: 'vec2' }], glsl: () => ({ uv: CENTERED_UV }) });
defNode({ type: 'time', title: 'Time', category: 'input', desc: '經過秒數', keywords: '時間',
  outputs: [{ name: 'time', type: 'float' }], glsl: () => ({ time: 'u_time' }) });
defNode({ type: 'mouse', title: 'Mouse', category: 'input', desc: '預覽視窗中的滑鼠位置 (0..1)', keywords: '滑鼠',
  outputs: [{ name: 'pos', type: 'vec2' }], glsl: () => ({ pos: 'u_mouse' }) });
defNode({ type: 'float', title: 'Float', category: 'input', desc: '常數數值', keywords: '數值 常數 number',
  params: [{ name: 'value', label: '值', kind: 'number', default: 1, step: 0.1 }],
  outputs: [{ name: 'value', type: 'float' }], glsl: (i, p) => ({ value: glslFloat(p.value) }) });
defNode({ type: 'color', title: 'Color', category: 'input', desc: '常數顏色', keywords: '顏色 rgb',
  params: [{ name: 'color', label: '顏色', kind: 'color', default: '#ff7a45' }],
  outputs: [{ name: 'rgb', type: 'vec3' }], glsl: (i, p) => ({ rgb: hexToVec3(p.color) }) });
defNode({ type: 'texture', title: 'Texture', category: 'input',
  desc: '圖片貼圖（上傳圖片，或直接把圖檔拖進節點圖）', keywords: '貼圖 圖片 image sampler 材質',
  params: [
    { name: 'image', label: '圖片', kind: 'image', default: '' },
    { name: 'wrap', label: '環繞', kind: 'select', default: 'repeat',
      options: [['repeat', '重複'], ['clamp', '延伸邊緣'], ['mirror', '鏡像重複']] },
  ],
  inputs: [{ name: 'uv', type: 'vec2', expr: 'vUv', exprType: 'vec2', exprLabel: 'UV' }],
  outputs: [{ name: 'rgba', type: 'vec4' }, { name: 'rgb', type: 'vec3' }, { name: 'a', type: 'float' }],
  glsl: (i, p, T, ctx) => {
    const s = ctx.texture();
    // vertex shader 沒有自動 mip 層級，需用 textureLod
    const sample = ctx.stage === 'vertex' ? `textureLod(${s}, ${i.uv}, 0.0)` : `texture(${s}, ${i.uv})`;
    return { rgba: sample, rgb: `${ctx.v('rgba')}.rgb`, a: `${ctx.v('rgba')}.a` };
  } });
defNode({ type: 'normal', title: 'Normal', category: 'input', desc: '世界空間法線', keywords: '法線',
  outputs: [{ name: 'n', type: 'vec3' }], glsl: () => ({ n: N_EXPR }) });
defNode({ type: 'worldPos', title: 'World Position', category: 'input', desc: '世界空間座標', keywords: '位置 position',
  outputs: [{ name: 'pos', type: 'vec3' }], glsl: () => ({ pos: 'vWorldPos' }) });
defNode({ type: 'viewDir', title: 'View Direction', category: 'input', desc: '指向攝影機的方向', keywords: '視線 camera',
  outputs: [{ name: 'dir', type: 'vec3' }], glsl: () => ({ dir: V_EXPR }) });
defNode({ type: 'lightDir', title: 'Light Direction', category: 'input', desc: '方向光的方向', keywords: '光源',
  outputs: [{ name: 'dir', type: 'vec3' }], glsl: () => ({ dir: 'u_lightDir' }) });

/* ---------------------------- 數學 ---------------------------- */
[
  ['add', 'Add', '相加', '+', 0],
  ['subtract', 'Subtract', '相減', '-', 0],
  ['multiply', 'Multiply', '相乘', '*', 1],
  ['divide', 'Divide', '相除', '/', 1],
].forEach(([type, title, desc, op, b]) => defNode({
  type, title, desc, category: 'math',
  inputs: [{ name: 'a', type: 'T', default: 0 }, { name: 'b', type: 'T', default: b }],
  outputs: [{ name: 'out', type: 'T' }],
  glsl: i => ({ out: `(${i.a} ${op} ${i.b})` }),
}));

[
  ['power', 'Power', '次方 pow(a, b)', 'pow', 2],
  ['minimum', 'Min', '取最小值', 'min', 0],
  ['maximum', 'Max', '取最大值', 'max', 0],
  ['modulo', 'Mod', '取餘數', 'mod', 1],
].forEach(([type, title, desc, fn, b]) => defNode({
  type, title, desc, category: 'math',
  inputs: [{ name: 'a', type: 'T', default: 1 }, { name: 'b', type: 'T', default: b }],
  outputs: [{ name: 'out', type: 'T' }],
  glsl: i => ({ out: `${fn}(${i.a}, ${i.b})` }),
}));

[
  ['sin', 'Sin', '正弦', x => `sin(${x})`],
  ['cos', 'Cos', '餘弦', x => `cos(${x})`],
  ['abs', 'Abs', '絕對值', x => `abs(${x})`],
  ['fract', 'Fract', '小數部分', x => `fract(${x})`],
  ['floor', 'Floor', '無條件捨去', x => `floor(${x})`],
  ['sqrt', 'Sqrt', '平方根', x => `sqrt(${x})`],
  ['negate', 'Negate', '取負號', x => `(-${x})`],
  ['oneMinus', 'One Minus', '1 - x（反相）', x => `(1.0 - ${x})`],
  ['saturate', 'Saturate', '限制在 0..1', x => `clamp(${x}, 0.0, 1.0)`],
  ['normalize', 'Normalize', '正規化向量', x => `normalize(${x})`],
].forEach(([type, title, desc, f]) => defNode({
  type, title, desc, category: 'math',
  inputs: [{ name: 'x', type: 'T', default: 0 }],
  outputs: [{ name: 'out', type: 'T' }],
  glsl: i => ({ out: f(i.x) }),
}));

defNode({ type: 'length', title: 'Length', category: 'math', desc: '向量長度',
  inputs: [{ name: 'v', type: 'T', default: 0 }], outputs: [{ name: 'out', type: 'float' }],
  glsl: i => ({ out: `length(${i.v})` }) });
defNode({ type: 'distance', title: 'Distance', category: 'math', desc: '兩點距離',
  inputs: [{ name: 'a', type: 'T', default: 0 }, { name: 'b', type: 'T', default: 0 }],
  outputs: [{ name: 'out', type: 'float' }], glsl: i => ({ out: `distance(${i.a}, ${i.b})` }) });
defNode({ type: 'dot', title: 'Dot', category: 'math', desc: '內積',
  inputs: [{ name: 'a', type: 'T', default: 0 }, { name: 'b', type: 'T', default: 0 }],
  outputs: [{ name: 'out', type: 'float' }], glsl: i => ({ out: `dot(${i.a}, ${i.b})` }) });
defNode({ type: 'mix', title: 'Lerp', category: 'math', desc: '線性內插 mix(a, b, t)', keywords: 'mix 混合 內插',
  inputs: [{ name: 'a', type: 'T', default: 0 }, { name: 'b', type: 'T', default: 1 }, { name: 't', type: 'float', default: 0.5 }],
  outputs: [{ name: 'out', type: 'T' }], glsl: i => ({ out: `mix(${i.a}, ${i.b}, ${i.t})` }) });
defNode({ type: 'clamp', title: 'Clamp', category: 'math', desc: '限制範圍',
  inputs: [{ name: 'x', type: 'T', default: 0 }, { name: 'min', type: 'float', default: 0 }, { name: 'max', type: 'float', default: 1 }],
  outputs: [{ name: 'out', type: 'T' }], glsl: i => ({ out: `clamp(${i.x}, ${i.min}, ${i.max})` }) });
defNode({ type: 'smoothstep', title: 'Smoothstep', category: 'math', desc: '平滑階梯',
  inputs: [{ name: 'edge0', type: 'float', default: 0 }, { name: 'edge1', type: 'float', default: 1 }, { name: 'x', type: 'T', default: 0 }],
  outputs: [{ name: 'out', type: 'T' }], glsl: i => ({ out: `smoothstep(${i.edge0}, ${i.edge1}, ${i.x})` }) });
defNode({ type: 'step', title: 'Step', category: 'math', desc: '階梯函數',
  inputs: [{ name: 'edge', type: 'float', default: 0.5 }, { name: 'x', type: 'T', default: 0 }],
  outputs: [{ name: 'out', type: 'T' }], glsl: i => ({ out: `step(${i.edge}, ${i.x})` }) });
defNode({ type: 'remap', title: 'Remap', category: 'math', desc: '將數值從一個範圍映射到另一個範圍', keywords: '映射',
  inputs: [
    { name: 'x', type: 'T', default: 0 },
    { name: 'inMin', type: 'float', default: -1 }, { name: 'inMax', type: 'float', default: 1 },
    { name: 'outMin', type: 'float', default: 0 }, { name: 'outMax', type: 'float', default: 1 },
  ],
  outputs: [{ name: 'out', type: 'T' }],
  glsl: i => ({ out: `(${i.outMin} + (${i.x} - ${i.inMin}) / (${i.inMax} - ${i.inMin}) * (${i.outMax} - ${i.outMin}))` }) });

/* ---------------------------- 向量 / UV ---------------------------- */
defNode({ type: 'split', title: 'Split', category: 'vector', desc: '拆分向量成 x y z w', keywords: '拆分 分量',
  inputs: [{ name: 'v', type: 'vec4', default: 0 }],
  outputs: ['x', 'y', 'z', 'w'].map(n => ({ name: n, type: 'float' })),
  glsl: i => ({ x: `${i.v}.x`, y: `${i.v}.y`, z: `${i.v}.z`, w: `${i.v}.w` }) });
defNode({ type: 'combine', title: 'Combine', category: 'vector', desc: '由分量組合向量', keywords: '組合 vector',
  inputs: [{ name: 'x', type: 'float', default: 0 }, { name: 'y', type: 'float', default: 0 },
    { name: 'z', type: 'float', default: 0 }, { name: 'w', type: 'float', default: 1 }],
  outputs: [{ name: 'xy', type: 'vec2' }, { name: 'xyz', type: 'vec3' }, { name: 'xyzw', type: 'vec4' }],
  glsl: i => ({ xy: `vec2(${i.x}, ${i.y})`, xyz: `vec3(${i.x}, ${i.y}, ${i.z})`, xyzw: `vec4(${i.x}, ${i.y}, ${i.z}, ${i.w})` }) });
defNode({ type: 'rotate', title: 'Rotate 2D', category: 'vector', desc: '旋轉 2D 座標（弧度）', keywords: '旋轉',
  helpers: ['rotate'],
  inputs: [{ name: 'p', type: 'vec2', expr: CENTERED_UV, exprType: 'vec2', exprLabel: '置中 UV' }, { name: 'angle', type: 'float', default: 0 }],
  outputs: [{ name: 'out', type: 'vec2' }], glsl: i => ({ out: `rot2(${i.p}, ${i.angle})` }) });
defNode({ type: 'polar', title: 'Polar', category: 'vector', desc: '轉為極座標 (角度 0..1, 半徑)', keywords: '極座標',
  inputs: [{ name: 'p', type: 'vec2', expr: CENTERED_UV, exprType: 'vec2', exprLabel: '置中 UV' }],
  outputs: [{ name: 'out', type: 'vec2' }],
  glsl: i => ({ out: `vec2(atan(${i.p}.y, ${i.p}.x) / 6.28318 + 0.5, length(${i.p}))` }) });
defNode({ type: 'tile', title: 'Tile', category: 'vector', desc: '重複平鋪座標', keywords: '平鋪 repeat',
  inputs: [{ name: 'p', type: 'vec2', expr: 'vUv', exprType: 'vec2', exprLabel: 'UV' }, { name: 'count', type: 'float', default: 4 }],
  outputs: [{ name: 'out', type: 'vec2' }], glsl: i => ({ out: `fract(${i.p} * ${i.count})` }) });

/* ---------------------------- 形狀與雜訊 ---------------------------- */
defNode({ type: 'circle', title: 'Circle SDF', category: 'pattern', desc: '圓形距離場（內部為負）', keywords: '圓',
  inputs: [{ name: 'p', type: 'vec2', expr: CENTERED_UV, exprType: 'vec2', exprLabel: '置中 UV' }, { name: 'radius', type: 'float', default: 0.5 }],
  outputs: [{ name: 'd', type: 'float' }], glsl: i => ({ d: `(length(${i.p}) - ${i.radius})` }) });
defNode({ type: 'box', title: 'Box SDF', category: 'pattern', desc: '矩形距離場', keywords: '方形 矩形',
  helpers: ['box'],
  inputs: [{ name: 'p', type: 'vec2', expr: CENTERED_UV, exprType: 'vec2', exprLabel: '置中 UV' },
    { name: 'width', type: 'float', default: 0.5 }, { name: 'height', type: 'float', default: 0.5 }],
  outputs: [{ name: 'd', type: 'float' }], glsl: i => ({ d: `sdBox(${i.p}, vec2(${i.width}, ${i.height}))` }) });
defNode({ type: 'checker', title: 'Checker', category: 'pattern', desc: '棋盤格', keywords: '棋盤',
  inputs: [{ name: 'p', type: 'vec2', expr: 'vUv', exprType: 'vec2', exprLabel: 'UV' }, { name: 'count', type: 'float', default: 8 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: i => ({ out: `mod(floor(${i.p}.x * ${i.count}) + floor(${i.p}.y * ${i.count}), 2.0)` }) });
defNode({ type: 'noise', title: 'Value Noise', category: 'pattern', desc: '平滑數值雜訊', keywords: '雜訊',
  helpers: ['hash', 'noise'],
  inputs: [{ name: 'p', type: 'vec2', expr: 'vUv', exprType: 'vec2', exprLabel: 'UV' }, { name: 'scale', type: 'float', default: 8 }],
  outputs: [{ name: 'out', type: 'float' }], glsl: i => ({ out: `vnoise(${i.p} * ${i.scale})` }) });
defNode({ type: 'fbm', title: 'FBM', category: 'pattern', desc: '分形布朗運動（多層雜訊）', keywords: '雜訊 雲',
  helpers: ['hash', 'noise', 'fbm'],
  inputs: [{ name: 'p', type: 'vec2', expr: 'vUv', exprType: 'vec2', exprLabel: 'UV' }, { name: 'scale', type: 'float', default: 4 }],
  outputs: [{ name: 'out', type: 'float' }], glsl: i => ({ out: `fbm(${i.p} * ${i.scale})` }) });
defNode({ type: 'voronoi', title: 'Voronoi', category: 'pattern', desc: '細胞雜訊（到最近點的距離）', keywords: '細胞 cell',
  helpers: ['hash', 'voronoi'],
  inputs: [{ name: 'p', type: 'vec2', expr: 'vUv', exprType: 'vec2', exprLabel: 'UV' },
    { name: 'scale', type: 'float', default: 6 }, { name: 'time', type: 'float', default: 0 }],
  outputs: [{ name: 'd', type: 'float' }], glsl: i => ({ d: `voronoi(${i.p} * ${i.scale}, ${i.time})` }) });

/* ---------------------------- 光照 ---------------------------- */
defNode({ type: 'lambert', title: 'Lambert', category: 'light', desc: '漫反射 max(N·L, 0)', keywords: '漫反射 diffuse',
  inputs: [{ name: 'normal', type: 'vec3', expr: N_EXPR, exprType: 'vec3', exprLabel: 'Normal' },
    { name: 'light', type: 'vec3', expr: 'u_lightDir', exprType: 'vec3', exprLabel: 'Light' }],
  outputs: [{ name: 'out', type: 'float' }], glsl: i => ({ out: `max(dot(${i.normal}, ${i.light}), 0.0)` }) });
defNode({ type: 'specular', title: 'Specular', category: 'light', desc: 'Blinn-Phong 高光', keywords: '高光 phong',
  inputs: [{ name: 'normal', type: 'vec3', expr: N_EXPR, exprType: 'vec3', exprLabel: 'Normal' },
    { name: 'light', type: 'vec3', expr: 'u_lightDir', exprType: 'vec3', exprLabel: 'Light' },
    { name: 'view', type: 'vec3', expr: V_EXPR, exprType: 'vec3', exprLabel: 'View' },
    { name: 'shininess', type: 'float', default: 32 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: i => ({ out: `pow(max(dot(${i.normal}, normalize(${i.light} + ${i.view})), 0.0), ${i.shininess})` }) });
defNode({ type: 'fresnel', title: 'Fresnel', category: 'light', desc: '邊緣光（視角越斜越亮）', keywords: '邊緣 rim',
  inputs: [{ name: 'normal', type: 'vec3', expr: N_EXPR, exprType: 'vec3', exprLabel: 'Normal' },
    { name: 'view', type: 'vec3', expr: V_EXPR, exprType: 'vec3', exprLabel: 'View' },
    { name: 'power', type: 'float', default: 3 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: i => ({ out: `pow(1.0 - clamp(dot(${i.normal}, ${i.view}), 0.0, 1.0), ${i.power})` }) });

/* ---------------------------- 顏色 ---------------------------- */
defNode({ type: 'palette', title: 'Cosine Palette', category: 'color', desc: '餘弦調色盤（t → 顏色）', keywords: '調色盤 漸層 gradient',
  params: [{ name: 'preset', label: '配色', kind: 'select', default: 'rainbow',
    options: Object.entries(PALETTES).map(([k, v]) => [k, v.label]) }],
  inputs: [{ name: 't', type: 'float', default: 0 }],
  outputs: [{ name: 'rgb', type: 'vec3' }],
  glsl: (i, p) => {
    const P = PALETTES[p.preset] || PALETTES.rainbow;
    const v = a => `vec3(${a.map(glslFloat).join(', ')})`;
    return { rgb: `(${v(P.a)} + ${v(P.b)} * cos(6.28318 * (${v(P.c)} * ${i.t} + ${v(P.d)})))` };
  } });
defNode({ type: 'hsv', title: 'HSV → RGB', category: 'color', desc: '色相 / 飽和度 / 明度轉 RGB', keywords: '色相 hue',
  helpers: ['hsv'],
  inputs: [{ name: 'h', type: 'float', default: 0 }, { name: 's', type: 'float', default: 1 }, { name: 'v', type: 'float', default: 1 }],
  outputs: [{ name: 'rgb', type: 'vec3' }], glsl: i => ({ rgb: `hsv2rgb(vec3(${i.h}, ${i.s}, ${i.v}))` }) });
defNode({ type: 'grayscale', title: 'Luminance', category: 'color', desc: '顏色轉亮度', keywords: '灰階 亮度',
  inputs: [{ name: 'rgb', type: 'vec3', default: 0 }], outputs: [{ name: 'out', type: 'float' }],
  glsl: i => ({ out: `dot(${i.rgb}, vec3(0.299, 0.587, 0.114))` }) });

/* ---------------------------- 輸出 ---------------------------- */
defNode({ type: 'output', title: 'Fragment Output', category: 'output', unique: true, desc: '最終輸出顏色（每張圖只能有一個）', keywords: '輸出 fragment',
  inputs: [{ name: 'color', type: 'vec3', default: 0 }, { name: 'alpha', type: 'float', default: 1 }],
  final: i => `fragColor = vec4(${i.color}, ${i.alpha});` });
defNode({ type: 'vertexOutput', title: 'Vertex Output', category: 'output', unique: true,
  desc: '頂點位移：沿法線位移 + 位置偏移（每張圖只能有一個）', keywords: '頂點 位移 displacement vertex 高度',
  params: [{ name: 'normals', label: '法線', kind: 'select', default: 'smooth',
    options: [['smooth', '原始（平滑）'], ['flat', '依位移重算']] }],
  inputs: [{ name: 'displacement', type: 'float', default: 0 }, { name: 'offset', type: 'vec3', default: 0 }] });
