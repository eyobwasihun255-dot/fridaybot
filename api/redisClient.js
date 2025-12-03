import Redis from "ioredis";

// Singleton Redis client for the backend (games / rooms / locks).
// Configure with REDIS_URL or REDIS_HOST / REDIS_PORT / REDIS_PASSWORD.
const redisUrl = process.env.REDIS_URL;

let client;

if (redisUrl) {
  client = new Redis(redisUrl);
} else {
  client = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  });
}

client.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

export default client;


