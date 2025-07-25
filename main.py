from fastapi import FastAPI
from apscheduler.schedulers.background import BackgroundScheduler
import httpx

app = FastAPI()
scheduler = BackgroundScheduler()

# 인증키 (반드시 본인의 키로 교체)
SERVICE_KEY = "발급받은_인증키_여기에"

def update_tide_data():
    print("데이터 갱신 시작")
    url = "https://www.khoa.go.kr/api/oceangrid/tideObsPreTab/search.do"
    params = {
        "ServiceKey": SERVICE_KEY,
        "ObsCode": "DT_0010",  # 부산 예시
        "Date": "20240725",    # 원하는 날짜
        "ResultType": "json"
    }
    try:
        response = httpx.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        print("API 응답:", data)
        # TODO: 여기에 DB 저장 로직 추가
    except Exception as e:
        print("API 호출 실패:", e)

# 매일 새벽 3시에 자동으로 데이터 갱신 실행
scheduler.add_job(update_tide_data, 'cron', hour=3, minute=0)
scheduler.start()

@app.on_event("shutdown")
def shutdown_event():
    scheduler.shutdown()

@app.get("/")
async def root():
    return {"message": "FastAPI with daily scheduled task running"}

@app.get("/update-now")
async def update_now():
    update_tide_data()
    return {"message": "수동 업데이트 함수 실행 완료"}
