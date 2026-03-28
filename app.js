import {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc
} from "./firebase.js";

    const authSection = document.getElementById("authSection");
    const chatSection = document.getElementById("chatSection");
    const authMessage = document.getElementById("authMessage");

    const loginTabButton = document.getElementById("loginTabButton");
    const registerTabButton = document.getElementById("registerTabButton");
    const loginPanel = document.getElementById("loginPanel");
    const registerPanel = document.getElementById("registerPanel");

    const loginEmailInput = document.getElementById("loginEmail");
    const loginPasswordInput = document.getElementById("loginPassword");
    const registerUsernameInput = document.getElementById("registerUsername");
    const registerEmailInput = document.getElementById("registerEmail");
    const registerPasswordInput = document.getElementById("registerPassword");

    const chat = document.getElementById("chat");
    const messageInput = document.getElementById("messageInput");
    const welcomeText = document.getElementById("welcomeText");
    const profileSummary = document.getElementById("profileSummary");
    const profileEditor = document.getElementById("profileEditor");
    const profileUsernameInput = document.getElementById("profileUsername");
    const profileBioInput = document.getElementById("profileBio");
    const profileAvatarUrlInput = document.getElementById("profileAvatarUrl");
    const emojiPicker = document.getElementById("emojiPicker");
    const onlineCount = document.getElementById("onlineCount");
    const themeToggleBtn = document.getElementById("themeToggleBtn");
    const requestPanel = document.getElementById("requestPanel");
    const requestList = document.getElementById("requestList");
    const privatePanel = document.getElementById("privatePanel");
    const friendList = document.getElementById("friendList");
    const globalModeButton = document.getElementById("globalModeButton");
    const privateModeButton = document.getElementById("privateModeButton");
    const chatModeTitle = document.getElementById("chatModeTitle");
    const typingBar = document.getElementById("typingBar");
    const mentionSuggestions = document.getElementById("mentionSuggestions");
    const notificationsButton = document.getElementById("notificationsButton");
    const requestsButton = document.getElementById("requestsButton");
    const friendsButton = document.getElementById("friendsButton");
    const notificationBadge = document.getElementById("notificationBadge");
    const notificationPanel = document.getElementById("notificationPanel");
    const notificationMeta = document.getElementById("notificationMeta");
    const notificationList = document.getElementById("notificationList");
    const closePrivateChatButton = document.getElementById("closePrivateChatButton");

    let currentUser = null;
    let currentProfile = {
      username: "",
      bio: "",
      avatarUrl: "",
      color: "#3b82f6"
    };
    let globalMessagesCache = [];
    let privateMessagesCache = [];
    let selectedProfileColor = "#3b82f6";
    let usersMap = {};
    let onlineHeartbeat = null;
    let friendStatusMap = {};
    let incomingRequests = [];
    let seenUpdateInProgress = new Set();
    let activeChatMode = "global";
    let activePrivateChatUserId = "";
    let unsubscribePrivateMessages = null;
    let notificationsCache = [];
    let notificationsPanelOpen = false;
    let activeFloatingPanel = "";
    let globalUnreadCount = 0;
    let typingUsersCache = [];
    let typingStopTimer = null;
    let mentionSuggestionHandleList = [];

    const emojiList = [
      "😀", "😄", "😁", "😂", "🤣", "😊", "😍", "🥰", "😘", "😎",
      "🥹", "😭", "😴", "😡", "🤔", "🙌", "👏", "👍", "👀", "🤝",
      "❤️", "🩷", "💙", "💚", "🔥", "✨", "🌙", "☀️", "🎉", "🎶",
      "🍕", "🍓", "☕", "🐶", "🐱", "🌸"
    ];
    const ONLINE_WINDOW_MS = 60000;
    const FRIEND_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

    window.showAuthTab = function (tab) {
      authMessage.innerText = "";

      if (tab === "login") {
        loginPanel.classList.add("active");
        registerPanel.classList.remove("active");
        loginTabButton.classList.add("active");
        registerTabButton.classList.remove("active");
      } else {
        registerPanel.classList.add("active");
        loginPanel.classList.remove("active");
        registerTabButton.classList.add("active");
        loginTabButton.classList.remove("active");
      }
    };

    function formatTime(timestamp) {
      if (!timestamp) return "";
      const date = timestamp.toDate();
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function formatDateTime(timestamp) {
      if (!timestamp) return "Just now";
      const date = timestamp.toDate();
      return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function getInitial(name) {
      return (name || "?").trim().charAt(0).toUpperCase() || "?";
    }

    function isUserOnline(lastActive) {
      if (!lastActive) return false;
      const last = lastActive.toDate().getTime();
      return Date.now() - last <= ONLINE_WINDOW_MS;
    }

    function getRequestDocId(uid1, uid2) {
      return [uid1, uid2].sort().join("_");
    }

    function getPrivateChatId(uid1, uid2) {
      return [uid1, uid2].sort().join("_");
    }


    async function createNotification(toUserId, type, textValue) {
      if (!currentUser || !toUserId || toUserId === currentUser.uid) return;

      try {
        await addDoc(collection(db, "notifications"), {
          toUserId: toUserId,
          fromUserId: currentUser.uid,
          type: type,
          text: textValue,
          isRead: false,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        console.log("Notification skipped");
      }
    }

    async function markNotificationRead(notificationId) {
      if (!notificationId) return;

      try {
        await updateDoc(doc(db, "notifications", notificationId), {
          isRead: true
        });
      } catch (error) {
        console.log("Notification read skipped");
      }
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function toHandle(name) {
      return String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");
    }

    function getCurrentHandle() {
      return toHandle(currentProfile.username || currentUser?.email || "");
    }

    function renderMessageText(textValue) {
      const escaped = escapeHtml(textValue || "");
      const currentHandle = getCurrentHandle();
      return escaped.replace(/(^|\s)@([a-zA-Z0-9_]+)/g, (match, prefix, handle) => {
        const safeHandle = escapeHtml(handle);
        const cssClass = currentHandle && handle.toLowerCase() === currentHandle ? "mentionMe" : "mentionTag";
        return `${prefix}<span class="${cssClass}">@${safeHandle}</span>`;
      });
    }

    function getMentionedUsersFromText(textValue) {
      const matches = [...String(textValue || "").matchAll(/(^|\s)@([a-zA-Z0-9_]+)/g)];
      const handles = [...new Set(matches.map((match) => (match[2] || "").toLowerCase()))];
      return Object.entries(usersMap)
        .filter(([userId, userData]) => userId !== currentUser?.uid && handles.includes(toHandle(userData.username || userData.email || "")))
        .map(([userId, userData]) => ({
          userId,
          username: userData.username || userData.email || "User",
          handle: toHandle(userData.username || userData.email || "")
        }));
    }

    function hideMentionSuggestions() {
      mentionSuggestionHandleList = [];
      mentionSuggestions.style.display = "none";
      mentionSuggestions.innerHTML = "";
    }

    function updateMentionSuggestions() {
      if (activeChatMode !== "global") {
        hideMentionSuggestions();
        return;
      }

      const value = messageInput.value;
      const match = value.match(/(^|\s)@([a-zA-Z0-9_]*)$/);

      if (!match || !currentUser) {
        hideMentionSuggestions();
        return;
      }

      const typed = (match[2] || "").toLowerCase();
      const suggestions = Object.entries(usersMap)
        .filter(([userId, userData]) => userId !== currentUser.uid)
        .map(([userId, userData]) => ({
          userId,
          username: userData.username || userData.email || "User",
          handle: toHandle(userData.username || userData.email || "")
        }))
        .filter((item) => item.handle && item.handle.includes(typed))
        .slice(0, 6);

      if (suggestions.length === 0) {
        hideMentionSuggestions();
        return;
      }

      mentionSuggestionHandleList = suggestions.map((item) => item.handle);
      mentionSuggestions.innerHTML = suggestions.map((item) => `
        <button class="mentionSuggestionItem" type="button" onclick="insertMention('${item.handle}')">
          ${escapeHtml(item.username)} <span class="mentionSuggestionHandle">@${escapeHtml(item.handle)}</span>
        </button>
      `).join("");
      mentionSuggestions.style.display = "block";
    }

    async function setTypingStatus(isTyping) {
      if (!currentUser) return;

      if (activeChatMode !== "global") {
        isTyping = false;
      }

      try {
        await setDoc(doc(db, "typingStatus", currentUser.uid), {
          userId: currentUser.uid,
          username: currentProfile.username || currentUser.email || "User",
          isTyping: isTyping,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.log("Typing status skipped");
      }
    }

    function getRemainingCooldownText(untilMs) {
      const remainingMs = untilMs - Date.now();
      if (remainingMs <= 0) return "Request again";

      const totalMinutes = Math.ceil(remainingMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      if (hours <= 0) {
        return `Try again in ${minutes}m`;
      }

      return `Try again in ${hours}h ${minutes}m`;
    }

    function getCooldownUntilMs(requestData) {
      if (!requestData || requestData.status !== "denied" || !requestData.updatedAt) return 0;
      return requestData.updatedAt.toDate().getTime() + FRIEND_REQUEST_COOLDOWN_MS;
    }

    function getAuthErrorMessage(code) {
      if (code === "auth/email-already-in-use") return "Email already used";
      if (code === "auth/weak-password") return "Password too weak";
      if (code === "auth/invalid-email") return "Invalid email";
      if (code === "auth/invalid-credential") return "Wrong email or password";
      if (code === "auth/missing-password") return "Please enter your password";
      if (code === "auth/user-disabled") return "This account is disabled";
      return "Something went wrong";
    }

    function updateThemeButton() {
      const isDark = document.body.classList.contains("dark");
      themeToggleBtn.innerText = isDark ? "Light Mode" : "Dark Mode";
    }

    function renderEmojiPicker() {
      emojiPicker.innerHTML = "";
      emojiList.forEach((emoji) => {
        emojiPicker.innerHTML += `<button class="emojiBtn" type="button" onclick="addEmoji('${emoji}')">${emoji}</button>`;
      });
    }

    renderEmojiPicker();

    function updateProfileUI() {
      welcomeText.innerText = "Welcome " + (currentProfile.username || currentUser.email);
      profileSummary.innerText = currentProfile.bio || "No bio yet";

      profileUsernameInput.value = currentProfile.username || "";
      profileBioInput.value = currentProfile.bio || "";
      profileAvatarUrlInput.value = currentProfile.avatarUrl || "";
      selectedProfileColor = currentProfile.color || "#3b82f6";
      updateSelectedColorUI();
    }

    function updateSelectedColorUI() {
      document.querySelectorAll(".colorChoice").forEach((button) => {
        if (button.dataset.color === selectedProfileColor) {
          button.classList.add("active");
        } else {
          button.classList.remove("active");
        }
      });
    }

    function closeFloatingPanels() {
      activeFloatingPanel = "";
      notificationsPanelOpen = false;
      requestPanel.style.display = "none";
      privatePanel.style.display = "none";
      notificationPanel.style.display = "none";
      updateFloatingPanelButtons();
    }
    window.closeFloatingPanels = closeFloatingPanels;

    function updateFloatingPanelButtons() {
      friendsButton.classList.toggle("active", activeFloatingPanel === "friends");
      requestsButton.classList.toggle("active", activeFloatingPanel === "requests");
      notificationsButton.classList.toggle("active", activeFloatingPanel === "notifications");
    }

    function refreshFloatingPanels() {
      const shouldShowRequests = activeFloatingPanel === "requests" && !!currentUser;
      const shouldShowFriends = activeFloatingPanel === "friends" && !!currentUser;
      const shouldShowNotifications = activeFloatingPanel === "notifications" && !!currentUser;
      requestPanel.style.display = shouldShowRequests ? "block" : "none";
      privatePanel.style.display = shouldShowFriends ? "block" : "none";
      notificationPanel.style.display = shouldShowNotifications ? "block" : "none";
      notificationsPanelOpen = shouldShowNotifications;
      updateFloatingPanelButtons();
    }

    function getPrivateMessageState(message) {
      const seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
      const deliveredTo = Array.isArray(message.deliveredTo) ? message.deliveredTo : [];
      const targetSeen = seenBy.some((uid) => uid !== currentUser?.uid);
      const targetDelivered = deliveredTo.some((uid) => uid !== currentUser?.uid);
      if (targetSeen) return { label: "Seen", className: "seen" };
      if (targetDelivered) return { label: "Delivered", className: "delivered" };
      return { label: "Sent", className: "sent" };
    }

    async function markMessagesAsDelivered() {
      if (!currentUser || activeChatMode !== "private" || !activePrivateChatUserId) return;
      for (const message of privateMessagesCache) {
        if (!message.id || message.userId === currentUser.uid) continue;
        const deliveredTo = Array.isArray(message.deliveredTo) ? message.deliveredTo : [];
        if (deliveredTo.includes(currentUser.uid)) continue;
        try {
          await updateDoc(doc(db, "privateChats", getPrivateChatId(currentUser.uid, activePrivateChatUserId), "messages", message.id), {
            deliveredTo: [...deliveredTo, currentUser.uid]
          });
        } catch (error) {
          console.log("Delivered update skipped");
        }
      }
    }

    function updateNotificationBadge() {
      const unreadNotifications = notificationsCache.filter((item) => !item.isRead).length;
      const totalBadgeCount = unreadNotifications + globalUnreadCount;

      notificationBadge.innerText = totalBadgeCount > 99 ? "99+" : String(totalBadgeCount);
      notificationBadge.style.display = totalBadgeCount > 0 ? "flex" : "none";

      let metaParts = [];
      if (globalUnreadCount > 0) {
        metaParts.push(`Group unread: ${globalUnreadCount}`);
      }
      if (unreadNotifications > 0) {
        metaParts.push(`Alerts unread: ${unreadNotifications}`);
      }
      notificationMeta.innerText = metaParts.length > 0 ? metaParts.join(" • ") : "You're all caught up";
    }

    function renderNotifications() {
      notificationList.innerHTML = "";
      const unreadItems = notificationsCache
        .filter((item) => !item.isRead)
        .sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
          return bTime - aTime;
        });

      if (unreadItems.length === 0) {
        notificationList.innerHTML = `<div class="smallNote">No unread notifications</div>`;
        updateNotificationBadge();
        return;
      }

      unreadItems.forEach((item) => {
        notificationList.innerHTML += `
          <div class="notificationCard unread" onclick="openNotification('${item.id}')" role="button" tabindex="0">
            <div class="notificationText">${escapeHtml(item.text || "New activity")}</div>
            <div class="notificationTime">${formatDateTime(item.createdAt)}</div>
          </div>
        `;
      });

      updateNotificationBadge();
      refreshFloatingPanels();
    }

    function renderRequestPanel() {
      if (!currentUser) {
        requestList.innerHTML = "";
        refreshFloatingPanels();
        return;
      }

      requestList.innerHTML = "";

      if (incomingRequests.length === 0) {
        requestList.innerHTML = `<div class="smallNote">No pending friend requests</div>`;
        refreshFloatingPanels();
        return;
      }

      incomingRequests.forEach((request) => {
        const sender = usersMap[request.fromUserId] || {};
        const name = sender.username || sender.email || "Unknown user";
        const bio = sender.bio || "No bio yet";

        requestList.innerHTML += `
          <div class="requestCard">
            <div class="requestName">${name}</div>
            <div class="requestMeta">${bio}</div>
            <div class="requestButtons">
              <button class="acceptBtn" onclick="acceptFriendRequest('${request.id}')">Accept</button>
              <button class="denyBtn" onclick="denyFriendRequest('${request.id}')">Deny</button>
            </div>
          </div>
        `;
      });
      refreshFloatingPanels();
    }

    function getFriendUserIds() {
      return Object.keys(friendStatusMap).filter((userId) => friendStatusMap[userId].state === "friends");
    }

    function renderFriendList() {
      if (!currentUser) {
        friendList.innerHTML = "";
        refreshFloatingPanels();
        return;
      }

      const friendIds = getFriendUserIds();

      if (friendIds.length === 0) {
        friendList.innerHTML = `<div class="smallNote">No friends yet. Accept a request first.</div>`;
        refreshFloatingPanels();
        return;
      }

      friendList.innerHTML = "";

      friendIds.forEach((friendUserId) => {
        const friend = usersMap[friendUserId] || {};
        const isActive = activePrivateChatUserId === friendUserId;
        const name = friend.username || friend.email || "Unknown user";
        const bio = friend.bio || "No bio yet";
        const onlineText = isUserOnline(friend.lastActive) ? "Online now" : "Offline";
        const selectedText = isActive ? "Opened" : "Open Chat";

        friendList.innerHTML += `
          <div class="friendCard">
            <div class="friendName">${name}</div>
            <div class="friendMeta">${bio} • ${onlineText}</div>
            <div class="friendButtons">
              <button class="messageFriendBtn" onclick="openPrivateChat('${friendUserId}')" type="button">${selectedText}</button>
              <button class="removeFriendBtn" onclick="removeFriend('${friendUserId}')" type="button">Remove Friend</button>
            </div>
          </div>
        `;
      });
      refreshFloatingPanels();
    }

    function updateChatModeUI() {
      const isGlobal = activeChatMode === "global";
      globalModeButton.classList.toggle("active", isGlobal);
      privateModeButton.classList.toggle("active", !isGlobal);

      if (isGlobal) {
        chatModeTitle.innerText = "Global chat room";
        messageInput.placeholder = "Message";
        closePrivateChatButton.style.display = "none";
      } else {
        hideMentionSuggestions();
        typingBar.innerText = "";
        const targetUser = usersMap[activePrivateChatUserId] || {};
        const targetName = targetUser.username || targetUser.email || "Select a friend";
        chatModeTitle.innerText = activePrivateChatUserId ? `Private chat with ${targetName}` : "Private chat";
        messageInput.placeholder = activePrivateChatUserId ? `Message ${targetName}` : "Select a friend first";
        closePrivateChatButton.style.display = activePrivateChatUserId ? "inline-flex" : "none";
      }

      renderRequestPanel();
      renderFriendList();
      renderMessages();
    }

    async function loadCurrentUserProfile(user) {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userData = userSnap.data();
        currentProfile = {
          username: userData.username || user.email,
          bio: userData.bio || "",
          avatarUrl: userData.avatarUrl || "",
          color: userData.color || "#3b82f6"
        };
      } else {
        currentProfile = {
          username: user.email,
          bio: "",
          avatarUrl: "",
          color: "#3b82f6"
        };
      }

      updateProfileUI();
      renderMessages();
    }

    async function touchCurrentUser() {
      if (!currentUser) return;

      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          lastActive: serverTimestamp()
        });
      } catch (error) {
        console.log("Heartbeat skipped");
      }
    }

    function startOnlineHeartbeat() {
      stopOnlineHeartbeat();
      touchCurrentUser();
      onlineHeartbeat = setInterval(() => {
        touchCurrentUser();
      }, 20000);
    }

    function stopOnlineHeartbeat() {
      if (onlineHeartbeat) {
        clearInterval(onlineHeartbeat);
        onlineHeartbeat = null;
      }
    }

    function getAvatarHtml(name, avatarUrl, color, online) {
      if (avatarUrl && avatarUrl.trim()) {
        return `
          <div class="avatarWrap">
            <div class="avatar" style="border-color:${color || "#6b7280"};">
              <img src="${avatarUrl}" alt="avatar" onerror="this.parentElement.innerHTML='${getInitial(name)}'; this.parentElement.style.background='${color || "#6b7280"}';">
            </div>
            ${online ? `<div class="onlineDot"></div>` : ""}
          </div>
        `;
      }

      return `
        <div class="avatarWrap">
          <div class="avatar" style="background:${color || "#6b7280"}; border-color:${color || "#6b7280"};">
            ${getInitial(name)}
          </div>
          ${online ? `<div class="onlineDot"></div>` : ""}
        </div>
      `;
    }

    function getRelationButtonHtml(targetUserId, isMine) {
      if (isMine || !currentUser || !targetUserId || activeChatMode !== "global") return "";

      const relation = friendStatusMap[targetUserId];

      if (!relation) {
        return `<button class="friendBtn" onclick="sendFriendRequest('${targetUserId}')" type="button">Add Friend</button>`;
      }

      if (relation.state === "friends") {
        return `
          <button class="friendBtn friendAdded" type="button" onclick="openPrivateChat('${targetUserId}')">
            Message
          </button>
        `;
      }

      if (relation.state === "outgoing-pending") {
        return `<button class="friendBtn pending" type="button" disabled>Pending</button>`;
      }

      if (relation.state === "incoming-pending") {
        return `<button class="friendBtn pending" type="button" disabled>Requested You</button>`;
      }

      if (relation.state === "denied") {
        if (relation.canRetryNow) {
          return `<button class="friendBtn" onclick="sendFriendRequest('${targetUserId}')" type="button">Request Again</button>`;
        }

        return `<button class="friendBtn denied" type="button" disabled>${relation.cooldownText || "Denied"}</button>`;
      }

      return `<button class="friendBtn" onclick="sendFriendRequest('${targetUserId}')" type="button">Add Friend</button>`;
    }

    async function markGlobalMessagesAsSeen() {
      if (!currentUser || document.visibilityState !== "visible") return;
      for (const message of globalMessagesCache) {
        if (!message.id || message.userId === currentUser.uid) continue;
        const seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
        if (seenBy.includes(currentUser.uid)) continue;
        const seenKey = `global_${message.id}`;
        if (seenUpdateInProgress.has(seenKey)) continue;
        seenUpdateInProgress.add(seenKey);
        try {
          await updateDoc(doc(db, "messages", message.id), {
            seenBy: [...seenBy, currentUser.uid]
          });
        } catch (error) {
          console.log("Seen update skipped");
        }
        seenUpdateInProgress.delete(seenKey);
      }
    }

    async function markMessagesAsSeen() {
      if (!currentUser || document.visibilityState !== "visible") return;

      const activeMessages = activeChatMode === "global" ? globalMessagesCache : privateMessagesCache;
      if (activeChatMode === "private") {
        await markMessagesAsDelivered();
      }
      if (activeChatMode === "global") {
        await markGlobalMessagesAsSeen();
        return;
      }
      const collectionPath = activeChatMode === "global"
        ? ["messages"]
        : ["privateChats", getPrivateChatId(currentUser.uid, activePrivateChatUserId), "messages"];

      if (activeChatMode === "private" && !activePrivateChatUserId) return;

      for (const message of activeMessages) {
        if (!message.id) continue;
        if (message.userId === currentUser.uid) continue;

        const seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
        if (seenBy.includes(currentUser.uid)) continue;

        const seenKey = `${activeChatMode}_${message.id}`;
        if (seenUpdateInProgress.has(seenKey)) continue;
        seenUpdateInProgress.add(seenKey);

        try {
          await updateDoc(doc(db, ...collectionPath, message.id), {
            seenBy: [...seenBy, currentUser.uid]
          });
        } catch (error) {
          console.log("Seen update skipped");
        }

        seenUpdateInProgress.delete(seenKey);
      }
    }

    function renderMessages() {
      chat.innerHTML = "";

      globalUnreadCount = globalMessagesCache.filter((message) => {
        if (!currentUser) return false;
        if (message.userId === currentUser.uid) return false;
        const seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
        return !seenBy.includes(currentUser.uid);
      }).length;
      updateNotificationBadge();

      const activeMessages = activeChatMode === "global" ? globalMessagesCache : privateMessagesCache;

      if (activeChatMode === "private" && !activePrivateChatUserId) {
        chat.innerHTML = `<div class="smallNote">Choose a friend to start private chat</div>`;
        return;
      }

      if (activeMessages.length === 0) {
        chat.innerHTML = `<div class="smallNote">No messages yet</div>`;
        return;
      }

      activeMessages.forEach((m) => {
        const isMine = currentUser && (
          m.userId === currentUser.uid ||
          m.userEmail === currentUser.email ||
          m.user === currentUser.email
        );

        const userData = usersMap[m.userId] || {};
        const displayName = m.username || userData.username || m.user || m.userEmail || "Unknown";
        const displayAvatar = m.avatarUrl || userData.avatarUrl || "";
        const displayColor = m.color || userData.color || "#6b7280";
        const displayOnline = m.userId ? isUserOnline(userData.lastActive) : false;
        const privateState = activeChatMode === "private" && isMine ? getPrivateMessageState(m) : null;

        chat.innerHTML += `
          <div class="messageRow ${isMine ? "myRow" : "otherRow"}">
            <div class="messageWrap ${isMine ? "myWrap" : "otherWrap"}">
              ${getAvatarHtml(displayName, displayAvatar, displayColor, displayOnline)}

              <div>
                <div class="message ${isMine ? "myMessage" : "otherMessage"}">
                  <div class="messageMeta ${isMine ? "myMeta" : "otherMeta"}">
                    <span style="color:${displayColor}; font-weight:bold;">${displayName}</span>
                    <span>•</span>
                    <span>${formatTime(m.createdAt)}</span>
                    ${activeChatMode === "global" ? getRelationButtonHtml(m.userId, isMine) : ""}
                  </div>
                  <div>${renderMessageText(m.text)}</div>
                </div>
                ${privateState ? `<div class="statusPill ${privateState.className}">${privateState.label}</div>` : ``}
              </div>
            </div>
          </div>
        `;
      });

      chat.scrollTop = chat.scrollHeight;
      markMessagesAsSeen();
    }

    function subscribeToPrivateMessages() {
      if (unsubscribePrivateMessages) {
        unsubscribePrivateMessages();
        unsubscribePrivateMessages = null;
      }

      privateMessagesCache = [];

      if (!currentUser || !activePrivateChatUserId) {
        renderMessages();
        return;
      }

      const privateChatId = getPrivateChatId(currentUser.uid, activePrivateChatUserId);
      const privateMessagesQuery = query(
        collection(db, "privateChats", privateChatId, "messages"),
        orderBy("createdAt", "asc")
      );

      unsubscribePrivateMessages = onSnapshot(privateMessagesQuery, async (snapshot) => {
        privateMessagesCache = [];
        snapshot.forEach((messageDoc) => {
          privateMessagesCache.push({
            id: messageDoc.id,
            ...messageDoc.data()
          });
        });

        renderMessages();
        await markMessagesAsDelivered();
      });
    }

    onSnapshot(collection(db, "users"), (snapshot) => {
      usersMap = {};
      let count = 0;

      snapshot.forEach((userDoc) => {
        const userData = userDoc.data();
        usersMap[userDoc.id] = userData;

        if (isUserOnline(userData.lastActive)) {
          count++;
        }
      });

      onlineCount.innerText = `${count} user${count === 1 ? "" : "s"} online`;
      renderMessages();
      renderRequestPanel();
      renderFriendList();
      updateChatModeUI();
      updateMentionSuggestions();
    });

    onSnapshot(collection(db, "notifications"), (snapshot) => {
      notificationsCache = [];

      snapshot.forEach((notificationDoc) => {
        const data = notificationDoc.data();
        if (!currentUser || data.toUserId !== currentUser.uid) return;

        notificationsCache.push({
          id: notificationDoc.id,
          ...data
        });
      });

      renderNotifications();
    });

    onSnapshot(collection(db, "typingStatus"), (snapshot) => {
      typingUsersCache = [];

      snapshot.forEach((typingDoc) => {
        const data = typingDoc.data();
        if (!currentUser) return;
        if (data.userId === currentUser.uid) return;
        if (!data.isTyping) return;
        typingUsersCache.push(data.username || "Someone");
      });

      if (activeChatMode !== "global") {
        typingBar.innerText = "";
      } else if (typingUsersCache.length === 0) {
        typingBar.innerText = "";
      } else if (typingUsersCache.length === 1) {
        typingBar.innerText = `${typingUsersCache[0]} is typing...`;
      } else {
        typingBar.innerText = `${typingUsersCache.slice(0, 2).join(", ")} are typing...`;
      }
    });

    onSnapshot(collection(db, "friendRequests"), (snapshot) => {
      friendStatusMap = {};
      incomingRequests = [];

      if (!currentUser) {
        renderMessages();
        renderRequestPanel();
        renderFriendList();
        return;
      }

      snapshot.forEach((requestDoc) => {
        const data = requestDoc.data();

        if (!data.fromUserId || !data.toUserId) return;

        const involvesCurrentUser =
          data.fromUserId === currentUser.uid || data.toUserId === currentUser.uid;

        if (!involvesCurrentUser) return;

        const otherUserId =
          data.fromUserId === currentUser.uid ? data.toUserId : data.fromUserId;

        if (data.status === "accepted") {
          friendStatusMap[otherUserId] = {
            state: "friends",
            requestId: requestDoc.id
          };
        } else if (data.status === "pending") {
          if (data.fromUserId === currentUser.uid) {
            friendStatusMap[otherUserId] = {
              state: "outgoing-pending",
              requestId: requestDoc.id
            };
          } else {
            friendStatusMap[otherUserId] = {
              state: "incoming-pending",
              requestId: requestDoc.id
            };

            incomingRequests.push({
              id: requestDoc.id,
              fromUserId: data.fromUserId,
              toUserId: data.toUserId
            });
          }
        } else if (data.status === "denied") {
          if (data.fromUserId === currentUser.uid) {
            const cooldownUntilMs = getCooldownUntilMs(data);
            friendStatusMap[otherUserId] = {
              state: "denied",
              requestId: requestDoc.id,
              canRetryNow: cooldownUntilMs <= Date.now(),
              cooldownText: getRemainingCooldownText(cooldownUntilMs)
            };
          }
        }
      });

      if (activePrivateChatUserId) {
        const relation = friendStatusMap[activePrivateChatUserId];
        if (!relation || relation.state !== "friends") {
          activePrivateChatUserId = "";
          privateMessagesCache = [];
          subscribeToPrivateMessages();
        }
      }

      renderMessages();
      renderRequestPanel();
      renderFriendList();
      updateChatModeUI();
      updateMentionSuggestions();
    });

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        authSection.style.display = "none";
        chatSection.style.display = "block";
        authMessage.innerText = "";
        activeChatMode = "global";
        activePrivateChatUserId = "";
        await loadCurrentUserProfile(user);
        startOnlineHeartbeat();
        updateChatModeUI();
        messageInput.focus();
      } else {
        currentUser = null;
        stopOnlineHeartbeat();
        if (unsubscribePrivateMessages) {
          unsubscribePrivateMessages();
          unsubscribePrivateMessages = null;
        }
        friendStatusMap = {};
        incomingRequests = [];
        globalMessagesCache = [];
        privateMessagesCache = [];
        activeChatMode = "global";
        activePrivateChatUserId = "";
        currentProfile = {
          username: "",
          bio: "",
          avatarUrl: "",
          color: "#3b82f6"
        };
        authSection.style.display = "block";
        chatSection.style.display = "none";
        authMessage.innerText = "";
        loginEmailInput.value = "";
        loginPasswordInput.value = "";
        registerUsernameInput.value = "";
        registerEmailInput.value = "";
        registerPasswordInput.value = "";
        profileEditor.style.display = "none";
        closeFloatingPanels();
        emojiPicker.style.display = "none";
        hideMentionSuggestions();
        typingBar.innerText = "";
        notificationsCache = [];
        notificationsPanelOpen = false;
        globalUnreadCount = 0;
        renderNotifications();
      }
    });

    window.register = async function () {
      const username = registerUsernameInput.value.trim();
      const email = registerEmailInput.value.trim();
      const password = registerPasswordInput.value;

      if (!username) {
        authMessage.innerText = "Please enter a username";
        return;
      }

      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        await setDoc(doc(db, "users", userCredential.user.uid), {
          username: username,
          email: email,
          bio: "",
          avatarUrl: "",
          color: "#3b82f6",
          createdAt: serverTimestamp(),
          lastActive: serverTimestamp()
        });

        authMessage.innerText = "Account created";
      } catch (err) {
        authMessage.innerText = getAuthErrorMessage(err.code);
      }
    };

    window.login = function () {
      signInWithEmailAndPassword(auth, loginEmailInput.value.trim(), loginPasswordInput.value)
        .then(() => {
          authMessage.innerText = "Logged in";
        })
        .catch((err) => {
          authMessage.innerText = getAuthErrorMessage(err.code);
        });
    };

    window.logout = async function () {
      stopOnlineHeartbeat();
      await setTypingStatus(false);

      if (currentUser) {
        try {
          await updateDoc(doc(db, "users", currentUser.uid), {
            lastActive: serverTimestamp()
          });
        } catch (error) {
          console.log("Logout status update skipped");
        }
      }

      signOut(auth).then(() => {
        authMessage.innerText = "";
      });
    };

    window.sendFriendRequest = async function (targetUserId) {
      if (!currentUser || !targetUserId) return;

      if (targetUserId === currentUser.uid) {
        alert("You cannot add yourself");
        return;
      }

      const relation = friendStatusMap[targetUserId];
      if (relation && relation.state === "friends") {
        alert("Already friends ✅");
        return;
      }

      if (relation && relation.state === "outgoing-pending") {
        alert("Friend request already pending ⏳");
        return;
      }

      if (relation && relation.state === "incoming-pending") {
        alert("They already requested you. Accept it from requests.");
        return;
      }

      if (relation && relation.state === "denied" && !relation.canRetryNow) {
        alert(relation.cooldownText || "You can request again in 24 hours");
        return;
      }

      const requestId = getRequestDocId(currentUser.uid, targetUserId);

      try {
        await setDoc(doc(db, "friendRequests", requestId), {
          fromUserId: currentUser.uid,
          toUserId: targetUserId,
          status: "pending",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          deniedByUserId: null
        }, { merge: true });

        await createNotification(targetUserId, "friend_request", `${currentProfile.username || currentUser.email} sent you a friend request`);
        alert("Friend request sent ✅");
      } catch (error) {
        alert("Could not send request");
      }
    };

    window.acceptFriendRequest = async function (requestId) {
      try {
        const request = incomingRequests.find((item) => item.id === requestId);
        await updateDoc(doc(db, "friendRequests", requestId), {
          status: "accepted",
          updatedAt: serverTimestamp()
        });
        if (request?.fromUserId) {
          await createNotification(request.fromUserId, "friend_accept", `${currentProfile.username || currentUser.email} accepted your friend request`);
        }
      } catch (error) {
        alert("Could not accept request");
      }
    };

    window.denyFriendRequest = async function (requestId) {
      try {
        await updateDoc(doc(db, "friendRequests", requestId), {
          status: "denied",
          deniedByUserId: currentUser ? currentUser.uid : null,
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        alert("Could not deny request");
      }
    };

    window.removeFriend = async function (targetUserId) {
      if (!currentUser || !targetUserId) return;

      const relation = friendStatusMap[targetUserId];
      if (!relation || relation.state !== "friends") {
        alert("That user is not in your friends list");
        return;
      }

      const confirmed = confirm("Remove this friend?");
      if (!confirmed) return;

      try {
        await deleteDoc(doc(db, "friendRequests", relation.requestId));
        if (activePrivateChatUserId === targetUserId) {
          activePrivateChatUserId = "";
          privateMessagesCache = [];
          subscribeToPrivateMessages();
          updateChatModeUI();
        }
      } catch (error) {
        alert("Could not remove friend");
      }
    };

    window.toggleFloatingPanel = async function (panelName) {
      activeFloatingPanel = activeFloatingPanel === panelName ? "" : panelName;
      refreshFloatingPanels();

      if (activeFloatingPanel === "notifications") {
        await markAllNotificationsRead();
      }
    };

    window.markAllNotificationsRead = async function () {
      const unreadItems = notificationsCache.filter((item) => !item.isRead);
      notificationsCache = notificationsCache.map((item) => ({ ...item, isRead: true }));
      renderNotifications();
      await markGlobalMessagesAsSeen();
      for (const item of unreadItems) {
        await markNotificationRead(item.id);
      }
      renderNotifications();
    };

    window.openNotification = async function (notificationId) {
      if (notificationId) {
        notificationsCache = notificationsCache.map((item) => item.id === notificationId ? { ...item, isRead: true } : item);
        renderNotifications();
        await markNotificationRead(notificationId);
      }
      chat.scrollTop = chat.scrollHeight;
    };

    window.toggleProfileEditor = function () {
      const willOpen = profileEditor.style.display !== "block";
      if (willOpen) {
        closeFloatingPanels();
      }
      profileEditor.style.display = willOpen ? "block" : "none";
    };

    window.selectProfileColor = function (color) {
      selectedProfileColor = color;
      updateSelectedColorUI();
    };

    window.saveProfile = async function () {
      if (!currentUser) return;

      const username = profileUsernameInput.value.trim();
      const bio = profileBioInput.value.trim();
      const avatarUrl = profileAvatarUrlInput.value.trim();

      if (!username) {
        alert("Username cannot be empty");
        return;
      }

      await setDoc(doc(db, "users", currentUser.uid), {
        username: username,
        email: currentUser.email,
        bio: bio,
        avatarUrl: avatarUrl,
        color: selectedProfileColor,
        lastActive: serverTimestamp()
      }, { merge: true });

      currentProfile = {
        username,
        bio,
        avatarUrl,
        color: selectedProfileColor
      };

      updateProfileUI();
      renderMessages();
      profileEditor.style.display = "none";
    };

    window.togglePassword = function (inputId) {
      const input = document.getElementById(inputId);
      input.type = input.type === "password" ? "text" : "password";
    };

    window.toggleDarkMode = function () {
      document.body.classList.toggle("dark");
      const isDark = document.body.classList.contains("dark");
      localStorage.setItem("darkMode", isDark ? "on" : "off");
      updateThemeButton();
    };

    if (localStorage.getItem("darkMode") === "on") {
      document.body.classList.add("dark");
    }
    updateThemeButton();

    window.toggleEmojiPicker = function () {
      emojiPicker.style.display = emojiPicker.style.display === "flex" ? "none" : "flex";
    };

    window.addEmoji = function (emoji) {
      messageInput.value += emoji;
      updateMentionSuggestions();
      messageInput.focus();
    };

    window.insertMention = function (handle) {
      const currentValue = messageInput.value;
      messageInput.value = currentValue.replace(/(^|\s)@([a-zA-Z0-9_]*)$/, `$1@${handle} `);
      hideMentionSuggestions();
      messageInput.focus();
    };

    window.switchChatMode = function (mode) {
      activeChatMode = mode === "private" ? "private" : "global";
      updateChatModeUI();

      if (activeChatMode === "private") {
        subscribeToPrivateMessages();
      }

      updateMentionSuggestions();
      messageInput.focus();
    };

    window.closePrivateChat = function () {
      activePrivateChatUserId = "";
      privateMessagesCache = [];
      activeChatMode = "global";
      updateChatModeUI();
      closeFloatingPanels();
      messageInput.blur();
    };

    window.openPrivateChat = function (targetUserId) {
      const relation = friendStatusMap[targetUserId];
      if (!relation || relation.state !== "friends") {
        alert("Only friends can use private chat");
        return;
      }

      activePrivateChatUserId = targetUserId;
      activeChatMode = "private";
      closeFloatingPanels();
      updateChatModeUI();
      subscribeToPrivateMessages();
      messageInput.focus();
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        markMessagesAsSeen();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeFloatingPanels();
        profileEditor.style.display = "none";
        emojiPicker.style.display = "none";
        hideMentionSuggestions();
      }
    });

    loginEmailInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") login();
    });

    loginPasswordInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") login();
    });

    registerUsernameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") register();
    });

    registerEmailInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") register();
    });

    registerPasswordInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") register();
    });

    window.sendMessage = async function () {
      const textValue = messageInput.value.trim();
      if (!textValue || !currentUser) return;

      await touchCurrentUser();
      await setTypingStatus(false);

      if (activeChatMode === "global") {
        const mentionedUsers = getMentionedUsersFromText(textValue);

        await addDoc(collection(db, "messages"), {
          text: textValue,
          userId: currentUser.uid,
          userEmail: currentUser.email,
          username: currentProfile.username || currentUser.email,
          avatarUrl: currentProfile.avatarUrl || "",
          color: currentProfile.color || "#3b82f6",
          createdAt: serverTimestamp(),
          seenBy: [currentUser.uid],
          mentionUserIds: mentionedUsers.map((item) => item.userId)
        });

        for (const mentionedUser of mentionedUsers) {
          await createNotification(
            mentionedUser.userId,
            "mention",
            `${currentProfile.username || currentUser.email} mentioned you in group chat`
          );
        }
      } else {
        if (!activePrivateChatUserId) {
          alert("Select a friend first");
          return;
        }

        const relation = friendStatusMap[activePrivateChatUserId];
        if (!relation || relation.state !== "friends") {
          alert("Private chat is only for friends");
          return;
        }

        const privateChatId = getPrivateChatId(currentUser.uid, activePrivateChatUserId);

        await setDoc(doc(db, "privateChats", privateChatId), {
          members: [currentUser.uid, activePrivateChatUserId],
          updatedAt: serverTimestamp()
        }, { merge: true });

        await addDoc(collection(db, "privateChats", privateChatId, "messages"), {
          text: textValue,
          userId: currentUser.uid,
          userEmail: currentUser.email,
          username: currentProfile.username || currentUser.email,
          avatarUrl: currentProfile.avatarUrl || "",
          color: currentProfile.color || "#3b82f6",
          createdAt: serverTimestamp(),
          seenBy: [currentUser.uid]
        });

        await createNotification(
          activePrivateChatUserId,
          "private_message",
          `${currentProfile.username || currentUser.email} sent you a private message`
        );
      }

      messageInput.value = "";
      hideMentionSuggestions();
      messageInput.focus();
    };

    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendMessage();
      }
    });

    messageInput.addEventListener("input", () => {
      updateMentionSuggestions();
      if (typingStopTimer) {
        clearTimeout(typingStopTimer);
      }

      if (messageInput.value.trim()) {
        setTypingStatus(true);
        typingStopTimer = setTimeout(() => {
          setTypingStatus(false);
        }, 1500);
      } else {
        setTypingStatus(false);
      }
    });

    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideMentionSuggestions();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && currentUser) {
        touchCurrentUser();
        markMessagesAsSeen();
      } else {
        setTypingStatus(false);
      }
    });

    const q = query(collection(db, "messages"), orderBy("createdAt", "asc"));

    onSnapshot(q, (snapshot) => {
      globalMessagesCache = [];
      snapshot.forEach((messageDoc) => {
        globalMessagesCache.push({
          id: messageDoc.id,
          ...messageDoc.data()
        });
      });

      renderMessages();
    });
