# 파츠 제작 (Parts Maker) — Phase 4

업로드 → 다각도 뷰 → 뷰별 파츠/Spine 메타 → **Depth Anything 3D 오빗 미리보기** → PNG zip / 재조립 GIF.

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

## Phase 4 — 3D (스코프드 MVP)

| 기능 | 상태 |
|------|------|
| 단안 깊이 (Depth Anything V2 Small ONNX) | **실제** |
| 깊이→변위 메시 + OrbitControls (three.js) | **실제** |
| depth / normal 맵 프리뷰 | 실제 |
| 자동 리깅 / Live2D 대체 | **비범위** |
| 모델 없을 때 | heuristic depth stub |

사이드 패널 **「깊이→메시 생성」** → 드래그로 오빗.

## Phase 1–3 (유지)

- rembg 세그 · 브러시 · Spine 테이블 · 히든 마커  
- 다각도 썸네일 (geometric-proxy + Replicate 훅)  
- `parts.json` v3  

## 스모크

```bash
npm run smoke:phase3   # 다각도
npm run smoke:phase4   # 3D 패널
```

## 한계

- 변위 평면 메시이지 토폴로지/리깅된 캐릭터 메시 아님  
- 멀티뷰 융합·Gaussian·풀 3D 파이프라인 없음  
- PSD 없음  
