import crypto from "crypto";

export default function handler(req, res) {
  const { id, username, auth_date, hash, ...rest } = req.query;
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  // 1. Build data-check-string
  const dataCheckArr = Object.keys(req.query)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${req.query[k]}`);
  const dataCheckString = dataCheckArr.join("\n");

  // 2. Create secret key
  const secretKey = crypto.createHash("sha256").update(token).digest();

  // 3. Compute hash
  const hmac = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const valid = hmac === hash;

  if (!valid) {
    return res.status(200).json({ valid: false });
  }

  // ✅ Return full user info
  return res.status(200).json({
    valid: true,
    id,
    username,
  });
}
