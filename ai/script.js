let conversation = [];

function appendMessage(text, sender) {
  const chatBox = document.getElementById("chatBox");

  const div = document.createElement("div");
  div.className = `message ${sender}`;
  div.innerText = text;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById("userInput");
  const question = input.value.trim();
  if (!question) return;

  appendMessage(question, "user");

  // Add to conversation memory
  conversation.push({ role: "user", content: question });

  input.value = "";

  try {
    const response = await fetch("/.netlify/functions/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation }),
    });

    const data = await response.json();

    if (data.reply) {
      appendMessage(data.reply, "tutor");

      // Add tutor reply to memory
      conversation.push({ role: "assistant", content: data.reply });
    } else {
      appendMessage("Error from tutor.", "tutor");
    }

  } catch (error) {
    appendMessage("Network error.", "tutor");
  }
}