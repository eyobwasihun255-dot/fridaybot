import crypto from "crypto";

export default function handler(req, res) {
  const { id, sig } = req.query;
  const secret = process.env.TELEGRAM_BOT_TOKEN;

  if (!secret) {
    console.error("❌ TELEGRAM_BOT_TOKEN is not set in environment!");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(id.toString())
    .digest("hex");

  res.status(200).json({ valid: sig === expectedSig });
}
