const OpenAI = require("openai");

exports.handler = async function (event) {
  try {
    const { question } = JSON.parse(event.body);

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a calm, teacher-like math tutor for K-8 students. Explain step-by-step clearly and gently.",
        },
        {
          role: "user",
          content: question,
        },
      ],
    });

    console.log("OPENAI RESPONSE:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error("No choices returned from OpenAI");
    }
    
    const reply = completion.choices[0].message.content;

    return {
      statusCode: 200,
      body: JSON.stringify({ answer: reply }),
    };
  } catch (error) {
    console.error("FULL ERROR:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
      }),
    };
  }
};