// Vercel 서버리스 함수: 영수증 이미지를 Gemini로 분석해 금액/상호/항목/결제일시 추출
// 환경변수 GEMINI_API_KEY 필요 (Vercel > Project > Settings > Environment Variables)
// ★ 환경변수 추가/변경 후에는 반드시 Redeploy 해야 적용됩니다.
const MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-flash-latest"];

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }

  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(200).json({ error: "no_key" }); return; }

  try {
    // 본문 파싱 (Vercel이 자동 파싱 못한 경우 스트림에서 직접 읽기)
    let body = req.body;
    if (body === undefined) {
      const raw = await new Promise(function (resolve) {
        var s = ""; req.on("data", function (c) { s += c; }); req.on("end", function () { resolve(s); }); req.on("error", function () { resolve(""); });
      });
      try { body = JSON.parse(raw || "{}"); } catch (e) { body = {}; }
    } else if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    const image = (body && body.image) || "";
    const b64 = image.indexOf(",") >= 0 ? image.split(",")[1] : image;
    if (!b64) { res.status(200).json({ error: "no_image" }); return; }

    const prompt =
      "이미지는 중국에서 결제한 영수증입니다. 아래 JSON 형식으로만 답하세요(설명·마크다운 금지). " +
      '{"amount": 총액 숫자(위안 CNY, 통화기호·콤마 제외), "merchant": "상호명", ' +
      '"items": "주요 결제 항목을 한 줄로 요약", "date": "결제일 YYYY-MM-DD", "time": "결제시각 HH:MM (24시간)"}. ' +
      "결제일·시각은 영수증의 打印时间(인쇄시간)·开单日期·交易时间·结账时间 등에서 찾아 실제 결제 시점을 적으세요. " +
      "총액을 찾지 못하면 amount는 0, 날짜·시각이 없으면 빈 문자열로 두세요.";

    const payload = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: b64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
    };

    let lastDetail = "";
    for (let i = 0; i < MODELS.length; i++) {
      const url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODELS[i] + ":generateContent?key=" + key;
      let gr, gj;
      try {
        gr = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        gj = await gr.json();
      } catch (e) {
        lastDetail = "요청 실패: " + String(e);
        continue;
      }
      if (!gr.ok || (gj && gj.error)) {
        lastDetail = (gj && gj.error && gj.error.message) ? gj.error.message : ("HTTP " + gr.status);
        continue; // 모델 없음/권한 문제면 다음 모델로 폴백
      }
      let text = "";
      try { text = gj.candidates[0].content.parts[0].text; } catch (e) {}
      text = (text || "").replace(/```json|```/g, "").trim();
      let parsed = {};
      try { parsed = JSON.parse(text); } catch (e) {}
      res.status(200).json({
        model: MODELS[i],
        amount: Number(parsed.amount) || 0,
        merchant: parsed.merchant || "",
        items: parsed.items || "",
        date: parsed.date || "",
        time: parsed.time || ""
      });
      return;
    }
    res.status(200).json({ error: "gemini", detail: lastDetail || "모든 모델 실패" });
  } catch (e) {
    res.status(200).json({ error: "scan_failed", detail: String(e) });
  }
}
