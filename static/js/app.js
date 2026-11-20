/**
 * Sawasdee Rental - High-Speed SPA Application Logic
 */
var isRent = false;

class App {
  constructor() {
    let savedUser = null;
    try {
      // Clear legacy persistent localStorage user so new visits always require login
      localStorage.removeItem("sawasdee_user");
      // Check 6-hour session timeout (6 * 60 * 60 * 1000 ms)
      const loginTime = parseInt(sessionStorage.getItem("sawasdee_login_time") || "0", 10);
      const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000;
      if (loginTime && (Date.now() - loginTime > SESSION_TIMEOUT_MS)) {
        sessionStorage.removeItem("sawasdee_user");
        sessionStorage.removeItem("sawasdee_login_time");
        savedUser = null;
      } else {
        // Use sessionStorage so credentials persist only within active browser session/tab
        savedUser = JSON.parse(sessionStorage.getItem("sawasdee_user") || "null");
      }
    } catch (e) {
      savedUser = null;
    }
    this.user = savedUser;

    this.cars = [];
    this.customers = [];
    this.bookings = [];
    this.backofficeJobs = [];
    this.completedJobs = [];
    this.users = [];
    this.maintenanceRecords = [];
    this.activeModule = "frontoffice";
    this.activeTab = "fleet";
    this.uploadedPhotos = [];
    this.currentSelectedBooking = null;
    // Search and Dashboard Charts State
    this.sidebarSearchKw = "";
    this.donutCharts = {};
    this.trendChart = null;
    this.trendMetric = "rev";
    this.selectedTrendCompanies = ["Sawasdee Rent A Car", "P.D.P. Co., Ltd.", "Sawasdee Car Rent"];

    // Modal & Selection State Management
    this.selectedVehicle = null;
    this.isModalOpen = false;

    // Dashboard Tables Collapsible Accordion State
    this.isTableCollapsed = {
      "expander-shift-closing": false,
      "expander-fleet": false,
      "expander-monthly-expenses": false,
      "expander-completed": true
    };

    if (typeof this.initLanguage === "function") {
      this.init();
    } else if (typeof document !== "undefined" && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init(), { once: true });
    } else {
      setTimeout(() => this.init(), 0);
    }
  }

  async init() {
    const dismissSplash = () => {
      const splash = document.getElementById("app-splash-screen");
      if (splash) {
        if (!splash.classList.contains("fade-out")) {
          splash.classList.add("fade-out");
        }
        setTimeout(() => {
          if (splash) splash.style.display = "none";
        }, 500);
      }
    };

    // Absolute fallback: never leave splash hanging beyond 2.5 seconds under any circumstance
    const fallbackTimer = setTimeout(() => {
      dismissSplash();
    }, 2500);

    try {
      try { this.initGlobalEnterKeyNavigation(); } catch (e) { console.warn("EnterKeyNav err:", e); }
      try { this.initLanguage(); } catch (e) { console.warn("InitLang err:", e); }
      try { this.setupDatePickers(); } catch (e) { console.warn("DatePickers err:", e); }
      try { this.updateAuthUI(); } catch (e) { console.warn("UpdateAuthUI err:", e); }

      document.addEventListener("click", (e) => {
        const bookCustWrapper = document.getElementById("book-cust-searchable-wrapper");
        if (bookCustWrapper && !bookCustWrapper.contains(e.target)) {
          const menu = document.getElementById("book-cust-dropdown-menu");
          if (menu && menu.style.display === "block") {
            this.closeBookingCustDropdown();
          }
        }
        const sbSearchWrapper = document.getElementById("sb-search-wrapper");
        if (sbSearchWrapper && !sbSearchWrapper.contains(e.target)) {
          const sbResults = document.getElementById("sb-search-results");
          if (sbResults) sbResults.style.display = "none";
        }
      });

      const splashStatus = document.getElementById("app-splash-status");

      if (this.user) {
        if (splashStatus) splashStatus.textContent = "กำลังโหลดข้อมูลระบบ...";
        try {
          // Timeout fetchInitialData so slow API never freezes the app on splash
          await Promise.race([
            this.fetchInitialData(),
            new Promise(res => setTimeout(res, 3500))
          ]);
        } catch (fetchErr) {
          console.error("fetchInitialData err:", fetchErr);
        }
        try { this.startLiveSyncPoller(); } catch (pollErr) { console.warn("startLiveSyncPoller err:", pollErr); }
        clearTimeout(fallbackTimer);
        setTimeout(dismissSplash, 250);
      } else {
        clearTimeout(fallbackTimer);
        setTimeout(dismissSplash, 300);
      }
    } catch (fatalErr) {
      console.error("App init fatal error:", fatalErr);
      clearTimeout(fallbackTimer);
      dismissSplash();
    }
  }

  initGlobalEnterKeyNavigation() {
    document.addEventListener("keydown", (e) => {
      // Only handle Enter without Ctrl / Meta / Alt, and ignore IME composition
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;

      const activeEl = document.activeElement;
      if (!activeEl) return;

      // Special handling for Auth Gate Screen (Enter navigation & submit)
      if (activeEl.closest("#auth-gate-screen")) {
        if (activeEl.id === "gate-login-username") {
          e.preventDefault();
          const pEl = document.getElementById("gate-login-password");
          if (pEl) pEl.focus();
          return;
        }
        if (activeEl.id === "gate-login-password") {
          e.preventDefault();
          this.submitGateLogin();
          return;
        }
      }

      const tag = activeEl.tagName.toLowerCase();
      // Allow textarea to insert line breaks normally
      if (tag === "textarea") return;
      // Allow buttons to be triggered normally on Enter
      if (tag === "button") return;

      // Only handle input and select
      if (tag !== "input" && tag !== "select") return;

      const inputType = (activeEl.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "file"].includes(inputType)) return;

      // Prevent default form submit or page reload
      e.preventDefault();

      // Find the logical container context:
      // 1. Is it inside an open modal?
      const openModal = activeEl.closest(".modal-backdrop.active, .modal-backdrop[style*='display: flex'], .modal-backdrop[style*='display: block'], .modal-backdrop");
      let container = null;
      if (openModal && window.getComputedStyle(openModal).display !== "none") {
        container = openModal.querySelector(".modal-dialog, .modal-box, .modal-content") || openModal;
      } else {
        // 2. Is it inside an active tab?
        container = activeEl.closest(".tab-content.active, .tab-pane.active") || activeEl.closest(".tab-content");
      }
      if (!container) {
        // 3. Fallback to closest section, card, form, or body
        container = activeEl.closest(".card, form, main") || document.body;
      }

      // Query candidate form elements within this container
      const selector = [
        'input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([disabled]):not([readonly])',
        'select:not([disabled]):not([readonly])'
      ].join(", ");

      const candidates = Array.from(container.querySelectorAll(selector));
      const visibleFields = candidates.filter(el => {
        if (el.disabled || el.readOnly || el.type === "hidden") return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        return (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
      });

      const currIndex = visibleFields.indexOf(activeEl);

      // Support Shift + Enter to navigate to previous field
      if (e.shiftKey) {
        if (currIndex > 0) {
          const prevEl = visibleFields[currIndex - 1];
          prevEl.focus();
          if (typeof prevEl.select === "function" && prevEl.tagName.toLowerCase() === "input" && !["date", "time", "color", "range"].includes(prevEl.type)) {
            prevEl.select();
          }
        }
        return;
      }

      // Enter to navigate to next field
      if (currIndex >= 0 && currIndex < visibleFields.length - 1) {
        const nextEl = visibleFields[currIndex + 1];
        nextEl.focus();
        if (typeof nextEl.select === "function" && nextEl.tagName.toLowerCase() === "input" && !["date", "time", "color", "range"].includes(nextEl.type)) {
          nextEl.select();
        }
      } else if (currIndex === visibleFields.length - 1) {
        // At the last field in container: focus the primary action / submit button
        const primaryBtn = container.querySelector(
          'button.btn-primary:not([disabled]):not([style*="display: none"]), button[type="submit"]:not([disabled]):not([style*="display: none"]), .btn-save:not([disabled])'
        );
        if (primaryBtn && window.getComputedStyle(primaryBtn).display !== "none") {
          primaryBtn.focus();
        }
      }
    });

    // Dismiss custom searchable dropdowns when clicking outside
    document.addEventListener("click", (e) => {
      const container = document.getElementById("mnt-car-dropdown-container");
      if (container && !container.contains(e.target)) {
        const listEl = document.getElementById("mnt-car-dropdown-list");
        if (listEl) listEl.style.display = "none";
      }
      const swapContainer = document.getElementById("insp-swap-car-dropdown-container");
      if (swapContainer && !swapContainer.contains(e.target)) {
        const swapList = document.getElementById("insp-swap-car-dropdown-list");
        if (swapList) swapList.style.display = "none";
      }
    });
  }

  getThaiDateTime(offsetDays = 0) {
    const now = new Date(Date.now() + offsetDays * 86400000);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(now);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    let yr = parseInt(map.year, 10);
    if (yr > 2400) {
      yr -= 543; // Always ensure 4-digit Gregorian year (YYYY) for HTML5 <input type="date">
    }
    const h = map.hour === "24" ? "00" : map.hour;
    const dStr = `${yr}-${map.month}-${map.day}`;
    const tStr = `${h}:${map.minute}`;
    return {
      date: dStr,
      time: tStr,
      dateStr: dStr,
      timeStr: tStr
    };
  }

  setupDatePickers() {
    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    const sDate = document.getElementById("filter-start-date");
    const eDate = document.getElementById("filter-end-date");
    if (sDate) {
      sDate.value = thNow.date;
      sDate.min = thNow.date;
    }
    if (eDate) {
      eDate.value = thNext3.date;
      eDate.min = thNow.date;
    }
    const sTime = document.getElementById("filter-start-time");
    const eTime = document.getElementById("filter-end-time");
    if (sTime) sTime.value = thNow.time;
    if (eTime) eTime.value = thNow.time;

    // Enforce min date to prevent backdated entries
    const wSDate = document.getElementById("walkin-start-date");
    const wEDate = document.getElementById("walkin-end-date");
    if (wSDate) {
      wSDate.min = thNow.date;
      if (!wSDate.value) wSDate.value = thNow.date;
    }
    if (wEDate) {
      wEDate.min = thNow.date;
      if (!wEDate.value) wEDate.value = thNext3.date;
    }
    const aDispDate = document.getElementById("assign-disp-date");
    const aDispSDate = document.getElementById("assign-disp-start-date");
    if (aDispDate) aDispDate.min = thNow.date;
    if (aDispSDate) aDispSDate.min = thNow.date;
  }

  switchModule(modName) {
    this.activeModule = modName;
    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    const navBtn = document.getElementById(`nav-${modName}`);
    if (navBtn) navBtn.classList.add("active");

    ["frontoffice", "backoffice", "maintenance", "customers", "dashboard", "users"].forEach(m => {
      const sec = document.getElementById(`module-${m}`);
      if (sec) sec.style.display = (m === modName) ? "block" : "none";
    });

    if (modName === "backoffice") {
      this.loadBackOfficeJobs();
      setTimeout(() => {
        if (this.boCalendar) this.boCalendar.updateSize();
      }, 120);
    }
    if (modName === "maintenance") this.loadMaintenanceRecords();
    if (modName === "customers") this.renderCustomersTable();
    if (modName === "dashboard") {
      this.loadDashboardKPIs();
      this.loadMonthlyExpenses();
      setTimeout(() => this.renderDashboardCharts(), 150);
    }
    if (modName === "users") this.loadUsers();
  }

  async switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    const tabBtn = document.getElementById(`tab-btn-${tabName}`);
    if (tabBtn) tabBtn.classList.add("active");

    ["fleet", "deposit", "assign", "contract", "dashboard_bks"].forEach(t => {
      const pane = document.getElementById(`subtab-${t}`);
      if (pane) pane.style.display = (t === tabName) ? "block" : "none";
    });

    if (!this.users || this.users.length <= 1) {
      await this.loadUsers();
    }

    if (tabName === "assign") {
      this.populateBookingDropdowns();
      this.populateStaffDropdowns();
      const dispSel = document.getElementById("assign-disp-bk");
      const retSel = document.getElementById("assign-ret-bk");
      if (dispSel && !dispSel.value && this.currentSelectedBooking?.booking_id) {
        dispSel.value = this.currentSelectedBooking.booking_id;
      }
      if (retSel && !retSel.value && (dispSel?.value || this.currentSelectedBooking?.booking_id)) {
        retSel.value = dispSel?.value || this.currentSelectedBooking.booking_id;
      }
      this.onSelectAssignDispBooking();
      this.onSelectAssignRetBooking();
      this.setAssignMode(this.assignMode || "Dispatch");
    } else if (tabName === "contract") {
      this.populateBookingDropdowns();
      this.populateStaffDropdowns();
      const contractSel = document.getElementById("contract-sel-bk");
      if (contractSel) {
        if (!contractSel.value) {
          if (this.currentSelectedBooking?.booking_id) {
            contractSel.value = this.currentSelectedBooking.booking_id;
          } else {
            const activeBks = this.bookings.filter(b => b.status !== "ยกเลิก" && b.status !== "เสร็จสิ้น");
            if (activeBks.length > 0) {
              contractSel.value = activeBks[0].booking_id;
            } else if (this.bookings.length > 0) {
              contractSel.value = this.bookings[0].booking_id;
            }
          }
        }
        this.onSelectContractBooking();
      }
    } else if (tabName === "deposit") {
      this.populateBookingDropdowns();
      const depSel = document.getElementById("deposit-sel-booking");
      if (depSel && !depSel.value && this.currentSelectedBooking?.booking_id) {
        depSel.value = this.currentSelectedBooking.booking_id;
        this.onSelectDepositBooking();
      }
    }
  }

  isSectionCollapsed(cardId) {
    if (!this.isTableCollapsed) return false;
    return !!this.isTableCollapsed[cardId];
  }

  toggleExpander(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const header = card.querySelector(".expander-header");
    const body = card.querySelector(".expander-body");
    const indicator = card.querySelector(".expander-indicator span");
    const isEn = (this.currentLang === "EN");

    if (!this.isTableCollapsed) {
      this.isTableCollapsed = {
        "expander-shift-closing": false,
        "expander-fleet": false,
        "expander-monthly-expenses": false,
        "expander-completed": true
      };
    }

    const currentCollapsed = (typeof this.isTableCollapsed[cardId] === "boolean")
      ? this.isTableCollapsed[cardId]
      : (body ? body.style.display === "none" : false);

    const newCollapsed = !currentCollapsed;
    this.isTableCollapsed[cardId] = newCollapsed;

    if (newCollapsed) {
      if (body) body.style.display = "none";
      if (header) header.classList.remove("open");
      if (indicator) indicator.textContent = isEn ? "▼ Click to expand" : "▼ คลิกเพื่อกางดูข้อมูล";
    } else {
      if (body) body.style.display = "block";
      if (header) header.classList.add("open");
      if (indicator) indicator.textContent = isEn ? "▲ Click to collapse" : "▲ คลิกเพื่อพับเก็บ";
    }
  }

  toggleFleetTableCollapse() {
    this.toggleExpander("expander-fleet");
  }

  formatDateDmy(dateVal) {
    if (!dateVal) return "-";
    try {
      const s = String(dateVal).split("T")[0];
      if (s.includes("-")) {
        const parts = s.split("-");
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return s;
    } catch (e) {
      return String(dateVal);
    }
  }

  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
      this.modalZIndex = (this.modalZIndex || 2000) + 10;
      m.style.zIndex = String(this.modalZIndex);
      m.style.display = "flex";
      m.classList.add("open");

      if (modalId === "modal-car-details") {
        this.isModalOpen = true;
      }

      if (modalId === "modal-edit-car") {
        setTimeout(() => {
          const plateInp = document.getElementById("edit-car-plate");
          if (plateInp) {
            plateInp.focus();
            plateInp.select();
          }
        }, 60);
      }
    }
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
      m.classList.remove("open");
      m.style.display = "none";
    }
    if (modalId === "modal-car-details") {
      this.isModalOpen = false;
      this.selectedVehicle = null;
    }
  }

  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "danger") icon = "⚠️";

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

}

// Global App Instance
const app = new App();
window.app = app;
