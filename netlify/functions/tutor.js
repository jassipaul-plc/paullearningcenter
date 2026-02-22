const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const conversation = body.conversation || [];

    if (conversation.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reply: "Please ask a math question."
        })
      };
    }

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: `
You are a calm K–8 math tutor.

Rules:
- Never give final answer.
- Always refer to the student's current problem.
- Do not change topic.
- Continue helping with the same problem.
- Give small hints only.
- Do not ask unrelated questions.
- No LaTeX.
`
        },
        ...conversation
      ]
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply: response.output_text
      })
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server error" })
    };
  }
};