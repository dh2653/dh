# 파츠 제작 (Parts Maker) — Phase 2

캐릭터 업로드 → **U2Net 배경 분리 + 워터셰드 파츠** → Spine식 **pivot / parent / drawOrder** 테이블 편집 → 히든 마커·간단 인페인트 → **PNG zip + 재조립 GIF**.

## 실행

```bash
cd parts-maker
npm install
pip3 install -r server/requirements.txt
npm run dev:all
```

- 웹: http://localhost:5173  
- API: http://127.0.0.1:8787/health  

웹만(`npm run dev`) 띄우면 세그 API 없이 로컬 marker-watershed fallback.

## Phase 2 기능

| 기능 | 상태 |
|------|------|
| pivot 자동 추정 (부모 관절 편향) + 클릭/테이블 편집 | 실제 |
| parent 계층 기본값 + 테이블 편집 | 실제 |
| drawOrder 편집 → GIF/export 반영 | 실제 |
| Spine식 파츠 테이블 UI | 실제 |
| 히든 영역 마커 (관절 overlap) | 실제 |
| 간단 인페인트 (이웃 평균 채우기) | **approx** — 생성형 inpaint는 TODO |
| rembg 세그 · 브러시 · PNG zip · GIF | 유지 |

`parts.json` export는 **version: 2** (parts + hiddenRegions).

## 세그멘테이션 (Phase 1.5)

- 기본: `server/` FastAPI → rembg U2Net + OpenCV marker watershed  
- 실패 시: 클라이언트 edge-aware marker flood  
- SAM 교체: `server/segment_engine.py`의 `propose_parts()` 또는 `/segment` JSON 계약 유지

## 데모

1. 샘플로 체험  
2. 피벗·본·히든 오버레이 확인  
3. 하단 테이블에서 parent / pivot / drawOrder 수정  
4. 재조립 GIF → PNG zip  

## 한계

- 히든 인페인트는 가벼운 로컬 채우기 (Firefly/LaMa급 아님)  
- 시드·parent 테이블은 전신 휴머노이드 가정  
- 다각도 / 3D / PSD는 Phase 3+  
