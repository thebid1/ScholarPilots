import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });
import { GoogleGenAI } from "@google/genai";

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string);
  if (typeof creds.private_key === "string") creds.private_key = creds.private_key.replace(/\\n/g, "\n");

  const ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: "global",
    googleAuthOptions: { credentials: creds },
  });

  const r = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: "are you a free or paid model",
  });
  console.log(r.text);
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
