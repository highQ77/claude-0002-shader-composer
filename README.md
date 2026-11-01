# Shader Node Editor

這是一個節點式（node-based）的 GLSL shader 編輯器，整個 SPA 不需要建置或安裝，版面參考 Babylon.js Node Material Editor。

## 執行

直接用瀏覽器開啟 `index.html` 就能使用，需要支援 WebGL2 的 Chrome、Edge、Firefox 或 Safari。
也可以用本地伺服器開啟：

```bash
npx serve .        # 或 python3 -m http.server
```

## 功能

- **節點圖**：可以拖曳、平移、縮放、多選、複製和刪除。連線依資料型別上色，從輸入端拖曳可以把連線拔起來。
- **節點庫**：位在左側，可以搜尋，拖曳或雙擊項目就會加入節點。在圖上按右鍵或空白鍵會開啟快速選單。
- **拖曳連線到空白處**：會開啟選單，選好節點後會自動接上。
- **型別系統**：支援 float、vec2、vec3、vec4，型別不同時會自動轉換。數學節點是泛型，輸出維度依輸入決定。
- **節點縮圖**：每個節點都有即時縮圖，顯示該節點輸出的結果。
- **3D 預覽**：可切換球體、立方體、圓環、平面 3D 或平面 2D，拖曳旋轉、用滾輪縮放，支援截圖和全螢幕。
- **光照節點**：提供 Normal、View Direction、Lambert、Blinn-Phong Specular 和 Fresnel。
- **Texture 貼圖節點**：可以上傳圖片，或直接把圖檔拖進節點圖；拖到既有的 Texture 節點上會替換圖片。沒有指定圖片時使用內建 UV 格線。可設定環繞模式（重複、延伸邊緣、鏡像），圖片會縮到最長邊 1024px 再存起來。
- **Vertex Output 頂點位移**：displacement 讓頂點沿法線位移，offset 是額外的位置偏移。接到它的節點會在 vertex shader 中求值，所以 Noise 或 Texture 都能當高度圖。「法線：依位移重算」會用螢幕空間導數重算法線，讓位移後的光照正確。建議搭配「平面 3D」預覽網格。
- **範例**：共 16 個，在工具列「範例…」中依分組列出，載入時會自動切換合適的預覽網格並顯示說明。
  - 2D 圖案：同心波紋、電漿、催眠螺旋、旋轉棋盤、霓虹光環、色相環、FBM 雲、Voronoi 細胞
  - 互動：滑鼠光暈
  - 3D 材質：Fresnel 邊緣光、卡通渲染、全息投影
  - 頂點位移：地形、水面波浪、熔岩星球、貼圖 + 位移
- **屬性面板**：位在右側，可以編輯選取節點的參數和輸入預設值。GLSL 分頁會顯示產生的 shader 程式碼。
- **編輯紀錄**：支援復原和重做，會自動存到 localStorage，也能匯入或匯出 JSON。
- **輸出 ZIP**：工具列最右側「⇩ 輸出」會打包 `index.html`（可離線直接開啟的獨立播放頁，保留目前網格與視角）、`shader.vert`、`shader.frag`、`shader-graph.json` 和 `preview.png`。

## 結構

| 檔案 | 內容 |
|---|---|
| `js/nodes.js` | 型別系統、GLSL 輔助函式、所有節點定義 |
| `js/compiler.js` | 把節點圖轉成 GLSL ES 3.0 vertex + fragment shader（拓撲走訪＋泛型解析） |
| `js/renderer.js` | WebGL2 渲染器、網格產生、矩陣運算、program 快取 |
| `js/examples.js` | 範例節點圖（新增範例只要在 `EXAMPLES` 陣列加一筆） |
| `js/zip.js` | 無相依的 ZIP 產生器（CompressionStream deflate，不支援時改用 store） |
| `js/app.js` | 編輯器 UI、互動、屬性面板、預覽、存檔 |

## 新增節點

在 `js/nodes.js` 呼叫 `defNode`：

```js
defNode({
  type: 'myNode', title: 'My Node', category: 'math', desc: '說明',
  inputs:  [{ name: 'x', type: 'T', default: 0 }],   // 或 { expr: 'vUv', exprType: 'vec2' } 作為未連接時的預設值
  outputs: [{ name: 'out', type: 'T' }],
  glsl: (i, params, T, ctx) => ({ out: `sin(${i.x})` }),  // ctx.stage 為 'vertex' 或 'fragment'
});
```
