# 파츠 제작 (Parts Maker)

**메인:** 이미지 업로드 → 투명 컷아웃 + **챗지용 ‘파츠 시트 재생성’ 프롬프트** 복사  
(원본 픽셀을 자르지 않고, 같은 캐릭터를 파츠 시트로 다시 그려 달라고 부탁하는 문장)

**실험(레거시):** 자동 분할 에디터 · 다각도 · 3D · 파츠이미지다운

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

## 파츠이미지다운

상단 **「파츠이미지다운」** → `parts-images-{view}.zip`

| 파일 | 내용 |
|------|------|
| `png/*.png` | 파츠별 투명 PNG |
| `preview-composite.png` | 파츠를 겹친 전체 미리보기 |
| `parts-{view}.psd` | 같은 파츠의 레이어 PSD (포토샵/클립) |
| `parts.json` | pivot / parent / drawOrder 메타 |

개별 PNG는 조각처럼 보이는 게 정상입니다. 전체는 `preview-composite.png` 또는 PSD에서 확인하세요.  
자동 경계가 이상하면 앱에서 브러시로 고친 뒤 다시 다운하면 됩니다.

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
