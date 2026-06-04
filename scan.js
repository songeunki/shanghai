// Vercel 서버리스 함수: 영수증 이미지를 Gemini로 분석해 금액/상호/항목을 추출
// 환경변수 GEMINI_API_KEY 필요 (Vercel > Project > Settings > Environment Variables)
// 모델은 필요 시 아래 MODEL 값을 변경하세요 (예: gemini-2.0-flash, gemini-1.5-flash)
const MODEL = "gemini-2.5-flash";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(200).json({ error: "no_key" });
    return;
  }
  try {
    let body = req.body;
    if (!body || typeof body === "string") {
      try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; }
    }
    const image = body.image || "";
    const b64 = image.indexOf(",") >= 0 ? image.split(",")[1] : image;
    if (!b64) { res.status(200).json({ error: "no_image" }); return; }

    const prompt =
      "이미지는 중국에서 결제한 영수증입니다. 아래 JSON 형식으로만 답하세요(설명·마크다운 금지). " +
      '{"amount": 총액 숫자(위안 CNY, 통화기호·콤마 제외), "merchant": "상호명", ' +
      '"items": "주요 결제 항목을 한 줄로 요약", "date": "결제일 YYYY-MM-DD 또는 빈 문자열", "time": "결제시각 HH:MM(24시간) 또는 빈 문자열"}. ' +
      "총액을 찾지 못하면 amount는 0으로 하세요. 날짜·시각이 안 보이면 빈 문자열로 두세요.";

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL + ":generateContent?key=" + key;

    const gr = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: b64 } }
          ]
        }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" }
      })
    });

    const gj = await gr.json();
    let text = "";
    try { text = gj.candidates[0].content.parts[0].text; } catch (e) {}
    text = (text || "").replace(/```json|```/g, "").trim();

    let parsed = {};
    try { parsed = JSON.parse(text); } catch (e) { parsed = {}; }

    res.status(200).json({
      amount: Number(parsed.amount) || 0,
      merchant: parsed.merchant || "",
      items: parsed.items || "",
      date: parsed.date || "",
      time: parsed.time || ""
    });
  } catch (e) {
    res.status(200).json({ error: "scan_failed" });
  }
}
