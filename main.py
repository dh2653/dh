from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import requests
from bs4 import BeautifulSoup

app = FastAPI()

# CORS 허용 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ 루트 경로 추가: Render 헬스체크 및 접속 확인용
@app.get("/")
def root():
    return {"message": "Welcome to Tide Info API", "status": "ok"}

@app.get("/tide")
def get_tide_data(region: str, date: str):
    url = f"https://www.badatime.com/tide/{region}/{date}"
    response = requests.get(url)
    soup = BeautifulSoup(response.text, "html.parser")

    table = soup.select_one(".tide_table")
    if not table:
        return {"error": "No tide data found"}

    rows = table.select("tr")
    data = []
    for row in rows[1:]:
        cells = row.select("td")
        if len(cells) >= 2:
            time = cells[0].get_text(strip=True)
            tide = cells[1].get_text(strip=True)
            data.append({"time": time, "tide": tide})

    return {
        "region": region,
        "date": date,
        "data": data
    }

# 아래 __main__ 블록은 로컬 테스트용
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
