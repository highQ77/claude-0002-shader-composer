'use strict';
/* =========================================================================
 * 節點圖 → GLSL ES 3.0（vertex + fragment shader）
 *  - Fragment Output 決定像素顏色
 *  - Vertex Output（可選）決定頂點位移；接到它的節點會在 vertex shader 中求值
 * ========================================================================= */

const COMMON_UNIFORMS = `uniform float u_time;
uniform vec2  u_resolution;
uniform vec2  u_mouse;
uniform float u_aspect;
uniform vec3  u_camPos;
uniform vec3  u_lightDir;
`;

function makeCompiler(graph, stage = 'fragment') {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const incoming = new Map();
  for (const l of graph.links) incoming.set(l.to + ':' + l.toPort, l);

  const lines = [];
  const helpers = new Set();
  const textures = new Set();
  const done = new Map();
  const visiting = new Set();
  const types = {};
  const inputExprs = new Map();

  function visit(node) {
    if (done.has(node.id)) return done.get(node.id);
    if (visiting.has(node.id)) throw new Error('偵測到循環連線');
    visiting.add(node.id);

    const def = NODE_DEFS[node.type];
    if (!def) throw new Error('未知的節點類型：' + node.type);

    // 1. 先求出所有已連接的上游輸出
    const src = {};
    for (const inp of def.inputs) {
      const l = incoming.get(node.id + ':' + inp.name);
      if (!l) continue;
      const from = byId.get(l.from);
      if (!from) continue;
      const outs = visit(from);
      if (outs[l.fromPort]) src[inp.name] = outs[l.fromPort];
    }

    // 2. 解析泛型 T
    let T = 'float';
    for (const inp of def.inputs) {
      if (inp.type === 'T' && src[inp.name]) T = widerType(T, src[inp.name].type);
    }

    // 3. 產生每個輸入的運算式（含型別轉換 / 預設值）
    const ins = {};
    for (const inp of def.inputs) {
      const want = inp.type === 'T' ? T : inp.type;
      const s = src[inp.name];
      let e;
      if (s) e = convertType(s.expr, s.type, want);
      else if (inp.expr) e = convertType(inp.expr, inp.exprType, want);
      else {
        const v = node.values && node.values[inp.name] !== undefined ? node.values[inp.name] : inp.default;
        e = convertType(glslFloat(v ?? 0), 'float', want);
      }
      ins[inp.name] = e;
      types[node.id + ':in:' + inp.name] = want;
    }

    def.helpers.forEach(h => helpers.add(h));
    const ctx = {
      stage,
      v: name => `n${node.id}_${name}`,
      texture: () => { textures.add(node.id); return 'u_tex' + node.id; },
    };
    const res = def.glsl ? def.glsl(ins, node.params || {}, T, ctx) : {};

    // 4. 每個輸出宣告成一個區域變數
    const outs = {};
    for (const o of def.outputs) {
      const t = o.type === 'T' ? T : o.type;
      const v = `n${node.id}_${o.name}`;
      lines.push(`  ${t} ${v} = ${res[o.name]};  // ${def.title}`);
      outs[o.name] = { expr: v, type: t };
      types[node.id + ':out:' + o.name] = t;
    }

    inputExprs.set(node.id, ins);
    visiting.delete(node.id);
    done.set(node.id, outs);
    return outs;
  }

  return { visit, lines, helpers, textures, types, inputExprs, byId, visiting };
}

function helperSource(c) {
  if (!c) return '';
  const src = Object.keys(HELPERS).filter(k => c.helpers.has(k)).map(k => HELPERS[k]).join('\n\n');
  return src ? '\n' + src + '\n' : '';
}
function samplerSource(c) {
  if (!c || !c.textures.size) return '';
  return [...c.textures].map(id => `uniform sampler2D u_tex${id};`).join('\n') + '\n';
}

function assembleFragment(c, finalLine, flatNormals) {
  return `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vNormal;
in vec3 vWorldPos;
out vec4 fragColor;

${COMMON_UNIFORMS}${samplerSource(c)}` +
    (flatNormals ? `
// 由螢幕空間導數重算法線（頂點位移後光照才會正確）
vec3 flatNormal() { return normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))); }
#define vNormal flatNormal()
` : '') +
    helperSource(c) +
    '\nvoid main() {\n' + c.lines.join('\n') + (c.lines.length ? '\n' : '') + '  ' + finalLine + '\n}\n';
}

function assembleVertex(c, displacement = '0.0', offset = 'vec3(0.0)') {
  const lines = c && c.lines.length ? c.lines.join('\n') + '\n' : '';
  return `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_viewProj;
uniform mat4 u_model;
${COMMON_UNIFORMS}${samplerSource(c)}
out vec2 vUv;
out vec3 vNormal;
out vec3 vWorldPos;
${helperSource(c)}
void main() {
  vUv = a_uv;
  vNormal = normalize(mat3(u_model) * a_normal);
  vWorldPos = (u_model * vec4(a_pos, 1.0)).xyz;
${lines}  vec3 pos = a_pos + a_normal * (${displacement}) + (${offset});
  vec4 wp = u_model * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = u_viewProj * wp;
}
`;
}

const DEFAULT_VERTEX = assembleVertex(null);

/** 解析整張圖所有 port 的實際型別（供連線/port 著色） */
function analyzeTypes(graph) {
  const c = makeCompiler(graph);
  for (const n of graph.nodes) {
    try { c.visit(n); } catch (e) { c.visiting.clear(); }
  }
  return c.types;
}

/**
 * target = null → 從 Output 節點產生完整 shader（含 Vertex Output）
 * target = { nodeId, port } → 只顯示該輸出的預覽 shader（節點縮圖用）
 * 回傳 { vs, fs, textures: [nodeId...] } 或 { error }
 */
function buildShader(graph, target) {
  try {
    const fc = makeCompiler(graph, 'fragment');
    if (target) {
      const node = fc.byId.get(target.nodeId);
      if (!node) return { error: 'node not found' };
      const o = fc.visit(node)[target.port];
      if (!o) return { error: 'port not found' };
      const final = `fragColor = vec4(${convertType(o.expr, o.type, 'vec3')}, 1.0);`;
      return { vs: DEFAULT_VERTEX, fs: assembleFragment(fc, final, false), textures: [...fc.textures] };
    }

    const out = graph.nodes.find(n => n.type === 'output');
    if (!out) return { error: '圖中沒有 Fragment Output 節點' };
    fc.visit(out);
    const final = NODE_DEFS.output.final(fc.inputExprs.get(out.id));
    const textures = new Set(fc.textures);

    let vs = DEFAULT_VERTEX, flat = false;
    const vout = graph.nodes.find(n => n.type === 'vertexOutput');
    if (vout) {
      const vc = makeCompiler(graph, 'vertex');
      vc.visit(vout);
      const i = vc.inputExprs.get(vout.id);
      vs = assembleVertex(vc, i.displacement, i.offset);
      vc.textures.forEach(t => textures.add(t));
      flat = (vout.params || {}).normals === 'flat';
    }
    return { vs, fs: assembleFragment(fc, final, flat), textures: [...textures] };
  } catch (err) {
    return { error: err.message };
  }
}
