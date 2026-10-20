# 파츠 제작 (Parts Maker) — Phase 1.5

캐릭터 이미지를 올리면 **신경망 배경 분리(U2Net)** + **마커 워터셰드**로 파츠를 제안하고, 브러시로 다듬은 뒤 **투명 PNG zip**과 **재조립 GIF**를 받습니다.

## 실행 (권장)

세그 API + 웹을 함께 띄웁니다.

```bash
cd parts-maker
npm install
# Python deps (최초 1회)
pip3 install -r server/requirements.txt

npm run dev:all
```

- 웹: http://localhost:5173  
- API: http://127.0.0.1:8787/health  

웹만 띄우면(`npm run dev`) API가 없을 때 **로컬 marker-watershed fallback**으로 동작합니다.

## 데모 흐름

1. **샘플로 체험** 또는 이미지 업로드
2. 컬러 오버레이 + Spine식 `번호 이름` 확인
3. 브러시 / 지우개 / 채우기로 마스크 수정
4. **재조립 GIF** → **PNG zip**

## 세그멘테이션이 지금 하는 일

| 단계 | 구현 | 비고 |
|------|------|------|
| 배경 분리 | **rembg + U2Net** (ONNX, 로컬) | 실제 신경망 |
| 파츠 분할 | OpenCV **marker watershed** + Spine식 시드 | 해부학 레이아웃 시드 |
| 이름 / drawOrder | 시드 테이블 | pivot/parent는 스텁 |
| 실패 시 | 클라이언트 edge-aware marker flood | k-means 제거됨 |
| 마스크 수정 | 브러시·지우개·채우기 | 반자동 UX 유지 |

상태 문구에 `엔진 rembg:u2net+watershed` 또는 `오프라인 fallback`이 표시됩니다.

### SAM으로 바꾸려면

1. `server/segment_engine.py`의 `propose_parts()`만 교체 (반환: labels + parts + working PNG)
2. 또는 `/segment`와 동일 JSON을 주는 외부 API로 Vite 프록시 대상만 변경
3. 프론트는 `src/lib/segmentApi.ts` 계약만 유지하면 UI/export는 그대로

필요 예: `REPLICATE_API_TOKEN` + SAM/Grounded-SAM, 또는 로컬 `segment-anything` + torch.

## 알려진 한계

- 관절 컷·hidden region inpaint는 아직 없음 → 브러시 수정 전제
- 워터셰드 시드는 전신 캐릭터 가정 (크롭/동물은 이름 품질 하락)
- 최초 U2Net 가중치 다운로드 필요 (`~/.u2net` / rembg 캐시)
- PSD/포토샵 연동은 범위 밖

## 스택

Vite · React · TypeScript · FastAPI · rembg · OpenCV · JSZip · gifenc
