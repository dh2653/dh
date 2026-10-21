# 파츠 제작 (Parts Maker)

업로드 → 다각도 뷰 → 뷰별 파츠/Spine 메타 → Depth Anything 3D 미리보기 → **PNG zip / PSD 레이어 / 재조립 GIF**.

## 실행

```bash
cd parts-maker
npm install
pip3 install -r server/requirements.txt
npm run dev:all
```

- 웹: http://localhost:5173  
- API: http://127.0.0.1:8787/health  

최초 `/api/depth` 호출 시 Depth Anything V2 Small ONNX(~95MB)를 `server/models/`에 받습니다 (git 제외).

## PSD 레이어보내기

상단 **「PSD보내기」** → `parts-psd-{view}.zip`  
- `parts-{view}.psd` — 파츠당 1 래스터 레이어, 이름 `{drawOrder}_{name}`, 스택 = drawOrder (아래→위)  
- `parts.json` — pivot / parent / drawOrder / hiddenRegions 사이드카  

라이브러리: **ag-psd** (브라우저 작성).

### 한계 (정직하게)

| 지원 | 미지원 |
|------|--------|
| RGBA 래스터 레이어, 투명도, normal blend | 스마트 오브젝트, 레이어 FX, 마스크 채널 |
| 문서 크기 = 작업 캔버스 | 그룹/아트보드, 조정 레이어 |
| Clip Studio / Photoshop에서 열기 가능* | 완벽한 PS 전용 메타 호환 보장 아님 |

\* CSP는 PSD 가져오기 지원. 복잡한 PS 전용 기능은 빠집니다.

## Phase 4 — 3D

| 기능 | 상태 |
|------|------|
| Depth Anything V2 Small ONNX | **실제** |
| 변위 메시 + OrbitControls | **실제** |
| 자동 리깅 / Live2D | **비범위** |

## Phase 1–3

- rembg(isnet) + 캐릭터 격리(배경 제외) · 브러시 · Spine 테이블 · 히든 마커  
- 다각도 썸네일 (geometric-proxy + Replicate 훅)  

## 스모크

```bash
npm run smoke:phase3
npm run smoke:phase4
npm run smoke:psd
```
