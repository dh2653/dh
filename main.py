from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "Welcome to Tide Info API", "status": "ok"}

@app.get("/tide")
def get_mock_tide(region: str, date: str):
    # 여기는 실제로는 requests + BeautifulSoup으로 가져와야 하는 자리야
    # 지금은 그냥 테스트용 고정 데이터로 줌
    data = [
        {"time": "04:12", "tide": "170cm"},
        {"time": "10:20", "tide": "80cm"},
        {"time": "16:45", "tide": "190cm"},
        {"time": "22:10", "tide": "70cm"}
    ]
    return {
        "region": region,
        "date": date,
        "data": data
    }
