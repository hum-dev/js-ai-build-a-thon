import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const token = process.env["GITHUB_TOKEN"];
const endpoint = "https://models.github.ai/inference";
const model = "meta/Llama-4-Maverick-17B-128E-Instruct-FP8";

async function encodeImageToBase64(imagePath) {
  try {
    const imageBuffer = await fs.promises.readFile(imagePath);
    return imageBuffer.toString("base64");
  } catch (error) {
    throw new Error(`Failed to read or encode image: ${error.message}`);
  }
}

export async function main() {
  // Validate token
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is not set");
  }

  console.log("Creating client...");
  const client = ModelClient(endpoint, new AzureKeyCredential(token));

  console.log("Reading image file...");
  const imagePath = path.join(process.cwd(), "contoso_layout_sketch.jpg");

  // Check if file exists
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  const base64Image = await encodeImageToBase64(imagePath);
  console.log("Image encoded successfully");

  console.log("Sending request to model...");
  const response = await client.path("/chat/completions").post({
    body: {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that can understand images and provide detailed descriptions.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please analyze this image and describe what you see.",
            },
            {
              type: "image",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      temperature: 1.0,
      top_p: 1.0,
      max_tokens: 1000,
      model: model,
    },
  });

  if (isUnexpected(response)) {
    console.error("Unexpected response:", response);
    throw new Error(
      response.body?.error?.message || "Unexpected response from the model"
    );
  }

  if (!response.body?.choices?.[0]?.message?.content) {
    throw new Error("Invalid response format from the model");
  }

  console.log(response.body.choices[0].message.content);
}

main().catch((err) => {
  console.error("The sample encountered an error:", err.message || err);
  if (err.stack) {
    console.error("Stack trace:", err.stack);
  }
});
