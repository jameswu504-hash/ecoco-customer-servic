const SESSION_ID = "session_" + (
  (window.crypto && typeof window.crypto.randomUUID === "function")
    ? window.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
);
    let chatHistory = [];

    document.getElementById("initTime").textContent = getTime();

    function getTime() {
      return new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function autoResize(el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 128) + "px";
    }

    function handleKey(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }

    function quickAsk(text) {
      const input = document.getElementById("inputBox");
      input.value = text;
      sendMessage();
    }

    function appendMessage(role, text, options = {}) {
      const messages = document.getElementById("messages");
      const row = document.createElement("div");
      row.className = `msg-row ${role}`;

      const avatar = document.createElement("div");
      avatar.className = `avatar ${role}`;
      if (role === "bot") {
        const img = document.createElement("img");
        img.src = "ecoco-mark.png";
        img.alt = "ECOCO";
        avatar.appendChild(img);
      } else {
        avatar.textContent = "我";
      }

      const wrapper = document.createElement("div");
      wrapper.className = "message-stack";

      const bubble = document.createElement("div");
      bubble.className = `bubble ${role}`;

      if (role === "bot") {
        bubble.innerHTML = DOMPurify.sanitize(marked.parse(text));
      } else {
        bubble.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
      }

      const time = document.createElement("div");
      time.className = "bubble-time";
      time.textContent = getTime();

      if (role === "bot") {
        wrapper.appendChild(bubble);
        wrapper.appendChild(time);
        wrapper.appendChild(renderRatingBar());

        if (shouldShowContact(text)) {
          const contactWrapper = document.createElement("div");
          const contactBtn = document.createElement("a");
          contactBtn.className = "contact-btn";
          contactBtn.href = "https://ecoco.tw/kWqgW";
          contactBtn.target = "_blank";
          contactBtn.rel = "noopener";
          contactBtn.textContent = "聯絡 ECOCO 客服";
          contactWrapper.appendChild(contactBtn);
          wrapper.appendChild(contactWrapper);
        }
      } else {
        wrapper.appendChild(bubble);
        wrapper.appendChild(time);
      }

      row.appendChild(avatar);
      row.appendChild(wrapper);
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;

      return bubble;
    }

    function renderRatingBar() {
      const ratingBar = document.createElement("div");
      ratingBar.className = "rating-bar";

      const msgId = Date.now();

      const thumbUp = document.createElement("button");
      thumbUp.className = "rating-btn";
      thumbUp.type = "button";
      thumbUp.textContent = "有幫助";

      const thumbDown = document.createElement("button");
      thumbDown.className = "rating-btn";
      thumbDown.type = "button";
      thumbDown.textContent = "需改善";

      const ratingText = document.createElement("span");
      ratingText.className = "rating-text";

      thumbUp.addEventListener("click", () => submitRating(msgId, "positive", thumbUp, thumbDown, ratingText));
      thumbDown.addEventListener("click", () => submitRating(msgId, "negative", thumbDown, thumbUp, ratingText));

      ratingBar.appendChild(thumbUp);
      ratingBar.appendChild(thumbDown);
      ratingBar.appendChild(ratingText);
      return ratingBar;
    }

    function shouldShowContact(text) {
      return [
        "客服表單",
        "聯絡我們",
        "人工協助",
        "專人",
        "沒有確切資料"
      ].some(keyword => text.includes(keyword));
    }

    function showTyping() {
      const messages = document.getElementById("messages");
      const row = document.createElement("div");
      row.className = "msg-row bot";
      row.id = "typingRow";

      const avatar = document.createElement("div");
      avatar.className = "avatar bot";
      avatar.innerHTML = '<img src="ecoco-mark.png" alt="ECOCO" />';

      const bubble = document.createElement("div");
      bubble.className = "bubble bot";
      bubble.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

      row.appendChild(avatar);
      row.appendChild(bubble);
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
    }

    function removeTyping() {
      const row = document.getElementById("typingRow");
      if (row) row.remove();
    }

    async function submitRating(msgId, type, clickedBtn, otherBtn, textEl) {
      clickedBtn.classList.add("selected");
      clickedBtn.disabled = true;
      otherBtn.disabled = true;
      textEl.textContent = type === "positive" ? "謝謝你的回饋" : "已收到，我們會用來改善回答";

      try {
        const response = await fetch("/api/rating", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": SESSION_ID
          },
          body: JSON.stringify({ msgId, type })
        });
        if (!response.ok) throw new Error("rating failed");
      } catch (e) {
        textEl.textContent = "評分暫時無法送出";
      }
    }

    async function sendMessage() {
      const input = document.getElementById("inputBox");
      const sendBtn = document.getElementById("sendBtn");
      const text = input.value.trim();
      if (!text) return;

      input.value = "";
      input.style.height = "auto";
      sendBtn.disabled = true;

      appendMessage("user", text);
      chatHistory.push({ role: "user", content: text });

      showTyping();

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-id": SESSION_ID
          },
          body: JSON.stringify({ message: text })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "AI 回覆失敗");

        const reply = data.reply;
        chatHistory.push({ role: "assistant", content: reply });

        removeTyping();
        appendMessage("bot", reply);
      } catch (err) {
        removeTyping();
        appendMessage("bot", "抱歉，連線暫時不穩。請稍後再試，或點選下方「聯絡 ECOCO 客服」補充問題。");
      }

      sendBtn.disabled = false;
      input.focus();
    }

    function bindUiEvents() {
      document.querySelectorAll(".quick-chip[data-question]").forEach(button => {
        button.addEventListener("click", () => quickAsk(button.dataset.question || button.textContent.trim()));
      });

      const input = document.getElementById("inputBox");
      input?.addEventListener("keydown", handleKey);
      input?.addEventListener("input", event => autoResize(event.currentTarget));
      document.getElementById("sendBtn")?.addEventListener("click", sendMessage);
    }

    bindUiEvents();
