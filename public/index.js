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

    const guidedMenus = {
      equipment: {
        title: "請選擇您目前使用的 ECOCO 設備",
        items: [
          {
            label: "ECOCO 智慧收瓶機",
            question: "我想詢問 ECOCO 智慧收瓶機的操作方式"
          },
          {
            label: "ECOCO 智慧電池機",
            question: "我想詢問 ECOCO 智慧電池機的操作方式"
          }
        ]
      }
    };

    function createGuidedMenu(title, items) {
      const menu = document.createElement("div");
      menu.className = "guided-menu";
      menu.setAttribute("aria-label", title);

      const heading = document.createElement("div");
      heading.className = "guided-menu-title";
      heading.textContent = title;
      menu.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "guided-menu-grid";
      items.forEach(item => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "guided-menu-btn";
        button.textContent = item.label;
        button.dataset.question = item.question;
        grid.appendChild(button);
      });
      menu.appendChild(grid);
      bindGuidedMenuButtons(menu);
      return menu;
    }

    function openGuidedMenu(menuName) {
      const menuConfig = guidedMenus[menuName];
      if (!menuConfig) return;

      const messages = document.getElementById("messages");
      const row = document.createElement("div");
      row.className = "msg-row bot";

      const avatar = document.createElement("div");
      avatar.className = "avatar bot";
      avatar.innerHTML = '<img src="ecoco-mark.png" alt="ECOCO" />';

      const wrapper = document.createElement("div");
      wrapper.className = "message-stack";
      wrapper.appendChild(createGuidedMenu(menuConfig.title, menuConfig.items));
      row.appendChild(avatar);
      row.appendChild(wrapper);
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
    }

    function bindGuidedMenuButtons(root = document) {
      root.querySelectorAll("[data-menu-target]").forEach(button => {
        if (button.dataset.menuBound === "true") return;
        button.dataset.menuBound = "true";
        button.addEventListener("click", () => openGuidedMenu(button.dataset.menuTarget));
      });
      root.querySelectorAll("[data-question]").forEach(button => {
        if (button.dataset.questionBound === "true") return;
        button.dataset.questionBound = "true";
        button.addEventListener("click", () => quickAsk(button.dataset.question || button.textContent.trim()));
      });
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
        if (options.messageId) {
          wrapper.appendChild(renderRatingBar(options.messageId));
        }

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

    function renderRatingBar(msgId) {
      const ratingBar = document.createElement("div");
      ratingBar.className = "rating-bar";

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
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ msgId, type })
        });
        if (!response.ok) throw new Error("rating failed");
      } catch (e) {
        textEl.textContent = "評分暫時無法送出";
      }
    }

    async function sendMessage(options = {}) {
      const input = document.getElementById("inputBox");
      const sendBtn = document.getElementById("sendBtn");
      const text = (options.overrideText || input.value).trim();
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
            "Content-Type": "application/json"
          },
          body: JSON.stringify(
            options.coords
              ? { message: text, coords: options.coords }
              : { message: text }
          )
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "AI 回覆失敗");

        const reply = data.reply;
        chatHistory.push({ role: "assistant", content: reply });

        removeTyping();
        appendMessage("bot", reply, { messageId: data.messageId });
      } catch (err) {
        removeTyping();
        appendMessage("bot", "抱歉，連線暫時不穩。請稍後再試，或點選下方「聯絡 ECOCO 客服」補充問題。");
      }

      sendBtn.disabled = false;
      input.focus();
    }

    function bindUiEvents() {
      bindGuidedMenuButtons();

      const input = document.getElementById("inputBox");
      input?.addEventListener("keydown", handleKey);
      input?.addEventListener("input", event => autoResize(event.currentTarget));
      document.getElementById("sendBtn")?.addEventListener("click", () => sendMessage());

      document.getElementById("locateBtn")?.addEventListener("click", () => {
        const btn = document.getElementById("locateBtn");
        if (!navigator.geolocation) {
          appendMessage("bot", "你的瀏覽器不支援定位功能，可以改用文字告訴我縣市或地標。");
          return;
        }
        btn.disabled = true;
        btn.textContent = "定位中…";
        navigator.geolocation.getCurrentPosition(
          pos => {
            btn.disabled = false;
            btn.textContent = "查最近站點";
            sendMessage({
              overrideText: "查詢我附近的 ECOCO 站點",
              coords: { lat: pos.coords.latitude, lng: pos.coords.longitude }
            });
          },
          () => {
            btn.disabled = false;
            btn.textContent = "查最近站點";
            appendMessage("bot", "沒有取得定位權限，可以改用文字告訴我縣市、路名或地標，我再幫你查。");
          },
          { timeout: 8000, maximumAge: 5 * 60 * 1000 }
        );
      });
    }

    bindUiEvents();
