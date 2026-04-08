import { OPENAI_API_KEY, ANTHROPIC_API_KEY } from "./supabase";

export async function callGPT(prompt: string, retries = 2): Promise<string> {
  const truncatedPrompt = prompt.length > 120000 ? prompt.slice(0, 120000) + "\n[TEXT TRUNCATED]" : prompt;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          messages: [{ role: "user", content: truncatedPrompt }],
          temperature: 0.2,
          max_completion_tokens: 4096,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown error");
        throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      return content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    } catch (err: any) {
      console.error(`callGPT attempt ${attempt + 1} failed:`, err.message);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("callGPT: all retries failed");
}

export async function callClaude(prompt: string, jsonSchema?: any, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      const body: any = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      };

      if (jsonSchema) {
        body.tools = [{
          name: "extract_data",
          description: "Extract structured data from the content",
          input_schema: jsonSchema,
        }];
        body.tool_choice = { type: "tool", name: "extract_data" };
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown");
        throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();

      if (jsonSchema) {
        const toolBlock = data.content?.find((b: any) => b.type === "tool_use");
        return JSON.stringify(toolBlock?.input || {});
      } else {
        const textBlock = data.content?.find((b: any) => b.type === "text");
        return textBlock?.text || "";
      }
    } catch (err: any) {
      console.error(`callClaude attempt ${attempt + 1} failed:`, err.message);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("callClaude: all retries failed");
}

export async function extractSkillsWithAI(text: string): Promise<Array<{ name: string; category: string; confidence: number }>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a skill extraction expert. Extract skills from job descriptions and return structured JSON.
Categories: "skill" (soft skills like communication), "technology" (tools/languages/frameworks), "knowledge" (domain knowledge), "ability" (cognitive/physical abilities).
Return a JSON object with a "skills" key containing an array of objects with: name (string), category (string), confidence (number 0-1).
Extract 5-30 skills depending on JD length. Be specific - prefer "React.js" over "frontend".`,
        },
        {
          role: "user",
          content: `Extract skills from this job description:\n\n${text.slice(0, 4000)}`,
        },
      ],
      temperature: 0.3,
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`extractSkillsWithAI API error: ${response.status}`, errBody);
    throw new Error(`OpenAI API error: ${response.status} ${errBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    const skills = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.skills) ? parsed.skills : []);
    return skills;
  } catch (err) {
    console.error("extractSkillsWithAI JSON parse error:", err, "raw content:", content);
    return [];
  }
}
