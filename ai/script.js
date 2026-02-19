let conversation = [];

async function sendMessage() {
  const input = document.getElementById("userInput");
  const chatBox = document.getElementById("chatBox");
  const message = input.value.trim();

  if (!message) return;

  appendMessage(message, "user");
  input.value = "";

  const response = await fetch("/.netlify/functions/tutor", {
    method: "POST",
    body: JSON.stringify({ message, conversation }),
  });

  const data = await response.json();

  appendMessage(data.reply, "tutor");

  conversation.push({ role: "user", content: message });
  conversation.push({ role: "assistant", content: data.reply });
}

function appendMessage(text, sender) {
  const chatBox = document.getElementById("chatBox");
  const div = document.createElement("div");
  div.className = `message ${sender}`;
  div.innerText = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}