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

    async loadDashboardKPIs() {
    try {
      const res = await fetch(`/api/dashboard/stats?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
      if (res.ok) {
        this.dashboardStats = await res.json();
        this.rawKpiData = this.dashboardStats;
      }
    } catch (e) {
      console.error("[Dashboard] Error fetching /api/dashboard/stats:", e);
    }

    try {
      this.updateDashboardKPIsFromScope();
    } catch (e) {
      console.error("[Dashboard] Error in updateDashboardKPIsFromScope:", e);
    }

    try {
      this.renderDashboardCharts();
    } catch (e) {
      console.error("[Dashboard] Error in renderDashboardCharts:", e);
    }

    try {
      await this.loadMonthlyReports();
    } catch (e) {
      console.error("[Dashboard] Error in loadMonthlyReports:", e);
    }

    try {
      await this.loadFinanceSummary();
    } catch (e) {
      console.error("[Dashboard] Error in loadFinanceSummary:", e);
    }

    try {
      this.renderFleetOverviewTable();
    } catch (e) {
      console.error("[Dashboard] Error in renderFleetOverviewTable:", e);
    }
  }

  onDashboardScopeChange() {
    this.updateDashboardKPIsFromScope();
    this.renderFleetOverviewTable();
  }

  matchesCompanyScope(rawCompany, scopeVal) {
    if (!scopeVal || scopeVal === "ทั้งหมด") return true;
    const raw = String(rawCompany || "").trim();
    if (raw === scopeVal) return true;
    if (scopeVal === "Sawasdee Rent A Car" && (raw.includes("สวัสดี เรนทัล") || raw.includes("Sawasdee Rental"))) return true;
    if (scopeVal === "P.D.P. Co., Ltd." && (raw.includes("P.D.P") || raw.includes("พี.ดี.พี"))) return true;
    if (scopeVal === "Sawasdee Car Rent" && raw.includes("บี คลิ๊ก")) return true;
    return false;
  }

    updateDashboardKPIsFromScope() {
    try {
      const isEn = (this.currentLang === "EN");
      const data = this.dashboardStats || {};
      const sc = data.status_counts || data.status_breakdown || data.fleet_status_breakdown || {};

      // Robust fallback extraction: never NaN or undefined
      let totalFleet = Number(data.total_fleet ?? data.total_cars ?? (this.cars || []).length ?? 0);
      let availCars = Number(sc.available ?? data.available ?? data.available_cars ?? 0);
      let onRentCars = Number(sc.on_rent ?? sc.rented ?? sc.onRent ?? data.on_rent ?? data.rented_cars ?? 0);
      let bookedCars = Number(sc.booked ?? sc.reserved ?? data.booked ?? data.booked_cars ?? 0);
      let maintCars = Number(sc.maintenance ?? sc.maint ?? data.maintenance ?? data.maintenance_cars ?? 0);

      // FOOLPROOF FALLBACK: If status counts from API are all 0 but this.cars exists in memory
      if (availCars === 0 && onRentCars === 0 && bookedCars === 0 && maintCars === 0 && (this.cars || []).length > 0) {
        totalFleet = this.cars.length;
        this.cars.forEach(c => {
          const st = String(c.status || c.car_status || "").trim().toLowerCase();
          const fKey = String(c.fleet_status_key || "").trim().toLowerCase();
          const isOnRent = Boolean(c.is_on_rent);
          if (isOnRent || fKey === "on_rent" || fKey === "rented" || st.includes("เช่า") || st.includes("rent") || st.includes("รอรับคืน")) {
            onRentCars++;
          } else if (fKey === "maintenance" || fKey === "repair" || st.includes("ซ่อม") || st.includes("ไม่พร้อม") || st.includes("ระงับ") || st.includes("maint") || st.includes("ต่อทะเบียน") || st.includes("ต่อภาษี") || st.includes("workshop") || st.includes("renewal")) {
            const pNorm = String(c.plate || "").replace(/[\s\-\.]+/g, "").toLowerCase();
            const hasActiveMaint = (this.maintenanceRecords || []).some(m => {
              const mpNorm = String(m.car_id || "").replace(/[\s\-\.]+/g, "").toLowerCase();
              const mSt = String(m.status || "").trim();
              return (m.car_id === c.plate || mpNorm === pNorm) && !["เสร็จสิ้น", "ยกเลิก", "completed", "canceled"].includes(mSt.toLowerCase());
            });
            if (hasActiveMaint) {
              maintCars++;
            } else {
              availCars++;
            }
          } else if (fKey === "booked" || fKey === "reserved" || st.includes("จอง") || st.includes("book") || st.includes("reserv") || st.includes("ติดจอง") || st.includes("ส่งมอบ")) {
            bookedCars++;
          } else {
            availCars++;
          }
        });
      }

      // Card 2: on_rent + booked (strictly never including available)
      const activeRentals = (onRentCars + bookedCars);
      const utilRate = (totalFleet > 0 ? ((activeRentals / totalFleet) * 100).toFixed(1) : "0.0");
      const totalRev = Number(data.total_revenue ?? 0);

      const elTotal = document.getElementById("kpi-total-cars");
      const elAvail = document.getElementById("kpi-avail-pill");
      const elActive = document.getElementById("kpi-active-rentals");
      const elMaint = document.getElementById("kpi-maint-pill");
      const elUtil = document.getElementById("kpi-utilization");
      const elRev = document.getElementById("kpi-total-revenue");
      const elInst = document.getElementById("kpi-monthly-installments");
      const elUpd = document.getElementById("dash-last-updated-txt");

      const totalFleetInstallments = (this.cars || []).reduce((sum, c) => {
        const isDebtFree = Boolean(c.is_debt_free);
        const instAmt = parseFloat(c.installment_amount || 0);
        if (!isDebtFree && instAmt > 0) return sum + instAmt;
        return sum;
      }, 0);

      // Card 1: total_fleet and available
      if (elTotal) elTotal.textContent = totalFleet;
      if (elAvail) elAvail.textContent = isEn ? `Available ${availCars} cars` : `พร้อมให้บริการ ${availCars} คัน`;
      
      // Card 2: on_rent + booked and maintenance
      if (elActive) elActive.textContent = activeRentals;
      if (elMaint) elMaint.textContent = isEn ? `Maintenance ${maintCars} cars` : `ซ่อมบำรุง ${maintCars} คัน`;
      
      // Card 3: utilization rate
      if (elUtil) elUtil.textContent = `${utilRate}%`;
      
      // Card 4: revenue
      if (elRev) elRev.textContent = `฿${Number(totalRev).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (elInst) elInst.textContent = `฿${totalFleetInstallments.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
      if (elUpd) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, "0");
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, "0");
        const min = String(now.getMinutes()).padStart(2, "0");
        elUpd.textContent = isEn 
          ? `🕒 Real-time updated at ${dd}/${mm}/${yyyy} ${hh}:${min}` 
          : `🕒 ข้อมูลอัปเดตล่าสุด ณ ${dd}/${mm}/${yyyy} ${hh}:${min}`;
      }
    } catch (err) {
      console.error("[Dashboard] Error in updateDashboardKPIsFromScope:", err);
    }
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

  openBookModal(plate) {
    try {
      const cleanPlate = String(plate || "").trim();
      const car = (this.cars || []).find(c => c.plate === cleanPlate || (this.normalizePlate && this.normalizePlate(c.plate) === this.normalizePlate(cleanPlate))) || { plate: cleanPlate, brand: "", model: "", price_day: 1000 };

      const plateInp = document.getElementById("book-car-plate");
      if (plateInp) plateInp.value = car.plate || cleanPlate;

      const thNow = this.getThaiDateTime ? this.getThaiDateTime(0) : { date: new Date().toISOString().split("T")[0], time: "10:00" };
      const thNext3 = this.getThaiDateTime ? this.getThaiDateTime(3) : { date: new Date(Date.now() + 3*86400000).toISOString().split("T")[0], time: "10:00" };

      // Read directly from DOM Instant Booking Bar inputs to prevent lost references
      const rawSDate = document.getElementById("filter-start-date")?.value;
      const rawSTime = document.getElementById("filter-start-time")?.value;
      const rawEDate = document.getElementById("filter-end-date")?.value;
      const rawETime = document.getElementById("filter-end-time")?.value;

      let fSDate = rawSDate && rawSDate.trim() ? rawSDate.trim() : thNow.date;
      let fSTime = rawSTime && rawSTime.trim() ? rawSTime.trim() : thNow.time;
      let fEDate = rawEDate && rawEDate.trim() ? rawEDate.trim() : (fSDate || thNext3.date);
      let fETime = rawETime && rawETime.trim() ? rawETime.trim() : fSTime;

      // Prevent backdated booking
      if (fSDate < thNow.date) {
        fSDate = thNow.date;
      }
      if (fEDate < fSDate) {
        fEDate = fSDate;
      }

      const mSDate = document.getElementById("book-modal-start-date");
      const mSTime = document.getElementById("book-modal-start-time");
      const mEDate = document.getElementById("book-modal-end-date");
      const mETime = document.getElementById("book-modal-end-time");

      if (mSDate) {
        mSDate.value = fSDate;
        mSDate.min = thNow.date;
      }
      if (mSTime) mSTime.value = fSTime;
      if (mEDate) {
        mEDate.value = fEDate;
        mEDate.min = fSDate;
      }
      if (mETime) mETime.value = fETime;

      const discInp = document.getElementById("book-discount-input");
      if (discInp) discInp.value = 0;

      this.recalcBookingModalFromDates(true);
      this.populateCustomerDropdowns(this.lastAddedCustomerName || null);
      this.openModal("modal-book-car");
    } catch (err) {
      console.error("openBookModal error:", err);
      this.showToast("เกิดข้อผิดพลาดในการเปิดหน้าต่างจอง: " + err.message, "danger");
    }
  }

  setBookingModalDurationDays(targetDays) {
    const sDateInput = document.getElementById("book-modal-start-date");
    const eDateInput = document.getElementById("book-modal-end-date");
    if (!sDateInput || !eDateInput || !sDateInput.value) return;

    let [y, m, d] = sDateInput.value.split("-").map(n => parseInt(n, 10));
    if (y > 2400) y -= 543;
    const target = new Date(y, m - 1, d + targetDays);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");
    eDateInput.value = `${yyyy}-${mm}-${dd}`;
    this.recalcBookingModalFromDates(false);
  }

  recalcBookingModalFromDates(fromDateChange = false) {
    const plate = document.getElementById("book-car-plate")?.value;
    const car = this.cars.find(c => c.plate === plate) || { brand: "", model: "", plate: plate || "-", price_day: 1000 };
    const thNow = this.getThaiDateTime(0);
    const mSDate = document.getElementById("book-modal-start-date");
    const mEDate = document.getElementById("book-modal-end-date");

    if (mSDate) {
      if (!mSDate.min) mSDate.min = thNow.date;
      if (mSDate.value && mSDate.value < thNow.date) {
        mSDate.value = thNow.date;
      }
    }
    if (mEDate && mSDate) {
      mEDate.min = mSDate.value || thNow.date;
      if (mEDate.value && mEDate.value < mSDate.value) {
        mEDate.value = mSDate.value;
      }
    }

    const sDate = mSDate?.value || thNow.date;
    const sTime = document.getElementById("book-modal-start-time")?.value || thNow.time;
    const eDate = mEDate?.value || thNow.date;
    const eTime = document.getElementById("book-modal-end-time")?.value || thNow.time;

    const start = new Date(`${sDate}T${sTime}`);
    const end = new Date(`${eDate}T${eTime}`);

    let days = 1;
    let baseDays = 1;
    let extraHours = 0;
    let remMins = 0;
    let isOver4 = false;
    let isInvalidDate = false;

    if (end <= start) {
      days = 1;
      baseDays = 1;
      isInvalidDate = true;
    } else {
      const diffMs = end - start;
      const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
      remMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      baseDays = Math.floor(totalHours / 24);
      extraHours = totalHours % 24;
      if (extraHours > 4 || (extraHours === 4 && remMins > 0)) {
        days = baseDays + 1;
        isOver4 = true;
      } else {
        days = Math.max(1, baseDays);
      }
    }

    const cTypeEl = document.getElementById("book-contract-type");
    if (fromDateChange && cTypeEl) {
      if (days >= 30) {
        cTypeEl.value = "รายเดือน";
      } else if (days >= 7) {
        cTypeEl.value = "รายสัปดาห์";
      } else {
        cTypeEl.value = "รายวัน";
      }
    }

    const cType = cTypeEl?.value || "รายวัน";
    const { basePrice, breakdownText, priceDay, priceWeek, priceMonth } = this.calculateCarRentalPrice(car, days, cType);

    // 1. Render Day & Duration Counter Box (Screenshot 1: เพิ่มตัวเลขการนับวัน)
    const durationBox = document.getElementById("book-modal-duration-box");
    if (durationBox) {
      let statusNotice = "";
      let boxBorder = "#BFDBFE";
      let boxBg = "#EFF6FF";

      if (isInvalidDate) {
        boxBorder = "#FCA5A5";
        boxBg = "#FEF2F2";
        statusNotice = `<span style="color:#DC2626; font-size:12px; font-weight:700;">⚠️ วัน-เวลาคืนรถต้องอยู่หลังเวลารับรถ (ระบบคำนวณขั้นต่ำคิดเป็น 1 วัน)</span>`;
      } else if (isOver4) {
        boxBorder = "#FDBA74";
        boxBg = "#FFF7ED";
        statusNotice = `<span style="color:#C2410C; font-size:12px;">⚠️ คืนรถเกินเวลา <b>${extraHours} ชม. ${remMins} นาที</b> (เกิน 4 ชม. ปรับคิดเพิ่ม 1 วันเต็ม ➔ คิดรวม <b>${days} วัน</b>)</span>`;
      } else if (extraHours > 0 || remMins > 0) {
        boxBorder = "#BFDBFE";
        boxBg = "#EFF6FF";
        statusNotice = `<span style="color:#1D4ED8; font-size:12px;">⏱️ เกินเวลา <b>${extraHours} ชม. ${remMins} นาที</b> (อนุโลมไม่เกิน 4 ชม. ไม่คิดวันเพิ่ม ➔ คิด <b>${days} วัน</b>)</span>`;
      } else {
        boxBorder = "#BBF7D0";
        boxBg = "#F0FDF4";
        statusNotice = `<span style="color:#15803D; font-size:12px;">🟢 ตรงเวลาพอดี <b>${days} วันเต็ม</b> (${days * 24} ชั่วโมง)</span>`;
      }

      let quickAdjustHtml = "";
      if (cType === "รายสัปดาห์" && days < 7) {
        quickAdjustHtml = `
          <button type="button" onclick="app.setBookingModalDurationDays(7)" style="margin-left:auto; background:#FFFFFF; border:1px solid #3B82F6; color:#1D4ED8; padding:3px 9px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;" title="ปรับวันคืนรถให้ครบ 7 วันพอดี">
            ⚡ ปรับวันคืนรถเป็น 7 วัน (1 สัปดาห์)
          </button>
        `;
      } else if (cType === "รายเดือน" && days < 30) {
        quickAdjustHtml = `
          <button type="button" onclick="app.setBookingModalDurationDays(30)" style="margin-left:auto; background:#FFFFFF; border:1px solid #3B82F6; color:#1D4ED8; padding:3px 9px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;" title="ปรับวันคืนรถให้ครบ 30 วันพอดี">
            ⚡ ปรับวันคืนรถเป็น 30 วัน (1 เดือน)
          </button>
        `;
      }

      durationBox.style.background = boxBg;
      durationBox.style.borderColor = boxBorder;
      durationBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:13.5px; font-weight:700; color:#1E293B;">จำนวนวันเช่ารวม:</span>
            <span style="background:#1D4ED8; color:#FFFFFF; font-size:15px; font-weight:800; padding:3px 14px; border-radius:20px; box-shadow:0 1px 3px rgba(0,0,0,0.12);">
              ${days} วัน
            </span>
          </div>
          ${quickAdjustHtml}
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          ${statusNotice}
        </div>
      `;
    }

    // 2. Render Top Car Preview Box (Clean professional layout)
    const preview = document.getElementById("book-car-preview");
    if (preview) {
      const activeStyle = "background:#FFFBEB; color:#B45309; border:1.5px solid #F59E0B; font-weight:800;";
      const inactiveStyle = "background:#F1F5F9; color:#475569; border:1px solid #E2E8F0;";

      preview.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
          <div>
            <b style="font-size:15px; color:#1E293B;">${car.brand || ''} ${car.model || ''}</b> | ทะเบียน: <b style="color:#D97706;">${car.plate}</b><br/>
            <span style="font-size:12px; color:#64748B;">กลุ่ม: ${car.car_group || 'รถยนต์'} | เชื้อเพลิง: ${car.fuel_type || car.fuel_system || 'เบนซิน'} | ผู้ถือกรรมสิทธิ์: ${car.owner_company || car.company || '-'}</span>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:#64748B; margin-bottom:3px;">อัตราค่าเช่า:</div>
            <div style="display:flex; gap:4px; font-size:11.5px; justify-content:flex-end; flex-wrap:wrap;">
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายวัน' ? activeStyle : inactiveStyle}">฿${priceDay.toLocaleString()}/วัน</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายสัปดาห์' ? activeStyle : inactiveStyle}">฿${priceWeek.toLocaleString()}/สัปดาห์</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายเดือน' ? activeStyle : inactiveStyle}">฿${priceMonth.toLocaleString()}/เดือน</span>
            </div>
          </div>
        </div>
        <div style="margin-top:7px; padding-top:6px; border-top:1px dashed #E2E8F0; font-size:12px; color:#475569;">
          <b>การคำนวณราคา (${cType}):</b> <span style="color:#D97706; font-weight:700;">${breakdownText}</span>
        </div>
      `;
    }

    const pInput = document.getElementById("book-price-input");
    if (pInput) pInput.value = basePrice;
    this.recalcBookingModalPrice();
  }

  recalcBookingModalPrice() {
    const p = parseFloat(document.getElementById("book-price-input")?.value || 0);
    const d = parseFloat(document.getElementById("book-discount-input")?.value || 0);
    const net = Math.max(0, p - d);
    document.getElementById("book-modal-net-price").textContent = `฿${net.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;
  }

  findBookingConflict(plate, sDate, eDate, excludeId = null) {
    if (!plate || !sDate || !eDate) return null;
    const norm = (v) => String(v || "").split("T")[0];
    return (this.bookings || []).find(b => {
      if (b.car_id !== plate) return false;
      if (excludeId && b.booking_id === excludeId) return false;
      if (b.status === "เสร็จสิ้น" || b.status === "ยกเลิก") return false;
      const bs = norm(b.start_date), be = norm(b.end_date);
      if (!bs || !be) return false;
      return !(be < sDate || bs > eDate);
    }) || null;
  }

  async submitInstantBooking() {
    const thNow = this.getThaiDateTime(0);
    const plate = document.getElementById("book-car-plate").value;
    const cust = document.getElementById("book-cust-select").value;
    const cType = document.getElementById("book-contract-type").value;
    const sDate = document.getElementById("book-modal-start-date")?.value || document.getElementById("filter-start-date").value;
    const sTime = document.getElementById("book-modal-start-time")?.value || document.getElementById("filter-start-time").value || thNow.time;
    const eDate = document.getElementById("book-modal-end-date")?.value || document.getElementById("filter-end-date").value;
    const eTime = document.getElementById("book-modal-end-time")?.value || document.getElementById("filter-end-time").value || thNow.time;
    const baseP = parseFloat(document.getElementById("book-price-input").value);
    const disc = parseFloat(document.getElementById("book-discount-input").value || 0);

    // Validation: prevent backdated booking / contracts
    if (sDate < thNow.date) {
      alert(`⚠️ ไม่อนุญาตให้ทำสัญญาหรือจองรถย้อนหลัง!\nวันที่เริ่มต้น (${sDate}) ต้องไม่น้อยกว่าวันนี้ (${thNow.date})`);
      this.showToast(`⚠️ ไม่อนุญาตให้ทำสัญญาย้อนหลัง: วันที่เริ่มต้นต้องเป็น ${thNow.date} ขึ้นไป`, "danger");
      return;
    }
    if (eDate < sDate) {
      alert(`⚠️ วันที่สิ้นสุดสัญญา (${eDate}) ต้องไม่น้อยกว่าวันที่เริ่มต้น (${sDate})`);
      this.showToast(`⚠️ วันที่สิ้นสุดสัญญาต้องไม่น้อยกว่าวันที่เริ่มต้น`, "danger");
      return;
    }

    const overlap = this.findBookingConflict(plate, sDate, eDate);
    if (overlap) {
      alert(`⚠️ ไม่สามารถจองได้: วันที่ทับซ้อนกับคิวเดิมของรถคันนี้\n\nรหัสจอง: ${overlap.booking_id}\nลูกค้า: ${overlap.customer}\nช่วงวันที่: ${overlap.start_date_formatted || overlap.start_date} - ${overlap.end_date_formatted || overlap.end_date}\n\nกรุณาเลือกช่วงวันที่อื่นที่ว่าง`);
      this.showToast("⚠️ วันที่ทับซ้อนกับคิวเดิม ระบบระงับการบันทึกการจอง", "danger");
      return;
    }

    const payload = {
      car_id: plate,
      customer: cust,
      contract_type: cType,
      start_date: sDate,
      end_date: eDate,
      start_time: sTime,
      end_time: eTime,
      base_price: baseP,
      discount: disc,
      deposit_amount: 5000.0,
      created_by: this.user ? this.user.username : "admin"
    };

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      let data = {};
      const resText = await res.text();
      try {
        data = JSON.parse(resText);
      } catch (jsonErr) {
        throw new Error(`เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ${res.status}): ${resText.slice(0, 160) || res.statusText}`);
      }
      if (!res.ok) {
        throw new Error(data.detail || data.error || "ไม่สามารถสร้างรายการจองได้");
      }
      if (data.success) {
        this.closeModal("modal-book-car");
        this.showToast(`🎉 สร้างการจอง ${data.booking_id} เรียบร้อย!`, "success");
        await this.loadBookings();
        await this.loadCars();

        // Switch to Tab 2 (Deposit) and auto-select this booking
        this.switchTab("deposit");
        const sel = document.getElementById("deposit-sel-booking");
        if (sel) {
          sel.value = data.booking_id;
          this.onSelectDepositBooking();
        }
      }
    } catch (e) {
      alert(`❌ สร้างรายการจองไม่สำเร็จ:\n${e.message}`);
      this.showToast("เกิดข้อผิดพลาดในการสร้างการจอง: " + e.message, "danger");
    }
  }

  populateBookingDropdowns() {
    const isEn = (this.currentLang === "EN");
    const depSel = document.getElementById("deposit-sel-booking");
    const assignDispSel = document.getElementById("assign-disp-bk");
    const assignRetSel = document.getElementById("assign-ret-bk");
    const contractSel = document.getElementById("contract-sel-bk");

    const activeBks = this.bookings.filter(b => b.status !== "ยกเลิก" && b.status !== "เสร็จสิ้น");
    const allValidBks = this.bookings.filter(b => b.status !== "ยกเลิก");

    const renderOpts = (bks) => `
      <option value="">-- ${isEn ? 'Please select a booking' : 'กรุณาเลือกรายการจอง'} --</option>
      ${bks.map(b => {
        const sFmt = b.start_date_formatted || b.start_date || "-";
        const eFmt = b.end_date_formatted || b.end_date || "-";
        return `<option value="${b.booking_id}">${b.booking_id} | ${b.car_id} (${b.customer}) 📅 ${sFmt} - ${eFmt} [${isEn ? 'Status' : 'สถานะ'}: ${b.status}]</option>`;
      }).join("")}
    `;

    if (depSel) {
      const cur = depSel.value;
      depSel.innerHTML = renderOpts(activeBks);
      if (cur) depSel.value = cur;
    }
    if (assignDispSel) {
      const cur = assignDispSel.value;
      assignDispSel.innerHTML = renderOpts(activeBks);
      if (cur) assignDispSel.value = cur;
    }
    if (assignRetSel) {
      const cur = assignRetSel.value;
      assignRetSel.innerHTML = renderOpts(activeBks);
      if (cur) assignRetSel.value = cur;
    }
    if (contractSel) {
      const cur = contractSel.value;
      contractSel.innerHTML = renderOpts(allValidBks.length > 0 ? allValidBks : this.bookings);
      if (cur) contractSel.value = cur;
    }
  }

  onSelectDepositBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("deposit-sel-booking")?.value;
    const summary = document.getElementById("deposit-booking-summary");
    const actionSec = document.getElementById("deposit-action-section");
    const btnSettle = document.getElementById("btn-settle-rental");
    const btnDlDep = document.getElementById("btn-dl-dep-receipt");
    const btnDlRent = document.getElementById("btn-dl-rent-receipt");
    const btnDlContract = document.getElementById("btn-dl-contract-from-dep");
    const btnSaveSlip = document.getElementById("btn-save-slip-only");

    if (!bkId) {
      if (summary) summary.style.display = "none";
      if (actionSec) actionSec.style.display = "none";
      return;
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) return;

    this.currentSelectedBooking = b;
    if (summary) summary.style.display = "block";
    if (actionSec) actionSec.style.display = "block";

    const isDep = b.deposit_paid;
    const isRent = b.rental_paid;
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);

    // 1. Populate amount & payment method (Fixed 5,000 THB)
    const amtEl = document.getElementById("deposit-amount-input");
    if (amtEl) amtEl.value = 5000;
    const methEl = document.getElementById("deposit-method-input");
    if (methEl && b.deposit_method) {
      methEl.value = b.deposit_method;
    }

    // 2. Populate ref number
    const refEl = document.getElementById("deposit-ref-input");
    if (refEl) {
      refEl.value = b.deposit_ref || b.rental_ref || "";
    }
    const alsoRentCb = document.getElementById("deposit-also-rent");
    if (alsoRentCb) {
      alsoRentCb.checked = Boolean(b.rental_paid || b.payment_type === "มัดจำและค่าเช่า");
    }
    const gdriveEl = document.getElementById("deposit-gdrive-input");
    if (gdriveEl) gdriveEl.value = b.google_drive_link || "";

    // 3. Populate slip URL and preview (Supports both 1 slip and 2 slips)
    const depSlip = b.deposit_slip || b.payment_slip_url || "";
    const rentSlip = b.remaining_slip_link || b.rental_slip || "";
    const hasDepSlip = Boolean(depSlip);
    const hasRentSlip = Boolean(rentSlip && rentSlip !== depSlip);

    const urlInput = document.getElementById("deposit-slip-url");
    if (urlInput) urlInput.value = depSlip || rentSlip || "";

    if (hasDepSlip) {
      this.showDepositSlipPreview(depSlip, isEn ? `Deposit Slip (${b.booking_id})` : `สลิปมัดจำ (${b.booking_id})`);
    } else if (rentSlip) {
      this.showDepositSlipPreview(rentSlip, isEn ? `Rental Fee Slip (${b.booking_id})` : `สลิปค่าเช่า (${b.booking_id})`);
    } else {
      this.clearDepositSlip(false);
    }

    // Secondary preview for rental balance slip if 2 separate slips exist
    const rentBox = document.getElementById("rental-slip-preview-box");
    const rentImg = document.getElementById("rental-slip-preview-img");
    const rentName = document.getElementById("rental-slip-preview-name");
    if (rentBox) {
      if (hasDepSlip && hasRentSlip) {
        this.currentRentalSlipUrl = rentSlip;
        rentBox.style.display = "flex";
        if (rentImg) rentImg.src = this.convertDriveUrl(rentSlip) || rentSlip;
        if (rentName) rentName.textContent = isEn ? `Rental Balance Slip (${b.booking_id})` : `สลิปชำระค่าเช่าคงเหลือ (${b.booking_id})`;
      } else {
        rentBox.style.display = "none";
        this.currentRentalSlipUrl = null;
      }
    }

    // 4. Render detailed summary with slip badges
    let slipBadges = [];
    if (b.deposit_ref) {
      slipBadges.push(`<span>🧾 <b>${isEn ? 'Slip Ref:' : 'เลขที่ Ref สลิป:'}</b> <code style="background:#FEF3C7; color:#92400E; padding:2px 7px; border-radius:4px; font-weight:700; font-size:12px;">${b.deposit_ref}</code></span>`);
    }
    if (depSlip) {
      slipBadges.push(`<span>📎 <b>${isEn ? 'Deposit Slip:' : 'สลิปมัดจำ:'}</b> <a href="javascript:void(0)" onclick="app.viewSlip('${depSlip}', '${isEn ? 'Deposit Slip' : 'สลิปมัดจำ'} (${b.booking_id})')" style="color:#0284C7; font-weight:700; text-decoration:underline; cursor:pointer;">🖼️ ${isEn ? 'Click to view slip' : 'ดูสลิปมัดจำ'}</a></span>`);
    }
    if (b.rental_ref && b.rental_ref !== b.deposit_ref) {
      slipBadges.push(`<span>🧾 <b>${isEn ? 'Rental Ref:' : 'Ref ค่าเช่า:'}</b> <code style="background:#E0F2FE; color:#0369A1; padding:2px 7px; border-radius:4px; font-weight:700; font-size:12px;">${b.rental_ref}</code></span>`);
    }
    if (hasRentSlip) {
      slipBadges.push(`<span>📎 <b>${isEn ? 'Rental Slip:' : 'สลิปค่าเช่า:'}</b> <a href="javascript:void(0)" onclick="app.viewSlip('${rentSlip}', '${isEn ? 'Rental Slip' : 'สลิปชำระคงเหลือ'} (${b.booking_id})')" style="color:#059669; font-weight:700; text-decoration:underline; cursor:pointer;">🖼️ ${isEn ? 'Click to view slip' : 'ดูสลิปชำระคงเหลือ'}</a></span>`);
    }

    summary.innerHTML = `
      <div class="deposit-summary-rows">
        <div class="deposit-summary-row"><span>${isEn ? 'ID' : 'รหัส'}</span><b>${b.booking_id}</b><span>${b.car_id || ''}</span></div>
        <div class="deposit-summary-row"><span>${isEn ? 'Customer' : 'ลูกค้า'}</span><b>${b.customer || '-'}</b><span>${b.customer_phone || ''}</span></div>
        <div class="deposit-summary-row"><span>${isEn ? 'Dates' : 'ระยะเวลา'}</span><b>${b.start_date_formatted || b.start_date || '-'} – ${b.end_date_formatted || b.end_date || '-'}</b></div>
        <div class="deposit-summary-row"><span>${isEn ? 'Net' : 'ค่าเช่าสุทธิ'}</span><b class="deposit-summary-price">฿${netP.toLocaleString()}</b><span style="color:${isDep ? '#059669' : '#DC2626'};">${isDep ? (isEn ? 'Deposit paid' : 'มัดจำชำระแล้ว') : (isEn ? 'Deposit pending' : 'รอมัดจำ')}</span></div>
        ${b.payment_type ? `<div class="deposit-summary-row"><span>${isEn ? 'Type' : 'ประเภท'}</span><b>${b.payment_type}</b></div>` : ''}
        ${b.google_drive_link ? `<a class="deposit-summary-slip" href="${b.google_drive_link}" target="_blank">${isEn ? 'Google Drive' : 'Google Drive'}</a>` : ''}
        ${b.deposit_slip ? `<a class="deposit-summary-slip" href="javascript:void(0)" onclick="app.viewSlip('${b.deposit_slip}', 'สลิปมัดจำ (${b.booking_id})')">${isEn ? 'View slip' : 'ดูสลิปมัดจำ'}</a>` : ''}
        ${(b.rental_slip && b.rental_slip !== b.deposit_slip) ? `<a class="deposit-summary-slip" href="javascript:void(0)" onclick="app.viewSlip('${b.rental_slip}', 'สลิปชำระคงเหลือ (${b.booking_id})')">${isEn ? 'View rental slip' : 'ดูสลิปคงเหลือ'}</a>` : ''}
        ${slipBadges.length > 0 ? `<div class="deposit-summary-extra">${slipBadges.join("")}</div>` : ''}
      </div>
    `;

    if (btnSaveSlip) btnSaveSlip.style.display = isDep ? "inline-flex" : "none";
    if (btnSettle) { 
      const remVal = isRent ? 0 : (isDep ? Math.max(0, netP - depAmt) : parseFloat(b.remaining_rental !== undefined ? b.remaining_rental : netP));
      btnSettle.style.display = ((!isRent && isDep) || remVal > 0) ? "inline-flex" : "none"; 
    }
    if (btnDlDep) btnDlDep.style.display = isDep ? "inline-flex" : "none";
    if (btnDlRent) btnDlRent.style.display = isRent ? "inline-flex" : "none";
    if (btnDlContract) btnDlContract.style.display = "inline-flex";
  }

  async onDepositSlipSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    const statusEl = document.getElementById("deposit-slip-status");
    if (statusEl) statusEl.innerHTML = `<span style="color:#2563EB;">⏳ กำลังอัปโหลด...</span>`;

    try {
      this.showToast(`⏳ กำลังอัปโหลดสลิป ${file.name}...`, "info");
      const bkId = this.currentSelectedBooking?.booking_id || "";
      const uploadUrl = `/api/upload-photo?category=slip&ref_id=${encodeURIComponent(bkId || 'DEP')}`;
      const res = await fetch(uploadUrl, { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success || !data.url) {
        throw new Error(data.detail || "อัปโหลดรูปภาพสลิปไม่สำเร็จ");
      }

      const slipUrl = data.url;
      const urlInput = document.getElementById("deposit-slip-url");
      if (urlInput) urlInput.value = slipUrl;

      this.showDepositSlipPreview(slipUrl, file.name);
      this.showToast(`✅ อัปโหลดรูปสลิปเรียบร้อย!`, "success");
    } catch (err) {
      console.error("Upload slip error:", err);
      if (statusEl) statusEl.innerHTML = `<span style="color:#DC2626;">❌ อัปโหลดไม่สำเร็จ</span>`;
      this.showToast("อัปโหลดสลิปไม่สำเร็จ: " + err.message, "danger");
    }
  }

  showDepositSlipPreview(url, fileName = "สลิปหลักฐานการชำระเงิน") {
    const box = document.getElementById("deposit-slip-preview-box");
    const img = document.getElementById("deposit-slip-preview-img");
    const nameEl = document.getElementById("deposit-slip-preview-name");
    const statusEl = document.getElementById("deposit-slip-status");

    this.currentDepositSlipUrl = url;
    this.currentDepositSlipName = fileName;

    if (box && img) {
      box.style.display = "flex";
      img.src = this.convertDriveUrl(url) || url;
      if (nameEl) nameEl.textContent = fileName || "สลิปหลักฐานการชำระเงิน";
      if (statusEl) statusEl.innerHTML = `<b style="color:#059669;">✔️ แนบสลิปแล้ว</b>`;
    }
  }

  viewCurrentDepositSlip() {
    if (!this.currentDepositSlipUrl) {
      this.showToast("⚠️ ยังไม่มีรูปภาพสลิปให้แสดง", "danger");
      return;
    }
    this.viewSlip(this.currentDepositSlipUrl, this.currentDepositSlipName || "สลิปมัดจำ");
  }

  viewCurrentRentalSlip() {
    if (!this.currentRentalSlipUrl) {
      this.showToast("⚠️ ยังไม่มีรูปภาพสลิปชำระคงเหลือ", "danger");
      return;
    }
    this.viewSlip(this.currentRentalSlipUrl, "สลิปชำระค่าเช่าคงเหลือ");
  }

  clearDepositSlip(resetFile = true) {
    const urlInput = document.getElementById("deposit-slip-url");
    if (urlInput) urlInput.value = "";
    this.currentDepositSlipUrl = null;
    this.currentDepositSlipName = null;
    const box = document.getElementById("deposit-slip-preview-box");
    if (box) box.style.display = "none";
    const rentBox = document.getElementById("rental-slip-preview-box");
    if (rentBox) rentBox.style.display = "none";
    this.currentRentalSlipUrl = null;
    const statusEl = document.getElementById("deposit-slip-status");
    if (statusEl) statusEl.textContent = "ยังไม่ได้แนบสลิป";
    if (resetFile) {
      const fileInput = document.getElementById("deposit-slip-file");
      if (fileInput) fileInput.value = "";
    }
  }

  viewSlip(url, title = "สลิปหลักฐานการชำระเงิน") {
    if (!url || url === "-" || url === "null" || url === "undefined") {
      this.showToast("⚠️ ไม่พบรูปภาพสลิป หรือยังไม่ได้แนบสลิป", "danger");
      return;
    }

    this.currentViewingSlip = { url, title };
    const titleEl = document.getElementById("modal-slip-title-text");
    const imgEl = document.getElementById("modal-slip-viewer-img");
    const emptyEl = document.getElementById("modal-slip-viewer-empty");
    const urlPrevEl = document.getElementById("modal-slip-url-preview");

    if (titleEl) titleEl.textContent = title;
    if (urlPrevEl) {
      urlPrevEl.textContent = url.startsWith("data:") ? "สลิป (รูปภาพ Base64)" : url;
      urlPrevEl.title = url;
    }

    const directSrc = this.convertDriveUrl(url) || url;
    const isPdf = String(url).toLowerCase().includes(".pdf");

    if (isPdf) {
      if (imgEl) imgEl.style.display = "none";
      if (emptyEl) {
        emptyEl.style.display = "block";
        emptyEl.innerHTML = `
          <div style="font-size:36px; margin-bottom:10px;">📄</div>
          <div style="font-weight:700; color:#FFFFFF;">เอกสารสลิปในรูปแบบ PDF</div>
          <div style="font-size:12px; margin-top:6px; color:#94A3B8;">กรุณากดปุ่ม "เปิดในแท็บใหม่" หรือ "ดาวน์โหลดสลิป" เพื่อดูเอกสาร</div>
        `;
      }
    } else {
      if (emptyEl) emptyEl.style.display = "none";
      if (imgEl) {
        imgEl.style.display = "block";
        imgEl.src = directSrc;
        imgEl.onerror = () => {
          imgEl.style.display = "none";
          if (emptyEl) {
            emptyEl.style.display = "block";
            emptyEl.innerHTML = `
              <div style="font-size:36px; margin-bottom:10px;">🖼️</div>
              <div style="font-weight:700; color:#FFFFFF;">ไม่สามารถแสดงภาพตัวอย่างได้โดยตรง</div>
              <div style="font-size:12px; margin-top:6px; color:#94A3B8;">กรุณากดปุ่มเปิดดูในแท็บใหม่ หรือเปิดใน Google Drive</div>
            `;
          }
        };
      }
    }

    this.openModal("modal-slip-viewer");
  }

  openSafeImageWindow(url) {
    if (!url) return;
    if (url.startsWith("data:")) {
      try {
        // Convert Base64 data URL to native Blob URL to safely bypass Chrome's top-frame navigation block
        const parts = url.split(";base64,");
        const contentType = parts[0].replace("data:", "") || "image/jpeg";
        const byteCharacters = atob(parts[1]);
        const byteArrays = [];
        for (let offset = 0; offset < byteCharacters.length; offset += 512) {
          const slice = byteCharacters.slice(offset, offset + 512);
          const byteNumbers = new Array(slice.length);
          for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
          }
          byteArrays.push(new Uint8Array(byteNumbers));
        }
        const blob = new Blob(byteArrays, { type: contentType });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank");
      } catch (e) {
        console.error("Blob URL creation error:", e);
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(`<html><head><title>สลิปการชำระเงิน</title></head><body style="margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${url}" style="max-width:98%;max-height:98vh;object-fit:contain;border-radius:8px;"/></body></html>`);
          win.document.close();
        }
      }
    } else {
      window.open(url, "_blank");
    }
  }

  openCurrentSlipExternal() {
    if (!this.currentViewingSlip?.url) return;
    this.openSafeImageWindow(this.currentViewingSlip.url);
  }

  downloadCurrentSlip() {
    if (!this.currentViewingSlip?.url) return;
    const url = this.currentViewingSlip.url;
    const cleanTitle = (this.currentViewingSlip.title || "slip").replace(/[\s\/:*?"<>|]/g, "_");
    const filename = `${cleanTitle}.jpg`;

    if (url.startsWith("data:")) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      window.open(url, "_blank");
    }
  }

  async submitDeposit() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depAmt = parseFloat(document.getElementById("deposit-amount-input").value) || 0;
    const depMethod = document.getElementById("deposit-method-input").value;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();
    const alsoRent = Boolean(document.getElementById("deposit-also-rent")?.checked);
    const payType = alsoRent ? "มัดจำและค่าเช่า" : "มัดจำประกันสัญญา";

    try {
      this.showToast(`⏳ กำลังบันทึกรับเงินมัดจำ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bkId,
          amount: depAmt,
          payment_method: depMethod,
          ref_id: depRef,
          slip_image_url: slipUrl || gdriveLink,
          deposit_amount: depAmt,
          payment_ref: depRef,
          deposit_ref: depRef,
          slip_url: slipUrl,
          payment_type: payType,
          google_drive_link: gdriveLink,
          also_pay_rental: alsoRent
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("บันทึกข้อมูลการเงินสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลการเงินสำเร็จ',
            text: `บันทึกเงินมัดจำสำหรับใบจอง ${bkId} เรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        await this.loadBookings();
        await this.loadCars();
        if (typeof this.loadDashboardKPIs === "function") {
          await this.loadDashboardKPIs();
        }
        this.onSelectDepositBooking();
        await this.goToTabWithBooking("assign", bkId);
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      console.error("[Deposit] Error submitting deposit:", e);
      this.showToast("เกิดข้อผิดพลาด: " + (e.message || "ไม่สามารถบันทึกข้อมูลการเงินได้"), "danger");
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: e.message || 'ไม่สามารถบันทึกข้อมูลการเงินได้'
        });
      }
    }
  }

  async submitSettle() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depMethod = document.getElementById("deposit-method-input").value;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();
    const rentAmt = parseFloat(this.currentSelectedBooking?.remaining_rental || this.currentSelectedBooking?.net_price || 0);

    try {
      this.showToast(`⏳ กำลังบันทึกชำระค่าเช่าคงเหลือ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bkId,
          amount: rentAmt,
          payment_method: depMethod,
          ref_id: depRef,
          slip_image_url: slipUrl || gdriveLink,
          payment_ref: depRef,
          rental_ref: depRef,
          slip_url: slipUrl || gdriveLink,
          rental_slip: slipUrl || gdriveLink,
          remaining_slip_link: slipUrl || gdriveLink
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("บันทึกข้อมูลการเงินสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลการเงินสำเร็จ',
            text: `บันทึกชำระค่าเช่าสำหรับใบจอง ${bkId} เรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        await this.loadBookings();
        this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      console.error("[Settle] Error submitting settle:", e);
      this.showToast("เกิดข้อผิดพลาด: " + (e.message || "ไม่สามารถบันทึกข้อมูลการเงินได้"), "danger");
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: e.message || 'ไม่สามารถบันทึกข้อมูลการเงินได้'
        });
      }
    }
  }

  async submitUpdateSlipOnly() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const alsoRent = Boolean(document.getElementById("deposit-also-rent")?.checked);
    const payType = alsoRent ? "มัดจำและค่าเช่า" : (this.currentSelectedBooking?.payment_type || "มัดจำประกันสัญญา");
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();

    try {
      this.showToast(`⏳ กำลังอัปเดตสลิปและเลข Ref สำหรับ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/payment-slip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_ref: depRef,
          slip_url: slipUrl,
          payment_type: payType,
          google_drive_link: gdriveLink
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ อัปเดตสลิปและเลข Ref ${bkId} เรียบร้อย!`, "success");
        await this.loadBookings();
        this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "อัปเดตไม่สำเร็จ");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  populateStaffDropdowns() {
    const dispW = document.getElementById("assign-disp-worker");
    const retW = document.getElementById("assign-ret-worker");
    const walkinW = document.getElementById("walkin-worker-select");
    const approved = (this.users || []).filter(u => !u.status || u.status === "approved");
    const opts = approved.map(u => {
      const uname = u.username;
      const label = (u.name && u.name !== uname) ? `${uname} (${u.name})` : uname;
      return `<option value="${uname}">${label} [${u.role || 'Staff'}]</option>`;
    }).join("");
    const fallback = `<option value="admin">admin (ผู้ดูแลระบบ) [Admin]</option>`;

    [dispW, retW, walkinW].forEach(sel => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = opts || fallback;
      if (cur && cur !== "Wait" && cur !== "-" && Array.from(sel.options).some(o => o.value === cur)) {
        sel.value = cur;
      } else if (sel.options.length > 0) {
        sel.selectedIndex = 0;
      }
    });
  }

  setAssignMode(mode) {
    const isDisp = mode !== "Return";
    this.assignMode = isDisp ? "Dispatch" : "Return";
    const dispCard = document.getElementById("assign-card-disp");
    const retCard = document.getElementById("assign-card-ret");
    if (dispCard) dispCard.style.display = isDisp ? "block" : "none";
    if (retCard) retCard.style.display = isDisp ? "none" : "block";
    document.querySelectorAll('input[name="assign-mode"]').forEach(r => { r.checked = (r.value === this.assignMode); });
    const dispSel = document.getElementById("assign-disp-bk");
    const retSel = document.getElementById("assign-ret-bk");
    if (isDisp && dispSel && retSel && retSel.value && dispSel.value !== retSel.value) {
      dispSel.value = retSel.value;
      this.onSelectAssignDispBooking();
    } else if (!isDisp && dispSel && retSel && dispSel.value && retSel.value !== dispSel.value) {
      retSel.value = dispSel.value;
      this.onSelectAssignRetBooking();
    }
  }

  async goToTabWithBooking(tabName, bkId) {
    if (bkId) {
      const b = this.bookings.find(x => x.booking_id === bkId);
      if (b) this.currentSelectedBooking = b;
    }
    await this.switchTab(tabName);
    if (!bkId) return;
    if (tabName === "deposit") {
      const sel = document.getElementById("deposit-sel-booking");
      if (sel) {
        sel.value = bkId;
        this.onSelectDepositBooking();
      }
    } else if (tabName === "assign") {
      this.confirmedAssignSides = this.confirmedAssignSides || {};
      this.confirmedAssignSides[bkId] = { Dispatch: false, Return: false };
      const sel = document.getElementById("assign-disp-bk");
      if (sel) {
        sel.value = bkId;
        this.onSelectAssignDispBooking();
      }
      const retSel = document.getElementById("assign-ret-bk");
      if (retSel) {
        retSel.value = bkId;
        this.onSelectAssignRetBooking();
      }
      const bkObj = this.bookings.find(x => x.booking_id === bkId);
      this.setAssignMode(bkObj && ["กำลังเช่า", "เตรียมรับคืน"].includes(bkObj.status) ? "Return" : "Dispatch");
    } else if (tabName === "contract") {
      const sel = document.getElementById("contract-sel-bk");
      if (sel) {
        sel.value = bkId;
        this.onSelectContractBooking();
      }
    }
  }

  onSelectAssignDispBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("assign-disp-bk")?.value;
    const form = document.getElementById("assign-disp-form");
    if (!bkId) {
      if (form) form.style.display = "none";
      return;
    }
    if (form) form.style.display = "block";
    this.populateStaffDropdowns();

    // Auto-sync right-side Return Work Order dropdown to the same booking
    const retSel = document.getElementById("assign-ret-bk");
    if (retSel && retSel.value !== bkId) {
      retSel.value = bkId;
      this.onSelectAssignRetBooking();
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
      const dispPrintBtn = document.getElementById("btn-assign-disp-print-pdf");
      if (dispPrintBtn) {
        dispPrintBtn.href = b.checkout_pdf_url || `/api/pdf/inspection/${bkId}?type=checkout`;
        dispPrintBtn.style.display = "block";
        dispPrintBtn.onclick = (e) => {
          e.preventDefault();
          this.printInspectionForm('Dispatch');
        };
      }
      const sDateEl = document.getElementById("assign-disp-start-date");
      const eDateEl = document.getElementById("assign-disp-end-date");
      const dispDateEl = document.getElementById("assign-disp-date");
      const locEl = document.getElementById("assign-disp-loc");
      const timeEl = document.getElementById("assign-disp-time");
      const workerEl = document.getElementById("assign-disp-worker");
      const bannerEl = document.getElementById("assign-disp-status-banner");

      const thNow = this.getThaiDateTime(0);
      const sVal = b.start_date || thNow.date;
      const eVal = b.end_date || thNow.date;
      if (sDateEl) sDateEl.value = sVal;
      if (eDateEl) eDateEl.value = eVal;
      if (dispDateEl) dispDateEl.value = sVal;
      if (locEl) locEl.value = b.loc_delivery || "";
      if (timeEl) timeEl.value = b.start_time || thNow.time;
      if (workerEl) {
        const w = String(b.worker_delivery || "").trim();
        if (w && w !== "Wait" && w !== "-" && Array.from(workerEl.options).some(o => o.value === w)) {
          workerEl.value = w;
        } else if (workerEl.options.length > 0) {
          workerEl.selectedIndex = 0;
        }
      }

      const odoEl = document.getElementById("assign-disp-odometer");
      const fuelEl = document.getElementById("assign-disp-fuel");
      const notesEl = document.getElementById("assign-disp-notes");
      const photosUrlEl = document.getElementById("assign-disp-photos-url");
      const photosPrevEl = document.getElementById("assign-disp-photos-preview");

      if (odoEl) odoEl.value = b.odometer_out || b.dispatch_mileage || "";
      const savedDispCats = b.inspection_categories_out || b.inspection_categories;
      ['petrol', 'cleanliness', 'tires', 'interior', 'underhood'].forEach(k => {
        const el = document.getElementById("assign-disp-chk-" + k);
        if (el) el.checked = savedDispCats ? (savedDispCats[k] !== false) : true;
      });
      if (fuelEl) fuelEl.value = b.fuel_out || b.dispatch_fuel || fuelEl.value;
      if (notesEl) notesEl.value = b.inspection_notes_out || b.dispatch_notes || b.remarks || "";
      if (photosUrlEl) photosUrlEl.value = b.inspection_photos_out || "";
      this.assignDispPhotos = b.inspection_photos_out ? b.inspection_photos_out.split(",").map(x => x.trim()).filter(Boolean) : [];
      this.renderInspectionPhotosPreview("Dispatch", this.assignDispPhotos);

      if (bannerEl) {
        const isDep = Boolean(b.deposit_paid);
        const isRent = Boolean(b.rental_paid);
        const netP = parseFloat(b.net_price || 0);
        const depAmt = parseFloat(b.deposit_amount || 5000);
        // TARGET MISSION 3: ยอดเงินคงเหลือ = ราคาค่าเช่าที่ตกลง (net_price) - เงินมัดจำที่ชำระแล้ว (deposit_amount)
        const remP = isRent ? 0 : (isDep ? Math.max(0, netP - depAmt) : parseFloat(b.remaining_rental !== undefined ? b.remaining_rental : netP));
        const wDel = String(b.worker_delivery || "").trim();
        const hasDriver = wDel && wDel !== "Wait" && wDel !== "-";
        const sFmt = b.start_date_formatted || sVal;
        const eFmt = b.end_date_formatted || eVal;

        let html = `
          <div style="background:#FAF7F2; border:1px solid #E5E7EB; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#1F2937;">
            📅 <b>${isEn ? 'Pick-up Schedule:' : 'กำหนดส่งมอบรถ:'}</b> <span style="color:#EA580C; font-weight:700;">${sFmt} (${b.start_time || '10:00'}${isEn ? '' : ' น.'})</span> &nbsp;|&nbsp; <b>${isEn ? 'Return Schedule:' : 'กำหนดคืนรถ:'}</b> <span style="font-weight:700;">${eFmt} (${b.end_time || '10:00'}${isEn ? '' : ' น.'})</span>
          </div>
        `;
        if (!isDep) {
          html += `
            <div style="background:#FFFBEB; border:1px solid #F59E0B; border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#92400E;"><b>🟡 ${isEn ? 'Booking Status: Awaiting Deposit' : 'สถานะการจอง: รอชำระเงินมัดจำ'}</b> (${isEn ? 'Driver can be assigned in advance' : 'สามารถมอบหมายคนขับล่วงหน้าได้'})</div>
              <button type="button" onclick="app.goToTabWithBooking('deposit', '${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 ${isEn ? 'Collect Deposit' : 'ไปรับมัดจำ'}</button>
            </div>
          `;
        }
        if (isRent) {
          html += `
            <div style="background:#ECFDF5; border:1px solid #10B981; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#065F46; font-weight:700;">
              ✅ ${isEn ? 'Rental fee fully paid' : 'ชำระค่าเช่ารถครบถ้วนแล้ว'} (฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})})
            </div>
          `;
          if (b.contract_issued) {
            html += `
              <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#166534; font-weight:700;">
                ✅ ${isEn ? 'Rental contract issued (Ready for vehicle delivery)' : 'ออกสัญญาเช่าเรียบร้อยแล้ว (พร้อมส่งมอบรถยนต์)'}
              </div>
            `;
          } else {
            html += `
              <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <div style="font-size:12.5px; color:#1E40AF;">📝 <b>${isEn ? 'Awaiting Contract:' : 'รอออกสัญญาเช่า:'}</b> ${isEn ? 'Please issue contract in Tab 4 before vehicle handover' : 'กรุณาไปออกสัญญาเช่าในแท็บ 4 ก่อนส่งมอบรถยนต์'}</div>
                <button type="button" onclick="app.goToTabWithBooking('contract', '${b.booking_id}')" class="btn btn-primary btn-sm" style="padding:4px 10px; font-size:11.5px; font-weight:700;">📝 ${isEn ? 'Go to Contract' : 'ไปหน้าสัญญา ➔'}</button>
              </div>
            `;
          }
        } else {
          html += `
            <div style="background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#1E40AF;">⏳ <b>${isEn ? 'Pending Rental Fee on Pick-up:' : 'รอชำระค่าเช่าวันรับรถ:'}</b> ฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
              <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 ${isEn ? 'Pay Rental Fee' : 'กดจ่ายเงินค่าเช่า'}</button>
            </div>
          `;
        }
        if (hasDriver) {
          html += `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#166534;">
              🚚 <b>${isEn ? 'Dispatch Staff Assigned:' : 'มอบหมายพนักงานจัดส่งแล้ว:'}</b> ${wDel} (${isEn ? 'Date' : 'วันที่'} ${sFmt} ${isEn ? 'Time' : 'เวลา'} ${b.start_time || '10:00'}${isEn ? '' : ' น.'})
            </div>
          `;
        }
        bannerEl.innerHTML = html;
      }
    }
  }

  onSelectAssignRetBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("assign-ret-bk")?.value;
    const form = document.getElementById("assign-ret-form");
    if (!bkId) {
      if (form) form.style.display = "none";
      return;
    }
    if (form) form.style.display = "block";
    this.populateStaffDropdowns();
    const dispSel = document.getElementById("assign-disp-bk");
    if (dispSel && dispSel.value !== bkId) {
      dispSel.value = bkId;
    }
    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
      const retPrintBtn = document.getElementById("btn-assign-ret-print-pdf");
      if (retPrintBtn) {
        retPrintBtn.href = b.checkin_pdf_url || `/api/pdf/inspection/${bkId}?type=checkin`;
        retPrintBtn.style.display = "block";
        retPrintBtn.onclick = (e) => {
          e.preventDefault();
          this.printInspectionForm('Return');
        };
      }
      const sDateEl = document.getElementById("assign-ret-start-date");
      const eDateEl = document.getElementById("assign-ret-end-date");
      const retDateEl = document.getElementById("assign-ret-date");
      const locEl = document.getElementById("assign-ret-loc");
      const timeEl = document.getElementById("assign-ret-time");
      const workerEl = document.getElementById("assign-ret-worker");
      const bannerEl = document.getElementById("assign-ret-status-banner");

      const thNow = this.getThaiDateTime(0);
      const sVal = b.start_date || thNow.date;
      const eVal = b.end_date || thNow.date;
      if (sDateEl) sDateEl.value = sVal;
      if (eDateEl) eDateEl.value = eVal;
      if (retDateEl) retDateEl.value = eVal;
      if (locEl) locEl.value = b.loc_return || b.loc_delivery || "";
      if (timeEl) timeEl.value = b.end_time || thNow.time;
      if (workerEl) {
        const w = String(b.worker_return || "").trim();
        if (w && w !== "Wait" && w !== "-" && Array.from(workerEl.options).some(o => o.value === w)) {
          workerEl.value = w;
        } else if (workerEl.options.length > 0) {
          workerEl.selectedIndex = 0;
        }
      }

      const odoEl = document.getElementById("assign-ret-odometer");
      const fuelEl = document.getElementById("assign-ret-fuel");
      const notesEl = document.getElementById("assign-ret-notes");
      const photosUrlEl = document.getElementById("assign-ret-photos-url");
      const photosPrevEl = document.getElementById("assign-ret-photos-preview");
      const badgeEl = document.getElementById("assign-ret-compare-badge");

      const imgFEl = document.getElementById("assign-ret-img-front");
      const imgLEl = document.getElementById("assign-ret-img-left");
      const imgReEl = document.getElementById("assign-ret-img-rear");
      const imgRiEl = document.getElementById("assign-ret-img-right");
      if (imgFEl) imgFEl.value = b.checkin_img_front || "";
      if (imgLEl) imgLEl.value = b.checkin_img_left || "";
      if (imgReEl) imgReEl.value = b.checkin_img_rear || "";
      if (imgRiEl) imgRiEl.value = b.checkin_img_right || "";

      if (odoEl) odoEl.value = b.odometer_in || b.return_mileage || "";
      const savedRetCats = b.inspection_categories_in || b.inspection_categories;
      ['petrol', 'cleanliness', 'tires', 'interior', 'underhood'].forEach(k => {
        const el = document.getElementById("assign-ret-chk-" + k);
        if (el) el.checked = savedRetCats ? (savedRetCats[k] !== false) : true;
      });
      if (fuelEl) fuelEl.value = b.fuel_in || b.return_fuel || fuelEl.value;
      if (notesEl) notesEl.value = b.inspection_notes_in || b.return_notes || b.remarks || "";
      if (photosUrlEl) photosUrlEl.value = b.inspection_photos_in || "";
      this.assignRetPhotos = b.inspection_photos_in ? b.inspection_photos_in.split(",").map(x => x.trim()).filter(Boolean) : [];
      this.renderInspectionPhotosPreview("Return", this.assignRetPhotos);

      if (badgeEl) {
        const outOdoFmt = b.odometer_out ? `${Number(b.odometer_out).toLocaleString()} กม.` : 'ไม่ได้ระบุ';
        const outFuelFmt = b.fuel_out || 'ไม่ได้ระบุ';
        const outNotesFmt = b.inspection_notes_out ? `"${b.inspection_notes_out}"` : 'ไม่มีบันทึก';
        badgeEl.innerHTML = `📌 <b>ข้อมูลตอนส่งมอบ (Outbound):</b> เลขไมล์: <span style="font-weight:700; color:#B45309;">${outOdoFmt}</span> | ระดับน้ำมัน: <span style="font-weight:700; color:#B45309;">${outFuelFmt}</span> | ตำหนิเดิม: <span style="font-style:italic;">${outNotesFmt}</span>`;
      }
      this.recalcReturnInspectionDiff();

      if (bannerEl) {
        const wRet = String(b.worker_return || "").trim();
        const hasDriver = wRet && wRet !== "Wait" && wRet !== "-";
        const sFmt = b.start_date_formatted || sVal;
        const eFmt = b.end_date_formatted || eVal;
        let html = `
          <div style="background:#FAF7F2; border:1px solid #E5E7EB; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#1F2937;">
            📅 <b>${isEn ? 'Return Schedule:' : 'กำหนดรับรถคืน:'}</b> <span style="color:#EA580C; font-weight:700;">${eFmt} (${b.end_time || '10:00'}${isEn ? '' : ' น.'})</span> &nbsp;|&nbsp; <b>${isEn ? 'Rental Start:' : 'วันเริ่มเช่า:'}</b> <span>${sFmt}</span>
          </div>
        `;
        if (hasDriver) {
          html += `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#166534;">
              🔙 <b>${isEn ? 'Return Staff Assigned:' : 'มอบหมายพนักงานรับรถคืนแล้ว:'}</b> ${wRet} (${isEn ? 'Date' : 'วันที่'} ${eFmt} ${isEn ? 'Time' : 'เวลา'} ${b.end_time || '10:00'}${isEn ? '' : ' น.'})
            </div>
          `;
        }
        bannerEl.innerHTML = html;
      }
    }
  }

  renderInspectionPhotosPreview(mode, photos = [], isUploading = false) {
    const isDisp = mode === "Dispatch";
    const prevEl = document.getElementById(isDisp ? "assign-disp-photos-preview" : "assign-ret-photos-preview");
    if (!prevEl) return;

    const angleDefs = [
      { key: "front", label: "1. ด้านหน้า (Front)", icon: "🚘" },
      { key: "left", label: "2. ด้านซ้าย (Left)", icon: "🚗" },
      { key: "rear", label: "3. ด้านหลัง (Rear)", icon: "🚙" },
      { key: "right", label: "4. ด้านขวา (Right)", icon: "🏎️" }
    ];

    prevEl.innerHTML = angleDefs.map((def, idx) => {
      const url = photos[idx];
      if (url) {
        const directSrc = this.convertDriveUrl ? this.convertDriveUrl(url) : url;
        return `
          <div style="position:relative; background:#0F172A; border-radius:8px; overflow:hidden; border:1.5px solid #EA580C; height:85px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
            <span style="position:absolute; top:3px; left:4px; background:rgba(15,23,42,0.88); color:#F8FAFC; font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; z-index:2; border:1px solid rgba(255,255,255,0.15);">
              ${def.label}
            </span>
            <img src="${directSrc}" onclick="window.open('${url || directSrc}', '_blank')" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" title="คลิกดูรูปขนาดเต็มในแท็บใหม่">
            <span style="position:absolute; bottom:3px; right:4px; font-size:9px; color:#10B981; font-weight:700; background:rgba(15,23,42,0.85); padding:1px 5px; border-radius:3px; border:1px solid rgba(16,185,129,0.3);">
              ${isUploading ? '⏳ กำลังอัปโหลด...' : '✓ GDrive'}
            </span>
          </div>
        `;
      }
      return `
        <div style="border:1.5px dashed #CBD5E1; border-radius:8px; height:85px; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#F8FAFC; color:#64748B; font-size:10px; font-weight:600; text-align:center; padding:4px;">
          <span style="font-size:16px; margin-bottom:2px;">${def.icon}</span>
          <span>${def.label}</span>
        </div>
      `;
    }).join("");
  }

  onInspectionPhotoUrlInput(mode, val) {
    const urls = String(val || "").split(",").map(x => x.trim()).filter(Boolean);
    if (mode === "Dispatch") this.assignDispPhotos = urls;
    else this.assignRetPhotos = urls;
    this.renderInspectionPhotosPreview(mode, urls, false);
  }

  async handleInspectionPhotoUpload(input, mode) {
    const isDisp = mode === "Dispatch";
    const fileInput = (input && input.files) ? input : document.getElementById(isDisp ? "assign-disp-photos-input" : "assign-ret-photos-input");
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk")?.value;
    const bkObj = (this.bookings || []).find(x => x.booking_id === bkId);
    let carPlate = bkObj?.car_id || "";

    if (!carPlate && !bkId) {
      alert("⚠️ กรุณาเลือกรหัสการจองก่อนเลือกรูปถ่ายสภาพรถยนต์");
      fileInput.value = "";
      return;
    }
    if (!carPlate) {
      carPlate = "unknown";
    }

    const filesToUpload = Array.from(fileInput.files).slice(0, 4);
    if (filesToUpload.length === 0) return;

    // Instant local preview for immediate visual feedback
    const tempUrls = filesToUpload.map(f => URL.createObjectURL(f));
    this.renderInspectionPhotosPreview(mode, tempUrls, true);

    const formData = new FormData();
    formData.append("booking_id", bkId || "");
    formData.append("job_type", mode);
    const angleNames = ["front", "left", "rear", "right"];
    filesToUpload.forEach((f, idx) => {
      formData.append("files", f);
      formData.append("photos", f);
      if (angleNames[idx]) {
        formData.append(angleNames[idx], f);
      }
    });

    this.showToast(`📸 กำลังอัปโหลดรูปรถ 4 มุม (${filesToUpload.length} รูป) ขึ้น Google Drive...`, "info");
    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(carPlate)}/4-angles`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const uploadedUrls = (data.urls || []).filter(Boolean);
        if (isDisp) this.assignDispPhotos = uploadedUrls;
        else this.assignRetPhotos = uploadedUrls;

        const urlInput = document.getElementById(isDisp ? "assign-disp-photos-url" : "assign-ret-photos-url");
        if (urlInput) urlInput.value = uploadedUrls.join(",");

        // Render permanent Google Drive links
        this.renderInspectionPhotosPreview(mode, uploadedUrls, false);

        // Update frontend car data immediately for Fleet & Car details modal
        if (this.cars && this.cars[carPlate]) {
          Object.assign(this.cars[carPlate], data.angles || {});
          if (data.angles?.img_front) {
            this.cars[carPlate].image = data.angles.img_front;
            this.cars[carPlate].image_url = data.angles.img_front;
          }
        }

        this.showToast(`✅ อัปโหลดรูปรถ 4 มุมขึ้น Google Drive และอัปเดตข้อมูลรถ (${carPlate}) สำเร็จ!`, "success");
      } else {
        throw new Error(data.detail || data.message || "Upload failed");
      }
    } catch (e) {
      this.showToast(`❌ อัปโหลดรูปรถ 4 มุมไม่สำเร็จ: ` + e.message, "danger");
      const curPhotos = isDisp ? this.assignDispPhotos : this.assignRetPhotos;
      this.renderInspectionPhotosPreview(mode, curPhotos || [], false);
    }
  }

  recalcReturnInspectionDiff() {
    const bkId = document.getElementById("assign-ret-bk")?.value;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const odoDiffEl = document.getElementById("assign-ret-mileage-diff");
    const fuelDiffEl = document.getElementById("assign-ret-fuel-diff");
    const inOdoVal = parseFloat(document.getElementById("assign-ret-odometer")?.value || "");

    if (b && odoDiffEl) {
      const outOdoVal = parseFloat(b.odometer_out || "");
      if (!isNaN(outOdoVal) && !isNaN(inOdoVal) && inOdoVal > 0) {
        const diff = inOdoVal - outOdoVal;
        if (diff >= 0) {
          odoDiffEl.innerHTML = `<span style="color:#059669; font-weight:700;">▲ ใช้งานไป ${diff.toLocaleString()} กม. (จากเลขไมล์ส่งมอบ ${outOdoVal.toLocaleString()})</span>`;
        } else {
          odoDiffEl.innerHTML = `<span style="color:#DC2626; font-weight:700;">⚠️ เลขไมล์น้อยกว่าตอนส่งมอบ (${outOdoVal.toLocaleString()} กม.) กรุณาตรวจสอบ</span>`;
        }
      } else {
        odoDiffEl.innerHTML = "";
      }
    }

    if (b && fuelDiffEl) {
      const outFuel = b.fuel_out || "";
      const inFuel = document.getElementById("assign-ret-fuel")?.value || "";
      if (outFuel && inFuel) {
        const fuelScore = (f) => {
          if (f.includes("เต็มถัง") || f.includes("Full")) return 4;
          if (f.includes("3/4")) return 3;
          if (f.includes("1/2")) return 2;
          if (f.includes("1/4")) return 1;
          return 0;
        };
        const sOut = fuelScore(outFuel);
        const sIn = fuelScore(inFuel);
        if (sIn < sOut) {
          fuelDiffEl.innerHTML = `<span style="color:#DC2626; font-weight:700;">⚠️ น้ำมันน้อยกว่าตอนส่งมอบ (${outFuel}) กรุณาพิจารณาคิดค่าน้ำมันเพิ่ม</span>`;
        } else if (sIn > sOut) {
          fuelDiffEl.innerHTML = `<span style="color:#059669; font-weight:700;">✅ น้ำมันมากกว่าตอนส่งมอบ (${outFuel})</span>`;
        } else {
          fuelDiffEl.innerHTML = `<span style="color:#4B5563;">ระดับน้ำมันเท่ากับตอนส่งมอบ</span>`;
        }
      } else {
        fuelDiffEl.innerHTML = "";
      }
    }
  }

  async submitAssign(jobType, actionType = "prepare") {
    const isDisp = jobType === "Dispatch";
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk").value;
    const worker = document.getElementById(isDisp ? "assign-disp-worker" : "assign-ret-worker").value;
    const loc = document.getElementById(isDisp ? "assign-disp-loc" : "assign-ret-loc").value;
    const tVal = document.getElementById(isDisp ? "assign-disp-time" : "assign-ret-time").value;
    const sDate = (isDisp ? document.getElementById("assign-disp-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-start-date" : "assign-ret-start-date")?.value || "";
    const eDate = (!isDisp ? document.getElementById("assign-ret-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-end-date" : "assign-ret-end-date")?.value || "";

    const bkObj = (this.bookings || []).find(x => x.booking_id === bkId);
    if (actionType === "handover") {
      if (bkObj && !bkObj.deposit_paid) {
        alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
        return;
      }
      if (bkObj && !bkObj.rental_paid) {
        alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ (สามารถกดปุ่ม \"กดจ่ายเงินค่าเช่า\" ในหน้านี้ได้ทันที)");
        this.openSettleModal(bkId);
        return;
      }
      if (bkObj && !bkObj.contract_issued) {
        alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาไปที่แท็บ \"4. จัดทำสัญญาเช่า\" เพื่อตรวจสอบและออกสัญญาเช่าให้เรียบร้อยก่อน");
        return;
      }
    }

    if (actionType === "complete") {
      // Route to inspection modal to ensure checklist and disposition branching (Branch A vs B)
      this.openHandoverModal(bkId, "Return");
      return;
    }

    const thNow = this.getThaiDateTime(0);
    if (isDisp && sDate && sDate < thNow.dateStr && actionType !== "handover") {
      if (!confirm(`⚠️ วันที่ส่งมอบ (${sDate}) เป็นวันย้อนหลังก่อนวันปัจจุบัน (${thNow.dateStr})\nคุณต้องการดำเนินการต่อหรือไม่?`)) {
        return;
      }
    }

    // Construct appointment_datetime from date + time
    const apptDate = isDisp ? sDate : eDate;
    const apptDatetime = (apptDate && tVal) ? `${apptDate} ${tVal}:00` : (apptDate || null);

    // TARGET MISSION 2 & 3: Decoupled API call to insert into work_order_logs
    try {
      await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_type: jobType,
          booking_id: bkId,
          staff_id: worker,
          appointment_datetime: apptDatetime,
          location: loc,
          job_status: actionType === "complete" ? "Completed" : "Pending",
          description: `ใบงาน${isDisp ? "ส่งมอบรถ (Dispatch)" : "รับรถคืน (Return)"} นัดหมาย: ${apptDatetime || '-'} สถานที่: ${loc || '-'}`
        })
      });
    } catch (woErr) {
      console.warn("[WorkOrder] Decoupled work order log creation notice:", woErr);
    }

    // Automatically upload any selected inspection photos if not already uploaded
    const photoInput = document.getElementById(isDisp ? "assign-disp-photos-input" : "assign-ret-photos-input");
    const existingPhotos = isDisp ? (this.assignDispPhotos || []) : (this.assignRetPhotos || []);
    if (photoInput && photoInput.files && photoInput.files.length > 0 && existingPhotos.length === 0) {
      await this.handleInspectionPhotoUpload(photoInput, jobType);
    }

    try {
      const res = await fetch(`/api/bookings/${bkId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_type: jobType,
          action_type: actionType === "handover" ? "handover_now" : (actionType === "complete" ? "complete_now" : "assign"),
          worker: worker,
          staff_id: worker,
          location: loc,
          time: tVal,
          start_date: sDate,
          end_date: eDate,
          appointment_datetime: apptDatetime,
          odometer: (document.getElementById(isDisp ? "assign-disp-odometer" : "assign-ret-odometer")?.value || "").trim(),
          odometer_out: isDisp ? (document.getElementById("assign-disp-odometer")?.value || "").trim() : undefined,
          odometer_in: !isDisp ? (document.getElementById("assign-ret-odometer")?.value || "").trim() : undefined,
          fuel_level: (document.getElementById(isDisp ? "assign-disp-fuel" : "assign-ret-fuel")?.value || "").trim(),
          fuel_out: isDisp ? (document.getElementById("assign-disp-fuel")?.value || "").trim() : undefined,
          fuel_in: !isDisp ? (document.getElementById("assign-ret-fuel")?.value || "").trim() : undefined,
          inspection_notes: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          inspection_notes_out: isDisp ? (document.getElementById("assign-disp-notes")?.value || "").trim() : undefined,
          inspection_notes_in: !isDisp ? (document.getElementById("assign-ret-notes")?.value || "").trim() : undefined,
          remarks: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          damage_notes: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          inspection_categories: {
            petrol: Boolean(document.getElementById(isDisp ? "assign-disp-chk-petrol" : "assign-ret-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById(isDisp ? "assign-disp-chk-cleanliness" : "assign-ret-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById(isDisp ? "assign-disp-chk-tires" : "assign-ret-chk-tires")?.checked),
            interior: Boolean(document.getElementById(isDisp ? "assign-disp-chk-interior" : "assign-ret-chk-interior")?.checked),
            underhood: Boolean(document.getElementById(isDisp ? "assign-disp-chk-underhood" : "assign-ret-chk-underhood")?.checked)
          },
          inspection_categories_out: isDisp ? {
            petrol: Boolean(document.getElementById("assign-disp-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById("assign-disp-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById("assign-disp-chk-tires")?.checked),
            interior: Boolean(document.getElementById("assign-disp-chk-interior")?.checked),
            underhood: Boolean(document.getElementById("assign-disp-chk-underhood")?.checked)
          } : undefined,
          inspection_categories_in: !isDisp ? {
            petrol: Boolean(document.getElementById("assign-ret-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById("assign-ret-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById("assign-ret-chk-tires")?.checked),
            interior: Boolean(document.getElementById("assign-ret-chk-interior")?.checked),
            underhood: Boolean(document.getElementById("assign-ret-chk-underhood")?.checked)
          } : undefined,
          inspection_photos: (isDisp ? (this.assignDispPhotos || []) : (this.assignRetPhotos || [])).length > 0
            ? (isDisp ? this.assignDispPhotos : this.assignRetPhotos).join(",")
            : (document.getElementById(isDisp ? "assign-disp-photos-url" : "assign-ret-photos-url")?.value || ""),
          checkin_img_front: !isDisp ? (document.getElementById("assign-ret-img-front")?.value || "").trim() : undefined,
          checkin_img_left: !isDisp ? (document.getElementById("assign-ret-img-left")?.value || "").trim() : undefined,
          checkin_img_rear: !isDisp ? (document.getElementById("assign-ret-img-rear")?.value || "").trim() : undefined,
          checkin_img_right: !isDisp ? (document.getElementById("assign-ret-img-right")?.value || "").trim() : undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("สร้างใบงานสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'สร้างใบงานสำเร็จ',
            text: `บันทึกใบงาน ${isDisp ? 'ส่งมอบรถ (Dispatch)' : 'รับรถคืน (Return)'} ลงระบบเรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        this.confirmedAssignSides = this.confirmedAssignSides || {};
        if (!this.confirmedAssignSides[bkId]) {
          this.confirmedAssignSides[bkId] = { Dispatch: false, Return: false };
        }
        this.confirmedAssignSides[bkId][jobType] = true;

        await this.loadBookings();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        if (isDisp) this.onSelectAssignDispBooking();
        else this.onSelectAssignRetBooking();

        if (actionType === "handover") {
          this.showToast(`🎉 ส่งมอบรถ ${bkId} เรียบร้อย! เปลี่ยนสถานะเป็น "กำลังเช่า" 🚗💨`, "success");
        } else if (actionType === "complete") {
          this.showToast(`🏁 รับรถคืน ${bkId} เรียบร้อย! เปลี่ยนสถานะเป็น "เสร็จสิ้น" และปล่อยรถว่างแล้ว 🎉`, "success");
        } else {
          if (isDisp) {
            this.showToast(`✅ บันทึกนัดหมายส่งมอบรถ (${data.booking?.status || 'เตรียมส่งมอบ'}) เรียบร้อย! กำลังไปหน้าจัดทำสัญญา...`, "success");
            this.switchTab("contract");
            const selContractBk = document.getElementById("contract-sel-bk");
            if (selContractBk) {
              selContractBk.value = bkId;
              this.onSelectContractBooking();
            }
          } else {
            this.showToast(`✅ บันทึกเตรียมนัดหมายรับรถคืน (${data.booking?.status || 'เสร็จสิ้น'}) เรียบร้อย!`, "success");
          }
        }
      } else {
        throw new Error(data.detail || data.error || "บันทึกใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async printInspectionForm(jobType) {
    const isEn = (this.currentLang === "EN");
    const isDisp = jobType === "Dispatch";
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk")?.value;
    if (!bkId) {
      alert(isEn ? "Please select a booking first." : "กรุณาเลือกรหัสการจองก่อนพิมพ์ใบตรวจสภาพรถ");
      return;
    }

    const odoVal = (document.getElementById(isDisp ? "assign-disp-odometer" : "assign-ret-odometer")?.value || "").trim();
    const fuelVal = (document.getElementById(isDisp ? "assign-disp-fuel" : "assign-ret-fuel")?.value || "").trim();
    const notesVal = (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim();
    const catsObj = {
      petrol: Boolean(document.getElementById(isDisp ? "assign-disp-chk-petrol" : "assign-ret-chk-petrol")?.checked),
      cleanliness: Boolean(document.getElementById(isDisp ? "assign-disp-chk-cleanliness" : "assign-ret-chk-cleanliness")?.checked),
      tires: Boolean(document.getElementById(isDisp ? "assign-disp-chk-tires" : "assign-ret-chk-tires")?.checked),
      interior: Boolean(document.getElementById(isDisp ? "assign-disp-chk-interior" : "assign-ret-chk-interior")?.checked),
      underhood: Boolean(document.getElementById(isDisp ? "assign-disp-chk-underhood" : "assign-ret-chk-underhood")?.checked)
    };

    const bObj = (this.bookings || []).find(x => x.booking_id === bkId) || {};
    const workerVal = document.getElementById(isDisp ? "assign-disp-worker" : "assign-ret-worker")?.value;
    const staffName = workerVal || (isDisp ? bObj.worker_delivery : bObj.worker_return) || "Staff";

    try {
      this.showToast(isEn ? "Generating Inspection PDF..." : "กำลังสร้างเอกสารใบตรวจสภาพรถ...", "info");
      const res = await fetch(`/api/bookings/${bkId}/generate-inspection-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspection_type: isDisp ? "checkout" : "checkin",
          odometer: odoVal,
          odometer_out: isDisp ? odoVal : undefined,
          odometer_in: !isDisp ? odoVal : undefined,
          fuel_level: fuelVal,
          fuel_out: isDisp ? fuelVal : undefined,
          fuel_in: !isDisp ? fuelVal : undefined,
          notes: notesVal,
          remarks: notesVal,
          damage_notes: notesVal,
          inspection_notes: notesVal,
          inspection_notes_out: isDisp ? notesVal : undefined,
          inspection_notes_in: !isDisp ? notesVal : undefined,
          inspection_categories: catsObj,
          inspection_categories_out: isDisp ? catsObj : undefined,
          inspection_categories_in: !isDisp ? catsObj : undefined,
          staff_name: staffName,
          customer_signature: bObj.customer || "Customer"
        })
      });
      const data = await res.json();
      if (data.success && data.pdf_url) {
        if (isDisp) bObj.checkout_pdf_url = data.pdf_url;
        else bObj.checkin_pdf_url = data.pdf_url;
        const openUrl = data.pdf_url.startsWith('http')
          ? data.pdf_url
          : (data.pdf_url + (data.pdf_url.includes('?') ? '&' : '?') + 't=' + Date.now());
        window.open(openUrl, '_blank');
      } else {
        throw new Error(data.detail || "สร้าง PDF ไม่สำเร็จ");
      }
    } catch (e) {
      console.error(e);
      this.showToast("เกิดข้อผิดพลาดในการพิมพ์ใบตรวจสภาพ: " + e.message, "danger");
    }
  }

  onSelectContractBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const card = document.getElementById("contract-details-card");
    const emptyMsg = document.getElementById("contract-empty-msg");
    if (!card) return;

    if (!bkId) {
      card.style.display = "none";
      if (emptyMsg) emptyMsg.style.display = (this.bookings && this.bookings.length === 0) ? "block" : "none";
      return;
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) {
      card.style.display = "none";
      if (emptyMsg) emptyMsg.style.display = "block";
      return;
    }

    if (emptyMsg) emptyMsg.style.display = "none";
    card.style.display = "block";

    const cust = this.customers.find(c => c.full_name === b.customer) || {};
    const car = this.cars.find(c => c.plate === b.car_id) || {};

    // Financial & Status variables declared upfront to avoid ReferenceError / TDZ
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const isDep = !!b.deposit_paid;
    const isRent = !!b.rental_paid;
    // TARGET MISSION 3: ยอดเงินคงเหลือ = ราคาค่าเช่าที่ตกลง (net_price) - เงินมัดจำที่ชำระแล้ว (deposit_amount)
    const remP = isRent ? 0 : (isDep ? Math.max(0, netP - depAmt) : parseFloat(b.remaining_rental !== undefined ? b.remaining_rental : netP));

    // Header with badges
    const header = document.getElementById("contract-header-info");
    if (header) {
      const isIssued = !!b.contract_issued;
      header.innerHTML = `
        <div>
          <span style="font-size:18px; font-weight:800; color:#1E3A8A; letter-spacing:0.5px;">📄 ${isEn ? 'Rental Contract ID:' : 'สัญญาเช่ารหัส:'} ${b.booking_id}</span>
          <span style="margin-left:8px;" class="badge ${isIssued ? 'badge-success' : 'badge-warning'}">
            ${isIssued ? (isEn ? '✅ Contract Issued' : '✅ ออกสัญญาเรียบร้อยแล้ว') : (isEn ? '⏳ Awaiting Issuance' : '⏳ รอยืนยันออกสัญญา')}
          </span>
          <span style="margin-left:4px;" class="badge badge-info">${b.status}</span>
        </div>
        <div style="font-size:12px; color:#64748B;">
          📅 ${isEn ? 'Created:' : 'จัดทำ:'} ${b.start_date_formatted || b.start_date} | ${isEn ? 'Recorded by:' : 'ผู้บันทึก:'} ${b.created_by || 'Admin'}
        </div>
      `;
    }

    // Customer
    const custEl = document.getElementById("contract-cust-info");
    if (custEl) {
      custEl.innerHTML = `
        • <b>${isEn ? 'Tenant Name:' : 'ชื่อผู้เช่า:'}</b> ${b.customer}<br/>
        • <b>${isEn ? 'Passport / ID Card:' : 'Passport / เลขบัตร:'}</b> ${cust.passport_id || b.customer_id_card || '-'}<br/>
        • <b>${isEn ? 'Phone / Contact:' : 'เบอร์ติดต่อ:'}</b> ${b.customer_phone || cust.contact_no || '-'}<br/>
        • <b>${isEn ? 'Driving License:' : 'ใบขับขี่:'}</b> ${cust.licence_no || '-'}<br/>
        • <b>${isEn ? 'Nationality:' : 'สัญชาติ:'}</b> ${cust.nationality || 'THAI'}
      `;
    }

    // Car
    const carEl = document.getElementById("contract-car-info");
    if (carEl) {
      carEl.innerHTML = `
        • <b>${isEn ? 'License Plate:' : 'หมายเลขทะเบียน:'}</b> <b style="color:#D97706;">${b.car_id}</b><br/>
        • <b>${isEn ? 'Brand / Model:' : 'ยี่ห้อ/รุ่น:'}</b> ${car.brand || b.car_brand || ''} ${car.model || b.car_model || ''}<br/>
        • <b>${isEn ? 'Group / Color:' : 'กลุ่มรถ/สี:'}</b> ${car.car_group || '-'} / ${car.color || '-'}<br/>
        • <b>${isEn ? 'Company / Fleet:' : 'บริษัทสังกัด:'}</b> ${car.company || '-'}<br/>
        • <b>${isEn ? 'Vehicle Status:' : 'สถานะรถ:'}</b> ${car.fleet_status_desc || car.status || (isEn ? 'Ready for Service' : 'พร้อมใช้งาน')}
      `;
    }

    // Schedule (Editable Thailand Date & Time)
    const schedEl = document.getElementById("contract-sched-info");
    if (schedEl) {
      const thNow = this.getThaiDateTime(0);
      const curSDate = b.start_date || thNow.dateStr;
      const curSTime = b.start_time || thNow.timeStr;
      const curEDate = b.end_date || this.getThaiDateTime(3).dateStr;
      const curETime = b.end_time || thNow.timeStr;
      const curLoc = b.loc_delivery || (isEn ? 'Front Office / Branch' : 'หน้าร้าน / สาขา');
      const isBackdated = curSDate < thNow.dateStr;

      schedEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div>
            • <b>${isEn ? 'Contract Start (Pick-up Thai Time):' : 'เริ่มสัญญา (Pick-up เวลาไทย):'}</b>
            <div style="display:flex; gap:6px; margin-top:3px;">
              <input type="date" id="contract-edit-start-date" class="form-control" style="padding:4px 8px; font-size:12.5px; border-color:${isBackdated ? '#EF4444' : '#CBD5E1'};" value="${curSDate}" min="${thNow.dateStr}" onchange="app.onContractStartDateChange(this.value)">
              <input type="time" id="contract-edit-start-time" class="form-control" style="padding:4px 8px; font-size:12.5px; max-width:115px;" value="${curSTime}">
            </div>
            <div id="contract-start-date-warn" style="display:${isBackdated ? 'block' : 'none'}; color:#DC2626; font-size:11.5px; font-weight:600; margin-top:4px; background:#FEF2F2; padding:6px 10px; border-radius:6px; border:1px solid #FCA5A5;">
              ${isEn
                ? `⚠️ Backdating protection: Start date (${curSDate}) is in the past (Today is ${thNow.dateStr}). Backdated contracts are not allowed. Please select today or future date.`
                : `⚠️ ป้องกันการลงสัญญาย้อนหลัง: วันที่เริ่มสัญญา (${curSDate}) เป็นวันที่ในอดีต (วันนี้คือ ${thNow.dateStr}) ไม่อนุญาตให้บันทึกสัญญาย้อนหลัง กรุณาแก้ไขวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`}
            </div>
          </div>
          <div>
            • <b>${isEn ? 'Contract End (Return Thai Time):' : 'สิ้นสุดสัญญา (Return เวลาไทย):'}</b>
            <div style="display:flex; gap:6px; margin-top:3px;">
              <input type="date" id="contract-edit-end-date" class="form-control" style="padding:4px 8px; font-size:12.5px;" value="${curEDate}" min="${curSDate > thNow.dateStr ? curSDate : thNow.dateStr}">
              <input type="time" id="contract-edit-end-time" class="form-control" style="padding:4px 8px; font-size:12.5px; max-width:115px;" value="${curETime}">
            </div>
          </div>
          <div>
            • <b>${isEn ? 'Delivery Location:' : 'สถานที่ส่งมอบ:'}</b>
            <input type="text" id="contract-edit-loc" class="form-control" style="padding:4px 8px; font-size:12.5px; margin-top:3px;" value="${curLoc}">
          </div>
          <div>• <b>${isEn ? 'Assigned Staff:' : 'พนักงานส่งมอบ:'}</b> ${b.worker_delivery || (isEn ? 'Unassigned' : 'ยังไม่ได้มอบหมาย')}</div>
          <div>• <b>${isEn ? 'Current Booking Status:' : 'สถานะการจองปัจจุบัน:'}</b> <span class="badge ${b.status === 'กำลังเช่า' ? 'badge-primary' : (b.status === 'เสร็จสิ้น' ? 'badge-success' : 'badge-info')}">${b.status}</span></div>
          <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
            <!-- ซ่อนปุ่ม 'ใช้วัน-เวลาปัจจุบัน' ออกจากหน้าจอทำสัญญาเช่า -->
            <button type="button" onclick="app.setContractToCurrentThaiTime()" class="btn btn-outline btn-sm" style="display:none; font-size:11.5px; padding:4px 10px;" title="${isEn ? 'Set dates to current Thai time' : 'ปรับวันและเวลาให้ตรงกับปัจจุบัน'}">
              🕒 ${isEn ? 'Use Current Time' : 'ใช้วัน-เวลาปัจจุบัน'}
            </button>
            <button type="button" onclick="app.saveContractSchedule()" class="btn btn-primary btn-sm" style="font-size:11.5px; padding:4px 10px;">
              💾 ${isEn ? 'Save Schedule' : 'บันทึกวัน-เวลาสัญญา'}
            </button>
            ${['รอส่งมอบ', 'เตรียมส่งมอบ'].includes(b.status) && b.contract_issued ? `
            <button type="button" onclick="app.quickConfirmHandover('${b.booking_id}')" class="btn btn-success btn-sm" style="font-size:11.5px; padding:4px 10px; font-weight:600;" title="${isEn ? 'Handed vehicle over to customer ➔ Update status to Renting' : 'ส่งมอบรถให้ลูกค้าแล้ว ➔ ปรับสถานะเป็น กำลังเช่า'}">
              🚚 ${isEn ? 'Handed Over (Renting) ➔' : 'ส่งมอบรถแล้ว (กำลังเช่า) ➔'}
            </button>` : ''}
            ${['กำลังเช่า', 'เตรียมรับคืน'].includes(b.status) ? `
            <button type="button" onclick="app.openExtendContract()" class="btn btn-warning btn-sm" style="font-size:11.5px; padding:4px 10px; font-weight:700; background:#f59e0b; border-color:#d97706; color:#1F2937;" title="${isEn ? 'Extend Contract Period' : 'ต่อสัญญา (Extend Contract)'}">
              📝 ${isEn ? 'Extend Contract' : 'ต่อสัญญา (Extend Contract)'}
            </button>` : ''}
          </div>
          ${!isRent ? `
            <div style="background:#FFFBEB; border:1.5px solid #FCD34D; border-radius:6px; padding:7px 10px; font-size:12px; color:#92400E; margin-top:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
              <span>⏳ <b>รอชำระค่าเช่าคงเหลือ: ฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</b></span>
              <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-sm btn-success" style="padding:3px 10px; font-size:11.5px; font-weight:700; background:#10B981; border-color:#059669;">
                💳 ${isEn ? 'Pay Rental Balance' : 'รับชำระค่าเช่าคงเหลือ'}
              </button>
            </div>
          ` : (!b.contract_issued ? `
            <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:6px; padding:7px 10px; font-size:12px; color:#1E40AF; margin-top:8px;">
              📝 <b>ชำระค่าเช่าครบแล้ว</b> ➔ กรุณากดปุ่ม <b>"📝 ดาวน์โหลดสัญญาเช่า (PDF)"</b> เพื่อออกสัญญาและเริ่มการเช่าทันที
            </div>
          ` : `
            <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:6px; padding:7px 10px; font-size:12px; color:#166534; margin-top:8px;">
              ✅ <b>ออกสัญญาเช่าเรียบร้อยแล้ว</b> พร้อมส่งมอบรถ (กำลังเช่า)
            </div>
          `)}
        </div>
      `;
    }

    // Financial
    const netEl = document.getElementById("contract-net-price");
    if (netEl) netEl.textContent = `฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const depEl = document.getElementById("contract-dep-status");
    const depSlip = b.deposit_slip || b.payment_slip_url;
    const rentSlip = b.remaining_slip_link || b.rental_slip;
    if (depEl) {
      let refText = b.deposit_ref ? ` (Ref: ${b.deposit_ref})` : '';
      let slipLink = depSlip ? ` <a href="javascript:void(0)" onclick="app.viewSlip('${depSlip}', '${isEn ? 'Deposit Slip' : 'สลิปมัดจำ'} (${b.booking_id})')" style="color:#0284C7; font-size:12px; text-decoration:underline; font-weight:700; cursor:pointer;">[📎 ${isEn ? 'View Deposit Slip' : 'ดูสลิปมัดจำ'}]</a>` : '';
      depEl.innerHTML = isDep 
        ? `<span style="color:#059669;">${isEn ? 'Paid' : 'ชำระแล้ว'} (฿${depAmt.toLocaleString()})${refText}${slipLink}</span>`
        : `<span style="color:#DC2626;">${isEn ? 'Pending Deposit' : 'รอมัดจำ'} (฿${depAmt.toLocaleString()})</span>`;
    }

    const remEl = document.getElementById("contract-rem-price");
    if (remEl) {
      let rentSlipLink = (rentSlip && rentSlip !== depSlip) 
        ? ` <a href="javascript:void(0)" onclick="app.viewSlip('${rentSlip}', '${isEn ? 'Rental Slip' : 'สลิปค่าเช่า'} (${b.booking_id})')" style="color:#059669; font-size:12px; text-decoration:underline; font-weight:700; cursor:pointer;">[📎 ${isEn ? 'View Rental Slip' : 'ดูสลิปค่าเช่า'}]</a>` 
        : '';
      remEl.innerHTML = isRent 
        ? `<span style="color:#059669;">฿0.00 (${isEn ? 'Fully Paid' : 'ชำระครบแล้ว'})${rentSlipLink}</span>`
        : `<span style="color:#E85826;">฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
           <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-sm btn-success" style="padding:2px 8px; font-size:11px; font-weight:700; margin-left:6px; vertical-align:middle; background:#10B981; border-color:#059669;">
             💳 ${isEn ? 'Pay Balance' : 'รับชำระค่าเช่า'}
           </button>`;
    }

    const contractInspBtn = document.getElementById("btn-contract-print-inspection");
    if (contractInspBtn) {
      contractInspBtn.href = b.checkout_pdf_url || b.checkin_pdf_url || `/api/pdf/inspection/${b.booking_id}`;
      contractInspBtn.style.display = "inline-flex";
    }
    // Extend-contract button only for rentals that are currently On Rent
    const extBtn = document.getElementById("btn-extend-contract");
    if (extBtn) extBtn.style.display = ["กำลังเช่า", "เตรียมรับคืน"].includes(b.status) ? "inline-flex" : "none";
    this.closeExtendContract();

    // Status pill
    const pill = document.getElementById("contract-issued-status-pill");
    if (pill) {
      pill.innerHTML = "";
    }
  }

  onContractStartDateChange(val) {
    const thNow = this.getThaiDateTime(0);
    const warnEl = document.getElementById("contract-start-date-warn");
    const sDateInput = document.getElementById("contract-edit-start-date");
    const eDateInput = document.getElementById("contract-edit-end-date");

    if (eDateInput && val) {
      eDateInput.min = val;
      if (eDateInput.value && eDateInput.value < val) {
        eDateInput.value = val;
      }
    }

    if (val && val < thNow.dateStr) {
      if (sDateInput) sDateInput.style.borderColor = "#EF4444";
      if (warnEl) {
        warnEl.style.display = "block";
        warnEl.innerHTML = `⚠️ ป้องกันการลงสัญญาย้อนหลัง: วันที่เริ่มสัญญา (${val}) เป็นวันที่ในอดีต (วันนี้คือ ${thNow.dateStr}) ไม่อนุญาตให้บันทึกสัญญาย้อนหลัง กรุณาแก้ไขวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`;
      }
    } else {
      if (sDateInput) sDateInput.style.borderColor = "#CBD5E1";
      if (warnEl) warnEl.style.display = "none";
    }
  }

  async setContractToCurrentThaiTime() {
    const thNow = this.getThaiDateTime(0);
    const sDateEl = document.getElementById("contract-edit-start-date");
    const sTimeEl = document.getElementById("contract-edit-start-time");
    const eTimeEl = document.getElementById("contract-edit-end-time");
    if (sDateEl) {
      sDateEl.value = thNow.dateStr;
      this.onContractStartDateChange(thNow.dateStr);
    }
    if (sTimeEl) sTimeEl.value = thNow.timeStr;
    if (eTimeEl) eTimeEl.value = thNow.timeStr;
    await this.saveContractSchedule();
  }

  async saveContractSchedule(silent = false) {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    if (!bkId) return;
    const sDate = document.getElementById("contract-edit-start-date")?.value;
    const sTime = document.getElementById("contract-edit-start-time")?.value;
    const eDate = document.getElementById("contract-edit-end-date")?.value;
    const eTime = document.getElementById("contract-edit-end-time")?.value;
    const loc = document.getElementById("contract-edit-loc")?.value;

    const thNow = this.getThaiDateTime(0);

    // Validation: prevent backdated contract start date
    if (sDate && sDate < thNow.dateStr) {
      alert(`⚠️ ป้องกันการลงสัญญาเช่าย้อนหลัง!\n\nไม่สามารถบันทึกวันเริ่มสัญญาเป็นวันที่ในอดีตได้ (${sDate})\nวันที่ปัจจุบันของระบบคือ: ${thNow.dateStr}\n\nกรุณาเลือกวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`);
      const sDateEl = document.getElementById("contract-edit-start-date");
      if (sDateEl) {
        sDateEl.value = thNow.dateStr;
        this.onContractStartDateChange(thNow.dateStr);
        sDateEl.focus();
      }
      return;
    }

    if (eDate && sDate && eDate < sDate) {
      alert(`⚠️ วันสิ้นสุดสัญญา (${eDate}) ต้องไม่เกิดขึ้นก่อนวันเริ่มสัญญา (${sDate})`);
      return;
    }

    const payload = {};
    if (sDate) payload.start_date = sDate;
    if (sTime) payload.start_time = sTime;
    if (eDate) payload.end_date = eDate;
    if (eTime) payload.end_time = eTime;
    if (loc !== undefined) payload.loc_delivery = loc;

    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.detail) {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
      if (data.success) {
        if (!silent) {
          this.showToast("✅ บันทึกวัน-เวลาสัญญาเช่า (เวลาประเทศไทย) เรียบร้อย!", "success");
        }
        await this.loadBookings();
        this.onSelectContractBooking();
      }
    } catch (e) {
      if (!silent) this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
      alert(e.message);
    }
  }

  async quickConfirmHandover(bkId) {
    if (!bkId) return;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (!b) return;
    const carPlate = b.car_id || "";
    const custName = b.customer || "";

    if (!b.deposit_paid) {
      alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
      return;
    }
    if (!b.rental_paid) {
      alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ (สามารถกดปุ่ม \"รับชำระค่าเช่าคงเหลือ\" ได้ทันที)");
      this.openSettleModal(bkId);
      return;
    }
    if (!b.contract_issued) {
      alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาตรวจสอบเอกสารและกดยืนยันออกสัญญาด้านล่างก่อน");
      return;
    }
    
    if (!confirm(`🚚 ยืนยันการส่งมอบรถ ${carPlate} ให้คุณ ${custName} เรียบร้อยแล้ว?\n\nระบบจะปรับสถานะรายการจองเป็น "กำลังเช่า" และปรับสถานะรถเป็น "กำลังเช่า" ทันที`)) {
      return;
    }

    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "กำลังเช่า" })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 ส่งมอบรถ ${carPlate} สำเร็จ! สถานะเปลี่ยนเป็น "กำลังเช่า" 🚗💨`, "success");
        await this.loadBookings();
        await this.loadCars();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
      } else {
        throw new Error(data.detail || "อัปเดตสถานะไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async quickConfirmReturn(bkId) {
    if (!bkId) return;
    // Strictly open Return Inspection Checklist to enforce Branch A vs Branch B disposition
    this.openHandoverModal(bkId, "Return");
  }

  async markContractIssued() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    if (!bkId) return;
    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_issued: true })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast("✅ บันทึกสถานะออกสัญญาเช่าเรียบร้อย!", "success");
        await this.loadBookings();
        this.onSelectContractBooking();
      } else {
        throw new Error(data.detail || "ไม่สามารถออกสัญญาได้");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  openExtendContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const panel = document.getElementById("contract-extend-panel");
    if (!b || !panel) return;
    if (!["กำลังเช่า", "เตรียมรับคืน"].includes(b.status)) {
      alert("⚠️ ต่อสัญญาได้เฉพาะรายการที่อยู่ในสถานะ \"กำลังเช่า\" เท่านั้น");
      return;
    }
    const curEnd = String(b.end_date || "").split("T")[0];
    const dEl = document.getElementById("contract-extend-end-date");
    const tEl = document.getElementById("contract-extend-end-time");
    const cbEl = document.getElementById("contract-extend-also-rent");
    const info = document.getElementById("contract-extend-current");
    if (info) info.textContent = `สัญญาเดิมสิ้นสุด: ${b.end_date_formatted || curEnd} (${b.end_time || "10:00"} น.)`;
    if (dEl) {
      const d = new Date(`${curEnd}T00:00:00`);
      d.setDate(d.getDate() + 1);
      const nextDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dEl.min = nextDay;
      dEl.value = nextDay;
    }
    if (tEl) tEl.value = b.end_time || "10:00";
    if (cbEl) cbEl.checked = true;
    panel.style.display = "block";
    this.onExtendDateChange();
  }

  closeExtendContract() {
    const panel = document.getElementById("contract-extend-panel");
    if (panel) panel.style.display = "none";
  }

  async onExtendDateChange() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const newEnd = document.getElementById("contract-extend-end-date")?.value;
    const prev = document.getElementById("contract-extend-preview");
    const btn = document.getElementById("btn-submit-extend");
    if (!prev || !bkId || !newEnd) return;
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bkId)}/extend-check?new_end_date=${encodeURIComponent(newEnd)}`);
      const data = await res.json();
      if (data.ok) {
        prev.innerHTML = `<span style="color:#15803D; font-weight:700;">✅ คิวว่าง ต่อสัญญาได้</span> · เพิ่ม ${data.extra_days} วัน · ค่าเช่าเพิ่ม ฿${Number(data.extra_price).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
        if (btn) btn.disabled = false;
      } else {
        prev.innerHTML = `<span style="color:#DC2626; font-weight:700;">⛔ ${data.message || "ไม่สามารถต่อสัญญาได้"}</span>`;
        if (btn) btn.disabled = true;
      }
    } catch (e) {
      prev.textContent = "ไม่สามารถตรวจสอบคิวได้: " + e.message;
    }
  }

  async submitExtendContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const newEnd = document.getElementById("contract-extend-end-date")?.value;
    const newTime = document.getElementById("contract-extend-end-time")?.value;
    const alsoRent = Boolean(document.getElementById("contract-extend-also-rent")?.checked);
    const payMethod = document.getElementById("contract-extend-method")?.value || "โอนเงิน / สแกน QR";
    if (!bkId || !newEnd) {
      alert("กรุณาระบุวันที่ต่อสัญญาใหม่");
      return;
    }
    const bObj = this.bookings.find(x => x.booking_id === bkId) || {};
    const conflict = this.findBookingConflict(
      bObj.car_id,
      String(bObj.end_date || "").split("T")[0],
      newEnd,
      bkId
    );
    if (conflict) {
      alert(`⚠️ ไม่สามารถต่อสัญญาได้: ติดจองคิวอื่นในวันที่จะต่อ\n\nรหัสจอง: ${conflict.booking_id}\nลูกค้า: ${conflict.customer}\nช่วงวันที่: ${conflict.start_date_formatted || conflict.start_date} - ${conflict.end_date_formatted || conflict.end_date}`);
      return;
    }
    const payNote = alsoRent ? `พร้อมรับชำระค่าเช่าเต็มจำนวน (${payMethod})` : "โดยรอรับชำระค่าเช่าภายหลัง";
    if (!confirm(`ยืนยันต่อสัญญา ${bkId} ถึงวันที่ ${newEnd} ${payNote} และออกสัญญาเช่าใหม่?`)) return;
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bkId)}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_end_date: newEnd,
          new_end_time: newTime,
          also_pay_rental: alsoRent,
          payment_method: payMethod
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || "ต่อสัญญาไม่สำเร็จ");
      }
      this.closeExtendContract();
      this.showToast(`🔁 ต่อสัญญา ${bkId} ถึง ${newEnd} เรียบร้อย (+${data.extra_days} วัน ฿${Number(data.extra_price).toLocaleString("th-TH")}) — บันทึกสัญญาใหม่เป็น PDF`, "success");
      await this.loadBookings();
      await this.loadCars();
      this.onSelectContractBooking();
      if (data.pdf_url) window.open(`${data.pdf_url}&t=${Date.now()}`, "_blank");
      if (alsoRent) {
        alert(`✅ ต่อสัญญาและรับชำระค่าเช่าเต็มจำนวน (฿${Number(data.extra_price).toLocaleString("th-TH")}) เรียบร้อยแล้ว`);
      } else {
        alert("✅ ออกสัญญาเช่าใหม่เรียบร้อย (ไฟล์ PDF ถูกดาวน์โหลดแล้ว)\nกรุณาชำระค่าเช่าส่วนที่ต่อที่หน้า \"ชำระเงิน\"");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  goToDepositFromContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    this.switchTab("deposit");
    if (bkId) {
      const depSel = document.getElementById("deposit-sel-booking");
      if (depSel) {
        depSel.value = bkId;
        this.onSelectDepositBooking();
      }
    }
  }

  async downloadContractPdf(bkId) {
    const selBk = document.getElementById("contract-sel-bk")?.value;
    const id = bkId || selBk || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดสัญญาเช่า", "warning");
      return;
    }
    if (selBk && id === selBk && document.getElementById("contract-edit-start-time")) {
      await this.saveContractSchedule(true);
    }
    const pdfUrl = `/api/pdf/contract/${encodeURIComponent(id)}`;
    this.showToast(`📝 กำลังดาวน์โหลดสัญญาเช่า PDF สำหรับ ${id}...`, "info");
    window.open(`${pdfUrl}?t=${Date.now()}`, "_blank");

    try {
      const bFound = (this.bookings || []).find(x => x.booking_id === id);
      const existingContract = bFound?.contract_pdf_url;
      const finalContractUrl = (existingContract && existingContract.includes("drive.google.com")) ? existingContract : (existingContract || pdfUrl);
      const res = await fetch(`/api/bookings/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_issued: true,
          contract_pdf_url: finalContractUrl,
          status: "กำลังเช่า",
          dispatch_closed: true
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 ออกสัญญาและส่งมอบรถ ${id} เรียบร้อย! เปลี่ยนสถานะเป็น "กำลังเช่า" 🚗💨`, "success");
        await this.loadBookings();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        this.onSelectContractBooking();
      } else if (data.detail) {
        console.warn("Handover on contract download:", data.detail);
      }
    } catch (e) {
      console.error("Contract handover auto-trigger error:", e);
    }
  }

  downloadDepositReceipt(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบเสร็จมัดจำ", "warning");
      return;
    }
    this.showToast(`🧾 กำลังดาวน์โหลดใบเสร็จรับเงินมัดจำ PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/deposit-receipt/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  }

  downloadRentalReceipt(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบเสร็จค่าเช่า", "warning");
      return;
    }
    this.showToast(`🧾 กำลังดาวน์โหลดใบเสร็จรับเงินค่าเช่า PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/receipt/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  }

  downloadJobPdf(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบตรวจสภาพรถ", "warning");
      return;
    }
    this.showToast(`📋 กำลังดาวน์โหลดใบตรวจสภาพรถ PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/job/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  }

  updateBookingMonthOptions(curYm) {
    const sel = document.getElementById("bks-month-filter");
    if (!sel) return;
    const bkCount = (this.bookings || []).length;
    if (sel.dataset.initializedCount === String(bkCount) && sel.options.length > 2) return;

    const isEn = (this.currentLang === "EN");
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const monthsSet = new Set();
    monthsSet.add(curYm);
    (this.bookings || []).forEach(b => {
      const d = b.start_date || b.end_date || b.created_at;
      if (d && typeof d === "string") {
        const ym = d.substring(0, 7);
        if (/^\d{4}-\d{2}$/.test(ym)) {
          monthsSet.add(ym);
        }
      }
    });

    const sortedMonths = Array.from(monthsSet).sort().reverse();
    const currentVal = sel.value || "current";

    const [curY, curM] = curYm.split("-");
    const curMIdx = parseInt(curM, 10) - 1;
    const curThYear = parseInt(curY, 10) + 543;
    const curLabel = isEn ? `Current Month (${enMonths[curMIdx]} ${curY})` : `เดือนปัจจุบัน (${thaiMonths[curMIdx]} ${curThYear})`;

    let html = `<option value="current">📅 ${curLabel}</option>`;
    sortedMonths.forEach(ym => {
      const [y, m] = ym.split("-");
      const mIdx = parseInt(m, 10) - 1;
      const thYear = parseInt(y, 10) + 543;
      const label = isEn ? `${enMonths[mIdx]} ${y}` : `${thaiMonths[mIdx]} ${thYear} (${ym})`;
      html += `<option value="${ym}">${label}</option>`;
    });
    html += `<option value="all">📅 ${isEn ? 'All Time (No Filter)' : 'ดูทั้งหมด (All Time)'}</option>`;

    sel.innerHTML = html;
    sel.value = currentVal;
    sel.dataset.initializedCount = String(bkCount);
  }

  renderBookingsTable() {
    const tbody = document.getElementById("bookings-table-body");
    if (!tbody) return;

    const kw = (document.getElementById("bks-search-input")?.value || "").toLowerCase().trim();
    const isEn = (this.currentLang === "EN");
    const stFilter = document.getElementById("bks-status-filter")?.value || "ทั้งหมด";
    const monthFilter = document.getElementById("bks-month-filter")?.value || "current";

    // Current year-month in YYYY-MM format
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, "0");
    const curYm = `${curYear}-${curMonth}`;

    // Dynamically update dropdown options for historical months
    this.updateBookingMonthOptions(curYm);

    const filtered = (this.bookings || []).filter(b => {
      // 1. Status Filter (Target Mission 3: Hide "เสร็จสิ้น" / Completed from active pipeline by default)
      if (stFilter === "ทั้งหมด" || stFilter === "All" || !stFilter) {
        if (b.status === "เสร็จสิ้น" || b.status === "Completed" || b.status === "completed") return false;
      } else if (stFilter !== "all_with_completed") {
        if (b.status !== stFilter) return false;
      }

      // 2. Keyword Filter
      if (kw) {
        const s = `${b.booking_id} ${b.car_id} ${b.customer} ${b.status}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }

      // 3. Month Filter (Default: Current Month, reset view every month, keep DB intact)
      if (monthFilter !== "all") {
        const targetYm = (monthFilter === "current") ? curYm : monthFilter;
        const bStart = b.start_date ? String(b.start_date).split("T")[0] : "";
        const bEnd = b.end_date ? String(b.end_date).split("T")[0] : "";
        const bCreated = b.created_at ? String(b.created_at).split("T")[0] : "";

        const inStart = bStart.startsWith(targetYm);
        const inEnd = bEnd.startsWith(targetYm);
        const inCreated = bCreated.startsWith(targetYm);

        // Also check if rental period spans across the month
        let spansMonth = false;
        if (bStart && bEnd && targetYm.length === 7) {
          const mStart = `${targetYm}-01`;
          const mEnd = `${targetYm}-31`;
          if (bStart <= mEnd && bEnd >= mStart) {
            spansMonth = true;
          }
        }

        if (!inStart && !inEnd && !inCreated && !spansMonth) {
          return false;
        }
      }

      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748B;">${isEn ? 'No bookings found' : 'ไม่พบรายการจอง'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(b => {
      const isDep = b.deposit_paid;
      const isRent = b.rental_paid;
      const netP = parseFloat(b.net_price || 0);

      let depBadge = isDep 
        ? `<span class="badge badge-success">${isEn ? 'Deposit Paid' : 'มัดจำแล้ว'}</span>` 
        : `<span class="badge badge-warning">${isEn ? 'Pending Deposit' : 'รอมัดจำ'}</span>`;
      let rentBadge = isRent 
        ? `<span class="badge badge-success">${isEn ? 'Fully Paid' : 'จ่ายครบ'}</span>` 
        : `<span class="badge badge-danger">${isEn ? 'Unpaid' : 'ค้างชำระ'}</span>`;

      return `
        <tr>
          <td>
            <b style="color:#D97706;">${b.booking_id}</b>
          </td>
          <td>
            <b>${b.car_id}</b><br/>
            <span style="font-size:11px; color:#64748B;">${b.car_brand || ''} ${b.car_model || ''}</span>
          </td>
          <td>
            <b>${b.customer}</b><br/>
            <span style="font-size:11px; color:#64748B;">📞 ${b.customer_phone || '-'}</span>
          </td>
          <td style="font-size:12px;">
            ${b.start_date_formatted} (${b.start_time || '10:00'})<br/>
            ${isEn ? 'to' : 'ถึง'} ${b.end_date_formatted} (${b.end_time || '10:00'})
          </td>
          <td style="font-weight:700; color:#1E293B;">
            ฿${netP.toLocaleString()}
          </td>
          <td>
            ${depBadge} ${rentBadge}
            ${b.deposit_ref ? `<div style="font-size:10.5px; color:#475569; margin-top:3px;">Ref: <code style="background:#FEF3C7; color:#92400E; padding:1px 4px; border-radius:3px;">${b.deposit_ref}</code></div>` : ''}
          </td>
          <td>
            <div style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
              <span class="badge ${
                b.status === 'กำลังเช่า' ? 'badge-primary' : 
                (b.status === 'เสร็จสิ้น' ? 'badge-success' : 
                (b.status === 'ยกเลิก' ? 'badge-danger' : 
                (b.status === 'เตรียมส่งมอบ' ? 'badge-warning' : 'badge-info')))
              }">${b.status}</span>
              ${['รอส่งมอบ', 'เตรียมส่งมอบ'].includes(b.status) ? (
                b.contract_issued ? `
                  <button type="button" onclick="app.quickConfirmHandover('${b.booking_id}')" class="btn btn-sm btn-success" style="font-size:11px; padding:2px 8px; white-space:nowrap; border-radius:4px; font-weight:600;" title="${isEn ? 'Handed vehicle over ➔ Update status to Renting' : 'ส่งมอบรถแล้ว ➔ ปรับสถานะเป็น กำลังเช่า'}">
                    🚚 ${isEn ? 'Handed Over' : 'ส่งมอบรถแล้ว'}
                  </button>
                ` : `
                  <button type="button" onclick="app.goToTabWithBooking('contract', '${b.booking_id}')" class="btn btn-sm btn-secondary" style="font-size:10.5px; padding:2px 6px; white-space:nowrap; border-radius:4px; font-weight:600; background:#EFF6FF; border-color:#BFDBFE; color:#1E40AF;" title="${isEn ? 'Issue contract in Tab 4 first' : 'ต้องออกสัญญาเช่าในแท็บ 4 ก่อนส่งมอบรถ'}">
                    📝 ${isEn ? 'Issue Contract' : 'รอออกสัญญา'}
                  </button>
                `
              ) : ''}
              ${['กำลังเช่า', 'เตรียมรับคืน'].includes(b.status) ? `
                <button type="button" onclick="app.openHandoverModal('${b.booking_id}', 'Return')" class="btn btn-sm btn-warning" style="font-size:11px; padding:2px 8px; white-space:nowrap; color:#1E293B; border-radius:4px; font-weight:600;" title="${isEn ? 'Customer returned vehicle ➔ Inspection & Return Checklist' : 'ลูกค้านำรถมาคืน ➔ ตรวจสภาพตาม Checklist และรับรถคืน'}">
                  🏁 ${isEn ? 'Return & Inspect' : 'ตรวจรับรถคืน'}
                </button>
              ` : ''}
            </div>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${(() => {
              const depSlip = b.deposit_slip || b.payment_slip_url;
              const rentSlip = b.remaining_slip_link || b.rental_slip;
              const hasDep = Boolean(depSlip);
              const hasRent = Boolean(rentSlip && rentSlip !== depSlip);
              if (hasDep && hasRent) {
                return `
                  <button type="button" onclick="app.viewSlip('${depSlip}', '${isEn ? 'Deposit Slip (Slip 1)' : 'สลิปมัดจำ (ใบที่ 1)'} (${b.booking_id})')" class="btn btn-sm btn-secondary" style="background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700; padding:2px 6px; font-size:11px;" title="${isEn ? 'View Deposit Slip (Slip 1)' : 'ดูสลิปมัดจำ (ใบที่ 1)'} (Ref: ${b.deposit_ref || '-'})">📎 ${isEn ? 'Deposit' : 'สลิปมัดจำ'}</button>
                  <button type="button" onclick="app.viewSlip('${rentSlip}', '${isEn ? 'Rental Slip (Slip 2)' : 'สลิปค่าเช่า (ใบที่ 2)'} (${b.booking_id})')" class="btn btn-sm btn-secondary" style="background:#F0FDF4; border-color:#86EFAC; color:#15803D; font-weight:700; padding:2px 6px; font-size:11px; margin-left:3px;" title="${isEn ? 'View Rental Balance Slip (Slip 2)' : 'ดูสลิปชำระค่าเช่าคงเหลือ (ใบที่ 2)'} (Ref: ${b.rental_ref || '-'})">📎 ${isEn ? 'Rental' : 'สลิปค่าเช่า'}</button>
                `;
              } else if (hasDep) {
                return `
                  <button type="button" onclick="app.viewSlip('${depSlip}', '${isEn ? 'Deposit Slip' : 'สลิปมัดจำ'} (${b.booking_id})')" class="btn btn-sm btn-secondary" style="background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700; padding:2px 7px; font-size:11px;" title="${isEn ? 'View Deposit Slip' : 'ดูสลิปมัดจำ'} (Ref: ${b.deposit_ref || '-'})">📎 ${isEn ? 'Deposit Slip' : 'สลิปมัดจำ'}</button>
                `;
              } else if (hasRent) {
                return `
                  <button type="button" onclick="app.viewSlip('${rentSlip}', '${isEn ? 'Rental Slip' : 'สลิปค่าเช่า'} (${b.booking_id})')" class="btn btn-sm btn-secondary" style="background:#F0FDF4; border-color:#86EFAC; color:#15803D; font-weight:700; padding:2px 7px; font-size:11px;" title="${isEn ? 'View Rental Slip' : 'ดูสลิปค่าเช่า'} (Ref: ${b.rental_ref || '-'})">📎 ${isEn ? 'Rental Slip' : 'สลิปค่าเช่า'}</button>
                `;
              }
              return '';
            })()}
            <a href="${b.contract_pdf_url || `/api/pdf/contract/${b.booking_id}`}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Rental Agreement PDF' : 'สัญญาเช่า (Rental Agreement PDF)'}">📝</a>
            <a href="/api/pdf/deposit-receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Deposit Receipt PDF' : 'ใบเสร็จมัดจำ (Deposit Receipt PDF)'}">🛡️</a>
            <a href="/api/pdf/receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Rental Receipt PDF' : 'ใบเสร็จค่าเช่า (Rental Receipt PDF)'}">🧾</a>
            <a href="${b.checkout_pdf_url || b.checkin_pdf_url || `/api/pdf/job/${b.booking_id}`}" target="_blank" class="btn btn-sm btn-secondary" style="${(b.checkout_pdf_url || b.checkin_pdf_url) ? 'background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700;' : ''}" title="${isEn ? 'Inspection Job Sheet' : 'ใบงานตรวจสภาพรถ (Job Sheet)'}">📋</a>
            <button onclick="app.deleteBooking('${b.booking_id}')" class="btn btn-sm btn-danger" title="${isEn ? 'Delete Booking' : 'ลบรายการจอง'}">🗑️</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  openInspectionPdf(bkId, type = null) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId) || {};
    const isReturned = b.return_closed || b.status === "เสร็จสิ้น" || !!b.return_mileage;
    const reqType = type || (isReturned ? "checkin" : "checkout");
    const url = (reqType === "checkin" && b.checkin_pdf_url)
      ? b.checkin_pdf_url
      : (b.checkout_pdf_url || b.checkin_pdf_url || `/api/pdf/inspection/${bkId}?type=${reqType}`);
    window.open(url, '_blank');
  }

  async deleteBooking(bkId) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบรายการจอง ${bkId}?`)) return;
    try {
      const res = await fetch(`/api/bookings/${bkId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        this.showToast(`ลบรายการจอง ${bkId} เรียบร้อย`, "success");
        await this.loadBookings();
        await this.loadCars();
      }
    } catch (e) {
      this.showToast("ลบไม่สำเร็จ: " + e.message, "danger");
    }
  }

  populateBackofficeStaffFilter() {
    const sel = document.getElementById("bo-staff-filter");
    if (!sel) return;
    const currentVal = sel.value || this.boStaffFilter || "";
    const isEn = (this.currentLang === "EN");
    const staffSet = new Set();
    (this.backofficeJobs || []).forEach(j => {
      const w = String(j.worker || "").trim();
      if (w && w !== "-" && w !== "ยังไม่มอบหมาย") {
        staffSet.add(w);
      }
    });
    let html = `<option value="">${isEn ? 'All Staff (ทุกคน)' : 'ทุกคน (All Staff)'}</option>`;
    Array.from(staffSet).sort().forEach(st => {
      html += `<option value="${st}">${st}</option>`;
    });
    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
  }

  onBackofficeStaffFilterChange(staff) {
    this.boStaffFilter = staff || "";
    this.renderBackofficeCalendar();
    this.renderBackOfficeJobs();
  }

  setBackofficeViewMode(mode) {
    this.boViewMode = mode;
    const calWrap = document.getElementById("bo-calendar-wrapper");
    const tblWrap = document.getElementById("bo-full-table-card");
    const btnCal = document.getElementById("btn-bo-view-calendar");
    const btnTbl = document.getElementById("btn-bo-view-table");

    if (mode === "calendar") {
      if (calWrap) calWrap.style.display = "block";
      if (tblWrap) tblWrap.style.display = "none";
      if (btnCal) {
        btnCal.className = "btn btn-sm btn-primary";
        btnCal.style.cssText = "font-size:12px; padding:4px 12px; font-weight:700;";
      }
      if (btnTbl) {
        btnTbl.className = "btn btn-sm btn-secondary";
        btnTbl.style.cssText = "font-size:12px; padding:4px 12px;";
      }
      setTimeout(() => {
        if (this.boCalendar) {
          this.boCalendar.updateSize();
        } else {
          this.renderBackofficeCalendar();
        }
      }, 80);
    } else {
      if (calWrap) calWrap.style.display = "none";
      if (tblWrap) tblWrap.style.display = "block";
      if (btnCal) {
        btnCal.className = "btn btn-sm btn-secondary";
        btnCal.style.cssText = "font-size:12px; padding:4px 12px;";
      }
      if (btnTbl) {
        btnTbl.className = "btn btn-sm btn-primary";
        btnTbl.style.cssText = "font-size:12px; padding:4px 12px; font-weight:700;";
      }
      this.renderBackOfficeJobs();
    }
  }

  renderBackofficeCalendar() {
    const calendarEl = document.getElementById("backoffice-calendar");
    if (!calendarEl) return;
    if (typeof FullCalendar === "undefined") {
      console.warn("FullCalendar is not loaded yet");
      return;
    }

    const isEn = (this.currentLang === "EN");
    const staffFilter = (document.getElementById("bo-staff-filter")?.value || this.boStaffFilter || "").trim();

    const jobs = (this.backofficeJobs || []).filter(j => {
      if (staffFilter && String(j.worker || "").trim() !== staffFilter) {
        return false;
      }
      return true;
    });

    const events = jobs.map(j => {
      const isDisp = j.job_type === "Dispatch";
      const isMnt = j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal";
      
      let title = "";
      let color = "#2563EB";
      let startStr = j.date_iso;

      if (isMnt) {
        title = `[🛠️ ${isEn ? 'Maint' : 'ซ่อม'}] ${j.car_id || ''} (${j.booking_id})`;
        color = "#EA580C"; // Orange for maintenance/renewal
        startStr = j.start_date || j.date_iso;
      } else if (isDisp) {
        title = `[🚚 ${isEn ? 'Dispatch' : 'ส่ง'}] ${j.car_id || ''} - ${j.customer || ''} (${j.booking_id})`;
        color = "#2563EB"; // Blue for dispatch
        if (j.start_date && j.start_time) {
          startStr = `${j.start_date}T${j.start_time}`;
        } else if (j.start_date) {
          startStr = j.start_date;
        }
      } else {
        title = `[🔙 ${isEn ? 'Return' : 'รับคืน'}] ${j.car_id || ''} - ${j.customer || ''} (${j.booking_id})`;
        color = "#16A34A"; // Green for return
        if (j.end_date && j.end_time) {
          startStr = `${j.end_date}T${j.end_time}`;
        } else if (j.end_date) {
          startStr = j.end_date;
        }
      }

      return {
        id: `${j.job_type}_${j.booking_id}`,
        title: title,
        start: startStr,
        backgroundColor: color,
        borderColor: color,
        textColor: "#FFFFFF",
        extendedProps: j
      };
    });

    if (this.boCalendar) {
      this.boCalendar.removeAllEvents();
      this.boCalendar.addEventSource(events);
      this.boCalendar.setOption('locale', isEn ? 'en' : 'th');
      this.boCalendar.updateSize();
      return;
    }

    this.boCalendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      navLinks: true,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listMonth'
      },
      locale: isEn ? 'en' : 'th',
      buttonText: isEn ? {
        today: 'Today',
        month: 'Month',
        week: 'Week',
        list: 'List'
      } : {
        today: 'วันนี้',
        month: 'ปฏิทิน',
        week: 'สัปดาห์',
        list: 'รายการ'
      },
      events: events,
      eventTimeFormat: {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      },
      displayEventTime: true,
      dayMaxEvents: 3,
      navLinkDayClick: (date, jsEvent) => {
        if (jsEvent && jsEvent.preventDefault) jsEvent.preventDefault();
        const dStr = typeof date === "string" ? date : (date.toISOString ? date.toISOString().split("T")[0] : String(date));
        if (this.boCalendar) {
          try {
            this.boCalendar.changeView('timeGridWeek', date);
          } catch(e) {
            try {
              this.boCalendar.changeView('listWeek', date);
            } catch(e2) {
              this.boCalendar.gotoDate(date);
            }
          }
        }
        this.onCalendarDateClick(dStr);
      },
      dateClick: (info) => {
        const dStr = info.dateStr || (info.date && info.date.toISOString ? info.date.toISOString().split("T")[0] : "");
        const targetDate = info.date || dStr;
        if (this.boCalendar && this.boCalendar.view && this.boCalendar.view.type === 'dayGridMonth') {
          try {
            this.boCalendar.changeView('timeGridWeek', targetDate);
          } catch(e) {
            try {
              this.boCalendar.changeView('listWeek', targetDate);
            } catch(e2) {
              this.boCalendar.gotoDate(targetDate);
            }
          }
        }
        this.onCalendarDateClick(dStr);
      },
      eventClick: (info) => {
        this.onCalendarEventClick(info.event);
      }
    });

    this.boCalendar.render();
  }

  onCalendarDateClick(dateStr) {
    const dayCard = document.getElementById("bo-day-jobs-card");
    const dayTbody = document.getElementById("bo-day-jobs-tbody");
    const dayTitle = document.getElementById("bo-day-jobs-title");
    if (!dayCard || !dayTbody) return;

    const isEn = (this.currentLang === "EN");
    const matched = (this.backofficeJobs || []).filter(j => {
      const d1 = j.date_iso;
      const d2 = j.start_date;
      const d3 = j.end_date;
      return d1 === dateStr || d2 === dateStr || d3 === dateStr;
    });

    if (dayTitle) {
      dayTitle.textContent = isEn
        ? `📋 Work Orders for ${dateStr} (${matched.length} jobs)`
        : `📋 ตารางงานประจำวันที่ ${dateStr} (${matched.length} รายการ)`;
    }

    if (matched.length === 0) {
      dayTbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#64748B;">${isEn ? 'No work orders scheduled on this date' : 'ไม่มีงานที่นัดหมายในวันนี้'}</td></tr>`;
    } else {
      dayTbody.innerHTML = matched.map(j => this.renderSingleBackofficeJobRow(j, isEn)).join("");
    }

    dayCard.style.display = "block";
    dayCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  onCalendarEventClick(calEvent) {
    const j = calEvent.extendedProps;
    if (!j) return;
    const isEn = (this.currentLang === "EN");

    const dayCard = document.getElementById("bo-day-jobs-card");
    const dayTbody = document.getElementById("bo-day-jobs-tbody");
    const dayTitle = document.getElementById("bo-day-jobs-title");
    if (dayCard && dayTbody) {
      if (dayTitle) {
        dayTitle.textContent = isEn
          ? `📋 Work Order: ${j.booking_id} (${j.job_type})`
          : `📋 รายละเอียดใบงาน: ${j.booking_id} (${j.job_type})`;
      }
      dayTbody.innerHTML = this.renderSingleBackofficeJobRow(j, isEn);
      dayCard.style.display = "block";
      dayCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    if (j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal") {
      this.openCloseMaintenanceModal(j.booking_id);
    } else {
      this.openHandoverModal(j.booking_id, j.job_type);
    }
  }

  renderSingleBackofficeJobRow(j, isEn) {
    const isDisp = j.job_type === "Dispatch";
    const isMnt = j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal";
    let typeBadge = '';
    if (j.job_type === "Maintenance") {
      typeBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">${isEn ? 'Maintenance' : 'ซ่อมบำรุง'}</span>`;
    } else if (j.job_type === "Renewal") {
      typeBadge = `<span class="badge" style="background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; font-weight:700;">${isEn ? 'Renewal' : 'ต่อทะเบียน/พรบ./ประกัน'}</span>`;
    } else if (isDisp) {
      typeBadge = `<span class="badge badge-info">${isEn ? 'Dispatch' : 'ส่งมอบรถ (Dispatch)'}</span>`;
    } else {
      typeBadge = `<span class="badge badge-warning">${isEn ? 'Return' : 'รับรถคืน (Return)'}</span>`;
    }

    let actionButtons = '';
    if (isMnt) {
      const isRenewalJob = j.job_type === "Renewal" || (j.order_type && (String(j.order_type).includes("ต่อทะเบียน") || String(j.order_type).includes("ประกัน") || String(j.order_type).includes("พ.ร.บ.") || String(j.order_type).includes("ภาษี") || String(j.order_type).includes("แพ็กคู่")));
      const btnLabel = isRenewalJob ? (isEn ? "Submit / Update" : "ส่งงาน / อัปเดตวัน") : (isEn ? "Inspect & Close" : "ตรวจรับ & ปิดงาน");
      actionButtons = `
        <a href="/api/pdf/maintenance/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Print Job PDF' : 'พิมพ์ใบงาน PDF'}">${isEn ? 'Job PDF' : 'ใบงาน PDF'}</a>
        <button onclick="app.openCloseMaintenanceModal('${j.booking_id}')" class="btn btn-sm btn-success" style="font-weight:700;" title="${btnLabel}">
          ${btnLabel}
        </button>
      `;
    } else {
      const lockTitle = isEn ? 'Wait for Dispatch completion' : 'ต้องปิดงานส่งมอบก่อน';
      const inspectBtnLabel = isEn ? 'Inspect & Complete' : 'ตรวจรับส่ง & ปิดงาน';
      actionButtons = `
        <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Inspection PDF' : 'ใบตรวจสภาพ PDF'}">PDF</a>
        <button onclick="app.openHandoverModal('${j.booking_id}', '${j.job_type}')" class="btn btn-sm btn-primary" ${j.is_locked ? `disabled title="${lockTitle}"` : ''}>
          ${inspectBtnLabel}
        </button>
      `;
    }

    let statusBadge = '';
    if (j.status === "กำลังซ่อมบำรุง") {
      statusBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74;">${isEn ? '🛠️ In Maintenance' : '🛠️ กำลังซ่อมบำรุง'}</span>`;
    } else if (j.status === "กำลังต่อภาษี/ประกัน") {
      statusBadge = `<span class="badge" style="background:#FEF3C7; color:#D97706; border:1px solid #FCD34D;">${isEn ? '⏳ Renewing Tax/Ins.' : '⏳ กำลังต่อภาษี/ประกัน'}</span>`;
    } else {
      let displayStatus = j.status;
      if (isEn) {
        if (displayStatus === "รอส่งมอบ") displayStatus = "Ready for Dispatch";
        else if (displayStatus === "กำลังเช่า") displayStatus = "Active Rental";
        else if (displayStatus === "รอรับคืน") displayStatus = "Ready for Return";
        else if (displayStatus === "🔒 รอส่งรถก่อน") displayStatus = "🔒 Wait for Dispatch";
        else if (displayStatus === "รอชำระมัดจำ") displayStatus = "Pending Deposit";
      }
      statusBadge = `<span class="badge badge-gray">${displayStatus}</span>`;
    }

    return `
      <tr>
        <td>${typeBadge}</td>
        <td><b style="color:#D97706;">${j.booking_id}</b></td>
        <td><b>${j.car_id}</b></td>
        <td>
          <b>${j.customer}</b><br/>
          ${j.customer_phone && j.customer_phone !== '-' ? `<a href="tel:${j.customer_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">📞 ${j.customer_phone}</a>` : ''}
        </td>
        <td style="font-size:12px;">${j.schedule}</td>
        <td><span style="font-weight:600; color:#334155;">${j.worker}</span></td>
        <td style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${j.location}">
          ${j.location.startsWith("http") ? `<a href="${j.location}" target="_blank" style="color:#2563EB;">📍 แผนที่นัดหมาย</a>` : j.location}
        </td>
        <td>${statusBadge}</td>
        <td style="text-align:center; white-space:nowrap;">
          ${actionButtons}
        </td>
      </tr>
    `;
  }

  renderBackOfficeJobs() {
    const tbody = document.getElementById("backoffice-jobs-tbody");
    if (!tbody) return;

    const boKw = (document.getElementById("bo-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();
    const kw = boKw || sbKw;
    const staffFilter = (document.getElementById("bo-staff-filter")?.value || this.boStaffFilter || "").trim();

    const filtered = (this.backofficeJobs || []).filter(j => {
      if (staffFilter && String(j.worker || "").trim() !== staffFilter) {
        return false;
      }
      if (kw) {
        const s = `${j.booking_id} ${j.car_id} ${j.customer} ${j.job_type} ${j.worker || ''} ${j.location || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    const isEn = (this.currentLang === "EN");
    if (filtered.length === 0) {
      const emptyMsg = isEn ? "No work orders in the system currently" : "ไม่มีใบงานในระบบขณะนี้";
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748B;">${emptyMsg}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(j => this.renderSingleBackofficeJobRow(j, isEn)).join("");
  }

  initDamageCanvas() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return;
    this.damageMarks = this.damageMarks || [];
    this.currentDamageTool = this.currentDamageTool || "dent";
    this.redrawDamageCanvas();
    this.setDamageTool(this.currentDamageTool);

    if (!canvas._hasDamageHandler) {
      canvas._hasDamageHandler = true;
      const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY
        };
      };
      const addMark = (e) => {
        e.preventDefault();
        const pos = getPos(e);
        this.damageMarks.push({
          x: pos.x,
          y: pos.y,
          type: this.currentDamageTool
        });
        this.redrawDamageCanvas();
      };
      canvas.addEventListener("click", addMark);
    }
  }

  setDamageTool(tool) {
    this.currentDamageTool = tool;
    const btnDent = document.getElementById("btn-tool-dent");
    const btnScratch = document.getElementById("btn-tool-scratch");
    if (btnDent && btnScratch) {
      if (tool === "dent") {
        btnDent.style.boxShadow = "0 0 0 2px #DC2626";
        btnDent.style.borderColor = "#DC2626";
        btnScratch.style.boxShadow = "none";
        btnScratch.style.borderColor = "#93C5FD";
      } else {
        btnScratch.style.boxShadow = "0 0 0 2px #2563EB";
        btnScratch.style.borderColor = "#2563EB";
        btnDent.style.boxShadow = "none";
        btnDent.style.borderColor = "#FCA5A5";
      }
    }
  }

  clearDamageCanvas() {
    this.damageMarks = [];
    this.redrawDamageCanvas();
  }

  redrawDamageCanvas() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#475569";
    ctx.font = "bold 10px Sarabun, sans-serif";
    ctx.textAlign = "center";

    // 1. FRONT
    ctx.fillText("FRONT", 65, 20);
    ctx.strokeStyle = "#64748B";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(30, 26, 70, 50);
    ctx.strokeRect(36, 30, 16, 12);
    ctx.strokeRect(78, 30, 16, 12);
    ctx.strokeRect(45, 60, 40, 10);

    // 2. REAR
    ctx.fillText("REAR", 65, 115);
    ctx.strokeRect(30, 122, 70, 50);
    ctx.strokeRect(36, 126, 16, 12);
    ctx.strokeRect(78, 126, 16, 12);
    ctx.strokeRect(48, 142, 34, 14);

    // 3. TOP VIEW
    ctx.fillText("TOP VIEW", 240, 18);
    ctx.strokeRect(205, 24, 70, 160);
    ctx.strokeRect(213, 50, 54, 25);
    ctx.strokeRect(213, 85, 54, 45);
    ctx.strokeRect(213, 138, 54, 25);

    // 4. LEFT
    ctx.fillText("LEFT SIDE", 400, 20);
    ctx.strokeRect(335, 28, 130, 48);
    ctx.beginPath(); ctx.arc(360, 78, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(440, 78, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(365, 34, 32, 20);
    ctx.strokeRect(402, 34, 32, 20);

    // 5. RIGHT
    ctx.fillText("RIGHT SIDE", 400, 115);
    ctx.strokeRect(335, 122, 130, 48);
    ctx.beginPath(); ctx.arc(360, 172, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(440, 172, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(365, 128, 32, 20);
    ctx.strokeRect(402, 128, 32, 20);

    (this.damageMarks || []).forEach(m => {
      ctx.beginPath();
      if (m.type === "dent") {
        ctx.fillStyle = "#DC2626";
        ctx.font = "bold 15px Arial, sans-serif";
        ctx.fillText("X", m.x, m.y + 5);
        ctx.strokeStyle = "rgba(220, 38, 38, 0.4)";
        ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#2563EB";
        ctx.font = "bold 15px Arial, sans-serif";
        ctx.fillText("D", m.x, m.y + 5);
        ctx.strokeStyle = "rgba(37, 99, 235, 0.4)";
        ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  getCarDiagramBase64() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  }

  openHandoverModal(bkId, jobType) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (jobType === "Dispatch") {
      if (b && !b.deposit_paid) {
        alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
        return;
      }
      if (b && !b.rental_paid) {
        alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ");
        this.openSettleModal(bkId);
        return;
      }
      if (b && !b.contract_issued) {
        alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาไปที่แท็บ \"4. จัดทำสัญญาเช่า\" เพื่อตรวจสอบและออกสัญญาเช่าให้เรียบร้อยก่อน");
        return;
      }
    }

    document.getElementById("insp-bk-id").value = bkId;
    document.getElementById("insp-job-type").value = jobType;
    document.getElementById("modal-handover-title").textContent = jobType === "Dispatch"
      ? `🚚 ตรวจสภาพและส่งมอบรถ (Dispatch - ${bkId})`
      : `🔙 ตรวจสภาพและรับรถคืน (Return - ${bkId})`;

    const condSec = document.getElementById("insp-return-condition-section");
    if (condSec) {
      condSec.style.display = jobType === "Return" ? "block" : "none";
      const radNorm = document.getElementById("insp-cond-normal");
      if (radNorm) radNorm.checked = true;

      // Check if early return (returning before contract end date)
      const badgeEarly = document.getElementById("insp-early-return-badge");
      if (badgeEarly && b) {
        const endStr = b.end_date ? (typeof b.end_date === "string" ? b.end_date.split("T")[0] : "") : "";
        const todayStr = new Date().toISOString().split("T")[0];
        if (endStr && todayStr < endStr) {
          badgeEarly.style.display = "inline-block";
          const dmy = this.ymdToDmy ? this.ymdToDmy(endStr) : endStr;
          badgeEarly.textContent = `⚡ คืนรถก่อนกำหนดสัญญา (ครบกำหนดจริง: ${dmy})`;
        } else {
          badgeEarly.style.display = "none";
        }
      }

      // Reset Branch B sub-options
      const radEnd = document.getElementById("insp-sub-end-contract");
      if (radEnd) radEnd.checked = true;
      const swapInput = document.getElementById("insp-swap-car-search");
      if (swapInput) swapInput.value = "";
      const swapPlate = document.getElementById("insp-swap-selected-plate");
      if (swapPlate) swapPlate.value = "";
      const swapBadge = document.getElementById("insp-swap-selected-badge");
      if (swapBadge) {
        swapBadge.style.display = "none";
        swapBadge.innerHTML = "";
      }

      this.onInspConditionChange("normal");
    }

    this.uploadedPhotos = [];
    const photoContainer = document.getElementById("insp-uploaded-photos");
    if (photoContainer) photoContainer.innerHTML = "";
    this.damageMarks = [];
    setTimeout(() => this.initDamageCanvas(), 60);

    const checkinImgSec = document.getElementById("insp-checkin-images-section");
    if (checkinImgSec) {
      checkinImgSec.style.display = jobType === "Return" ? "block" : "none";
    }
    if (jobType === "Return") {
      const fVal = b?.checkin_img_front || document.getElementById("assign-ret-img-front")?.value || "";
      const lVal = b?.checkin_img_left || document.getElementById("assign-ret-img-left")?.value || "";
      const reVal = b?.checkin_img_rear || document.getElementById("assign-ret-img-rear")?.value || "";
      const riVal = b?.checkin_img_right || document.getElementById("assign-ret-img-right")?.value || "";

      const elF = document.getElementById("insp-checkin-img-front");
      const elL = document.getElementById("insp-checkin-img-left");
      const elRe = document.getElementById("insp-checkin-img-rear");
      const elRi = document.getElementById("insp-checkin-img-right");

      if (elF) elF.value = fVal;
      if (elL) elL.value = lVal;
      if (elRe) elRe.value = reVal;
      if (elRi) elRi.value = riVal;

      this.updateCheckinImgPreview("front", fVal);
      this.updateCheckinImgPreview("left", lVal);
      this.updateCheckinImgPreview("rear", reVal);
      this.updateCheckinImgPreview("right", riVal);
    }

    const pdfContainer = document.getElementById("insp-pdf-result-container");
    const modalPrintBtn = document.getElementById("btn-modal-print-inspection");
    if (pdfContainer && modalPrintBtn) {
      const existingPdf = (jobType === "Dispatch" ? b?.checkout_pdf_url : b?.checkin_pdf_url);
      if (existingPdf) {
        modalPrintBtn.href = existingPdf;
        pdfContainer.style.display = "flex";
      } else {
        pdfContainer.style.display = "none";
      }
    }
    this.openModal("modal-handover");
  }

  onInspConditionChange(cond) {
    const normInfo = document.getElementById("insp-cond-normal-info");
    const repInfo = document.getElementById("insp-cond-repair-info");
    const submitBtn = document.getElementById("btn-submit-inspection");

    if (cond === "needs_repair") {
      if (normInfo) normInfo.style.display = "none";
      if (repInfo) repInfo.style.display = "block";
      const isSwap = document.getElementById("insp-sub-swap-car")?.checked;
      this.onInspBranchBActionChange(isSwap ? "swap_car" : "end_contract");
    } else {
      if (normInfo) normInfo.style.display = "block";
      if (repInfo) repInfo.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = `✅ ยืนยันบันทึกผล & ปิดงาน`;
      this.recalcInspRefundPreview();
    }
  }

  onInspBranchBActionChange(action) {
    const swapPanel = document.getElementById("insp-swap-car-panel");
    const depositPreview = document.getElementById("insp-deposit-calc-preview");
    const swapWarning = document.getElementById("insp-swap-damage-warning");
    const submitBtn = document.getElementById("btn-submit-inspection");

    if (action === "swap_car") {
      if (swapPanel) swapPanel.style.display = "block";
      if (depositPreview) depositPreview.style.display = "none";
      if (swapWarning) swapWarning.style.display = "block";
      if (submitBtn) submitBtn.innerHTML = `🔄 ยืนยันสลับรถทดแทน & ส่งรถเก่าเข้าซ่อม`;
      this.populateInspSwapCars();
    } else {
      if (swapPanel) swapPanel.style.display = "none";
      if (depositPreview) depositPreview.style.display = "block";
      if (swapWarning) swapWarning.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = `✅ ยืนยันบันทึกผล & ปิดงาน`;
      this.recalcInspRefundPreview();
    }
  }

  populateInspSwapCars(searchKw = "") {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;

    const bkId = document.getElementById("insp-bk-id")?.value;
    const currentBooking = (this.bookings || []).find(x => x.booking_id === bkId);
    const currentPlate = currentBooking?.car_id || "";

    // Show only cars that are Available ("ว่างพร้อมใช้งาน") and not the currently rented car
    const availableCars = (this.cars || []).filter(c => {
      const isAvailable = (c.status === "ว่างพร้อมใช้งาน" || c.status === "ว่าง" || !c.status);
      return isAvailable && c.plate !== currentPlate;
    });

    const kw = (searchKw || "").toLowerCase().trim();
    const filtered = availableCars.filter(c => {
      if (!kw) return true;
      const plateMatch = (c.plate || "").toLowerCase().includes(kw);
      const brandMatch = (c.brand || "").toLowerCase().includes(kw);
      const modelMatch = (c.model || "").toLowerCase().includes(kw);
      const colorMatch = (c.color || "").toLowerCase().includes(kw);
      return plateMatch || brandMatch || modelMatch || colorMatch;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding:10px 12px; color:#94A3B8; font-size:12px; text-align:center;">${availableCars.length === 0 ? "⚠️ ไม่มีรถยนต์ที่ว่างพร้อมใช้งานในขณะนี้" : `ไม่พบรถที่ตรงกับ "${kw}"`}</div>`;
      return;
    }

    const currentSelected = document.getElementById("insp-swap-selected-plate")?.value || "";
    listEl.innerHTML = filtered.map(c => {
      const isSelected = c.plate === currentSelected;
      const priceStr = c.price_day || c.daily_rate ? `฿${Number(c.price_day || c.daily_rate).toLocaleString()}/วัน` : '';
      return `
        <div class="insp-swap-car-option-item ${isSelected ? 'selected' : ''}" 
             onclick="app.selectInspSwapCar('${c.plate}')"
             title="${c.plate} - ${c.brand || ''} ${c.model || ''}">
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">
            <span style="font-weight:800; color:#0F172A; margin-right:6px;">${c.plate}</span>
            <span style="color:#334155; font-weight:600;">${c.brand || ''} ${c.model || ''}</span>
            ${c.color ? `<span style="color:#64748B; font-size:11.5px; margin-left:4px;">(${c.color})</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            ${priceStr ? `<span style="font-size:11px; color:#D97706; font-weight:600;">${priceStr}</span>` : ''}
            <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:#ECFDF5; color:#065F46; white-space:nowrap;">
              ว่าง
            </span>
          </div>
        </div>
      `;
    }).join("");
  }

  showInspSwapCarDropdown(show = true) {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;
    if (show) {
      this.populateInspSwapCars(document.getElementById("insp-swap-car-search")?.value || "");
      listEl.style.display = "block";
    } else {
      listEl.style.display = "none";
    }
  }

  toggleInspSwapCarDropdown() {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;
    if (listEl.style.display === "none" || !listEl.style.display) {
      this.showInspSwapCarDropdown(true);
      document.getElementById("insp-swap-car-search")?.focus();
    } else {
      this.showInspSwapCarDropdown(false);
    }
  }

  filterInspSwapCars(kw) {
    this.populateInspSwapCars(kw);
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (listEl) listEl.style.display = "block";
  }

  selectInspSwapCar(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    const searchInput = document.getElementById("insp-swap-car-search");
    const hiddenPlate = document.getElementById("insp-swap-selected-plate");
    const badgeEl = document.getElementById("insp-swap-selected-badge");

    if (car) {
      if (searchInput) searchInput.value = `${car.plate} - ${car.brand || ''} ${car.model || ''} (${car.color || ''})`;
      if (hiddenPlate) hiddenPlate.value = car.plate;
      if (badgeEl) {
        badgeEl.style.display = "block";
        badgeEl.innerHTML = `✅ <b>เลือกรถทดแทน:</b> <span style="font-weight:800; color:#065F46;">${car.plate}</span> (${car.brand || ''} ${car.model || ''}) — ลูกค้าจะได้รับรถคันนี้ไปใช้งานต่อจนครบกำหนดสัญญา`;
      }
    }
    this.showInspSwapCarDropdown(false);
  }

  recalcInspRefundPreview() {
    const depAmt = 5000; // STRICT RULE: Fixed 5,000 THB deposit always
    const repCost = parseFloat(document.getElementById("insp-repair-cost")?.value || 0);
    const isRepair = document.getElementById("insp-cond-repair")?.checked;
    const isSwap = document.getElementById("insp-sub-swap-car")?.checked;

    const prevEl = document.getElementById("insp-deposit-calc-preview");
    if (!prevEl) return;

    if (isRepair) {
      if (isSwap) {
        prevEl.style.display = "none";
        return;
      }
      prevEl.style.display = "block";
      const deducted = Math.min(repCost, depAmt);
      const refund = Math.max(0, depAmt - deducted);
      prevEl.innerHTML = `
        💵 <b>สรุปการเงินมัดจำ:</b> มัดจำเดิม ฿5,000 | หักค่าซ่อม ฿${deducted.toLocaleString()} | <b>คืนมัดจำสุทธิ: <span style="color:#15803D;">฿${refund.toLocaleString()}</span></b>
      `;
    } else {
      prevEl.style.display = "block";
      prevEl.innerHTML = `
        💵 <b>คืนเงินมัดจำเต็มจำนวน:</b> <b style="color:#15803D;">฿5,000</b>
      `;
    }
  }

  openSettleModal(bkId) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (!b) return;
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const isDep = Boolean(b.deposit_paid);
    const isRent = Boolean(b.rental_paid);
    // TARGET MISSION 3: ยอดเงินคงเหลือ = ราคาค่าเช่าที่ตกลง (net_price) - เงินมัดจำที่ชำระแล้ว (deposit_amount)
    const remP = isRent ? 0 : (isDep ? Math.max(0, netP - depAmt) : parseFloat(b.remaining_rental !== undefined ? b.remaining_rental : netP));
    
    document.getElementById("modal-settle-bk-id").value = bkId;
    const sumEl = document.getElementById("modal-settle-summary");
    if (sumEl) {
      sumEl.innerHTML = `
        <b>รหัสการจอง:</b> <span style="color:#C2410C;">${b.booking_id}</span> | <b>ทะเบียน:</b> ${b.car_id}<br/>
        <b>ผู้เช่า:</b> ${b.customer} | <b>ยอดสัญญาเต็ม:</b> ฿${netP.toLocaleString()} ${isDep ? `| <b>หักเงินมัดจำ:</b> ฿${depAmt.toLocaleString()}` : ''}
      `;
    }
    const amtEl = document.getElementById("modal-settle-amount");
    if (amtEl) amtEl.value = `฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const refEl = document.getElementById("modal-settle-ref");
    if (refEl) refEl.value = b.rental_ref || "";
    const slipEl = document.getElementById("modal-settle-slip-url");
    if (slipEl) slipEl.value = b.rental_slip || "";

    this.openModal("modal-settle-rental");
  }

  async handleSettleSlipUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);
    try {
      this.showToast(`กำลังอัปโหลดสลิป ${file.name}...`, "info");
      const bkId = document.getElementById("modal-settle-bk-id")?.value || "";
      const uploadUrl = `/api/upload-photo?category=slip&ref_id=${encodeURIComponent(bkId || 'SETTLE')}`;
      const res = await fetch(uploadUrl, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        document.getElementById("modal-settle-slip-url").value = data.url;
        this.showToast("📸 อัปโหลดสลิปเรียบร้อย!", "success");
      }
    } catch (e) {
      this.showToast("อัปโหลดไม่สำเร็จ: " + e.message, "danger");
    }
  }

  async submitSettleFromModal() {
    const bkId = document.getElementById("modal-settle-bk-id")?.value;
    if (!bkId) return;
    const method = document.getElementById("modal-settle-method")?.value || "โอนเงิน / สแกน QR";
    const ref = (document.getElementById("modal-settle-ref")?.value || "").trim();
    const slip = (document.getElementById("modal-settle-slip-url")?.value || "").trim();

    try {
      this.showToast(`⏳ กำลังบันทึกชำระค่าเช่า ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method: method,
          payment_ref: ref,
          rental_ref: ref,
          slip_url: slip,
          rental_slip: slip,
          remaining_slip_link: slip
        })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-settle-rental");
        this.showToast(`🎉 ชำระค่าเช่าสำหรับ ${bkId} เรียบร้อย! พร้อมจัดทำสัญญาเช่า`, "success");
        await this.loadBookings();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
        if (this.activeTab === "deposit") this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "ชำระค่าเช่าไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async handlePhotoUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const container = document.getElementById("insp-uploaded-photos");

    for (let file of input.files) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        this.showToast(`กำลังอัปโหลด ${file.name}...`, "info");
        const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
          this.uploadedPhotos.push(data.url);
          const thumb = document.createElement("img");
          thumb.src = data.url;
          thumb.style.width = "50px";
          thumb.style.height = "50px";
          thumb.style.objectFit = "cover";
          thumb.style.borderRadius = "6px";
          thumb.style.border = "1px solid #CBD5E1";
          container.appendChild(thumb);
          this.showToast(`📸 อัปโหลดรูปภาพสำเร็จ!`, "success");
        }
      } catch (e) {
        this.showToast("อัปโหลดไม่สำเร็จ: " + e.message, "danger");
      }
    }
  }

  updateCheckinImgPreview(angle, url) {
    const previewContainer = document.getElementById(`preview-checkin-img-${angle}`);
    if (!previewContainer) return;
    const directSrc = this.convertDriveUrl(url);
    const imgEl = previewContainer.querySelector("img");
    if (directSrc && imgEl) {
      imgEl.src = directSrc;
      previewContainer.style.display = "block";
    } else {
      previewContainer.style.display = "none";
      if (imgEl) imgEl.src = "";
    }
  }

  async uploadCheckinAnglePhoto(input, angle) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    const bkId = document.getElementById("insp-bk-id")?.value;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const plate = b?.car_id || "CAR";

    try {
      this.showToast(`กำลังอัปโหลดรูปรถด้าน ${angle} (${file.name})...`, "info");
      const url = `/api/upload-photo?category=car&plate=${encodeURIComponent(plate)}&sub_type=${encodeURIComponent(angle)}`;
      const res = await fetch(url, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        const inp = document.getElementById(`insp-checkin-img-${angle}`);
        if (inp) inp.value = data.webViewLink || data.url;
        this.updateCheckinImgPreview(angle, data.webViewLink || data.url);
        this.showToast(`📸 อัปโหลดรูปรถด้าน ${angle} เรียบร้อย!`, "success");
      }
    } catch (e) {
      this.showToast(`อัปโหลดรูปรถด้าน ${angle} ไม่สำเร็จ: ` + e.message, "danger");
    }
  }

  async uploadInsuranceDoc(input, subType = "กรมธรรม์") {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);
    const plate = document.getElementById("edit-car-plate")?.value || "CAR";

    try {
      this.showToast(`กำลังอัปโหลดเอกสาร ${subType} (${file.name})...`, "info");
      const url = `/api/upload-photo?category=insurance&plate=${encodeURIComponent(plate)}&sub_type=${encodeURIComponent(subType)}`;
      const res = await fetch(url, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        const inp = document.getElementById("edit-car-ins-doc-url");
        if (inp) inp.value = data.webViewLink || data.url;
        this.updateCarFormField('ins_doc_url', data.webViewLink || data.url);
        this.showToast(`📄 อัปโหลดเอกสาร ${subType} เรียบร้อย!`, "success");
      }
    } catch (e) {
      this.showToast(`อัปโหลดเอกสารไม่สำเร็จ: ` + e.message, "danger");
    }
  }

  async submitInspection() {
    const bkId = document.getElementById("insp-bk-id").value;
    const jobType = document.getElementById("insp-job-type").value;
    const fuel = document.getElementById("insp-fuel-select").value;
    const mileage = document.getElementById("insp-mileage-input").value;
    const notes = document.getElementById("insp-notes-input").value;
    const isRepair = document.getElementById("insp-cond-repair")?.checked;
    const damageDesc = (document.getElementById("insp-damage-desc")?.value || "").trim();
    const repairCost = parseFloat(document.getElementById("insp-repair-cost")?.value || 0);
    const serviceCenter = (document.getElementById("insp-service-center")?.value || "").trim();

    // Check Branch B sub-option (end_contract vs swap_vehicle)
    let branchBAction = "end_contract";
    let swapNewPlate = "";
    if (jobType === "Return" && isRepair) {
      const isSwap = document.getElementById("insp-sub-swap-car")?.checked;
      if (isSwap) {
        branchBAction = "swap_vehicle";
        swapNewPlate = (document.getElementById("insp-swap-selected-plate")?.value || "").trim();
        if (!swapNewPlate) {
          alert("⚠️ กรุณาเลือกรถคันใหม่สำหรับเปลี่ยนทดแทนให้ลูกค้าก่อนกดยืนยัน");
          return;
        }
      }
    }

    const imgFront = (document.getElementById("insp-checkin-img-front")?.value || "").trim();
    const imgLeft = (document.getElementById("insp-checkin-img-left")?.value || "").trim();
    const imgRear = (document.getElementById("insp-checkin-img-rear")?.value || "").trim();
    const imgRight = (document.getElementById("insp-checkin-img-right")?.value || "").trim();

    const diagramBase64 = this.getCarDiagramBase64();
    const curDamageMarks = Array.isArray(this.damageMarks) ? [...this.damageMarks] : [];

    const payload = {
      fuel_level: fuel,
      mileage: mileage,
      notes: notes,
      photos: this.uploadedPhotos,
      condition: (jobType === "Return" && isRepair) ? "needs_repair" : "normal",
      damage_desc: damageDesc,
      repair_cost: repairCost,
      service_center: serviceCenter,
      action: branchBAction,
      new_car_id: swapNewPlate,
      car_diagram: diagramBase64,
      damage_marks: curDamageMarks
    };

    if (jobType === "Return") {
      payload.checkin_img_front = imgFront;
      payload.checkin_img_left = imgLeft;
      payload.checkin_img_rear = imgRear;
      payload.checkin_img_right = imgRight;
    }

    // TARGET MISSION 2 & 3: Generate official inspection checklist PDF
    let genPdfUrl = null;
    try {
      const bObj = (this.bookings || []).find(x => x.booking_id === bkId);
      const genRes = await fetch(`/api/bookings/${bkId}/generate-inspection-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspection_type: jobType === "Dispatch" ? "checkout" : "checkin",
          odometer: mileage,
          odometer_out: jobType === "Dispatch" ? mileage : undefined,
          odometer_in: jobType !== "Dispatch" ? mileage : undefined,
          fuel_level: fuel,
          fuel_out: jobType === "Dispatch" ? fuel : undefined,
          fuel_in: jobType !== "Dispatch" ? fuel : undefined,
          notes: notes,
          remarks: notes,
          damage_notes: notes,
          damage_desc: damageDesc,
          car_diagram: diagramBase64,
          car_diagram_out: jobType === "Dispatch" ? diagramBase64 : undefined,
          car_diagram_in: jobType !== "Dispatch" ? diagramBase64 : undefined,
          damage_marks: curDamageMarks,
          damage_marks_out: jobType === "Dispatch" ? curDamageMarks : undefined,
          damage_marks_in: jobType !== "Dispatch" ? curDamageMarks : undefined,
          checkin_img_front: jobType === "Return" ? imgFront : undefined,
          checkin_img_left: jobType === "Return" ? imgLeft : undefined,
          checkin_img_rear: jobType === "Return" ? imgRear : undefined,
          checkin_img_right: jobType === "Return" ? imgRight : undefined,
          inspection_categories: bObj?.inspection_categories || (jobType === "Dispatch" ? bObj?.inspection_categories_out : bObj?.inspection_categories_in) || {
            petrol: true, cleanliness: true, tires: true, interior: true, underhood: true
          },
          staff_name: (jobType === "Dispatch" ? bObj?.worker_delivery : bObj?.worker_return) || "Staff",
          customer_signature: bObj?.customer || "Customer"
        })
      });
      const genData = await genRes.json();
      if (!genRes.ok) {
        this.showToast(genData.detail || "เกิดข้อผิดพลาดในการบันทึกเลขไมล์", "error");
        return;
      }
      if (genData.success && genData.pdf_url) {
        genPdfUrl = genData.pdf_url;
        if (bObj) {
          if (jobType === "Dispatch") bObj.checkout_pdf_url = genPdfUrl;
          else bObj.checkin_pdf_url = genPdfUrl;
        }
      }
    } catch (pdfErr) {
      console.warn("[Inspection PDF] Notice generating inspection checklist PDF:", pdfErr);
    }

    const endpoint = jobType === "Dispatch" ? `/api/bookings/${bkId}/close-dispatch` : `/api/bookings/${bkId}/close-return`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-handover");
        const bObj = (this.bookings || []).find(x => x.booking_id === bkId);
        if (bObj && jobType === "Return") {
          bObj.checkin_img_front = imgFront;
          bObj.checkin_img_left = imgLeft;
          bObj.checkin_img_rear = imgRear;
          bObj.checkin_img_right = imgRight;
        }
        if (jobType === "Return" && isRepair) {
          if (branchBAction === "swap_vehicle") {
            this.showToast(`🔄 สลับรถทดแทนเป็น ${swapNewPlate} เรียบร้อย (รถเดิมเข้าซ่อมบำรุง & แขวนยอดค่าเสียหาย ฿${repairCost.toLocaleString()})`, "success");
          } else {
            this.showToast(`⚠️ รับคืนรถ ${bkId} เรียบร้อย (ส่งซ่อมบำรุง & หักมัดจำ ฿${repairCost.toLocaleString()})`, "warning");
          }
        } else {
          this.showToast(`🎉 ปิดงาน ${jobType} สำหรับ ${bkId} สมบูรณ์!`, "success");
        }
        if (typeof Swal !== "undefined" && genPdfUrl) {
          Swal.fire({
            icon: 'success',
            title: jobType === 'Dispatch' ? 'ส่งมอบรถสำเร็จ!' : 'รับรถคืนสำเร็จ!',
            html: `
              <p style="color:#475569; font-size:13.5px; margin-bottom:14px;">ระบบได้สร้างเอกสารใบตรวจสภาพรถยนต์ (Inspection Checklist PDF) พร้อมบันทึกลงฐานข้อมูลเรียบร้อยแล้ว</p>
              <a href="${genPdfUrl}" target="_blank" class="btn btn-primary" style="font-weight:700; padding:10px 20px; font-size:14px; text-decoration:none; display:inline-block; background:#EA580C; border-color:#EA580C;">
                🖨️ พิมพ์ใบตรวจสภาพรถ (Print Inspection PDF)
              </a>
            `,
            showConfirmButton: true,
            confirmButtonText: 'ปิดหน้าต่าง'
          });
        }
        await this.loadBackOfficeJobs();
        await this.loadBookings();
        await this.loadCars();
        if (jobType === "Return") await this.loadDashboardKPIs();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
      } else {
        throw new Error(data.detail || "ปิดงานไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  parseExpiryDateInfo(rawStr) {
    const str = String(rawStr || "").trim();
    if (!str || str === "-" || str.toLowerCase() === "none") {
      return { valid: false, dateObj: null, daysLeft: 999999, raw: "-", formatted: "-" };
    }

    let d = null;
    if (str.includes("/")) {
      const parts = str.split("/");
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let year = parseInt(parts[2], 10);
        if (year > 2400) year -= 543;
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          d = new Date(year, month, day);
        }
      }
    } else if (str.includes("-")) {
      const parts = str.split("-");
      if (parts.length === 3) {
        let year = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let day = parseInt(parts[2], 10);
        if (year > 2400) year -= 543;
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          d = new Date(year, month, day);
        }
      }
    }

    if (!d || isNaN(d.getTime())) {
      return { valid: false, dateObj: null, daysLeft: 999999, raw: str, formatted: str };
    }

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((targetMidnight.getTime() - todayMidnight.getTime()) / 86400000);

    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();

    return {
      valid: true,
      dateObj: d,
      daysLeft: diffDays,
      raw: str,
      formatted: `${dd}/${mm}/${yyyy}`
    };
  }

  formatExpiryStatusCell(plate, field, rawStr) {
    const info = this.parseExpiryDateInfo(rawStr);
    const safePlate = String(plate || "").replace(/'/g, "\\'");
    const labelType = field === "tax_expiry" ? "ภาษี" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");
    const mode = field === "ins_expiry" ? "ins" : "act";

    let badgeHtml = `<span style="color:#64748B; font-size:11.5px;">${info.formatted}</span>`;
    if (info.valid) {
      if (info.daysLeft < 0) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#991B1B; background:#FEE2E2; border:1px solid #FECACA; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🔴 ${info.formatted} (ขาด ${Math.abs(info.daysLeft)} วัน)
          </span>`;
      } else if (info.daysLeft === 0) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#991B1B; background:#FEE2E2; border:1px solid #FECACA; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🔴 ${info.formatted} (วันนี้!)
          </span>`;
      } else if (info.daysLeft <= 30) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#B45309; background:#FEF3C7; border:1px solid #FDE68A; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🟡 ${info.formatted} (เหลือ ${info.daysLeft} วัน)
          </span>`;
      } else {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:600; color:#065F46; background:#ECFDF5; border:1px solid #A7F3D0; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🟢 ${info.formatted}
          </span>`;
      }
    }

    // Check if an active renewal or maintenance job exists for this car & field
    const activeMnt = (this.maintenanceRecords || []).find(m =>
      m.car_id === plate &&
      m.status !== "เสร็จสิ้น" &&
      m.status !== "ยกเลิก" &&
      (
        ((field === "act_expiry" || field === "tax_expiry") && (String(m.order_type).includes("พ.ร.บ.") || String(m.order_type).includes("ต่อทะเบียน") || String(m.order_type).includes("แพ็กคู่"))) ||
        (field === "ins_expiry" && (String(m.order_type).includes("ประกัน") || String(m.order_type).includes("แพ็กคู่")))
      )
    );

    let actionBtnHtml = '';
    if (activeMnt) {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:4px;">
          <button type="button" onclick="app.openCloseMaintenanceModal('${activeMnt.id}')" title="พนักงานต่อเสร็จแล้ว: คลิกเพื่อระบุวันหมดอายุใหม่ & ส่งงาน" style="background:#ECFDF5; color:#047857; border:1px solid #10B981; border-radius:6px; padding:2px 7px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
            🏁 ส่งงาน
          </button>
        </div>
      `;
    } else if (field === "tax_expiry") {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:3px;">
          <button type="button" onclick="app.openExpiryModal('${safePlate}', 'tax_expiry')" title="ระบุ/แก้ไขวันหมดอายุภาษีโดยตรง" style="background:#F8FAFC; color:#64748B; border:1px solid #CBD5E1; border-radius:6px; padding:2px 5px; font-size:11px; cursor:pointer;">
            ✏️
          </button>
        </div>
      `;
    } else {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:3px;">
          <button type="button" onclick="app.openRenewalOrderModal('${safePlate}', '${mode}')" title="ออกใบงานมอบหมายต่ออายุ ${labelType} (ขึ้นหน้าตารางงาน)" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; border-radius:6px; padding:2px 6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
            📋 ออกใบงาน
          </button>
          <button type="button" onclick="app.openExpiryModal('${safePlate}', '${field}')" title="ระบุ/แก้ไขวันหมดอายุ ${labelType} โดยตรง" style="background:#F8FAFC; color:#64748B; border:1px solid #CBD5E1; border-radius:6px; padding:2px 5px; font-size:11px; cursor:pointer;">
            ✏️
          </button>
        </div>
      `;
    }

    return `
      <div style="display:flex; flex-direction:column; gap:3px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:nowrap;">
          <div>${badgeHtml}</div>
          <div style="flex-shrink:0;">${actionBtnHtml}</div>
        </div>
        ${activeMnt ? `<div style="font-size:10.5px; color:#1D4ED8; font-weight:700; display:flex; align-items:center; gap:3px;"><span>⏳ มอบหมาย:</span> <span style="color:#0F172A;">${activeMnt.assigned_worker || 'ช่าง'}</span> <span style="color:#64748B;">(${activeMnt.id})</span></div>` : ''}
      </div>
    `;
  }

  renderFleetOverviewTable() {
    const tbody = document.getElementById("fleet-overview-tbody");
    if (!tbody) return;

    const isEn = (this.currentLang === "EN");
    const summaryEl = document.getElementById("dash-fleet-expiry-summary");
    const sortMode = document.getElementById("dash-fleet-sort-select")?.value || "expiry_asc";
    const localKw = (document.getElementById("dash-fleet-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();

    // 1. Total Fleet across all companies (Unified Dashboard)
    const scopedCars = this.cars || [];

    let expiredCount = 0;
    let warningCount = 0;
    let normalCount = 0;

    // Duplicate check across current fleet
    const seenNormPlates = new Set();
    const seenChassis = new Set();
    let dupCount = 0;
    (this.cars || []).forEach(c => {
      const np = this.normalizePlate(c.plate);
      if (seenNormPlates.has(np)) dupCount++;
      seenNormPlates.add(np);
      const ch = String(c.chassis_no || "").trim().toUpperCase();
      if (ch && ch !== "-" && ch.length >= 8) {
        if (seenChassis.has(ch)) dupCount++;
        seenChassis.add(ch);
      }
    });

    const enrichedCars = scopedCars.map(c => {
      const taxInfo = this.parseExpiryDateInfo(c.tax_expiry);
      const actInfo = this.parseExpiryDateInfo(c.act_expiry);
      const insInfo = this.parseExpiryDateInfo(c.ins_expiry);
      const minDays = Math.min(actInfo.daysLeft, insInfo.daysLeft, taxInfo.daysLeft);
      const maxDays = Math.max(actInfo.daysLeft, insInfo.daysLeft);

      if (minDays < 0) expiredCount++;
      else if (minDays <= 30) warningCount++;
      else normalCount++;

      return {
        car: c,
        taxInfo,
        actInfo,
        insInfo,
        minDays,
        maxDays
      };
    });

    const titleEl = document.getElementById("title-expander-fleet");
    if (titleEl) {
      titleEl.textContent = isEn 
        ? `Fleet Database Overview (Tax, ACT, Ins & Service — ${scopedCars.length} cars)` 
        : `ฐานข้อมูลทะเบียนรถ, ภาษี, พ.ร.บ., ประกันภัย และเช็คระยะ (Fleet Database — ${scopedCars.length} คัน)`;
    }

    if (summaryEl) {
      summaryEl.innerHTML = `
        <span style="background:#FEE2E2; color:#991B1B; border:1px solid #FECACA; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🔴 ${isEn ? `Expired: ${expiredCount} cars` : `หมดอายุ: ${expiredCount} คัน`}
        </span>
        <span style="background:#FEF3C7; color:#B45309; border:1px solid #FDE68A; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🟡 ${isEn ? `Due soon (≤30d): ${warningCount} cars` : `ใกล้หมด (≤30 วัน): ${warningCount} คัน`}
        </span>
        <span style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🟢 ${isEn ? `Normal: ${normalCount} cars` : `ปกติ: ${normalCount} คัน`}
        </span>
        <span style="background:#EFF6FF; color:#1E40AF; border:1px solid #BFDBFE; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;" title="ตรวจสอบทะเบียนซ้ำและเลขตัวถังซ้ำอัตโนมัติ">
          ${dupCount === 0 ? (isEn ? 'No Duplicates' : 'ไม่พบรถซ้ำ') : (isEn ? `Duplicates (${dupCount})` : `พบรถซ้ำ (${dupCount})`)}
        </span>
      `;
    }

    // 2. Filter by search keyword (local search or sidebar search)
    let filtered = enrichedCars.filter(item => {
      const c = item.car;
      const target = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.company || ''} ${c.owner || ''} ${c.beneficiary || ''} ${c.color || ''} ${c.chassis_no || ''} ${c.ins_company || ''} ${c.reg_year || ''} ${c.notes || ''} ${c.status || ''} ${c.tax_expiry || ''} ${c.act_expiry || ''} ${c.ins_expiry || ''} ${c.hp_contract_no || ''}`.toLowerCase();
      if (localKw && !target.includes(localKw)) return false;
      if (sbKw && !target.includes(sbKw)) return false;
      return true;
    });

    // 3. Sort according to selected sort mode
    filtered.sort((a, b) => {
      if (sortMode === "tax_asc") {
        if (a.taxInfo.daysLeft !== b.taxInfo.daysLeft) return a.taxInfo.daysLeft - b.taxInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "act_asc") {
        if (a.actInfo.daysLeft !== b.actInfo.daysLeft) return a.actInfo.daysLeft - b.actInfo.daysLeft;
        if (a.insInfo.daysLeft !== b.insInfo.daysLeft) return a.insInfo.daysLeft - b.insInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "ins_asc") {
        if (a.insInfo.daysLeft !== b.insInfo.daysLeft) return a.insInfo.daysLeft - b.insInfo.daysLeft;
        if (a.actInfo.daysLeft !== b.actInfo.daysLeft) return a.actInfo.daysLeft - b.actInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "plate_asc") {
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else {
        if (a.minDays !== b.minDays) return a.minDays - b.minDays;
        if (a.maxDays !== b.maxDays) return a.maxDays - b.maxDays;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      }
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:28px; color:#64748B;">${isEn ? 'No vehicles found matching the search criteria' : 'ไม่พบข้อมูลรถยนต์ที่ค้นหา'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const c = item.car;
      const safePlate = String(c.plate || "").replace(/'/g, "\\'");
      const rowBg = item.minDays < 0 ? "background:#FEF2F2;" : (item.minDays <= 30 ? "background:#FFFBEB;" : "");

      const activePairMnt = (this.maintenanceRecords || []).find(m =>
        m.car_id === c.plate &&
        m.status !== "เสร็จสิ้น" &&
        m.status !== "ยกเลิก" &&
        (String(m.order_type).includes("ต่อทะเบียน") || String(m.order_type).includes("ประกัน") || String(m.order_type).includes("พ.ร.บ.") || String(m.order_type).includes("แพ็กคู่"))
      );

      let renewBtnHtml = '';
      if (activePairMnt) {
        renewBtnHtml = `
          <button type="button" onclick="app.openCloseMaintenanceModal('${activePairMnt.id}')" class="btn btn-sm" style="padding:3px 7px; font-size:11px; font-weight:800; background:#ECFDF5; color:#047857; border:1px solid #10B981;" title="${isEn ? 'Renewal completed: Submit & update dates' : 'พนักงานต่อเสร็จแล้ว: ส่งงาน & อัปเดตวันหมดอายุ'}">
            ${isEn ? 'Submit Renewal' : 'ส่งงานต่ออายุ'}
          </button>
        `;
      } else {
        renewBtnHtml = `
          <button type="button" onclick="app.openRenewalOrderModal('${safePlate}', 'both')" class="btn btn-sm" style="padding:3px 7px; font-size:11px; font-weight:700; background:#FFF7ED; color:#EA580C; border:1px solid #FDBA74;" title="${isEn ? 'Create dual work order for ACT & Insurance' : 'ออกใบงานต่ออายุทั้ง พ.ร.บ. และ ประกันภัย มอบหมายพนักงาน (ขึ้นหน้าตารางงาน)'}">
            ${isEn ? 'Dual Order' : 'ต่อคู่'}
          </button>
        `;
      }

      const regYearBadge = c.reg_year && c.reg_year !== "-"
        ? `<div style="font-size:10.5px; color:#64748B;">${isEn ? 'Reg Year:' : 'ปีจด:'} <b>${c.reg_year}</b></div>`
        : "";

      const ownerTxt = c.owner && c.owner !== "-" ? c.owner : (c.company || "-");
      const benTxt = c.beneficiary && c.beneficiary !== "-" && c.beneficiary !== ownerTxt
        ? `<div style="font-size:10.5px; color:#64748B;">ผู้รับผลประโยชน์: ${c.beneficiary}</div>`
        : "";

      const insCompBadge = c.ins_company && c.ins_company !== "-"
        ? `<div style="font-size:10.5px; color:#0369A1; font-weight:700; margin-top:2px;">${c.ins_company}</div>`
        : "";

      const srvInfo = [];
      if (c.last_service_date && c.last_service_date !== "-") srvInfo.push(`ล่าสุด: ${c.last_service_date}`);
      if (c.next_service_date && c.next_service_date !== "-") srvInfo.push(`กำหนดเช็ค: ${c.next_service_date}`);
      if (c.next_service_mileage && Number(c.next_service_mileage) > 0) srvInfo.push(`ไมล์เช็ค: ${Number(c.next_service_mileage).toLocaleString()} กม.`);
      else if (c.next_service && c.next_service !== "-" && c.next_service !== c.next_service_date) srvInfo.push(`ถัดไป: ${c.next_service}`);
      const srvHtml = srvInfo.length > 0
        ? `<div style="font-size:10.5px; color:#475569;">${srvInfo.join(" | ")}</div>`
        : "";

      const hpBadge = c.hp_contract_no
        ? `<div style="font-size:10.5px; color:#7C3AED; font-weight:700;">สัญญา: ${c.hp_contract_no}${c.hp_installment ? ` (฿${Number(c.hp_installment).toLocaleString()}/ด.)` : ''}</div>`
        : "";

      const notesShort = c.notes
        ? `<div style="font-size:11px; color:#334155; max-width:210px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${String(c.notes).replace(/"/g, '&quot;')}">${c.notes}</div>`
        : `<span style="color:#94A3B8; font-size:11px;">-</span>`;

      return `
        <tr style="${rowBg} transition: background 0.25s ease;">
          <td style="white-space:nowrap;">
            <b>${c.plate}</b>
            ${regYearBadge}
          </td>
          <td>
            <b>${c.brand || ''}</b> ${c.model || ''}
            <div style="font-size:11px; color:#64748B;">${c.color || '-'}</div>
          </td>
          <td style="font-family:monospace; font-size:11.5px; color:#1E293B; white-space:nowrap;">${c.chassis_no || '-'}</td>
          <td>
            <div style="font-weight:700; font-size:12px; color:#1E293B;">${ownerTxt}</div>
            ${benTxt}
          </td>
          <td>
            <span class="badge" style="background:${c.status_bg}; color:${c.status_color}; border:1px solid ${c.status_border};">
              ${c.fleet_status_desc || c.status}
            </span>
          </td>
          <td>${this.formatExpiryStatusCell(c.plate, 'tax_expiry', c.tax_expiry)}</td>
          <td>${this.formatExpiryStatusCell(c.plate, 'act_expiry', c.act_expiry)}</td>
          <td>
            ${this.formatExpiryStatusCell(c.plate, 'ins_expiry', c.ins_expiry)}
            ${insCompBadge}
          </td>
          <td style="white-space:nowrap;">
            <div style="font-weight:700; font-size:12px;">${c.mileage || '15,000'} km</div>
            ${srvHtml}
          </td>
          <td>
            ${hpBadge}
            ${notesShort}
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${renewBtnHtml}
            <button type="button" onclick="app.openEditCarModal('${safePlate}')" class="btn btn-sm btn-secondary" style="padding:3px 7px; font-size:11.5px;" title="แก้ไขรายละเอียดรถและรูปรถ">
              ✏️
            </button>
            <button type="button" onclick="app.jumpToCarInFrontOffice('${safePlate}')" class="btn btn-sm btn-secondary" style="padding:3px 7px; font-size:11.5px;" title="ดูรถในหน้าเลือกรถยนต์">
              🔍
            </button>
            <button type="button" onclick="app.deleteCarByPlate('${safePlate}')" class="btn btn-sm" style="padding:3px 7px; font-size:11.5px; background:#FEE2E2; color:#B91C1C; border:1px solid #FCA5A5;" title="ลบรถยนต์คันนี้ออกจากระบบ">
              🗑️
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async loadHpLeasingData() {
    await this.loadMonthlyExpenses();
  }

  renderHpLeasingTable() {
    this.renderMonthlyExpensesTable();
  }

  getExpiryCycleInfo(dateObj = null) {
    const d = dateObj || new Date();
    const day = d.getDate();
    const curYear = d.getFullYear();
    const curMonth = d.getMonth() + 1; // 1..12

    // สัปดาห์ปัจจุบัน (Monday ถึง Sunday) สำหรับ Weekly Warning
    const curr = new Date(d);
    const dayOfWeek = (curr.getDay() + 6) % 7; // 0=Mon, 6=Sun
    const monday = new Date(curr);
    monday.setDate(curr.getDate() - dayOfWeek);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    let roundDay, targetYear, targetMonth, roundName, roundNameEn, badgeText, badgeTextEn;
    if (day < 16) {
      roundDay = 1;
      targetYear = curYear;
      targetMonth = curMonth;
      const mm = String(targetMonth).padStart(2, '0');
      badgeText = `รอบวันที่ 1 (เดือนนี้ ${mm}/${targetYear})`;
      badgeTextEn = `Round 1st (This Month ${mm}/${targetYear})`;
      roundName = `รอบวันที่ 1 (หมดอายุเดือนนี้ ${mm}/${targetYear})`;
      roundNameEn = `Round 1st (Expiring this month ${mm}/${targetYear})`;
    } else {
      roundDay = 16;
      // Year-end safe transition: December (12) -> January (1) of next year
      if (curMonth === 12) {
        targetYear = curYear + 1;
        targetMonth = 1;
      } else {
        targetYear = curYear;
        targetMonth = curMonth + 1;
      }
      const mm = String(targetMonth).padStart(2, '0');
      badgeText = `รอบวันที่ 16 (เดือนหน้า ${mm}/${targetYear})`;
      badgeTextEn = `Round 16th (Next Month ${mm}/${targetYear})`;
      roundName = `รอบวันที่ 16 (หมดอายุเดือนหน้า ${mm}/${targetYear})`;
      roundNameEn = `Round 16th (Expiring next month ${mm}/${targetYear})`;
    }

    const targetYM = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    return {
      roundDay,
      targetYear,
      targetMonth,
      targetYM,
      roundName,
      roundNameEn,
      badgeText,
      badgeTextEn,
      weekStart: monday,
      weekEnd: sunday
    };
  }

  onAlertBannerClick() {
    const cycle = this.getExpiryCycleInfo();
    const body = document.getElementById("body-expander-monthly-expenses");
    const header = document.querySelector("#expander-monthly-expenses .expander-header");
    if (body) body.style.display = "block";
    if (header) header.classList.add("open");

    this.currentCycleFilterYM = cycle.targetYM;
    this.renderMonthlyExpensesTable();

    const el = document.getElementById("expander-monthly-expenses");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    this.showToast(`🔍 เลื่อนไปที่ตารางสรุปค่าใช้จ่าย: ${cycle.roundName}`, "info");
  }

  jumpToFilteredExpensesTable() {
    this.closeModal("modal-cycle-expiries");
    this.onAlertBannerClick();
  }

  clearCycleFilter() {
    this.currentCycleFilterYM = null;
    this.renderMonthlyExpensesTable();
    this.showToast("ล้างตัวกรองรอบแจ้งเตือนแล้ว (แสดงทุกรายการ)", "info");
  }

  showExpiryCycleDetails() {
    const cycle = this.getExpiryCycleInfo();
    const data = this.monthlyExpensesData || {};
    const allExpenses = data.expenses || [];
    const isEn = (this.currentLang === "EN");

    const matched = allExpenses.filter(item => {
      const iso = String(item.due_date_iso || "");
      const isMatchYM = iso.startsWith(cycle.targetYM);
      const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
      let isWeekly = false;
      if (iso && cycle.weekStart && cycle.weekEnd) {
        try {
          const itemDate = new Date(iso);
          isWeekly = (itemDate >= cycle.weekStart && itemDate <= cycle.weekEnd);
        } catch (e) {}
      }
      return isMatchYM || isOverdueInRound1 || isWeekly;
    });

    const titleEl = document.getElementById("modal-cycle-title");
    if (titleEl) titleEl.textContent = isEn ? `Expiring Documents & Expenses (${cycle.roundNameEn})` : `รายการเอกสารที่ต้องต่ออายุ — ${cycle.roundName}`;

    const subEl = document.getElementById("modal-cycle-subtitle");
    if (subEl) subEl.textContent = isEn 
      ? `Cycle Round: ${cycle.roundDay}th of month | Target month: ${cycle.targetYM}`
      : `รอบการแจ้งเตือนวันที่ ${cycle.roundDay} ของเดือน | เดือนเป้าหมาย: ${cycle.targetYM}`;

    const summaryEl = document.getElementById("modal-cycle-summary-bar");
    const totalAmt = matched.reduce((sum, it) => sum + parseFloat(it.amount || 0), 0);
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <b>${isEn ? 'Cycle Round:' : 'รอบแจ้งเตือน:'}</b> <span style="font-weight:800; color:#EA580C;">${isEn ? cycle.roundNameEn : cycle.roundName}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Items:' : 'รวมทั้งหมด:'}</b> <span style="font-weight:800;">${matched.length} ${isEn ? 'items' : 'รายการ'}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Amount:' : 'ยอดเงินรวม:'}</b> <span style="font-weight:800; color:#15803D;">฿${totalAmt.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
          </div>
        </div>
      `;
    }

    const tbody = document.getElementById("modal-cycle-tbody");
    if (tbody) {
      if (matched.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:32px; color:#64748B;">🎉 ${isEn ? 'No documents expiring in this cycle.' : `ไม่มีเอกสารหรือค่าใช้จ่ายครบกำหนดใน ${cycle.roundName}`}</td></tr>`;
      } else {
        tbody.innerHTML = matched.map((it, idx) => {
          let badgeClass = "badge badge-success";
          let itStatus = it.status;
          if (it.status_key === "overdue" || it.days_left < 0) {
            badgeClass = "badge badge-danger";
            itStatus = isEn ? "Overdue" : "เกินกำหนด";
          } else if (it.status_key === "pending_near" || (it.status_key !== "paid" && it.days_left <= 15)) {
            badgeClass = "badge badge-warning";
            itStatus = isEn ? "Pending (Due Soon)" : "รอชำระ (ใกล้ครบกำหนด)";
          } else if (it.status_key === "pending" || (it.status_key !== "paid" && it.days_left <= 30)) {
            badgeClass = "badge badge-warning";
            itStatus = isEn ? "Pending" : "รอชำระ";
          } else {
            itStatus = isEn ? "Paid" : "ชำระแล้ว";
          }
          return `
            <tr style="background:#ffffff !important;">
              <td style="text-align:center; font-weight:700; color:#64748B; background:#ffffff !important;">${idx + 1}</td>
              <td style="background:#ffffff !important;"><b>${it.plate}</b><br/><small style="color:#64748B;">${it.model}</small></td>
              <td style="background:#ffffff !important;"><b>${it.expense_type}</b></td>
              <td style="text-align:center; font-weight:600; background:#ffffff !important;">${it.due_date || '-'}<br/><small style="color:${it.days_left < 0 ? '#DC2626' : '#64748B'};">${it.notes || ''}</small></td>
              <td style="text-align:right; font-weight:800; color:#0F172A; background:#ffffff !important;">฿${Number(it.amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
              <td style="text-align:center; background:#ffffff !important;"><span class="${badgeClass}">${itStatus}</span></td>
            </tr>
          `;
        }).join("");
      }
    }

    this.openModal("modal-cycle-expiries");
  }

  openTopExpensesModal() {
    const isEn = (this.currentLang === "EN");
    const data = this.monthlyExpensesData || {};
    const allExpenses = data.expenses || [];

    // Map: plate -> { plate, model, company, total, breakdown: [] }
    const carMap = {};

    // 1. Populate all registered cars
    (this.cars || []).forEach(c => {
      const pl = c.id || c.plate;
      if (!pl) return;
      carMap[pl] = {
        plate: pl,
        model: `${c.brand || ''} ${c.model || ''}`.trim() || '-',
        company: c.company || c.owner_company || '-',
        total: 0,
        breakdown: []
      };
    });

    // 2. Aggregate expenses for each car (ภาษี + พ.ร.บ. + ประกัน + ค่างวด)
    allExpenses.forEach(exp => {
      const pl = exp.plate;
      if (!pl) return;
      if (!carMap[pl]) {
        carMap[pl] = {
          plate: pl,
          model: exp.model || '-',
          company: exp.company || '-',
          total: 0,
          breakdown: []
        };
      }
      const amt = parseFloat(exp.amount || 0);
      carMap[pl].total += amt;
      carMap[pl].breakdown.push({
        type: exp.expense_type,
        amount: amt
      });
    });

    // 3. Convert to array and sort descending by total expenses
    const rankedCars = Object.values(carMap);
    rankedCars.sort((a, b) => b.total - a.total);

    const grandTotal = rankedCars.reduce((sum, c) => sum + c.total, 0);

    // 4. Populate Summary Ribbon
    const summaryEl = document.getElementById("modal-top-expenses-summary");
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <b>${isEn ? 'Total Vehicles:' : 'จำนวนรถทั้งหมด:'}</b> <span style="font-weight:800; color:#991B1B;">${rankedCars.length} ${isEn ? 'cars' : 'คัน'}</span>
          </div>
          <div>
            <b>${isEn ? 'Highest Expense Car:' : 'รถที่มีค่าใช้จ่ายสูงสุด:'}</b> <span style="font-weight:800; color:#DC2626;">${rankedCars[0] ? `${rankedCars[0].plate} (฿${rankedCars[0].total.toLocaleString('th-TH', {minimumFractionDigits: 2})})` : '-'}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Fleet Expenses:' : 'ยอดค่าใช้จ่ายรวมทุกคัน:'}</b> <span style="font-weight:800; color:#991B1B;">฿${grandTotal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
          </div>
        </div>
      `;
    }

    // 5. Populate Table Body
    const tbody = document.getElementById("modal-top-expenses-tbody");
    if (tbody) {
      if (rankedCars.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:#64748B;">${isEn ? 'No vehicle expense data found.' : 'ไม่พบข้อมูลค่าใช้จ่ายรถยนต์'}</td></tr>`;
      } else {
        tbody.innerHTML = rankedCars.map((c, idx) => {
          const rankBadge = idx === 0 
            ? '<span style="font-size:16px;">🥇</span>' 
            : (idx === 1 ? '<span style="font-size:16px;">🥈</span>' : (idx === 2 ? '<span style="font-size:16px;">🥉</span>' : `<span style="font-weight:700; color:#64748B;">#${idx + 1}</span>`));
          const bdText = c.breakdown.length > 0 
            ? c.breakdown.map(b => `<span style="display:inline-block; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:1px 6px; margin:2px;">${b.type}: ฿${Number(b.amount).toLocaleString()}</span>`).join(" ")
            : '<span style="color:#94A3B8;">ไม่มีรายการค้างชำระ</span>';

          return `
            <tr style="background:#ffffff !important;">
              <td style="text-align:center; font-size:14px; background:#ffffff !important;">${rankBadge}</td>
              <td style="background:#ffffff !important;"><b style="font-size:13.5px; color:#0F172A;">${c.plate}</b></td>
              <td style="background:#ffffff !important;"><span style="font-weight:600; color:#334155;">${c.model}</span></td>
              <td style="font-size:11.5px; color:#64748B; background:#ffffff !important;">${bdText}</td>
              <td style="text-align:right; font-weight:800; color:#DC2626; font-size:13.5px; background:#ffffff !important;">฿${c.total.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
            </tr>
          `;
        }).join("");
      }
    }

    this.openModal("modal-top-expenses");
  }

  async loadMonthlyExpenses() {
    try {
      const res = await fetch(`/api/expenses/monthly?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
      if (res.ok) {
        this.monthlyExpensesData = await res.json();
        this.renderMonthlyExpensesTable();
      }
    } catch (e) {
      console.error("loadMonthlyExpenses error:", e);
    }
  }

  renderMonthlyExpensesTable() {
    const data = this.monthlyExpensesData || {};
    const summary = data.summary || {};
    const allExpenses = data.expenses || [];
    const isEn = (this.currentLang === "EN");

    // 1. Render Top Summary Badges Strip
    const cardsEl = document.getElementById("monthly-expenses-summary-cards");
    if (cardsEl) {
      cardsEl.innerHTML = `
        <div style="background:#FEF2F2; border:1px solid #FECACA; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#991B1B; font-weight:700;">📑 ${isEn ? 'Tax Pending' : 'ภาษีประจำปีรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#DC2626; margin-top:2px;">${summary.tax_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#92400E; font-weight:700;">🛡️ ${isEn ? 'ACT / PRB Pending' : 'พ.ร.บ. รอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#D97706; margin-top:2px;">${summary.act_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#1E40AF; font-weight:700;">🚗 ${isEn ? 'Insurance Pending' : 'ประกันภัยรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#2563EB; margin-top:2px;">${summary.insurance_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#FFF7ED; border:1px solid #FED7AA; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#C2410C; font-weight:700;">💳 ${isEn ? 'Installments Pending' : 'ค่างวดผ่อนรถรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#EA580C; margin-top:2px;">${summary.installment_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#166534; font-weight:700;">💰 ${isEn ? 'Total Pending Amount' : 'ยอดรวมที่ต้องชำระรอบนี้'}</div>
          <div style="font-size:18px; font-weight:800; color:#15803D; margin-top:2px;">฿${Number(summary.total_pending_amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
        </div>
      `;
    }

    // Update alert count badge on dashboard
    const cycle = this.getExpiryCycleInfo();
    const cycleMatched = allExpenses.filter(item => {
      const iso = String(item.due_date_iso || "");
      const isMatchYM = iso.startsWith(cycle.targetYM);
      const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
      let isWeekly = false;
      if (iso && cycle.weekStart && cycle.weekEnd) {
        try {
          const itemDate = new Date(iso);
          isWeekly = (itemDate >= cycle.weekStart && itemDate <= cycle.weekEnd);
        } catch (e) {}
      }
      return isMatchYM || isOverdueInRound1 || isWeekly;
    });
    const alertCountEl = document.getElementById("dash-alert-count");
    if (alertCountEl) alertCountEl.textContent = cycleMatched.length;

    // Optional active cycle notice banner above table
    let cycleNoticeEl = document.getElementById("monthly-expenses-cycle-notice");
    if (!cycleNoticeEl && cardsEl) {
      cycleNoticeEl = document.createElement("div");
      cycleNoticeEl.id = "monthly-expenses-cycle-notice";
      cardsEl.parentNode.insertBefore(cycleNoticeEl, cardsEl.nextSibling);
    }
    if (this.currentCycleFilterYM && cycleNoticeEl) {
      cycleNoticeEl.style.display = "block";
      cycleNoticeEl.innerHTML = `
        <div style="background:#FFF7ED; border:1px solid #FDBA74; border-radius:8px; padding:8px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="font-size:12.5px; color:#C2410C; font-weight:700;">
            🔍 ${isEn ? 'Showing only items for:' : 'กำลังแสดงรายการเฉพาะ:'} <span>${cycle.roundName}</span> (${cycleMatched.length} ${isEn ? 'items' : 'รายการ'})
          </div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="app.clearCycleFilter()" style="padding:3px 10px; font-size:11.5px; font-weight:700;">
            ✕ ${isEn ? 'Clear Filter (Show All)' : 'ล้างตัวกรองรอบนี้ (แสดงทั้งหมด)'}
          </button>
        </div>
      `;
    } else if (cycleNoticeEl) {
      cycleNoticeEl.style.display = "none";
    }

    // 2. Filter Table Items
    const kw = (document.getElementById("expense-search-kw")?.value || "").toLowerCase().trim();
    const typeFilter = document.getElementById("expense-type-filter")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("expense-status-filter")?.value || "ทั้งหมด";

    const filtered = allExpenses.filter(item => {
      if (this.currentCycleFilterYM) {
        const iso = String(item.due_date_iso || "");
        const isMatchYM = iso.startsWith(this.currentCycleFilterYM);
        const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
        if (!isMatchYM && !isOverdueInRound1) return false;
      }
      if (kw) {
        const fullTxt = `${item.plate} ${item.model} ${item.company} ${item.expense_type}`.toLowerCase();
        if (!fullTxt.includes(kw)) return false;
      }
      if (typeFilter !== "ทั้งหมด") {
        if (!item.expense_type.includes(typeFilter) && item.expense_key !== typeFilter) return false;
      }
      if (statusFilter !== "ทั้งหมด") {
        if (statusFilter === "รอชำระ" && item.status_key === "paid") return false;
        if (statusFilter === "ชำระแล้ว" && item.status_key !== "paid") return false;
      }
      return true;
    });

    // 3. Render Table Body
    const tbody = document.getElementById("monthly-expenses-tbody");
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:36px; color:#64748B;">${isEn ? 'No expense items found matching the selected filters.' : '🎉 ไม่มีรายการค่าใช้จ่ายค้างชำระตามตัวกรองที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((item, idx) => {
      let badgeStyle = "background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;";
      let badgeIcon = "✅";
      let displayStatus = item.status;

      // SINGLE SOURCE OF TRUTH: Directly reflect Backend status & status_key
      if (item.status_key === "paid") {
        badgeStyle = "background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;";
        badgeIcon = "✅";
        displayStatus = item.status || (isEn ? "Paid" : "ชำระแล้ว");
      } else if (item.status_key === "overdue") {
        badgeStyle = "background:#FEF2F2; color:#991B1B; border:1px solid #FECACA; font-weight:800;";
        badgeIcon = "⚠️";
        displayStatus = item.status || (isEn ? "Overdue" : "เกินกำหนด");
      } else if (item.status_key === "pending_near") {
        badgeStyle = "background:#FFF7ED; color:#C2410C; border:1.5px solid #FDBA74; font-weight:800;";
        badgeIcon = "⏳";
        displayStatus = item.status || (isEn ? "Pending (Due Soon)" : "รอชำระ (ใกล้ครบกำหนด)");
      } else {
        badgeStyle = "background:#FFFBEB; color:#92400E; border:1px solid #FDE68A; font-weight:700;";
        badgeIcon = "⏳";
        displayStatus = item.status || (isEn ? "Pending" : "รอชำระ");
      }

      const safePlate = String(item.plate || "").replace(/'/g, "\\'");
      const isPaid = (item.status_key === "paid");

      return `
        <tr>
          <td style="text-align:center; font-weight:700; color:#64748B;">${idx + 1}</td>
          <td>
            <div style="font-weight:800; color:#1E293B;">🚘 ${item.plate}</div>
            <div style="font-size:12px; color:#475569;">${item.model} <span style="font-size:11px; color:#94A3B8;">(${item.company})</span></div>
          </td>
          <td>
            <span style="font-weight:700; color:#334155; font-size:12px;">${item.expense_type}</span>
          </td>
          <td style="text-align:center;">
            <div style="font-weight:700; color:#1E293B;">📅 ${item.due_date}</div>
            <div style="font-size:11px; color:${item.days_left < 0 ? '#DC2626' : (item.days_left <= 15 ? '#C2410C' : (item.days_left <= 30 ? '#D97706' : '#16A34A'))}; font-weight:600;">
              ${item.notes}
            </div>
          </td>
          <td style="text-align:right; font-weight:800; color:#1E293B; font-size:13px;">
            ฿${Number(item.amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}
          </td>
          <td style="text-align:center;">
            <span style="font-size:11.5px; padding:3px 10px; border-radius:12px; display:inline-block; ${badgeStyle}">
              ${badgeIcon} ${displayStatus}
            </span>
          </td>
          <td style="text-align:center;">
            <button type="button" class="btn btn-sm ${isPaid ? 'btn-secondary' : 'btn-primary'}" onclick="app.payMonthlyExpense('${safePlate}', '${item.expense_key}', ${item.amount || 0}, '${item.due_date}')" style="padding:4px 12px; font-size:11.5px; font-weight:700; border-radius:6px; cursor:pointer;" title="${isEn ? 'Mark as Paid & Extend Expiry Date' : 'บันทึกชำระเงินและต่ออายุวันหมดอายุอัตโนมัติ'}">
              💳 ${isEn ? 'Update Paid' : 'อัปเดตชำระเงิน'}
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async payMonthlyExpense(plate, expenseKey, amount = 0, dueDate = "") {
    if (!plate || !expenseKey) return;
    const isEn = (this.currentLang === "EN");
    const typeLabel = expenseKey === "tax" ? "ภาษีประจำปี" : (expenseKey === "act" ? "พ.ร.บ." : (expenseKey === "insurance" ? "ประกันภัย" : "ค่างวดผ่อนรถ"));
    const conf = confirm(`ยืนยันการบันทึกชำระเงิน "${typeLabel}" สำหรับรถทะเบียน ${plate} หรือไม่?

💰 ยอดเงิน: ฿${Number(amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}
💡 ระบบจะทำการบันทึกลงบัญชีรายจ่าย (financial_records) และต่ออายุรอบถัดไปให้อัตโนมัติ`);
    if (!conf) return;

    try {
      const todayIso = new Date().toISOString().split("T")[0];
      const res = await fetch("/api/expenses/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: plate,
          car_id: plate,
          expense_type: expenseKey,
          amount: Number(amount || 0),
          payment_date: todayIso,
          due_date: dueDate
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "เกิดข้อผิดพลาดในการอัปเดต");
      }
      this.showToast(`🎉 ${data.message} (กำหนดใหม่: ${data.new_due_date})`, "success");
      // TARGET MISSION 3: Real-time UI Refresh
      await this.loadMonthlyExpenses();
      await this.loadCars();
      if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
      if (this.loadFinanceSummary) await this.loadFinanceSummary();
    } catch (e) {
      alert(`❌ อัปเดตชำระเงินไม่สำเร็จ:
${e.message}`);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  computeRenewedDateStr(rawStr) {
    const now = new Date();
    const info = this.parseExpiryDateInfo(rawStr);
    let targetDate = null;

    if (info.valid && info.dateObj) {
      const d = info.dateObj;
      let targetYear = Math.max(d.getFullYear() + 1, now.getFullYear() + 1);
      targetDate = new Date(targetYear, d.getMonth(), d.getDate());
      const diffDays = Math.round((targetDate.getTime() - now.getTime()) / 86400000);
      if (diffDays <= 30) {
        targetDate = new Date(targetYear + 1, d.getMonth(), d.getDate());
      }
    } else {
      targetDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    }

    const dd = String(targetDate.getDate()).padStart(2, "0");
    const mm = String(targetDate.getMonth() + 1).padStart(2, "0");
    const yyyy = targetDate.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  dmyToYmd(dmyStr) {
    if (!dmyStr || dmyStr === "-" || String(dmyStr).trim().toLowerCase() === "none") return "";
    const s = String(dmyStr).trim();
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts[0].length === 4) {
        let yr = parseInt(parts[0], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
      }
      if (parts[2].length === 4) {
        let yr = parseInt(parts[2], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
    }
    if (s.includes("/")) {
      const parts = s.split("/");
      if (parts.length === 3 && parts[2].length === 4) {
        let yr = parseInt(parts[2], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
    }
    return "";
  }

  ymdToDmy(ymdStr) {
    if (!ymdStr || ymdStr === "-") return "";
    const s = String(ymdStr).trim();
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts.length === 3 && parts[0].length === 4) {
        return `${parts[2].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[0]}`;
      }
    }
    return s;
  }

  openRenewalOrderModal(plate, mode = "both") {
    try {
      const car = (this.cars || []).find(c => c.plate === plate);
      if (!car) {
        this.showToast("ไม่พบข้อมูลรถยนต์ " + plate, "danger");
        return;
      }

      const modalTitleEl = document.getElementById("modal-mnt-title");
      if (modalTitleEl) {
        modalTitleEl.textContent = "📋 ออกใบงานมอบหมายต่อทะเบียนภาษี / พ.ร.บ. / ประกันภัย";
      }

      // 1. Populate car select in modal and select target plate
      const carSel = document.getElementById("mnt-car-select");
      if (carSel) {
        const opts = (this.cars || []).map(c => `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (${c.color || ''}) [${c.status}]</option>`);
        carSel.innerHTML = opts.join("");
        carSel.value = plate;
      }

      // 2. Populate worker select
      const workerSel = document.getElementById("mnt-assigned-worker");
      if (workerSel) {
        const userList = (this.users || []).filter(u => u.status === "approved" || !u.status);
        const opts = userList.length > 0
          ? userList.map(u => `<option value="${u.username}">${u.username} (${u.name || u.username}) [${u.role || 'Staff'}]</option>`)
          : [
              '<option value="admin">admin (ผู้ดูแลระบบ (Admin)) [Admin]</option>',
              '<option value="chaiwat.u">chaiwat.u [Staff]</option>',
              '<option value="sam">sam [Staff]</option>',
              '<option value="sucheeda">sucheeda [Staff]</option>',
              '<option value="Chatipat">Chatipat [Staff]</option>'
            ];
        workerSel.innerHTML = opts.join("");
        if (this.user?.username && Array.from(workerSel.options).some(o => o.value === this.user.username)) {
          workerSel.value = this.user.username;
        }
      }

      // 3. Update car details pill & mileage
      this.onMaintenanceCarSelected(plate);

      // 4. Set order type and service description
      let orderType = "ต่อทะเบียนภาษี และ พ.ร.บ.";
      let serviceDesc = "";
      let garageName = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร)";
      let garagePhone = "02-271-8888";
      let garageLoc = "กรมการขนส่งทางบก จตุจักร กทม.";
      let costEst = 1500;

      if (mode === "act") {
        orderType = "ต่อทะเบียนภาษี และ พ.ร.บ.";
        serviceDesc = `1. ตรวจสอบเอกสาร และ ชำระภาษีรถยนต์ประจำปี\n2. ต่ออายุ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ (วันหมดอายุเดิม: ${car.act_expiry || '-'})\n3. รับป้ายวงกลมแสดงการเสียภาษีและสำเนากรมธรรม์ พ.ร.บ.`;
        garageName = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร)";
        garagePhone = "02-271-8888";
        garageLoc = "กรมการขนส่งทางบก จตุจักร กทม.";
        costEst = 1500;
      } else if (mode === "ins") {
        orderType = "ต่อประกันภัยรถยนต์";
        serviceDesc = `1. ต่ออายุกรมธรรม์ประกันภัยรถยนต์ประจำปี (วันหมดอายุเดิม: ${car.ins_expiry || '-'})\n2. ดำเนินการออกกรมธรรม์ความคุ้มครองฉบับใหม่ พร้อมขอใบเสร็จรับเงิน`;
        garageName = "บริษัทประกันภัยรถยนต์ (ตามกรมธรรม์เดิม)";
        garagePhone = "02-123-4567";
        garageLoc = "สำนักงานใหญ่ / ตัวแทนประกันภัย";
        costEst = 15000;
      } else {
        orderType = "ต่อทะเบียนภาษี พ.ร.บ. และ ประกันภัย (แพ็กคู่)";
        serviceDesc = `1. ชำระภาษีรถยนต์ประจำปี + ต่ออายุ พ.ร.บ. (วันหมดอายุเดิม: ${car.act_expiry || '-'})\n2. ต่ออายุกรมธรรม์ประกันภัยรถยนต์ประจำปี (วันหมดอายุเดิม: ${car.ins_expiry || '-'})\n3. รับป้ายวงกลมภาษีและกรมธรรม์ประกันภัยฉบับใหม่`;
        garageName = "สำนักงานขนส่ง และ บริษัทประกันภัย";
        garagePhone = "02-271-8888";
        garageLoc = "สำนักงานขนส่งทางบก / ตัวแทนประกัน";
        costEst = 16500;
      }

      const typeSelect = document.getElementById("mnt-order-type");
      if (typeSelect) {
        let exists = Array.from(typeSelect.options).some(o => o.value === orderType);
        if (!exists) {
          const opt = document.createElement("option");
          opt.value = orderType;
          opt.textContent = `🔄 ${orderType}`;
          typeSelect.appendChild(opt);
        }
        typeSelect.value = orderType;
      }

      const formIdEl = document.getElementById("mnt-form-id");
      if (formIdEl) formIdEl.value = "";
      const itemsEl = document.getElementById("mnt-service-items");
      if (itemsEl) itemsEl.value = serviceDesc;
      const costEl = document.getElementById("mnt-cost");
      if (costEl) costEl.value = costEst;
      const centerEl = document.getElementById("mnt-service-center");
      if (centerEl) centerEl.value = garageName;
      const phoneEl = document.getElementById("mnt-service-phone");
      if (phoneEl) phoneEl.value = garagePhone;
      const locEl = document.getElementById("mnt-service-loc");
      if (locEl) locEl.value = garageLoc;

      const todayStr = new Date().toISOString().split("T")[0];
      const tmrw = new Date();
      tmrw.setDate(tmrw.getDate() + 1);
      const tmrwStr = tmrw.toISOString().split("T")[0];

      const schedDate = document.getElementById("mnt-sched-date");
      if (schedDate) schedDate.value = todayStr;
      const schedTime = document.getElementById("mnt-sched-time");
      if (schedTime) schedTime.value = "09:00";
      const expDate = document.getElementById("mnt-exp-date");
      if (expDate) expDate.value = tmrwStr;
      const expTime = document.getElementById("mnt-exp-time");
      if (expTime) expTime.value = "17:00";

      const notesEl = document.getElementById("mnt-notes");
      if (notesEl) notesEl.value = `มอบหมายพนักงานไปดำเนินการต่อทะเบียน/ประกันภัย ทะเบียน ${car.plate} (เลขตัวถัง: ${car.chassis_no || '-'})`;
      const updateCarCheck = document.getElementById("mnt-update-car-status");
      if (updateCarCheck) updateCarCheck.checked = true;

      // Open Modal
      this.openModal("modal-new-maintenance");
    } catch (err) {
      console.error("Error opening renewal modal:", err);
      alert("เกิดข้อผิดพลาดในการเปิดหน้าต่างใบงาน: " + err.message);
    }
  }

  async quickRenewCarExpiry(plate, field) {
    this.openRenewalOrderModal(plate, field === "act_expiry" ? "act" : "ins");
  }

  async quickRenewBothExpiry(plate) {
    this.openRenewalOrderModal(plate, "both");
  }

  openExpiryModal(plate, field) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const labelType = field === "tax_expiry" ? "ภาษีรถยนต์" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");
    const currVal = car[field] || "-";
    const info = this.parseExpiryDateInfo(currVal);

    document.getElementById("expiry-modal-plate").value = plate;
    document.getElementById("expiry-modal-field").value = field;
    document.getElementById("modal-expiry-title").textContent = `🔄 อัปเดตวันหมดอายุ ${labelType} (${plate})`;
    document.getElementById("expiry-modal-car-info").textContent = `🚘 ${plate} — ${car.brand || ''} ${car.model || ''} (${car.company || ''})`;
    document.getElementById("expiry-modal-current-info").textContent = `วันหมดอายุ ${labelType} ปัจจุบัน: ${info.formatted}`;

    // Pre-fill with +1 year from old expiry date by default
    this.applyExpiryPreset("old_1y");
    this.openModal("modal-update-expiry");
  }

  applyExpiryPreset(mode) {
    const plate = document.getElementById("expiry-modal-plate")?.value;
    const field = document.getElementById("expiry-modal-field")?.value;
    const car = (this.cars || []).find(c => c.plate === plate) || {};

    let newDateStr = "";
    if (mode === "old_1y") {
      newDateStr = this.computeRenewedDateStr(car[field]);
    } else {
      const now = new Date();
      const target = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      const dd = String(target.getDate()).padStart(2, "0");
      const mm = String(target.getMonth() + 1).padStart(2, "0");
      const yyyy = target.getFullYear();
      newDateStr = `${dd}/${mm}/${yyyy}`;
    }

    const parts = newDateStr.split("/");
    const textInput = document.getElementById("expiry-modal-text-input");
    const datePicker = document.getElementById("expiry-modal-date-picker");
    if (textInput) textInput.value = newDateStr;
    if (datePicker && parts.length === 3) {
      datePicker.value = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  onExpiryPickerChange(isoVal) {
    if (!isoVal) return;
    const parts = isoVal.split("-");
    if (parts.length === 3) {
      const textInput = document.getElementById("expiry-modal-text-input");
      if (textInput) textInput.value = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  async submitExpiryModal() {
    const plate = document.getElementById("expiry-modal-plate")?.value;
    const field = document.getElementById("expiry-modal-field")?.value;
    const rawNew = (document.getElementById("expiry-modal-text-input")?.value || "").trim();
    if (!plate || !field || !rawNew) {
      this.showToast("⚠️ กรุณาระบุวันหมดอายุใหม่", "warning");
      return;
    }

    const parsed = this.parseExpiryDateInfo(rawNew);
    const finalDateStr = parsed.valid ? parsed.formatted : rawNew;
    const labelType = field === "tax_expiry" ? "ภาษีรถยนต์" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");

    this.closeModal("modal-update-expiry");
    await this.saveCarExpiryUpdate(plate, field, finalDateStr, labelType);
  }

  async saveCarExpiryUpdate(plate, field, newDateStr, labelType) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    // Optimistically update in-memory car object and re-sort table immediately
    car[field] = newDateStr;
    this.renderFleetOverviewTable();

    const otherField = field === "act_expiry" ? "ins_expiry" : "act_expiry";
    const otherLabel = field === "act_expiry" ? "ประกันภัย" : "พ.ร.บ.";
    const otherInfo = this.parseExpiryDateInfo(car[otherField]);
    const sortMode = document.getElementById("dash-fleet-sort-select")?.value || "expiry_asc";

    const payload = Object.assign({}, car, {
      plate: plate,
      [field]: newDateStr
    });

    try {
      const res = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        if (sortMode === "expiry_asc" && otherInfo.valid && otherInfo.daysLeft <= 30) {
          this.showToast(`✅ อัปเดต ${labelType} ทะเบียน ${plate} เป็น ${newDateStr} แล้ว (หมายเหตุ: ${otherLabel} ยังหมดอายุ ${otherInfo.formatted} กด 🔄 ที่ ${otherLabel} หรือปุ่ม '🔄 ต่อคู่' เพื่อให้แถวเลื่อนลงไปท้ายตาราง)`, "success");
        } else {
          this.showToast(`✅ อัปเดตวันหมดอายุ ${labelType} ทะเบียน ${plate} เป็น ${newDateStr} เรียบร้อย! (เรียงลำดับตารางใหม่แล้ว)`, "success");
        }
        await this.loadCars();
      } else {
        this.showToast("❌ อัปเดตไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  jumpToCarInFrontOffice(plate) {
    const sbSearch = document.getElementById("sb-search-input");
    if (sbSearch) sbSearch.value = plate;
    this.sidebarSearchKw = String(plate || "").toLowerCase().trim();
    this.switchModule("frontoffice");
    this.switchTab("fleet");
    this.renderFleetCards();
    this.showToast(`🚘 ข้ามไปยังข้อมูลรถยนต์ทะเบียน ${plate}`, "info");
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

  renderDashboardCharts() {
    this.renderDonutCharts();
    this.renderTrendChart();
  }

  setTrendType(type) {
    this.trendType = type || "bar";
    const btnBar = document.getElementById("btn-trend-bar");
    const btnArea = document.getElementById("btn-trend-area");
    if (this.trendType === "bar") {
      if (btnBar) { btnBar.style.background = "#E85826"; btnBar.style.color = "#FFFFFF"; }
      if (btnArea) { btnArea.style.background = "transparent"; btnArea.style.color = "#6B7280"; }
    } else {
      if (btnArea) { btnArea.style.background = "#E85826"; btnArea.style.color = "#FFFFFF"; }
      if (btnBar) { btnBar.style.background = "transparent"; btnBar.style.color = "#6B7280"; }
    }
    this.renderTrendChart();
  }

    renderDonutCharts() {
    try {
      const canvas = document.getElementById("chart-fleet-status-donut");
      const badge = document.getElementById("donut-total-badge");
      const legend = document.getElementById("fleet-status-legend");
      if (!canvas) {
        console.warn("[Dashboard Donut] Canvas element #chart-fleet-status-donut not found");
        return;
      }
      if (typeof Chart === "undefined") {
        console.warn("[Dashboard Donut] Chart.js library is not loaded");
        return;
      }

      const isEn = (this.currentLang === "EN");
      const data = this.dashboardStats || {};
      const sc = data.status_counts || data.status_breakdown || data.fleet_status_breakdown || {};

      console.log("[Dashboard Donut] Raw API stats received:", data);
      console.log("[Dashboard Donut] Parsed status_counts:", sc);

      // Robust fallback extraction: never NaN or undefined
      let totalCars = Number(data.total_fleet ?? data.total_cars ?? (this.cars || []).length ?? 0);
      let availCount = Number(sc.available ?? data.available ?? data.available_cars ?? 0);
      let rentCount = Number(sc.on_rent ?? sc.rented ?? sc.onRent ?? data.on_rent ?? data.rented_cars ?? 0);
      let bookCount = Number(sc.booked ?? sc.reserved ?? data.booked ?? data.booked_cars ?? 0);
      let maintCount = Number(sc.maintenance ?? sc.maint ?? data.maintenance ?? data.maintenance_cars ?? 0);

      // FOOLPROOF FALLBACK: If status counts from API are all 0 but this.cars exists in memory
      if (availCount === 0 && rentCount === 0 && bookCount === 0 && maintCount === 0 && (this.cars || []).length > 0) {
        console.log("[Dashboard Donut] API returned all 0s, computing counts directly from this.cars:", this.cars.length);
        totalCars = this.cars.length;
        this.cars.forEach(c => {
          const st = String(c.status || c.car_status || "").trim().toLowerCase();
          const fKey = String(c.fleet_status_key || "").trim().toLowerCase();
          const isOnRent = Boolean(c.is_on_rent);
          if (isOnRent || fKey === "on_rent" || fKey === "rented" || st.includes("เช่า") || st.includes("rent") || st.includes("รอรับคืน")) {
            rentCount++;
          } else if (fKey === "maintenance" || fKey === "repair" || st.includes("ซ่อม") || st.includes("ไม่พร้อม") || st.includes("ระงับ") || st.includes("maint") || st.includes("ต่อทะเบียน") || st.includes("ต่อภาษี") || st.includes("workshop") || st.includes("renewal")) {
            const pNorm = String(c.plate || "").replace(/[\s\-\.]+/g, "").toLowerCase();
            const hasActiveMaint = (this.maintenanceRecords || []).some(m => {
              const mpNorm = String(m.car_id || "").replace(/[\s\-\.]+/g, "").toLowerCase();
              const mSt = String(m.status || "").trim();
              return (m.car_id === c.plate || mpNorm === pNorm) && !["เสร็จสิ้น", "ยกเลิก", "completed", "canceled"].includes(mSt.toLowerCase());
            });
            if (hasActiveMaint) {
              maintCount++;
            } else {
              availCount++;
            }
          } else if (fKey === "booked" || fKey === "reserved" || st.includes("จอง") || st.includes("book") || st.includes("reserv") || st.includes("ติดจอง") || st.includes("ส่งมอบ")) {
            bookCount++;
          } else {
            availCount++;
          }
        });
      }

      console.log(`[Dashboard Donut] Final counts => Available: ${availCount}, On Rent: ${rentCount}, Booked: ${bookCount}, Maintenance: ${maintCount}, Total: ${totalCars}`);

      if (badge) {
        badge.textContent = isEn ? `${totalCars} cars` : `${totalCars} คัน`;
      }

      // Safely destroy previous chart instance before re-creating
      if (this.donutChart) {
        try {
          this.donutChart.destroy();
        } catch (e) {
          console.warn("[Dashboard Donut] Error destroying existing chart:", e);
        }
        this.donutChart = null;
      }

      const labels = isEn 
        ? ["Available", "Rented", "Reserved", "Maintenance"]
        : ["ว่างพร้อมให้บริการ", "กำลังเช่า", "ติดจอง", "ซ่อมบำรุง"];
      const colors = ["#10B981", "#3B82F6", "#F59E0B", "#F97316"]; // เขียว, น้ำเงิน, เหลือง, ส้ม

      // If all counts are zero, display a friendly placeholder ring rather than a broken blank canvas
      const isAllZero = (availCount === 0 && rentCount === 0 && bookCount === 0 && maintCount === 0);
      const chartDataArr = isAllZero ? [1] : [availCount, rentCount, bookCount, maintCount];
      const chartColors = isAllZero ? ["#E2E8F0"] : colors;
      const chartLabels = isAllZero ? (isEn ? ["No data"] : ["ไม่มีข้อมูลรถ"]) : labels;

      this.donutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: chartLabels,
          datasets: [{
            data: chartDataArr,
            backgroundColor: chartColors,
            borderColor: '#FFFFFF',
            borderWidth: 2,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '80%', // Minimalist thin donut ring
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: !isAllZero,
              callbacks: {
                label: function(ctx) {
                  const val = ctx.raw || 0;
                  const pct = totalCars > 0 ? ((val / totalCars) * 100).toFixed(1) : "0.0";
                  return isEn ? ` ${ctx.label}: ${val} cars (${pct}%)` : ` ${ctx.label}: ${val} คัน (${pct}%)`;
                }
              }
            }
          }
        }
      });

      if (legend) {
        const dataArr = [availCount, rentCount, bookCount, maintCount];
        legend.className = "grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100";
        legend.style.display = "grid";
        legend.style.gridTemplateColumns = "repeat(2, 1fr)";
        legend.style.gap = "6px 12px";
        legend.innerHTML = labels.map((lbl, idx) => {
          const val = dataArr[idx];
          const pct = totalCars > 0 ? ((val / totalCars) * 100).toFixed(1) : "0.0";
          const cDot = colors[idx];
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:4px 8px; background:#F8FAFC; border-radius:6px; border:1px solid #F1F5F9;">
              <span style="display:inline-flex; align-items:center; gap:5px; color:#475569;">
                <span style="color:${cDot}; font-size:13px; line-height:1;">●</span>
                <span style="font-weight:600;">${lbl}</span>
              </span>
              <span style="font-weight:700; color:#1E293B;">
                ${val} ${isEn ? 'cars' : 'คัน'} <span style="font-weight:400; color:#94A3B8; font-size:11px;">(${pct}%)</span>
              </span>
            </div>
          `;
        }).join("");
      }
    } catch (err) {
      console.error("[Dashboard Donut] Error in renderDonutCharts:", err);
    }
  }

  renderTrendChart() {
    const canvas = document.getElementById("chart-revenue-trend");
    if (!canvas || typeof Chart === "undefined") return;

    const isEn = (this.currentLang === "EN");
    const thMonthNames = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const enMonthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthNames = isEn ? enMonthNames : thMonthNames;

    let labels = [];
    let dataRev = [];

    if (this.dashboardStats && this.dashboardStats.monthly_trend && this.dashboardStats.monthly_trend.length > 0) {
      const mt = this.dashboardStats.monthly_trend;
      labels = mt.map(b => isEn ? `${enMonthNames[b.month]} ${b.year}` : `${b.month}. ${thMonthNames[b.month]}`);
      dataRev = mt.map(b => Number(b.revenue || 0));
    } else {
      const now = new Date();
      const monthBins = [];
      for (let i = 5; i >= 0; i--) {
        let m = now.getMonth() + 1 - i;
        let y = now.getFullYear();
        while (m <= 0) {
          m += 12;
          y -= 1;
        }
        monthBins.push({
          label: isEn ? `${monthNames[m]} ${y}` : `${m}. ${monthNames[m]}`,
          month: m,
          year: y,
          rev: 0,
          jobs: 0
        });
      }

      (this.completedJobs || []).forEach(item => {
        const dStr = String(item.completed_date || item.end_date || "");
        let dObj = null;
        if (dStr.includes("-")) {
          const p = dStr.split("-");
          if (p.length >= 3) dObj = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
        } else if (dStr.includes("/")) {
          const p = dStr.split("/");
          if (p.length >= 3) dObj = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
        }
        if (dObj && !isNaN(dObj.getTime())) {
          const m = dObj.getMonth() + 1;
          const y = dObj.getFullYear();
          const mb = monthBins.find(b => b.month === m && b.year === y);
          if (mb) {
            mb.rev += parseFloat(item.net_price || 0);
            mb.jobs += 1;
          }
        }
      });

      labels = monthBins.map(b => b.label);
      dataRev = monthBins.map(b => b.rev);
    }

    if (this.trendChart) {
      this.trendChart.destroy();
    }

    const isBar = (this.trendType || "bar") === "bar";

    const sumPill = document.getElementById("trend-summary-pill");
    if (sumPill) {
      const totalPeriodRev = dataRev.reduce((a, b) => a + Number(b || 0), 0);
      sumPill.textContent = (isEn ? "Period Rev: " : "รวม 6 เดือน: ") + "฿" + totalPeriodRev.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    this.trendChart = new Chart(canvas, {
      type: isBar ? 'bar' : 'line',
      data: {
        labels: labels,
        datasets: [{
          label: isEn ? 'Total Revenue (THB)' : 'รายรับรวม (THB)',
          data: dataRev,
          backgroundColor: isBar ? '#E85826' : 'rgba(232, 88, 38, 0.12)',
          borderColor: '#E85826',
          borderWidth: isBar ? 0 : 3,
          borderRadius: isBar ? 6 : 0,
          fill: !isBar,
          tension: 0.35,
          pointRadius: isBar ? 0 : 5,
          pointBackgroundColor: '#E85826',
          pointHoverRadius: isBar ? 0 : 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const idx = ctx.dataIndex;
                const val = ctx.raw || 0;
                const jCount = dataJobs[idx] || 0;
                return isEn ? [
                  ` Total Revenue: ฿${val.toLocaleString()} THB`,
                  ` Jobs Completed: ${jCount} jobs`
                ] : [
                  ` รายรับรวม: ฿${val.toLocaleString()} บาท`,
                  ` จำนวนงาน: ${jCount} งาน`
                ];
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(val) {
                return '฿' + (val >= 1000 ? (val/1000) + 'k' : val);
              }
            },
            grid: { color: '#F3EDE4' }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });
  }

  renderCompletedJobsTable() {
    const tbody = document.getElementById("completed-jobs-tbody");
    if (!tbody) return;

    const compFilter = document.getElementById("report-company-filter")?.value || "ทั้งหมด";
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();

    const filtered = (this.completedJobs || []).filter(j => {
      if (compFilter !== "ทั้งหมด" && !this.matchesCompanyScope(j.company, compFilter)) {
        return false;
      }
      if (sbKw) {
        const s = `${j.booking_id || ''} ${j.car_id || ''} ${j.customer || ''} ${j.worker_delivery || ''} ${j.worker_return || ''} ${j.company || ''}`.toLowerCase();
        if (!s.includes(sbKw)) return false;
      }
      return true;
    });

    // Update Expander Title Count
    const isEn = (this.currentLang === "EN");
    const titleEl = document.getElementById("title-expander-completed");
    if (titleEl) {
      titleEl.textContent = isEn
        ? `Completed Jobs Archive & Monthly Reports — (${filtered.length} Records)`
        : `คลังประวัติงานเสร็จสิ้น & รีพอร์ตรายเดือน (Completed Jobs Archive) — (${filtered.length} รายการ)`;
    }

    // Update 4 Monthly Summary KPI Cards (matching app.py lines 7344-7378)
    const totalJobsCnt = filtered.length;
    const totalRevSum = filtered.reduce((sum, x) => sum + parseFloat(x.net_price || 0), 0);
    const uniqueCarsCnt = new Set(filtered.map(x => x.car_id).filter(Boolean)).size;
    const uniqueCustCnt = new Set(filtered.map(x => x.customer).filter(Boolean)).size;

    const elJobs = document.getElementById("rpt-kpi-jobs");
    const elRev = document.getElementById("rpt-kpi-rev");
    const elCars = document.getElementById("rpt-kpi-cars");
    const elCusts = document.getElementById("rpt-kpi-custs");

    if (elJobs) elJobs.innerHTML = `${totalJobsCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'jobs' : 'งาน'}</span>`;
    if (elRev) elRev.textContent = `฿${totalRevSum.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elCars) elCars.innerHTML = `${uniqueCarsCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'cars' : 'คัน'}</span>`;
    if (elCusts) elCusts.innerHTML = `${uniqueCustCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'customers' : 'ราย'}</span>`;

    const photosContainer = document.getElementById("completed-jobs-photos-container");

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:30px; color:#64748B;">${isEn ? '💡 No completed jobs archive data available in the system.' : '💡 ยังไม่มีข้อมูลประวัติงานที่เสร็จสิ้นในระบบครับ'}</td></tr>`;
      if (photosContainer) photosContainer.innerHTML = "";
      return;
    }

    tbody.innerHTML = filtered.map(j => {
      const bObj = (this.bookings || []).find(b => b.booking_id === j.booking_id) || {};
      const hasCheckinImgs = Boolean(
        j.checkin_img_front || j.checkin_img_left || j.checkin_img_rear || j.checkin_img_right ||
        bObj.checkin_img_front || bObj.checkin_img_left || bObj.checkin_img_rear || bObj.checkin_img_right
      );
      const img4Badge = hasCheckinImgs
        ? `<button type="button" onclick="app.showCheckinImagesModal('${j.booking_id}')" class="btn btn-sm" style="background:#FEF3C7; color:#B45309; border:1px solid #FCD34D; padding:2px 7px; border-radius:10px; font-size:11px; font-weight:700; margin-left:4px; cursor:pointer;" title="${isEn ? 'View 4 Return Photos' : 'คลิกดูรูปรถ 4 มุมตอนรับคืน'}">📸 ${isEn ? '4 Angles' : '4 มุม'}</button>`
        : "";
      const custObj = (this.customers || []).find(c => c.full_name === j.customer) || {};
      const phone = custObj.contact_no && custObj.contact_no !== "-" ? `<div style="font-size:11px; color:#64748B;">📞 ${custObj.contact_no}</div>` : "";
      const locStr = j.loc_return || j.loc_delivery || "-";
      const photos = Array.isArray(j.inspection_photos) ? j.inspection_photos : [];
      const pBadge = photos.length > 0
        ? `<span style="background:#E0E7FF; color:#4338CA; padding:2px 7px; border-radius:10px; font-size:11px; font-weight:700; margin-left:4px;">📸 ${photos.length} ${isEn ? 'photos' : 'รูป'}</span>`
        : "";
      let cType = j.contract_type || 'รายวัน';
      if (isEn) {
        if (cType === 'รายวัน') cType = 'Daily';
        else if (cType === 'รายสัปดาห์') cType = 'Weekly';
        else if (cType === 'รายเดือน') cType = 'Monthly';
      }
      let fuelDisp = j.fuel_level || (isEn ? '⛽ Full Tank (100%)' : '⛽ เต็มถัง (100%)');
      if (isEn && fuelDisp.includes('เต็มถัง')) {
        fuelDisp = fuelDisp.replace('เต็มถัง', 'Full Tank');
      }
      const notes = j.inspection_notes || (isEn ? "Normal inspection" : "ตรวจสภาพปกติ");

      return `
        <tr>
          <td><b style="color:#D97706;">${j.booking_id}</b></td>
          <td style="white-space:nowrap;">📅 ${j.completed_date || j.end_date || '-'}</td>
          <td style="white-space:nowrap;"><b>🚘 ${j.car_id}</b></td>
          <td>
            <b>👤 ${j.customer}</b>
            ${phone}
          </td>
          <td>${j.company || '-'}</td>
          <td><span class="badge badge-gray">${cType}</span></td>
          <td style="text-align:right; font-weight:700; color:#E85826;">฿${parseFloat(j.net_price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
          <td style="font-size:12px;">${j.worker_delivery || '-'} / ${j.worker_return || '-'}</td>
          <td style="font-size:12px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${locStr}">${locStr}</td>
          <td>
            <div style="font-size:12px; white-space:nowrap;"><b>${fuelDisp}</b>${pBadge}${img4Badge}</div>
            <div style="font-size:11px; color:#64748B; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${notes}">${notes}</div>
          </td>
          <td><span class="badge badge-success">${isEn ? 'Completed' : 'เสร็จสิ้น'}</span></td>
          <td style="text-align:center; white-space:nowrap;">
            ${hasCheckinImgs ? `<button type="button" onclick="app.showCheckinImagesModal('${j.booking_id}')" class="btn btn-sm btn-secondary" title="${isEn ? 'View 4 Check-in Photos' : 'ดูภาพรับรถคืน 4 มุม'}">📸</button>` : ''}
            <a href="/api/pdf/contract/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Rental Agreement PDF' : 'โหลดสัญญาเช่า PDF'}">📝</a>
            <a href="/api/pdf/receipt/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Receipt PDF' : 'โหลดใบเสร็จ PDF'}">🧾</a>
            <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Vehicle Checklist PDF' : 'โหลดลิสต์ตรวจเช็ครถ PDF'}">📋</a>
          </td>
        </tr>
      `;
    }).join("");

    // Render Collapsible Photo Gallery if any completed job has inspection photos (matching app.py lines 7468-7479)
    if (photosContainer) {
      const jobsWithPhotos = filtered.filter(j => Array.isArray(j.inspection_photos) && j.inspection_photos.length > 0);
      if (jobsWithPhotos.length === 0) {
        photosContainer.innerHTML = "";
      } else {
        const totalPhotoCnt = jobsWithPhotos.reduce((acc, j) => acc + j.inspection_photos.length, 0);
        const galleryItems = jobsWithPhotos.map(j => {
          const imgsHtml = j.inspection_photos.map(p => {
            const src = typeof p === "string" ? p : (p.data || p.url || "");
            const cap = typeof p === "object" && p.name ? p.name : (isEn ? "Vehicle inspection photo" : "ภาพสภาพรถ");
            return `
              <div style="border:1px solid #E2E8F0; border-radius:8px; padding:6px; background:#FFFFFF; text-align:center;">
                <a href="${src}" target="_blank">
                  <img src="${src}" alt="${cap}" style="width:100%; height:130px; object-fit:cover; border-radius:6px;">
                </a>
                <div style="font-size:11px; color:#64748B; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${cap}</div>
              </div>
            `;
          }).join("");

          return `
            <div style="margin-bottom:14px;">
              <div style="font-size:13px; font-weight:700; color:#1F2937; margin-bottom:6px;">
                🚘 ${j.car_id} | ${isEn ? 'Booking:' : 'รหัส:'} ${j.booking_id} (${j.customer}) — ${isEn ? 'Fuel Level:' : 'ระดับน้ำมัน:'} ${j.fuel_level || '-'}
              </div>
              <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:10px;">
                ${imgsHtml}
              </div>
            </div>
          `;
        }).join("");

        photosContainer.innerHTML = `
          <details style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px 14px;">
            <summary style="cursor:pointer; font-weight:700; font-size:13px; color:#334155;">
              📸 ${isEn ? 'Vehicle Inspection & Fuel Gauge Photos on Return' : 'คลังรูปภาพสภาพรถ & เกจ์น้ำมันตอนส่งงานปิดจ๊อบ'} (${totalPhotoCnt} ${isEn ? 'Photos' : 'รูป'}) — ${isEn ? 'Click to view evidence photos' : 'คลิกเพื่อดูภาพหลักฐาน'}
            </summary>
            <div style="margin-top:12px;">
              ${galleryItems}
            </div>
          </details>
        `;
      }
    }
  }

  showCheckinImagesModal(bkId) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId)
      || (this.completedJobs || []).find(x => x.booking_id === bkId) || {};
    const isEn = (this.currentLang === "EN");

    const angles = [
      { key: "front", label: isEn ? "Front View" : "ด้านหน้า", url: b.checkin_img_front },
      { key: "left", label: isEn ? "Left View" : "ด้านซ้าย", url: b.checkin_img_left },
      { key: "rear", label: isEn ? "Rear View" : "ด้านหลัง", url: b.checkin_img_rear },
      { key: "right", label: isEn ? "Right View" : "ด้านขวา", url: b.checkin_img_right }
    ];

    const cardsHtml = angles.map(a => {
      const direct = this.convertDriveUrl(a.url);
      if (!direct) {
        return `
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; text-align:center;">
            <div style="font-weight:700; font-size:12px; color:#475569; margin-bottom:6px;">🚘 ${a.label}</div>
            <div style="height:120px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:6px; color:#94A3B8; font-size:11.5px;">
              ${isEn ? 'No image link' : 'ไม่มีรูปรถ'}
            </div>
          </div>
        `;
      }
      return `
        <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:8px; padding:10px; text-align:center;">
          <div style="font-weight:700; font-size:12px; color:#1E293B; margin-bottom:6px;">🚘 ${a.label}</div>
          <a href="${direct}" target="_blank" title="${isEn ? 'Click to enlarge' : 'คลิกดูภาพขนาดใหญ่'}" style="display:block; height:120px; overflow:hidden; border-radius:6px; border:1px solid #E2E8F0;">
            <img src="${direct}" alt="${a.label}" style="width:100%; height:100%; object-fit:cover;">
          </a>
          <a href="${a.url}" target="_blank" style="display:inline-block; font-size:11px; color:#2563EB; margin-top:6px; text-decoration:none;">🔗 ${isEn ? 'Original Drive Link' : 'ลิงก์ Google Drive'}</a>
        </div>
      `;
    }).join("");

    if (typeof Swal !== "undefined") {
      Swal.fire({
        title: isEn ? `Check-in Return Photos (${bkId})` : `📸 รูปรถยนต์ 4 มุมตอนรับคืน (${bkId})`,
        html: `
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px; text-align:left;">
            ${cardsHtml}
          </div>
        `,
        width: 600,
        confirmButtonText: isEn ? "Close" : "ปิดหน้าต่าง",
        confirmButtonColor: "#475569"
      });
    } else {
      alert(`รูปรถ 4 มุม (${bkId}):\nหน้า: ${b.checkin_img_front || '-'}\nซ้าย: ${b.checkin_img_left || '-'}\nหลัง: ${b.checkin_img_rear || '-'}\nขวา: ${b.checkin_img_right || '-'}`);
    }
  }

  async triggerLineExpiryCheck() {
    if (this._isSendingLineAlert) return;

    let selectedMode = "broadcast";
    if (typeof Swal !== "undefined") {
      const result = await Swal.fire({
        title: "📲 เลือกกลุ่มเป้าหมายส่งแจ้งเตือน LINE",
        html: `
          <div style="text-align:left; font-size:14px; display:flex; flex-direction:column; gap:12px; margin-top:12px;">
            <label class="line-mode-label" style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; padding:12px; border:2px solid #EA580C; border-radius:10px; background:#FFF7ED; transition:all 0.2s;">
              <input type="radio" name="line_delivery_mode" value="broadcast" checked style="margin-top:4px; accent-color:#EA580C; width:18px; height:18px;">
              <div>
                <b style="color:#C2410C; font-size:15px;">📢 บรอดแคสต์ (ส่งหาผู้ติดตามทุกคน)</b>
                <div style="font-size:12px; color:#64748B; margin-top:3px;">ส่งข้อความถึงทุกคนที่เป็นเพื่อนกับ LINE OA นี้ทันที (พนักงานทุกคนได้รับข้อความ โดยไม่ต้องผูก LINE ID)</div>
              </div>
            </label>
            <label class="line-mode-label" style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; padding:12px; border:1px solid #CBD5E1; border-radius:10px; background:#F8FAFC; transition:all 0.2s;">
              <input type="radio" name="line_delivery_mode" value="admin_only" style="margin-top:4px; accent-color:#EA580C; width:18px; height:18px;">
              <div>
                <b style="color:#1E293B; font-size:15px;">👤 ทดสอบ / ส่งเฉพาะแอดมิน</b>
                <div style="font-size:12px; color:#64748B; margin-top:3px;">ส่งข้อความตรงเฉพาะแอดมินตาม LINE ID ที่ตั้งไว้ในระบบ / .env (Multicast หรือ Direct Push)</div>
              </div>
            </label>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "🚀 ส่งข้อความทันที",
        cancelButtonText: "ยกเลิก",
        confirmButtonColor: "#EA580C",
        cancelButtonColor: "#64748B",
        didOpen: () => {
          const labels = document.querySelectorAll('.line-mode-label');
          labels.forEach(lbl => {
            lbl.addEventListener('click', () => {
              labels.forEach(l => {
                l.style.borderColor = '#CBD5E1';
                l.style.backgroundColor = '#F8FAFC';
              });
              lbl.style.borderColor = '#EA580C';
              lbl.style.backgroundColor = '#FFF7ED';
              const rad = lbl.querySelector('input[type="radio"]');
              if (rad) rad.checked = true;
            });
          });
        },
        preConfirm: () => {
          const checked = document.querySelector('input[name="line_delivery_mode"]:checked');
          return checked ? checked.value : "broadcast";
        }
      });
      if (!result.isConfirmed) return;
      selectedMode = result.value || "broadcast";
    }

    this._isSendingLineAlert = true;
    const btn = document.getElementById("btn-dash-line-check");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.7";
    }

    const modeText = selectedMode === "broadcast" ? "บรอดแคสต์ทุกคน" : "เฉพาะแอดมิน";
    this.showToast(`📲 กำลังตรวจสอบวันหมดอายุ พ.ร.บ./ประกันภัย/ภาษี และส่ง LINE (${modeText})...`, "info");
    try {
      const res = await fetch("/api/line/check-expiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ check_mode: "weekly", delivery_mode: selectedMode, mode: selectedMode })
      });
      const data = await res.json();
      if (data.sent) {
        if (data.count > 0) {
          this.showToast(`🚨 ส่งแจ้งเตือน LINE สำเร็จ: ${data.count} รายการ (${data.cycle || 'รอบสัปดาห์นี้'}) [${modeText}]!`, "success");
        } else {
          this.showToast(`✅ ส่ง LINE สำเร็จ: ${data.message || 'ไม่มีรถครบกำหนดต่ออายุประกัน พ.ร.บ. ภาษี ในรอบนี้'} [${modeText}]`, "success");
        }
      } else {
        this.showToast(data.message || "ไม่มีรายการครบกำหนดแจ้งเตือนในรอบนี้", "info");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    } finally {
      this._isSendingLineAlert = false;
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    }
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

  async loadMaintenanceRecords() {
    try {
      const res = await fetch("/api/maintenance");
      if (res.ok) {
        this.maintenanceRecords = await res.json();
        const badge = document.getElementById("badge-maintenance-jobs");
        const activeCount = this.maintenanceRecords.filter(m => m.status !== "เสร็จสิ้น" && m.status !== "ยกเลิก").length;
        if (badge) badge.textContent = activeCount;
        this.populateMaintenanceDropdowns();
        this.renderMaintenanceRecords();
      }
    } catch (e) {
      console.error("loadMaintenanceRecords error:", e);
    }
  }

  populateMaintenanceDropdowns() {
    const carSel = document.getElementById("mnt-filter-car");
    if (carSel) {
      const cur = carSel.value;
      const isEn = (this.currentLang === "EN");
      const opts = [`<option value="ทั้งหมด">${isEn ? 'All Vehicles' : 'ทุกคัน'}</option>`];
      (this.cars || []).forEach(c => {
        opts.push(`<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''}</option>`);
      });
      carSel.innerHTML = opts.join("");
      if (cur) carSel.value = cur;
    }
  }

  renderMaintenanceRecords() {
    const tbody = document.getElementById("maintenance-records-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("mnt-search-input")?.value || "").toLowerCase().trim();
    const typeFilter = document.getElementById("mnt-filter-type")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("mnt-filter-status")?.value || "ทั้งหมด";
    const carFilter = document.getElementById("mnt-filter-car")?.value || "ทั้งหมด";

    // KPIs calculation
    const allRecords = this.maintenanceRecords || [];
    const inProg = allRecords.filter(m => m.status === "กำลังซ่อมบำรุง").length;
    const pending = allRecords.filter(m => m.status === "รอดำเนินการ").length;
    const totalCost = allRecords.reduce((sum, m) => sum + Number(m.actual_cost || m.cost || 0), 0);
    const renewals = allRecords.filter(m => {
      const t = String(m.order_type || "");
      return t.includes("ต่อทะเบียน") || t.includes("พ.ร.บ.") || t.includes("พรบ") || t.includes("ประกัน");
    }).length;

    const isEn = (this.currentLang === "EN");
    const carUnit = isEn ? "cars" : "คัน";
    const jobUnit = isEn ? "jobs" : "รายการ";

    const elInProg = document.getElementById("mnt-kpi-in-progress");
    if (elInProg) elInProg.innerHTML = `${inProg} <span style="font-size:13px; font-weight:500; color:#64748B;">${carUnit}</span>`;
    const elPending = document.getElementById("mnt-kpi-pending");
    if (elPending) elPending.innerHTML = `${pending} <span style="font-size:13px; font-weight:500; color:#64748B;">${jobUnit}</span>`;
    const elCost = document.getElementById("mnt-kpi-total-cost");
    if (elCost) elCost.textContent = `฿${totalCost.toLocaleString()}`;
    const elRen = document.getElementById("mnt-kpi-renewals");
    if (elRen) elRen.innerHTML = `${renewals} <span style="font-size:13px; font-weight:500; color:#64748B;">${jobUnit}</span>`;

    // Filter records (Target Mission 3: Hide completed tasks from active view by default)
    const filtered = allRecords.filter(m => {
      if (carFilter !== "ทั้งหมด" && m.car_id !== carFilter) return false;
      if (statusFilter === "ทั้งหมด" || statusFilter === "All" || !statusFilter) {
        if (m.status === "เสร็จสิ้น" || m.status === "Completed") return false;
      } else if (statusFilter !== "all_with_completed") {
        if (m.status !== statusFilter) return false;
      }
      if (typeFilter !== "ทั้งหมด") {
        if (!String(m.order_type || "").includes(typeFilter)) return false;
      }
      if (kw) {
        const s = `${m.id || ''} ${m.car_id || ''} ${m.car_brand || ''} ${m.car_model || ''} ${m.service_center || ''} ${m.service_items || ''} ${m.assigned_worker || ''} ${m.notes || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    const countTxt = document.getElementById("mnt-table-count");
    if (countTxt) countTxt.textContent = filtered.length;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:32px; color:#64748B;">${isEn ? 'No maintenance work orders match the selected filters' : 'ไม่พบรายการใบงานซ่อมบำรุงตามเงื่อนไขที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(m => {
      const isRenewal = String(m.order_type || "").includes("ต่อทะเบียน") || String(m.order_type || "").includes("พ.ร.บ.") || String(m.order_type || "").includes("ประกัน");
      let typeBadge = '';
      if (isRenewal) {
        typeBadge = '<span class="badge" style="background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; font-weight:700;">' + m.order_type + '</span>';
      } else {
        typeBadge = '<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">' + m.order_type + '</span>';
      }

      let statusBadge = '';
      if (m.status === "เสร็จสิ้น") {
        statusBadge = `<span class="badge badge-success">${isEn ? '✅ Completed' : '✅ เสร็จสิ้น'}</span>`;
      } else if (m.status === "กำลังซ่อมบำรุง") {
        statusBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74;">${isEn ? '🛠️ In Repair' : '🛠️ กำลังซ่อมบำรุง'}</span>`;
      } else if (m.status === "กำลังต่อภาษี/ประกัน") {
        statusBadge = `<span class="badge" style="background:#FEF3C7; color:#D97706; border:1px solid #FCD34D;">${isEn ? '⏳ Renewing Tax/Ins.' : '⏳ กำลังต่อภาษี/ประกัน'}</span>`;
      } else {
        statusBadge = `<span class="badge badge-warning">${isEn ? '⏳ Pending' : '⏳ ' + m.status}</span>`;
      }

      const costDisp = Number(m.actual_cost || m.cost || 0);
      const schedStr = `${this.formatDateDmy(m.schedule_date)} ➔ ${this.formatDateDmy(m.expected_finish_date)}`;

      const pdfBtnText = isEn ? "Work Order PDF" : "ใบงาน PDF";
      const finishBtnText = isRenewal ? (isEn ? 'Submit & Renew' : 'ส่งงาน/อัปเดตวัน') : (isEn ? 'Close Job' : 'ปิดงาน');
      const finishBtnTitle = isRenewal ? (isEn ? 'Submit job & specify new expiry date' : 'ส่งงาน & ระบุวันหมดอายุใหม่') : (isEn ? 'Inspect car & close work order' : 'ตรวจรับรถ & ปิดงาน');

      return `
        <tr>
          <td><b style="color:#C2410C;">${m.id}</b></td>
          <td>
            <b style="font-size:13px; color:#1F2937;">${m.car_id}</b><br/>
            <span style="font-size:11.5px; color:#64748B;">${m.car_brand || ''} ${m.car_model || ''} (${m.car_color || '-'})</span>
          </td>
          <td>${typeBadge}</td>
          <td style="max-width:200px; white-space:pre-wrap; font-size:12px; line-height:1.4;">${m.service_items || '-'}</td>
          <td><b style="color:#047857; font-size:13px;">฿${costDisp.toLocaleString()}</b></td>
          <td>
            <b style="color:#1F2937; font-size:12.5px;">${m.service_center || '-'}</b><br/>
            ${m.service_center_phone && m.service_center_phone !== '-' ? `<a href="tel:${m.service_center_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">${m.service_center_phone}</a>` : ''}
          </td>
          <td><span style="font-weight:600; color:#334155; font-size:12px;">${m.assigned_worker || '-'}</span></td>
          <td style="font-size:11.5px; color:#475569;">${schedStr}</td>
          <td>${statusBadge}</td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/maintenance/${m.id}" target="_blank" class="btn btn-sm btn-secondary" title="${pdfBtnText}">${pdfBtnText}</a>
            ${m.status !== "เสร็จสิ้น" ? `
              <button onclick="app.openCloseMaintenanceModal('${m.id}')" class="btn btn-sm btn-success" style="font-weight:700;" title="${finishBtnTitle}">
                ${finishBtnText}
              </button>
            ` : ''}
            <button onclick="app.openEditMaintenanceModal('${m.id}')" class="btn btn-sm btn-secondary" title="${isEn ? 'Edit Order' : 'แก้ไขใบงาน'}">✏️</button>
            <button onclick="app.deleteMaintenanceRecord('${m.id}')" class="btn btn-sm btn-danger" title="${isEn ? 'Delete Order' : 'ลบใบงาน'}">🗑️</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  populateMaintenanceCars(searchKw = "") {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    const carSel = document.getElementById("mnt-car-select");
    const currentCarId = carSel ? carSel.value : "";

    // Always keep hidden #mnt-car-select populated with options for 100% backward compatibility
    if (carSel) {
      const opts = (this.cars || []).map(c => `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (${c.color || ''}) [${c.status}]</option>`);
      carSel.innerHTML = opts.join("");
      if (currentCarId) carSel.value = currentCarId;
    }

    if (!listEl) return;
    const kw = (searchKw || "").toLowerCase().trim();
    const filtered = (this.cars || []).filter(c => {
      if (!kw) return true;
      const plateMatch = (c.plate || "").toLowerCase().includes(kw);
      const brandMatch = (c.brand || "").toLowerCase().includes(kw);
      const modelMatch = (c.model || "").toLowerCase().includes(kw);
      const colorMatch = (c.color || "").toLowerCase().includes(kw);
      const statusMatch = (c.status || "").toLowerCase().includes(kw);
      return plateMatch || brandMatch || modelMatch || colorMatch || statusMatch;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding:10px 14px; color:#94A3B8; font-size:12px; text-align:center;">ไม่พบข้อมูลรถยนต์ที่ตรงกับ "${kw}"</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(c => {
      const isSelected = c.plate === currentCarId;
      const statusBg = c.status === "ว่างพร้อมใช้งาน" ? "#ECFDF5" : (c.status === "สถานะซ่อมบำรุง" ? "#FEF2F2" : "#FFFBEB");
      const statusColor = c.status === "ว่างพร้อมใช้งาน" ? "#065F46" : (c.status === "สถานะซ่อมบำรุง" ? "#991B1B" : "#92400E");
      return `
        <div class="mnt-car-option-item ${isSelected ? 'selected' : ''}" 
             onclick="app.selectMaintenanceCar('${c.plate}')"
             title="${c.plate} - ${c.brand || ''} ${c.model || ''}">
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">
            <span style="font-weight:800; color:#0F172A; margin-right:6px;">${c.plate}</span>
            <span style="color:#334155; font-weight:600;">${c.brand || ''} ${c.model || ''}</span>
            ${c.color ? `<span style="color:#64748B; font-size:11.5px; margin-left:4px;">(${c.color})</span>` : ''}
          </div>
          <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:${statusBg}; color:${statusColor}; white-space:nowrap;">
            ${c.status || '-'}
          </span>
        </div>
      `;
    }).join("");
  }

  showMntCarDropdown(show = true) {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (!listEl) return;
    if (show) {
      this.populateMaintenanceCars(document.getElementById("mnt-car-search-input")?.value || "");
      listEl.style.display = "block";
    } else {
      listEl.style.display = "none";
    }
  }

  toggleMntCarDropdown() {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (!listEl) return;
    if (listEl.style.display === "none" || !listEl.style.display) {
      this.showMntCarDropdown(true);
      document.getElementById("mnt-car-search-input")?.focus();
    } else {
      this.showMntCarDropdown(false);
    }
  }

  filterMaintenanceCars(kw) {
    this.populateMaintenanceCars(kw);
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (listEl) listEl.style.display = "block";
  }

  selectMaintenanceCar(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    const searchInput = document.getElementById("mnt-car-search-input");
    const carSel = document.getElementById("mnt-car-select");

    if (car) {
      if (searchInput) {
        searchInput.value = `${car.plate} - ${car.brand || ''} ${car.model || ''} (${car.color || ''})`;
      }
      if (carSel) {
        carSel.value = car.plate;
      }
      this.onMaintenanceCarSelected(car.plate);

      const isEdit = Boolean(document.getElementById("mnt-form-id")?.value);
      if (!isEdit) {
        const typeSel = document.getElementById("mnt-order-type");
        if (typeSel) {
          this.fetchAndPopulateLastCost(car.plate, typeSel.value);
        }
      }
    }
    this.showMntCarDropdown(false);
  }

  async fetchAndPopulateLastCost(carId, typeVal) {
    const costInput = document.getElementById("mnt-cost");
    const hintEl = document.getElementById("mnt-cost-hint");
    if (!costInput) return;
    if (!carId) {
      if (hintEl) hintEl.innerHTML = "";
      return;
    }

    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#D97706;">⏳ กำลังตรวจสอบประวัติราคาเดิม...</span>`;
    }

    try {
      const resp = await fetch(`/api/maintenance/last-cost?car_id=${encodeURIComponent(carId)}&type=${encodeURIComponent(typeVal || "")}`);
      if (!resp.ok) {
        if (hintEl) hintEl.innerHTML = "";
        return;
      }
      const data = await resp.json();
      if (data && data.success && data.cost > 0) {
        costInput.value = data.cost;
        const sourceLabel = data.source === "maintenance_record"
          ? "ประวัติใบงานเดิมล่าสุด"
          : (data.source === "vehicle_maintenance" ? "ประวัติการซ่อมบำรุงเดิม" : "ค่าบริการตามสเปกรถ");
        if (hintEl) {
          hintEl.innerHTML = `<span style="color:#059669; font-weight:600;">💡 ดึงราคาล่าสุดอัตโนมัติ: ฿${Number(data.cost).toLocaleString()} (${sourceLabel}) — สามารถแก้ไขได้</span>`;
        }
      } else {
        costInput.value = 0;
        if (hintEl) {
          hintEl.innerHTML = `<span style="color:#64748B;">ไม่มีประวัติราคาเดิมในระบบ (กรุณาระบุงบประมาณตามจริง)</span>`;
        }
      }
    } catch (e) {
      console.warn("fetchAndPopulateLastCost error:", e);
      if (hintEl) hintEl.innerHTML = "";
    }
  }

  openNewMaintenanceModal(targetPlate = null, defaultType = null) {
    const workerSel = document.getElementById("mnt-assigned-worker");
    if (workerSel) {
      const userList = (this.users || []).filter(u => u.status === "approved" || !u.status);
      const opts = userList.length > 0
        ? userList.map(u => `<option value="${u.username}">${u.username} (${u.name || u.username}) [${u.role || 'Staff'}]</option>`)
        : [
            '<option value="admin">admin (ผู้ดูแลระบบ (Admin)) [Admin]</option>',
            '<option value="chaiwat.u">chaiwat.u [Staff]</option>',
            '<option value="sam">sam [Staff]</option>',
            '<option value="sucheeda">sucheeda [Staff]</option>',
            '<option value="Chatipat">Chatipat [Staff]</option>'
          ];
      workerSel.innerHTML = opts.join("");
    }

    document.getElementById("mnt-form-id").value = "";
    document.getElementById("mnt-cost").value = "";
    const hintEl = document.getElementById("mnt-cost-hint");
    if (hintEl) hintEl.innerHTML = "";
    document.getElementById("mnt-notes").value = "";
    const itemArea = document.getElementById("mnt-service-items");
    if (itemArea) itemArea.value = "";
    const gName = document.getElementById("mnt-service-center");
    if (gName) gName.value = "";
    const gPhone = document.getElementById("mnt-service-phone");
    if (gPhone) gPhone.value = "";
    const gLoc = document.getElementById("mnt-service-loc");
    if (gLoc) gLoc.value = "";
    const updateCarCheck = document.getElementById("mnt-update-car-status");
    if (updateCarCheck) updateCarCheck.checked = true;

    // Populate car options and select target
    this.populateMaintenanceCars("");
    const chosenPlate = targetPlate || (this.cars && this.cars[0] ? this.cars[0].plate : "");
    if (chosenPlate) {
      this.selectMaintenanceCar(chosenPlate);
    }

    const typeSel = document.getElementById("mnt-order-type");
    if (typeSel) {
      if (defaultType === "renewal") {
        typeSel.value = "ต่อทะเบียนภาษี และ พ.ร.บ.";
      } else {
        typeSel.value = "ซ่อมบำรุงทั่วไป / เช็คระยะ";
      }
      this.onMaintenanceTypeChange(typeSel.value);
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

    const schedDate = document.getElementById("mnt-sched-date");
    if (schedDate) schedDate.value = todayStr;
    const expDate = document.getElementById("mnt-exp-date");
    if (expDate) expDate.value = tomorrow;

    document.getElementById("modal-mnt-title").textContent = "🛠️ ออกใบงานซ่อมบำรุง / ต่อทะเบียน-ประกัน";
    this.openModal("modal-new-maintenance");
  }

  openEditMaintenanceModal(mntId) {
    const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
    if (!rec) return;

    this.openNewMaintenanceModal(rec.car_id);

    document.getElementById("modal-mnt-title").textContent = `✏️ แก้ไขใบงานซ่อมบำรุง (${mntId})`;
    document.getElementById("mnt-form-id").value = mntId;
    document.getElementById("mnt-order-type").value = rec.order_type || "ซ่อมบำรุงทั่วไป / เช็คระยะ";
    document.getElementById("mnt-service-items").value = rec.service_items || "";
    document.getElementById("mnt-cost").value = rec.cost || "";
    const hintEl = document.getElementById("mnt-cost-hint");
    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#64748B;">แก้ไขค่างบประมาณของใบงาน (${mntId})</span>`;
    }
    document.getElementById("mnt-mileage").value = rec.current_mileage || "";
    document.getElementById("mnt-service-center").value = rec.service_center || "";
    document.getElementById("mnt-service-phone").value = rec.service_center_phone || "";
    document.getElementById("mnt-service-loc").value = rec.service_location || "";
    document.getElementById("mnt-assigned-worker").value = rec.assigned_worker || "admin";
    document.getElementById("mnt-sched-date").value = this.dmyToYmd(rec.schedule_date) || (rec.schedule_date || "");
    document.getElementById("mnt-sched-time").value = rec.schedule_time || "09:00";
    document.getElementById("mnt-exp-date").value = this.dmyToYmd(rec.expected_finish_date) || (rec.expected_finish_date || "");
    document.getElementById("mnt-exp-time").value = rec.expected_finish_time || "17:00";
    document.getElementById("mnt-notes").value = rec.notes || "";
    const updateCarCheck = document.getElementById("mnt-update-car-status");
    if (updateCarCheck) updateCarCheck.checked = Boolean(rec.update_car_status);
  }

  onMaintenanceCarSelected(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const actEl = document.getElementById("mnt-car-act");
    if (actEl) actEl.textContent = car.act_expiry || "-";
    const insEl = document.getElementById("mnt-car-ins");
    if (insEl) insEl.textContent = car.ins_expiry || "-";
    const mileEl = document.getElementById("mnt-mileage");
    if (mileEl) mileEl.value = car.mileage || "";
  }

  onMaintenanceTypeChange(typeVal) {
    const itemArea = document.getElementById("mnt-service-items");
    const garageInput = document.getElementById("mnt-service-center");
    if (itemArea) {
      if (typeVal.includes("ต่อทะเบียน") && (!itemArea.value || itemArea.value.includes("น้ำมันเครื่อง"))) {
        itemArea.value = "1. ตรวจสภาพรถยนต์ ตรอ.\n2. ยื่นต่อภาษีประจำปี ณ กรมการขนส่งทางบก\n3. จัดทำ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ";
        if (garageInput && !garageInput.value) {
          garageInput.value = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร) / ตรอ.วิภาวดี";
        }
      } else if (typeVal.includes("ประกัน") && (!itemArea.value || itemArea.value.includes("น้ำมันเครื่อง"))) {
        itemArea.value = "1. ตรวจสอบเบี้ยประกันภัยรถยนต์ประจำปี\n2. ต่ออายุความคุ้มครองกรมธรรม์ประกันภัยรถยนต์ (ชั้น 1)";
      }
    }

    // Auto-fetch historical cost for the chosen car & order type if not in edit mode
    const isEdit = Boolean(document.getElementById("mnt-form-id")?.value);
    if (!isEdit) {
      const carSel = document.getElementById("mnt-car-select");
      const chosenPlate = carSel ? carSel.value : "";
      if (chosenPlate) {
        this.fetchAndPopulateLastCost(chosenPlate, typeVal);
      }
    }
  }

  appendMntItem(text) {
    const textarea = document.getElementById("mnt-service-items");
    if (!textarea) return;
    if (textarea.value.trim()) {
      textarea.value = textarea.value.trim() + "\n- " + text;
    } else {
      textarea.value = "- " + text;
    }
  }

  fillMntGarage(name, phone, loc) {
    const n = document.getElementById("mnt-service-center");
    if (n) n.value = name;
    const p = document.getElementById("mnt-service-phone");
    if (p) p.value = phone;
    const l = document.getElementById("mnt-service-loc");
    if (l) l.value = loc;
  }

  async submitMaintenanceOrder(openPdf = false) {
    const mntId = document.getElementById("mnt-form-id").value;
    const carId = document.getElementById("mnt-car-select").value;
    const orderType = document.getElementById("mnt-order-type").value;
    const serviceItems = document.getElementById("mnt-service-items").value.trim();
    const cost = document.getElementById("mnt-cost").value;
    const mileage = document.getElementById("mnt-mileage").value.trim();
    const serviceCenter = document.getElementById("mnt-service-center").value.trim();
    const servicePhone = document.getElementById("mnt-service-phone").value.trim();
    const serviceLoc = document.getElementById("mnt-service-loc").value.trim();
    const worker = document.getElementById("mnt-assigned-worker").value;
    const schedDate = document.getElementById("mnt-sched-date").value;
    const schedTime = document.getElementById("mnt-sched-time").value;
    const expDate = document.getElementById("mnt-exp-date").value;
    const expTime = document.getElementById("mnt-exp-time").value;
    const notes = document.getElementById("mnt-notes").value.trim();
    const updateCar = document.getElementById("mnt-update-car-status").checked;

    if (!carId) {
      alert("กรุณาเลือกรถยนต์ที่ต้องการดำเนินการ");
      return;
    }
    if (!serviceItems) {
      alert("กรุณาระบุรายการซ่อมหรือรายการบริการ");
      return;
    }

    const payload = {
      car_id: carId,
      order_type: orderType,
      service_items: serviceItems,
      cost: cost ? parseFloat(cost) : 0,
      current_mileage: mileage,
      service_center: serviceCenter || "ศูนย์บริการมาตรฐาน",
      service_center_phone: servicePhone || "-",
      service_location: serviceLoc || "-",
      assigned_worker: worker || "admin",
      schedule_date: schedDate,
      schedule_time: schedTime,
      expected_finish_date: expDate,
      expected_finish_time: expTime,
      notes: notes,
      update_car_status: updateCar,
      created_by: this.user?.name || this.user?.username || "Admin"
    };

    try {
      let res;
      if (mntId) {
        res = await fetch(`/api/maintenance/${mntId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch("/api/maintenance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-new-maintenance");
        const orderId = data.maintenance?.id || mntId;
        this.showToast(`🎉 ออกใบงาน ${orderId} สำเร็จเรียบร้อย!`, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        await this.loadBackOfficeJobs();

        if (openPdf && orderId) {
          window.open(`/api/pdf/maintenance/${orderId}`, "_blank");
        }
      } else {
        alert(data.detail || "บันทึกใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
  }

  openCloseMaintenanceModal(mntId) {
    const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
    if (!rec) return;

    const car = (this.cars || []).find(c => c.plate === rec.car_id) || {};
    const oType = String(rec.order_type || "");
    const isRenewal = oType.includes("ต่อทะเบียน") || oType.includes("พ.ร.บ.") || oType.includes("พรบ") || oType.includes("ประกัน") || oType.includes("ภาษี") || oType.includes("แพ็กคู่");

    document.getElementById("close-mnt-id").value = mntId;
    document.getElementById("close-mnt-car-title").textContent = `🚘 ${rec.car_id} (${rec.car_brand || car.brand || ''} ${rec.car_model || car.model || ''})`;
    document.getElementById("close-mnt-summary-txt").textContent = `ใบงาน: ${mntId} | ประเภท: ${rec.order_type} | ผู้รับผิดชอบ: ${rec.assigned_worker || '-'}`;
    document.getElementById("close-mnt-actual-cost").value = rec.actual_cost || rec.cost || "";
    document.getElementById("close-mnt-mileage").value = rec.current_mileage || car.mileage || "";
    document.getElementById("close-mnt-notes").value = rec.completion_notes || (isRenewal ? "ต่อภาษี/พ.ร.บ./ประกันภัยเรียบร้อย ได้รับเอกสารครบถ้วน" : "ตรวจรับรถเรียบร้อย สภาพสมบูรณ์พร้อมใช้งาน");
    document.getElementById("close-mnt-restore-car").checked = true;
    document.getElementById("close-mnt-record-expense").checked = true;

    const renewalSec = document.getElementById("close-mnt-renewal-section");
    const taxWrapper = document.getElementById("close-mnt-tax-wrapper");
    const actWrapper = document.getElementById("close-mnt-act-wrapper");
    const insWrapper = document.getElementById("close-mnt-ins-wrapper");
    const coWrapper = document.getElementById("close-mnt-company-wrapper");
    const submitBtn = document.getElementById("close-mnt-submit-btn");

    if (isRenewal) {
      if (renewalSec) renewalSec.style.display = "block";
      const hasTax = oType.includes("ภาษี") || oType.includes("ต่อทะเบียน") || oType.includes("แพ็กคู่");
      const hasAct = oType.includes("พ.ร.บ.") || oType.includes("พรบ") || oType.includes("ต่อทะเบียน") || oType.includes("แพ็กคู่");
      const hasIns = oType.includes("ประกัน") || oType.includes("แพ็กคู่");

      if (taxWrapper) taxWrapper.style.display = hasTax ? "block" : "none";
      if (actWrapper) actWrapper.style.display = hasAct ? "block" : "none";
      if (insWrapper) insWrapper.style.display = hasIns ? "block" : "none";
      if (coWrapper) coWrapper.style.display = (hasIns || isRenewal) ? "block" : "none";

      const curTax = car.tax_expiry || "-";
      const curAct = car.act_expiry || "-";
      const curIns = car.ins_expiry || "-";
      const taxCurrentEl = document.getElementById("close-mnt-tax-current");
      const actCurrentEl = document.getElementById("close-mnt-act-current");
      const insCurrentEl = document.getElementById("close-mnt-ins-current");
      if (taxCurrentEl) taxCurrentEl.textContent = `(วันหมดอายุเดิม: ${curTax})`;
      if (actCurrentEl) actCurrentEl.textContent = `(วันหมดอายุเดิม: ${curAct})`;
      if (insCurrentEl) insCurrentEl.textContent = `(วันหมดอายุเดิม: ${curIns})`;

      // Compute next 1 year default
      const nextTaxStr = this.computeRenewedDateStr(curTax);
      const nextActStr = this.computeRenewedDateStr(curAct);
      const nextInsStr = this.computeRenewedDateStr(curIns);

      const taxInput = document.getElementById("close-mnt-tax-expiry");
      const actInput = document.getElementById("close-mnt-act-expiry");
      const insInput = document.getElementById("close-mnt-ins-expiry");
      const coInput = document.getElementById("close-mnt-insurance-company");
      const policyInput = document.getElementById("close-mnt-policy-no");

      if (taxInput) taxInput.value = this.dmyToYmd(nextTaxStr);
      if (actInput) actInput.value = this.dmyToYmd(nextActStr);
      if (insInput) insInput.value = this.dmyToYmd(nextInsStr);
      if (coInput) coInput.value = car.insurance_company || car.ins_company || "";
      if (policyInput) policyInput.value = rec.policy_no || car.insurance_policy_no || car.policy_no || "";

      if (submitBtn) submitBtn.innerHTML = "🏁 ยืนยันส่งงาน & อัปเดตวันหมดอายุ";
    } else {
      if (renewalSec) renewalSec.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = "🏁 ยืนยันตรวจรับรถ & ปิดงาน";
    }

    this.openModal("modal-close-maintenance");
  }

  async submitCloseMaintenance() {
    const mntId = document.getElementById("close-mnt-id").value;
    const actualCost = document.getElementById("close-mnt-actual-cost")?.value;
    const mileage = document.getElementById("close-mnt-mileage")?.value.trim() || "";
    const notes = document.getElementById("close-mnt-notes")?.value.trim() || "";

    const renewalSec = document.getElementById("close-mnt-renewal-section");
    const isRenewal = renewalSec && renewalSec.style.display !== "none";

    let newTaxExpiry = "";
    let newActExpiry = "";
    let newInsExpiry = "";
    let insuranceCompany = "";
    let policyNo = "";

    if (isRenewal) {
      const taxRaw = document.getElementById("close-mnt-tax-expiry")?.value;
      const actRaw = document.getElementById("close-mnt-act-expiry")?.value;
      const insRaw = document.getElementById("close-mnt-ins-expiry")?.value;
      insuranceCompany = document.getElementById("close-mnt-insurance-company")?.value.trim() || "";
      policyNo = document.getElementById("close-mnt-policy-no")?.value.trim() || "";

      const taxWrapper = document.getElementById("close-mnt-tax-wrapper");
      const actWrapper = document.getElementById("close-mnt-act-wrapper");
      const insWrapper = document.getElementById("close-mnt-ins-wrapper");

      if (taxWrapper && taxWrapper.style.display !== "none" && taxRaw) {
        newTaxExpiry = this.ymdToDmy(taxRaw);
      }
      if (actWrapper && actWrapper.style.display !== "none" && actRaw) {
        newActExpiry = this.ymdToDmy(actRaw);
      }
      if (insWrapper && insWrapper.style.display !== "none" && insRaw) {
        newInsExpiry = this.ymdToDmy(insRaw);
      }
    }

    if (!mntId) return;

    try {
      const res = await fetch(`/api/maintenance/${mntId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actual_cost: actualCost ? parseFloat(actualCost) : 0,
          mileage: mileage,
          completion_notes: notes,
          new_tax_expiry: newTaxExpiry,
          new_act_expiry: newActExpiry,
          new_ins_expiry: newInsExpiry,
          insurance_company: insuranceCompany,
          policy_no: policyNo,
          recorded_by: this.user?.name || this.user?.username || "Admin"
        })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-close-maintenance");

        // Immediately update local car object for instant UI sync
        if (this.cars) {
          const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
          const c = rec ? this.cars.find(x => x.plate === rec.car_id) : null;
          if (c) {
            if (newTaxExpiry) { c.tax_expiry = newTaxExpiry; c.tax_expire_date = this.dmyToYmd(newTaxExpiry); }
            if (newActExpiry) { c.act_expiry = newActExpiry; c.prb_expire_date = this.dmyToYmd(newActExpiry); }
            if (newInsExpiry) { c.ins_expiry = newInsExpiry; c.insurance_expire_date = this.dmyToYmd(newInsExpiry); }
            if (insuranceCompany) { c.insurance_company = insuranceCompany; c.ins_company = insuranceCompany; }
            if (policyNo) {
              if (newActExpiry) { c.act_policy_no = policyNo; c.policy_no = policyNo; }
              else { c.insurance_policy_no = policyNo; c.ins_policy_no = policyNo; }
            }
            c.status = "ว่างพร้อมใช้งาน";
          }
        }

        let successMsg = `🏁 ปิดงาน ${mntId} เรียบร้อย!`;
        if (newTaxExpiry || newActExpiry || newInsExpiry) {
          const parts = [];
          if (newTaxExpiry) parts.push(`ภาษี: ${newTaxExpiry}`);
          if (newActExpiry) parts.push(`พ.ร.บ.: ${newActExpiry}`);
          if (newInsExpiry) parts.push(`ประกัน: ${newInsExpiry}`);
          successMsg = `🏁 ส่งงานสำเร็จ! อัปเดตข้อมูลรถเรียบร้อย (${parts.join(", ")})`;
        }
        this.showToast(successMsg, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        if (typeof this.renderCars === "function") {
          this.renderCars();
        } else {
          if (typeof this.renderFleetCards === "function") this.renderFleetCards();
          if (typeof this.renderFleetOverviewTable === "function") this.renderFleetOverviewTable();
        }
        if (typeof this.renderExpiringAlerts === "function") this.renderExpiringAlerts();
        if (typeof this.renderUnifiedExpensesTable === "function") this.renderUnifiedExpensesTable();
        await this.loadBackOfficeJobs();
        await this.loadDashboardKPIs();
        this.renderFleetOverviewTable();
      } else {
        alert(data.detail || "ปิดงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
  }

  async deleteMaintenanceRecord(mntId) {
    if (!confirm(`ยืนยันการลบใบงานซ่อมบำรุง ${mntId} ออกจากระบบถาวรใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/maintenance/${encodeURIComponent(mntId)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`✅ ลบใบงาน ${mntId} และคืนสถานะรถเรียบร้อย`, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        try {
          if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
          if (this.loadDashboardData) await this.loadDashboardData();
          if (this.renderDashboardCharts) this.renderDashboardCharts();
        } catch (dbErr) {
          console.warn("Dashboard refetch warning:", dbErr);
        }
      } else {
        alert(data.detail || data.message || "ลบใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาดในการลบใบงาน: " + e.message);
    }
  }

  async deleteWorkOrder(orderId) {
    if (!confirm(`ยืนยันการลบใบงาน ${orderId} ออกจากระบบถาวรใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`✅ ลบใบงาน ${orderId} เรียบร้อย`, "success");
        await this.loadBackOfficeJobs();
        await this.loadMaintenanceRecords();
        await this.loadCars();
        try {
          if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
          if (this.loadDashboardData) await this.loadDashboardData();
          if (this.renderDashboardCharts) this.renderDashboardCharts();
        } catch (dbErr) {
          console.warn("Dashboard refetch warning:", dbErr);
        }
      } else {
        alert(data.detail || data.message || "ลบใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
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

  onClickKpiFleetCard() {
    this.switchModule("frontoffice");
    this.switchTab("fleet");
    window.scrollTo({ top: 0, behavior: "smooth" });
    this.showToast("🚗 ข้ามมายังหน้าเลือกรถ & จองคิว (Fleet Showcase) เรียบร้อย", "info");
  }

  openActiveRentalsModal() {
    const scopeVal = document.getElementById("dash-company-scope")?.value || "ทั้งหมด";
    const compFilter = document.getElementById("active-rentals-company-filter");
    if (compFilter && scopeVal) {
      compFilter.value = scopeVal;
    }
    const searchInp = document.getElementById("active-rentals-search");
    if (searchInp) searchInp.value = "";
    const statFilter = document.getElementById("active-rentals-status-filter");
    if (statFilter) statFilter.value = "ทั้งหมด";

    this.renderActiveRentalsTable();
    this.openModal("modal-active-rentals");
  }

  renderActiveRentalsTable() {
    const tbody = document.getElementById("active-rentals-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("active-rentals-search")?.value || "").toLowerCase().trim();
    const compFilter = document.getElementById("active-rentals-company-filter")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("active-rentals-status-filter")?.value || "ทั้งหมด";

    // 1. Gather all active bookings where status is not completed or cancelled
    const activeBks = (this.bookings || []).filter(b => {
      const st = String(b.status || "");
      return !["เสร็จสิ้น", "ยกเลิก"].includes(st);
    });

    const activeRows = [];
    const accountedPlates = new Set();

    activeBks.forEach(b => {
      const car = (this.cars || []).find(c => c.plate === b.car_id) || {};
      const cust = (this.customers || []).find(c => c.full_name === b.customer) || {};
      const company = car.company || b.company || "Sawasdee Rent A Car";

      if (!this.matchesCompanyScope(company, compFilter)) return;
      if (statusFilter !== "ทั้งหมด" && !String(b.status).includes(statusFilter)) return;

      if (kw) {
        const str = `${b.car_id || ''} ${car.brand || ''} ${car.model || ''} ${b.customer || ''} ${cust.contact_no || ''} ${b.status || ''} ${company}`.toLowerCase();
        if (!str.includes(kw)) return;
      }

      accountedPlates.add(b.car_id);
      activeRows.push({
        type: "booking",
        booking_id: b.booking_id,
        car_id: b.car_id,
        car_brand: car.brand || b.car_brand || "",
        car_model: car.model || b.car_model || "",
        car_color: car.color || "",
        company: company,
        customer: b.customer,
        customer_phone: cust.contact_no || b.customer_phone || "-",
        customer_nat: cust.nationality || "THAI",
        start_date: b.start_date_formatted || b.start_date,
        start_time: b.start_time || "10:00",
        end_date: b.end_date_formatted || b.end_date,
        end_time: b.end_time || "10:00",
        status: b.status || "กำลังเช่า",
        net_price: parseFloat(b.net_price || 0),
        deposit_paid: Boolean(b.deposit_paid),
        deposit_amount: parseFloat(b.deposit_amount || 5000),
        worker: b.worker_delivery || b.worker_return || "-",
        location: b.loc_delivery || b.loc_return || "-"
      });
    });

    // 2. Also check if any cars in this.cars have status 'กำลังเช่า', 'ติดจอง' or 'ซ่อมบำรุง' not yet in activeRows
    (this.cars || []).forEach(c => {
      if (accountedPlates.has(c.plate)) return;
      const isMaint = c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง";
      const isRent = c.fleet_status_key === "unavailable" || ["กำลังเช่า", "ติดจอง", "เตรียมส่งมอบ", "เตรียมรับคืน", "รอส่งมอบ"].includes(c.status);

      if (!isMaint && !isRent) return;
      if (!this.matchesCompanyScope(c.company, compFilter)) return;
      if (statusFilter !== "ทั้งหมด" && !String(c.status).includes(statusFilter)) return;

      if (kw) {
        const str = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.status || ''} ${c.company || ''}`.toLowerCase();
        if (!str.includes(kw)) return;
      }

      activeRows.push({
        type: isMaint ? "maintenance" : "car_status",
        booking_id: "-",
        car_id: c.plate,
        car_brand: c.brand || "",
        car_model: c.model || "",
        car_color: c.color || "",
        company: c.company || "Sawasdee Rent A Car",
        customer: isMaint ? "ศูนย์บริการ/อู่ซ่อมบำรุง" : "ลูกค้าประจำ (สัญญาเดิม)",
        customer_phone: "-",
        customer_nat: "-",
        start_date: "-",
        start_time: "-",
        end_date: "-",
        end_time: "-",
        status: c.status || (isMaint ? "ซ่อมบำรุง" : "กำลังเช่า"),
        net_price: 0,
        deposit_paid: true,
        deposit_amount: 0,
        worker: "-",
        location: "-"
      });
    });

    // Update count badge
    const badge = document.getElementById("active-rentals-count-badge");
    if (badge) badge.textContent = `${activeRows.length} คัน`;

    if (activeRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748B;">🔍 ไม่พบรายการรถที่กำลังเช่าหรือติดจองตามเงื่อนไขที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = activeRows.map((r, idx) => {
      let statusBadge = '<span class="badge badge-info">' + r.status + '</span>';
      if (r.status === "กำลังเช่า") {
        statusBadge = '<span class="badge" style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;">🔑 กำลังเช่า</span>';
      } else if (r.status === "เตรียมรับคืน") {
        statusBadge = '<span class="badge" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; font-weight:700;">🔙 เตรียมรับคืน</span>';
      } else if (r.status === "เตรียมส่งมอบ" || r.status === "รอส่งมอบ") {
        statusBadge = '<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">🚚 เตรียมส่งมอบ</span>';
      } else if (r.status === "ติดจอง") {
        statusBadge = '<span class="badge" style="background:#FEF3C7; color:#92400E; border:1px solid #FDE68A; font-weight:700;">📌 ติดจอง</span>';
      } else if (r.status === "ซ่อมบำรุง") {
        statusBadge = '<span class="badge" style="background:#FEF2F2; color:#991B1B; border:1px solid #FECACA; font-weight:700;">🛠️ ซ่อมบำรุง</span>';
      }

      const depositBadge = r.deposit_paid
        ? `<span style="font-size:11px; color:#047857; font-weight:700;">🟢 มัดจำแล้ว</span>`
        : `<span style="font-size:11px; color:#DC2626; font-weight:700;">🔴 รอมัดจำ</span>`;

      const rentalDatesDisplay = (r.start_date !== "-" && r.end_date !== "-")
        ? `
          <div style="font-size:12px; font-weight:700; color:#1F2937;">
            ${r.start_date} (${r.start_time}) ➔ ${r.end_date} (${r.end_time})
          </div>
          <div style="font-size:11px; color:#64748B;">รหัสจอง: <b>${r.booking_id}</b></div>
        `
        : `<span style="color:#64748B; font-size:12px;">ไม่ได้ระบุช่วงวันสัญญา</span>`;

      const phoneLink = (r.customer_phone && r.customer_phone !== "-")
        ? `<a href="tel:${r.customer_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">📞 ${r.customer_phone}</a>`
        : `<span style="color:#94A3B8; font-size:11px;">-</span>`;

      return `
        <tr>
          <td style="text-align:center; font-weight:700; color:#64748B;">${idx + 1}</td>
          <td>
            <b style="font-size:13.5px; color:#1F2937;">🚘 ${r.car_id}</b><br/>
            <span style="font-size:11.5px; color:#475569;">${r.car_brand} ${r.car_model} (${r.car_color || '-'})</span><br/>
            <span style="font-size:10.5px; color:#94A3B8;">🏢 ${r.company}</span>
          </td>
          <td>
            <b style="font-size:12.5px; color:#1F2937;">👤 ${r.customer}</b><br/>
            ${phoneLink}
          </td>
          <td>${rentalDatesDisplay}</td>
          <td>${statusBadge}</td>
          <td>
            <div style="font-size:11.5px; color:#334155;">📍 ${r.location}</div>
            <div style="font-size:11px; color:#64748B;">👤 ช่าง/คนส่ง: <b>${r.worker}</b></div>
          </td>
          <td style="text-align:right;">
            <b style="font-size:13.5px; color:#EA580C;">฿${r.net_price.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b><br/>
            ${depositBadge}
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${r.booking_id !== '-' ? `
              <button onclick="app.closeModal('modal-active-rentals'); app.goToTabWithBooking('assign', '${r.booking_id}')" class="btn btn-sm btn-primary" style="padding:2px 8px; font-size:11px;" title="ไปที่ใบงานนี้">
                📋 ดูใบงาน
              </button>
            ` : `
              <button onclick="app.closeModal('modal-active-rentals'); app.jumpToCarInFrontOffice('${r.car_id}')" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;">
                🚗 ดูรถ
              </button>
            `}
          </td>
        </tr>
      `;
    }).join("");
  }

  openCarProfitabilityModal() {
    const scopeVal = document.getElementById("dash-company-scope")?.value || "ทั้งหมด";
    const compFilter = document.getElementById("prof-company-filter");
    if (compFilter && scopeVal) {
      compFilter.value = scopeVal;
    }
    const searchInp = document.getElementById("prof-search-input");
    if (searchInp) searchInp.value = "";
    const sortSel = document.getElementById("prof-sort-select");
    if (sortSel) sortSel.value = "profit_desc";

    this.renderCarProfitabilityTable();
    this.openModal("modal-car-profitability");
  }

  calculateCarProfitabilityList() {
    const revByCar = {};
    const rentalsByCar = {};
    const completedBids = new Set();

    (this.completedJobs || []).forEach(j => {
      const pl = j.car_id;
      if (pl) {
        const netP = parseFloat(j.net_price || 0);
        const late = parseFloat(j.late_fee || 0);
        revByCar[pl] = (revByCar[pl] || 0) + netP + late;
        rentalsByCar[pl] = (rentalsByCar[pl] || 0) + 1;
      }
      if (j.booking_id) completedBids.add(j.booking_id);
    });

    (this.bookings || []).forEach(b => {
      const pl = b.car_id;
      const bid = b.booking_id;
      if (pl && !completedBids.has(bid)) {
        if (b.rental_paid || ["กำลังเช่า", "เตรียมรับคืน", "รอส่งมอบ", "เตรียมส่งมอบ"].includes(b.status)) {
          const netP = parseFloat(b.net_price || 0);
          revByCar[pl] = (revByCar[pl] || 0) + netP;
          rentalsByCar[pl] = (rentalsByCar[pl] || 0) + 1;
        }
      }
    });

    const expByCar = {};
    const mntIds = new Set();
    (this.maintenanceRecords || []).forEach(m => {
      const pl = m.car_id;
      if (pl) {
        const cVal = parseFloat(m.actual_cost || m.cost || 0);
        expByCar[pl] = (expByCar[pl] || 0) + cVal;
      }
      if (m.id) mntIds.add(m.id);
    });

    // In case rawKpiData or financial_records has standalone expenses
    const finRecords = this.rawKpiData?.financial_records || [];
    finRecords.forEach(f => {
      const fType = f.type;
      const fAmt = parseFloat(f.amount || 0);
      const fRef = String(f.ref || "");
      const fDet = String(f.detail || "");

      let matchedPl = null;
      for (const c of (this.cars || [])) {
        if (c.plate === fRef || fDet.includes(c.plate)) {
          matchedPl = c.plate;
          break;
        }
      }

      if (matchedPl) {
        if (fType === "รายรับ" && f.category === "ค่าเช่ารถ" && !completedBids.has(fRef)) {
          revByCar[matchedPl] = (revByCar[matchedPl] || 0) + fAmt;
        } else if (fType === "รายจ่าย" && !mntIds.has(fRef)) {
          expByCar[matchedPl] = (expByCar[matchedPl] || 0) + fAmt;
        }
      }
    });

    const list = (this.cars || []).map(c => {
      const gross = Math.round((revByCar[c.plate] || 0) * 100) / 100;
      const exp = Math.round((expByCar[c.plate] || 0) * 100) / 100;
      const net = Math.round((gross - exp) * 100) / 100;
      const rCnt = rentalsByCar[c.plate] || 0;
      const margin = gross > 0 ? Math.round((net / gross) * 100) : (net < 0 ? -100 : 0);

      return {
        plate: c.plate,
        brand: c.brand || "",
        model: c.model || "",
        color: c.color || "",
        company: c.company || "Sawasdee Rent A Car",
        status: c.status || "ว่างพร้อมใช้งาน",
        total_rentals: rCnt,
        gross_revenue: gross,
        total_expense: exp,
        net_profit: net,
        margin: margin
      };
    });

    return list;
  }

  renderCarProfitabilityTable() {
    const tbody = document.getElementById("car-profitability-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("prof-search-input")?.value || "").toLowerCase().trim();
    const compFilter = document.getElementById("prof-company-filter")?.value || "ทั้งหมด";
    const sortMode = document.getElementById("prof-sort-select")?.value || "profit_desc";

    let list = this.calculateCarProfitabilityList();

    // 1. Filter by company and keyword
    list = list.filter(item => {
      if (!this.matchesCompanyScope(item.company, compFilter)) return false;
      if (kw) {
        const s = `${item.plate} ${item.brand} ${item.model} ${item.company} ${item.status}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    // 2. Sort: Highest net profit first down to lowest (default)
    if (sortMode === "revenue_desc") {
      list.sort((a, b) => b.gross_revenue - a.gross_revenue || b.net_profit - a.net_profit);
    } else if (sortMode === "rentals_desc") {
      list.sort((a, b) => b.total_rentals - a.total_rentals || b.net_profit - a.net_profit);
    } else {
      // Default: Highest Net Profit first
      list.sort((a, b) => b.net_profit - a.net_profit || b.gross_revenue - a.gross_revenue || b.total_rentals - a.total_rentals);
    }

    // 3. Update top summary metrics in the modal
    const totalGross = list.reduce((acc, x) => acc + x.gross_revenue, 0);
    const totalExp = list.reduce((acc, x) => acc + x.total_expense, 0);
    const totalNet = totalGross - totalExp;

    const elGross = document.getElementById("prof-kpi-gross-rev");
    const elExp = document.getElementById("prof-kpi-total-exp");
    const elNet = document.getElementById("prof-kpi-net-profit");
    const elCars = document.getElementById("prof-kpi-total-cars");

    if (elGross) elGross.textContent = `฿${totalGross.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elExp) elExp.textContent = `-฿${totalExp.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elNet) elNet.textContent = `฿${totalNet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elCars) elCars.textContent = `${list.length} คัน`;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748B;">🔍 ไม่พบข้อมูลรถยนต์ตรงกับเงื่อนไขที่ค้นหา</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, idx) => {
      let rankBadge = `<b style="font-size:13px; color:#64748B;">${idx + 1}</b>`;
      if (idx === 0) rankBadge = `<span style="font-size:18px;" title="อันดับ 1">🥇</span>`;
      else if (idx === 1) rankBadge = `<span style="font-size:18px;" title="อันดับ 2">🥈</span>`;
      else if (idx === 2) rankBadge = `<span style="font-size:18px;" title="อันดับ 3">🥉</span>`;

      let statusBadge = '<span class="badge badge-gray">' + item.status + '</span>';
      if (item.status === "ว่างพร้อมใช้งาน") {
        statusBadge = '<span class="badge badge-success">ว่าง</span>';
      } else if (item.status === "กำลังเช่า") {
        statusBadge = '<span class="badge badge-danger">กำลังเช่า</span>';
      } else if (item.status === "ติดจอง") {
        statusBadge = '<span class="badge badge-warning">ติดจอง</span>';
      } else if (item.status === "ซ่อมบำรุง") {
        statusBadge = '<span class="badge" style="background:#FEE2E2; color:#991B1B;">ซ่อมบำรุง</span>';
      }

      const netColor = item.net_profit > 0 ? "#15803D" : (item.net_profit < 0 ? "#DC2626" : "#475569");
      const netBg = item.net_profit > 0 ? "#F0FDF4" : (item.net_profit < 0 ? "#FEF2F2" : "#F8FAFC");
      const netBorder = item.net_profit > 0 ? "#BBF7D0" : (item.net_profit < 0 ? "#FECACA" : "#E2E8F0");

      return `
        <tr>
          <td style="text-align:center;">${rankBadge}</td>
          <td>
            <b style="font-size:13.5px; color:#1F2937;">🚘 ${item.plate}</b><br/>
            <span style="font-size:11.5px; color:#475569;">${item.brand} ${item.model} (${item.color || '-'})</span><br/>
            <span style="font-size:10.5px; color:#94A3B8;">🏢 ${item.company}</span>
          </td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="text-align:center;">
            <b style="color:#1E40AF; font-size:13px;">${item.total_rentals}</b> <span style="font-size:11px; color:#64748B;">งาน</span>
          </td>
          <td style="text-align:right;">
            <b style="color:#15803D; font-size:13px;">+฿${item.gross_revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b>
          </td>
          <td style="text-align:right;">
            <span style="color:#DC2626; font-size:12.5px;">${item.total_expense > 0 ? `-฿${item.total_expense.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '฿0.00'}</span>
          </td>
          <td style="text-align:right; background:${netBg};">
            <span style="display:inline-block; padding:3px 10px; border-radius:8px; border:1px solid ${netBorder}; font-weight:800; font-size:14px; color:${netColor};">
              ฿${item.net_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          </td>
          <td style="text-align:center;">
            <button onclick="app.closeModal('modal-car-profitability'); app.jumpToCarInFrontOffice('${item.plate}')" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;" title="ดูข้อมูลรถคันนี้ในหน้าเลือกรถ">
              🔍 ดูรถ
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  setShiftClosingMode(mode) {
    this.shiftClosingMode = mode;
    const btnD = document.getElementById("btn-shift-mode-daily");
    const btnM = document.getElementById("btn-shift-mode-monthly");
    const thDate = document.getElementById("th-shift-date");

    if (btnD && btnM) {
      if (mode === "daily") {
        btnD.style.background = "#E85826";
        btnD.style.color = "#FFF";
        btnM.style.background = "transparent";
        btnM.style.color = "#475569";
        if (thDate) thDate.textContent = (this.currentLang === "EN") ? "Date (Daily)" : "วันที่ (รายวัน)";
      } else {
        btnM.style.background = "#E85826";
        btnM.style.color = "#FFF";
        btnD.style.background = "transparent";
        btnD.style.color = "#475569";
        if (thDate) thDate.textContent = (this.currentLang === "EN") ? "Period (Monthly)" : "งวดเดือน (รายเดือน)";
      }
    }
    this.renderShiftClosingTable();
  }

  filterShiftClosing() {
    this.renderShiftClosingTable();
  }

  resetShiftClosingFilter() {
    const f = document.getElementById("shift-month-filter");
    if (f) f.value = "";
    this.renderShiftClosingTable();
  }

  async loadFinanceSummary() {
    try {
      const res = await fetch("/api/finance/summary");
      if (res.ok) {
        this.financeSummaryData = await res.json();
        this.renderShiftClosingTable();
      }
    } catch (err) {
      console.error("loadFinanceSummary error:", err);
    }
  }

  renderShiftClosingTable() {
    if (!this.financeSummaryData) return;
    const isEn = (this.currentLang === "EN");
    const data = this.financeSummaryData;

    const sumTotalEl = document.getElementById("shift-sum-total");
    const sumQrEl = document.getElementById("shift-sum-qr");
    const sumCashEl = document.getElementById("shift-sum-cash");
    const sumCardEl = document.getElementById("shift-sum-card");
    const sumPaypalEl = document.getElementById("shift-sum-paypal");

    const byMethod = data.by_method || {};
    if (sumTotalEl) sumTotalEl.textContent = "฿" + Number(data.total_revenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumQrEl) sumQrEl.textContent = "฿" + Number(byMethod["โอนเงิน / สแกน QR"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumCashEl) sumCashEl.textContent = "฿" + Number(byMethod["เงินสด"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumCardEl) sumCardEl.textContent = "฿" + Number(byMethod["บัตรเครดิต"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumPaypalEl) sumPaypalEl.textContent = "฿" + Number(byMethod["PayPal"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

    const tbody = document.getElementById("shift-closing-tbody");
    if (!tbody) return;

    const filterInput = document.getElementById("shift-month-filter");
    const filterVal = filterInput ? filterInput.value.trim() : "";

    const currentMode = this.shiftClosingMode || "daily";
    let rows = (currentMode === "monthly") ? (data.monthly || []) : (data.daily || []);
    if (filterVal) {
      rows = rows.filter(r => (r.month && r.month === filterVal) || (r.date && r.date.startsWith(filterVal)));
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94A3B8; padding:20px;">${isEn ? 'No financial transactions recorded for this period' : 'ไม่มีรายการรายรับในงวดที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r, idx) => {
      const periodLabel = r.date || r.month || "-";
      const totalNum = Number(r.total || 0);
      const methods = r.by_method || {};
      const qrNum = Number(methods["โอนเงิน / สแกน QR"] || 0);
      const cashNum = Number(methods["เงินสด"] || 0);
      const cardNum = Number(methods["บัตรเครดิต"] || 0);
      const paypalNum = Number(methods["PayPal"] || 0);
      const countNum = Number(r.count || 0);
      const hasRecords = Array.isArray(r.records) && r.records.length > 0;

      return `
        <tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:10px 12px; font-weight:700; color:#1E293B;">
            📅 ${periodLabel}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:800; color:#EA580C; font-size:13px;">
            ฿${totalNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${qrNum > 0 ? '#2563EB' : '#94A3B8'};">
            ${qrNum > 0 ? '฿' + qrNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${cashNum > 0 ? '#059669' : '#94A3B8'};">
            ${cashNum > 0 ? '฿' + cashNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${cardNum > 0 ? '#DB2777' : '#94A3B8'};">
            ${cardNum > 0 ? '฿' + cardNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${paypalNum > 0 ? '#7C3AED' : '#94A3B8'};">
            ${paypalNum > 0 ? '฿' + paypalNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:center;">
            <span style="background:#F1F5F9; color:#475569; font-size:11.5px; font-weight:700; padding:2px 8px; border-radius:10px;">
              ${countNum} ${isEn ? 'tx' : 'รายการ'}
            </span>
          </td>
          <td style="padding:10px 12px; text-align:center;">
            ${hasRecords ? `
              <button type="button" onclick="app.toggleShiftRowDetails(${idx})" class="btn btn-sm btn-secondary" style="font-size:11px; padding:3px 8px;">
                🔍 ${isEn ? 'View' : 'ดูย่อย'}
              </button>
            ` : '-'}
          </td>
        </tr>
      `;
    }).join("");
  }

  toggleShiftRowDetails(idx) {
    const isEn = (this.currentLang === "EN");
    const box = document.getElementById("shift-closing-details-box");
    if (!box || !this.financeSummaryData) return;

    const currentMode = this.shiftClosingMode || "daily";
    const rows = (currentMode === "monthly") ? (this.financeSummaryData.monthly || []) : (this.financeSummaryData.daily || []);
    const row = rows[idx];
    if (!row || !Array.isArray(row.records)) {
      box.style.display = "none";
      return;
    }

    if (box.dataset.activeIdx === String(idx) && box.style.display === "block") {
      box.style.display = "none";
      box.dataset.activeIdx = "";
      return;
    }

    box.dataset.activeIdx = String(idx);
    box.style.display = "block";
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #CBD5E1; padding-bottom:6px;">
        <b style="font-size:13px; color:#1E293B;">🔍 ${isEn ? 'Transaction Details for' : 'รายละเอียดรายการประจำงวด'} ${row.date || row.month} (${row.records.length} ${isEn ? 'items' : 'รายการ'})</b>
        <button type="button" onclick="document.getElementById('shift-closing-details-box').style.display='none'" class="btn btn-sm btn-secondary" style="padding:1px 6px; font-size:11px;">✕ ${isEn ? 'Close' : 'ปิด'}</button>
      </div>
      <div class="table-responsive" style="max-height:180px; overflow-y:auto;">
        <table class="custom-table" style="margin:0; font-size:11.5px;">
          <thead>
            <tr style="background:#E2E8F0;">
              <th>${isEn ? 'Booking / Ref' : 'รหัสจอง / อ้างอิง'}</th>
              <th>${isEn ? 'Vehicle' : 'ทะเบียนรถ'}</th>
              <th>${isEn ? 'Customer' : 'ลูกค้า'}</th>
              <th>${isEn ? 'Category' : 'หมวดหมู่'}</th>
              <th>${isEn ? 'Method' : 'ช่องทางชำระ'}</th>
              <th style="text-align:right;">${isEn ? 'Amount (฿)' : 'ยอดเงิน (฿)'}</th>
            </tr>
          </thead>
          <tbody>
            ${row.records.map(rec => `
              <tr>
                <td style="font-weight:700;">${rec.ref || '-'}</td>
                <td>${rec.car_id || '-'}</td>
                <td>${rec.customer || '-'}</td>
                <td><span style="background:#EFF6FF; color:#1D4ED8; padding:1px 6px; border-radius:4px; font-size:10.5px; font-weight:600;">${rec.category || '-'}</span></td>
                <td><span style="font-weight:600;">${rec.payment_method || '-'}</span></td>
                <td style="text-align:right; font-weight:700; color:#EA580C;">฿${Number(rec.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

}

// Global App Instance
const app = new App();
window.app = app;
