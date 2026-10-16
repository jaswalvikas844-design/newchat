import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 10000);
const SITE_ORIGIN = process.env.SITE_ORIGIN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";
const ASSISTANT_INSTRUCTIONS = process.env.ASSISTANT_INSTRUCTIONS ||
  "You are a helpful assistant for this website. Answer clearly and concisely. If you do not know an answer, say so and direct the visitor to the website's contact page.";

if (!SITE_ORIGIN) throw new Error("Set the SITE_ORIGIN environment variable.");
if (!OPENAI_API_KEY) throw new Error("Set the OPENAI_API_KEY environment variable.");

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": SITE_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 24_000) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && origin !== SITE_ORIGIN) {
    return sendJson(response, 403, { error: "This website is not allowed." });
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    });
    return response.end();
  }

  if (request.method === "GET" && request.url === "/health") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method !== "POST" || request.url !== "/api/chat") {
    return sendJson(response, 404, { error: "Not found." });
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    return sendJson(response, 400, { error: "Invalid or oversized request." });
  }

  const messages = Array.isArray(body?.messages)
    ? body.messages
        .filter((message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string"
        )
        .slice(-10)
        .map(({ role, content }) => ({ role, content: content.slice(0, 1500) }))
    : [];

  if (!messages.length || messages.at(-1).role !== "user") {
    return sendJson(response, 400, { error: "Send a message to start." });
  }

  try {
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: ASSISTANT_INSTRUCTIONS,
        input: messages,
      }),
    });

    const result = await apiResponse.json();
    if (!apiResponse.ok) {
      console.error("OpenAI API returned status", apiResponse.status);
      return sendJson(response, 502, { error: "The assistant could not respond." });
    }

    return sendJson(response, 200, { reply: result.output_text || "I couldn't answer that." });
  } catch (error) {
    console.error("Chat request failed:", error);
    return sendJson(response, 500, { error: "Chat is temporarily unavailable." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Framer chat backend listening on port ${PORT}`);
});
