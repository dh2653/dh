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

@app.get("/tide")
def get_tide_data(region: str, date: str):
    url = f"https://www.badatime.com/tide/{region}/{date}"
    response = requests.get(url)
    soup = BeautifulSoup(response.text, "html.parser")

    # 👇 예시 파싱: 실제 구조에 맞게 수정 필요
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
