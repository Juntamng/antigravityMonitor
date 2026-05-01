/**
 * auth.js — Popup auth UI (email/password + Google via background)
 */
(function () {
  const authSection = () => document.getElementById("auth-section");
  const appMain = () => document.getElementById("app-main");

  async function sendMsg(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        resolve(resp);
      });
    });
  }

  function showError(msg) {
    const el = document.getElementById("auth-error");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  }

  function setLoggedInUI(email) {
    authSection()?.classList.add("hidden");
    appMain()?.classList.remove("hidden");
    const label = document.getElementById("user-email");
    if (label) {
      label.textContent = email || "";
      label.title = email || "";
    }
  }

  function setLoggedOutUI() {
    authSection()?.classList.remove("hidden");
    appMain()?.classList.add("hidden");
  }

  window.PageMonitorAuth = {
    async init() {
      const state = await sendMsg("GET_AUTH_STATE");
      if (state?.error) {
        showError(state.error);
        setLoggedOutUI();
        return false;
      }
      if (state?.authenticated) {
        setLoggedInUI(state.email);
        return true;
      }
      setLoggedOutUI();
      return false;
    },

    bindAuthForm() {
      const emailEl = document.getElementById("auth-email");
      const passEl = document.getElementById("auth-password");
      const loginBtn = document.getElementById("auth-login-btn");
      const googleBtn = document.getElementById("auth-google-btn");
      const logoutBtn = document.getElementById("logout-btn");

      loginBtn?.addEventListener("click", async () => {
        showError("");
        const email = emailEl?.value?.trim();
        const password = passEl?.value || "";
        if (!email || !password) {
          showError("Enter email and password.");
          return;
        }
        loginBtn.disabled = true;
        loginBtn.textContent = "Signing in…";
        try {
          const res = await sendMsg("LOGIN", { email, password });
          if (res?.error) throw new Error(res.error);
          setLoggedInUI(res.email);
          passEl.value = "";
          window.dispatchEvent(new CustomEvent("page-monitor:auth-changed"));
        } catch (e) {
          showError(e.message || "Login failed");
        } finally {
          loginBtn.disabled = false;
          loginBtn.textContent = "Sign in";
        }
      });

      googleBtn?.addEventListener("click", async () => {
        showError("");
        googleBtn.disabled = true;
        googleBtn.textContent = "Opening Google…";
        try {
          const res = await sendMsg("GOOGLE_LOGIN");
          if (res?.error) throw new Error(res.error);
          setLoggedInUI(res.email);
          window.dispatchEvent(new CustomEvent("page-monitor:auth-changed"));
        } catch (e) {
          showError(e.message || "Google login failed");
        } finally {
          googleBtn.disabled = false;
          googleBtn.textContent = "Continue with Google";
        }
      });

      logoutBtn?.addEventListener("click", async () => {
        await sendMsg("LOGOUT");
        setLoggedOutUI();
        window.dispatchEvent(new CustomEvent("page-monitor:auth-changed"));
      });
    },
  };
})();
