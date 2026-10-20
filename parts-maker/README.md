# 파츠 제작 (Parts Maker) — Phase 1 MVP

캐릭터 이미지를 올리면 **파츠 후보 마스크 + 이름**을 제안하고, 브러시로 다듬은 뒤 **투명 PNG zip**과 **재조립 GIF**를 받습니다.

기존 레포의 FastAPI 샘플과는 별개로 `parts-maker/` 하위에 동작합니다.

## 실행

```bash
cd parts-maker
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 을 엽니다.

프로덕션 빌드:

```bash
npm run build
npm run preview
```

## 데모 흐름

1. **샘플로 체험** (한복 캐릭터) 또는 이미지 업로드
2. 컬러 오버레이 + Spine식 `번호 이름` 라벨 확인
3. 파츠 선택 → **브러시 / 지우개 / 채우기**로 마스크 수정
4. **재조립 GIF** — draw order대로 파츠가 쌓여 원본에 가깝게 보이는지 확인
5. **PNG zip** — `parts/parts.json` + 파츠별 투명 PNG

## 무엇이 실제 AI인가 / 스텁인가

| 기능 | 현재 | 비고 |
|------|------|------|
| 배경 분리 | 클라이언트 휴리스틱 (가장자리 flood-fill) | |
| 파츠 제안 | 공간+색 k-means + 위치 기반 이름 | **데모 파이프라인** (API 키 없음) |
| 오버레이 / 라벨 | 실제 | |
| 브러시·지우개·채우기 | 실제 | |
| PNG zip + `parts.json` | 실제 | `parent`/`pivot`은 Phase 2용 스텁 필드 |
| 재조립 GIF | 실제 (drawOrder 스택) | |

### 나중에 진짜 세그멘테이션 붙이기

`src/lib/segment.ts`의 `proposeParts(source)` 반환 형태만 맞추면 됩니다.

```ts
// ProjectState: { width, height, source: ImageData, labels: Uint16Array, parts: PartMeta[] }
// labels[i] === 0 → 배경, 그 외 → part.id
```

권장 교체 지점:

1. 서버 라우트(예: `/api/segment`)에서 SAM / Grounded-SAM / 비전 API 호출
2. 마스크 배열을 `Uint16Array`로 매핑하고 `PartMeta[]`에 이름·drawOrder 채움
3. UI는 그대로 두고 `runPropose`에서 `proposeParts` 대신 fetch 결과 사용

환경 변수 예: `VITE_SEGMENT_API_URL`, 서버 측 `REPLICATE_API_TOKEN` 등.

## 알려진 한계

- 자동 분리는 **완벽한 관절 컷이 아님** — 반드시 사람이 다듬는 전제
- 흰 배경·단순한 일러스트에서 가장 잘 동작
- Hidden region inpaint / 피벗·부모 편집 / 다각도·3D는 Phase 2+ (로드맵 참고)
- GIF는 팔레트 양자화로 색이 약간 달라질 수 있음

## 스택

Vite · React · TypeScript · JSZip · gifenc
