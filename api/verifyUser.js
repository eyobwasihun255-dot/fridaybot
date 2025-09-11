// /pages/api/verifyUser.ts
import crypto from "crypto";

export default function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: "Server misconfiguration" });

  const q = req.query;

  // 1) Telegram WebApp verification using `hash` (preferred)
  if (q.hash) {
    // build data-check-string with all keys except 'hash'
    const dataCheckArr = Object.keys(q)
      .filter((k) => k !== "hash")
      .sort()
      .map((k) => `${k}=${q[k]}`);
    const dataCheckString = dataCheckArr.join("\n");

    const secretKey = crypto.createHash("sha256").update(token).digest();
    const hmac = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    const valid = hmac === q.hash;
    return res.status(200).json({
      valid,
      id: q.id,
      username: q.username,
      ...(valid ? { verifiedBy: "hash" } : {}),
    });
  }

  // 2) Legacy (your previous) check: sig based on id (keeps backward compatibility)
  if (q.sig && q.id) {
    const expectedSig = crypto.createHmac("sha256", token).update(String(q.id)).digest("hex");
    const valid = q.sig === expectedSig;
    return res.status(200).json({
      valid,
      id: q.id,
      username: q.username,
      ...(valid ? { verifiedBy: "legacy-sig" } : {}),
    });
  }

  // 3) Nothing to verify
  return res.status(400).json({ valid: false, error: "no-verification-data" });
}
