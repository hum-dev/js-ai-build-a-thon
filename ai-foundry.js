import dotenv from "dotenv";
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

dotenv.config();

const endpoint = process.env.AZURE_INFERENCE_SDK_ENDPOINT ?? "";
const apiKey = process.env.AZURE_INFERENCE_SDK_KEY ?? "";

if (!endpoint || !apiKey) {
  console.error(
    "Please set AZURE_INFERENCE_SDK_ENDPOINT and AZURE_INFERENCE_SDK_KEY in your .env file"
  );
  process.exit(1);
}

const client = new ModelClient(
  "https://humpr-mbzj3ifc-eastus.openai.azure.com",
  new AzureKeyCredential(apiKey)
);

const messages = [
  { role: "system", content: "You are a helpful assistant" },
  { role: "user", content: "What are 3 things to see in Seattle?" },
];

try {
  const response = await client
    .path("/openai/deployments/gpt-4.1-chat/chat/completions")
    .post({
      queryParameters: {
        "api-version": "2024-08-01-preview",
      },
      body: {
        messages,
        max_tokens: 800,
        temperature: 1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      },
    });

  if (
    response.status === "200" &&
    response.body.choices &&
    response.body.choices[0]
  ) {
    console.log("\nAssistant's response:\n");
    const choice = response.body.choices[0];
    if (
      typeof choice === "object" &&
      choice.message &&
      choice.message.content
    ) {
      console.log(choice.message.content);
      console.log("\nUsage Statistics:");
      console.log(`Prompt tokens: ${response.body.usage.prompt_tokens}`);
      console.log(
        `Completion tokens: ${response.body.usage.completion_tokens}`
      );
      console.log(`Total tokens: ${response.body.usage.total_tokens}`);
    } else {
      console.log(JSON.stringify(choice, null, 2));
    }
    console.log("\n");
  } else {
    console.error(
      "Unexpected response format:",
      JSON.stringify(response, null, 2)
    );
  }
} catch (error) {
  console.error("Error:", error.message);
  if (error.response) {
    console.error("Response:", error.response.body);
  }
}
