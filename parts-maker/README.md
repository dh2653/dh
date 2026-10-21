# 파츠 제작 (Parts Maker) — Phase 3

업로드 → **다각도 뷰 생성** → 각도 썸네일 클릭 → **뷰별 파츠 분리** (rembg + Spine 메타) → PNG zip / 재조립 GIF.

## 실행

```bash
cd parts-maker
npm install
pip3 install -r server/requirements.txt
npm run dev:all
```

- 웹: http://localhost:5173  
- API: http://127.0.0.1:8787/health  

## Phase 3 — 다각도

| 기능 | 상태 |
|------|------|
| 정면/좌/우/위/아래 뷰 생성 | **geometric-proxy** (rembg FG + perspective/shear) |
| 각도 썸네일 → 기존 파츠 파이프라인 | 실제 |
| 각도별 이미지 수동 업로드 | 실제 |
| 뷰 생성 실패 시 | 정면만으로 계속 (앱 비차단) |
| Zero123 / Replicate novel-view | 훅만 (`REPLICATE_API_TOKEN` + `VIEW_MODEL`) |

### 진짜 novel-view 붙이기

1. `server/view_engine.py`의 `_try_replicate_novel_view`를 모델 IO에 맞게 완성하거나  
2. `/views`가 동일한 JSON(`views[{id,imagePngBase64}]`)을 반환하도록 교체  

환경에 torch/Zero123 가중치·API 키가 없어 기본은 geometric proxy입니다.

## Phase 1–2 (유지)

- rembg U2Net + watershed 세그  
- 브러시 / 피벗·parent·drawOrder 테이블  
- 히든 마커 + 간단 인페인트 (approx)  
- `parts.json` **v3** (`view` 필드 + 현재 뷰 PNG)

## 데모

1. 샘플로 체험 → 상단 각도 썸네일 확인  
2. 좌측/우측 클릭 → 해당 뷰 파츠 분리  
3. 메타 편집 · GIF · PNG zip  

## 한계

- geometric proxy는 **실제 측면 재생성 아님** (왜곡된 정면 기반)  
- 생성형 inpaint / 3D 메시·리깅 / PSD 미포함  
