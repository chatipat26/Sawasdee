/**
 * Sawasdee Rental - High-Speed SPA Application Logic
 */

class App {
  constructor() {
    this.user = JSON.parse(localStorage.getItem("sawasdee_user") || "null");
    this.cars = [];
    this.customers = [];
    this.bookings = [];
    this.backofficeJobs = [];
    this.completedJobs = [];
    this.users = [];
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

    this.init();
  }

  async init() {
    this.setupDatePickers();
    this.updateAuthUI();
    if (this.user) {
      await this.fetchInitialData();
      this.startLiveSyncPoller();
    }
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
    const h = map.hour === "24" ? "00" : map.hour;
    const dStr = `${map.year}-${map.month}-${map.day}`;
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
    if (sDate && !sDate.value) sDate.value = thNow.date;
    if (eDate && !eDate.value) eDate.value = thNext3.date;
    const sTime = document.getElementById("filter-start-time");
    const eTime = document.getElementById("filter-end-time");
    if (sTime && !sTime.value) sTime.value = thNow.time;
    if (eTime && !eTime.value) eTime.value = thNow.time;
  }

  updateAuthUI() {
    const gateScreen = document.getElementById("auth-gate-screen");
    const mainWrapper = document.getElementById("main-app-wrapper");
    const sbName = document.getElementById("sb-user-name");
    const sbRole = document.getElementById("sb-user-role");
    const sbAdminBtn = document.getElementById("sb-admin-staff-btn");
    const headerName = document.getElementById("user-display-name");
    const headerRole = document.getElementById("user-role-tag");

    if (this.user) {
      if (gateScreen) gateScreen.style.display = "none";
      if (mainWrapper) mainWrapper.style.display = "flex";

      const un = this.user.name || this.user.username || "admin";
      const role = this.user.role || "Staff";
      const isAdmin = (role === "Admin" || (this.user.username && this.user.username.toLowerCase() === "admin"));
      const roleLabel = isAdmin ? "👑 ผู้ดูแลระบบ (Admin)" : "👷 พนักงานปฏิบัติงาน";

      if (sbName) sbName.textContent = this.user.username || un;
      if (sbRole) sbRole.textContent = roleLabel;
      if (headerName) headerName.textContent = un;
      if (headerRole) {
        headerRole.textContent = role;
        headerRole.style.background = isAdmin ? "#FEF3C7" : "#EFF6FF";
        headerRole.style.color = isAdmin ? "#92400E" : "#1E40AF";
      }

      if (sbAdminBtn) {
        sbAdminBtn.style.display = isAdmin ? "flex" : "none";
      }
    } else {
      if (gateScreen) gateScreen.style.display = "flex";
      if (mainWrapper) mainWrapper.style.display = "none";
    }
  }

  async fetchInitialData() {
    try {
      await Promise.all([
        this.loadUsers(),
        this.loadCars(),
        this.loadCustomers(),
        this.loadBookings(),
        this.loadBackOfficeJobs(),
        this.loadDashboardKPIs()
      ]);
      this.onFilterChange();
    } catch (e) {
      console.error("Initial load error:", e);
    }
  }

  startLiveSyncPoller() {
    setInterval(async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const st = await res.json();
          const syncTxt = document.getElementById("sync-time-txt");
          if (syncTxt) syncTxt.textContent = st.last_sync_formatted || "เมื่อสักครู่";
          if (st.data_signature && this.lastDataSignature && st.data_signature !== this.lastDataSignature) {
            this.lastDataSignature = st.data_signature;
            await this.fetchInitialData();
          } else if (st.data_signature && !this.lastDataSignature) {
            this.lastDataSignature = st.data_signature;
            if (typeof st.total_bookings === "number" && st.total_bookings !== this.bookings.length) {
              await this.fetchInitialData();
            }
          }
        }
      } catch (e) {}
    }, 8000);
  }

  async manualSync() {
    this.showToast("🔄 กำลังซิงค์ข้อมูลกับ Supabase Cloud...", "info");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        await this.fetchInitialData();
        this.showToast("✅ ซิงค์ข้อมูลล่าสุดสำเร็จเรียบร้อย!", "success");
      }
    } catch (e) {
      this.showToast("⚠️ การซิงค์ขัดข้อง: " + e.message, "danger");
    }
  }

  // --- API Loaders ---
  async loadCars() {
    const sDate = document.getElementById("filter-start-date")?.value;
    const eDate = document.getElementById("filter-end-date")?.value;
    const url = `/api/cars?start_date=${sDate || ''}&end_date=${eDate || ''}`;
    const res = await fetch(url);
    if (res.ok) {
      this.cars = await res.json();
      this.populateFleetDropdowns();
      this.renderFleetCards();
      this.renderFleetOverviewTable();
      if (this.activeModule === "dashboard") {
        this.renderDashboardCharts();
      }
    }
  }

  populateFleetDropdowns() {
    // 1. Group Dropdown
    const selGroup = document.getElementById("filter-group");
    if (selGroup) {
      const curVal = selGroup.value;
      const groups = Array.from(new Set(this.cars.map(c => (c.car_group || "").trim()).filter(Boolean))).sort();
      selGroup.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>' + 
        groups.map(g => `<option value="${g}">${g}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || groups.includes(curVal))) {
        selGroup.value = curVal;
      }
    }

    // 2. Brand Dropdown
    const selBrand = document.getElementById("filter-brand");
    if (selBrand) {
      const curVal = selBrand.value;
      const brands = Array.from(new Set(this.cars.map(c => (c.brand || "").trim()).filter(Boolean))).sort();
      selBrand.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>' + 
        brands.map(b => `<option value="${b}">${b}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || brands.includes(curVal))) {
        selBrand.value = curVal;
      }
    }

    // 3. Company Dropdown
    const selComp = document.getElementById("filter-company");
    if (selComp) {
      const curVal = selComp.value;
      const companies = Array.from(new Set(this.cars.map(c => (c.company || "").trim()).filter(Boolean))).sort();
      selComp.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>' + 
        companies.map(co => `<option value="${co}">${co}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || companies.includes(curVal))) {
        selComp.value = curVal;
      }
    }
  }

  resetFleetFilters() {
    const selGroup = document.getElementById("filter-group");
    const selBrand = document.getElementById("filter-brand");
    const selComp = document.getElementById("filter-company");
    const selStatus = document.getElementById("filter-status");
    const sDate = document.getElementById("filter-start-date");
    const sTime = document.getElementById("filter-start-time");
    const eDate = document.getElementById("filter-end-date");
    const eTime = document.getElementById("filter-end-time");
    const sbSearch = document.getElementById("sb-search-input");

    if (selGroup) selGroup.value = "ทั้งหมด";
    if (selBrand) selBrand.value = "ทั้งหมด";
    if (selComp) selComp.value = "ทั้งหมด";
    if (selStatus) selStatus.value = "ทั้งหมด";

    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    if (sDate) sDate.value = thNow.date;
    if (eDate) eDate.value = thNext3.date;
    if (sTime) sTime.value = thNow.time;
    if (eTime) eTime.value = thNow.time;
    if (sbSearch) sbSearch.value = "";
    this.sidebarSearchKw = "";

    this.loadCars();
    this.onFilterChange();
    this.showToast("🔄 คืนค่าตัวกรองทั้งหมดเรียบร้อย (เวลาไทย)", "info");
  }

  onDateFilterChange() {
    this.onFilterChange();
    this.loadCars();
  }

  async loadCustomers() {
    const res = await fetch("/api/customers");
    if (res.ok) {
      this.customers = await res.json();
      const badge = document.getElementById("badge-customers-count");
      if (badge) badge.textContent = this.customers.length;
      this.renderCustomersTable();
      this.populateCustomerDropdowns();
    }
  }

  async loadBookings() {
    const res = await fetch("/api/bookings");
    if (res.ok) {
      this.bookings = await res.json();
      const badge = document.getElementById("badge-frontoffice-bks");
      if (badge) badge.textContent = this.bookings.length;
      this.renderBookingsTable();
      this.populateBookingDropdowns();
    }
  }

  async loadBackOfficeJobs() {
    const res = await fetch("/api/backoffice/jobs");
    if (res.ok) {
      this.backofficeJobs = await res.json();
      const badge = document.getElementById("badge-backoffice-jobs");
      if (badge) badge.textContent = this.backofficeJobs.length;
      this.renderBackOfficeJobs();
    }
  }

  async loadDashboardKPIs() {
    try {
      const res = await fetch("/api/reports/kpis");
      if (res.ok) {
        this.rawKpiData = await res.json();
      }
      await this.loadMonthlyReports();
      this.updateDashboardKPIsFromScope();
      this.renderDashboardCharts();
      this.renderFleetOverviewTable();
    } catch (e) {}
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
    const scopeVal = document.getElementById("dash-company-scope")?.value || "ทั้งหมด";
    const scopedCars = (this.cars || []).filter(c => this.matchesCompanyScope(c.company, scopeVal));

    const totalCars = scopedCars.length;
    const availCars = scopedCars.filter(c => c.fleet_status_key === "available" || c.status === "ว่างพร้อมใช้งาน").length;
    const maintCars = scopedCars.filter(c => c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง").length;
    const activeRentals = scopedCars.filter(c => c.fleet_status_key === "unavailable" || ["กำลังเช่า", "ติดจอง", "เตรียมส่งมอบ", "เตรียมรับคืน", "รอส่งมอบ"].includes(c.status)).length;
    const utilRate = totalCars > 0 ? ((activeRentals / totalCars) * 100).toFixed(1) : "0.0";

    let totalRev = 0;
    if (scopeVal === "ทั้งหมด" && this.rawKpiData && this.rawKpiData.total_revenue !== undefined) {
      totalRev = parseFloat(this.rawKpiData.total_revenue || 0);
    } else {
      totalRev = (this.completedJobs || [])
        .filter(j => this.matchesCompanyScope(j.company, scopeVal))
        .reduce((sum, j) => sum + parseFloat(j.net_price || 0), 0);
    }

    const elTotal = document.getElementById("kpi-total-cars");
    const elAvail = document.getElementById("kpi-avail-pill");
    const elActive = document.getElementById("kpi-active-rentals");
    const elMaint = document.getElementById("kpi-maint-pill");
    const elUtil = document.getElementById("kpi-utilization");
    const elRev = document.getElementById("kpi-total-revenue");
    const elUpd = document.getElementById("dash-last-updated-txt");

    if (elTotal) elTotal.textContent = totalCars;
    if (elAvail) elAvail.textContent = `พร้อมให้บริการ ${availCars} คัน`;
    if (elActive) elActive.textContent = activeRentals;
    if (elMaint) elMaint.textContent = `ซ่อมบำรุง ${maintCars} คัน`;
    if (elUtil) elUtil.textContent = `${utilRate}%`;
    if (elRev) elRev.textContent = `฿${totalRev.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elUpd) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yyyy = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, "0");
      const min = String(now.getMinutes()).padStart(2, "0");
      elUpd.textContent = `🕒 ข้อมูลอัปเดตล่าสุด ณ ${dd}/${mm}/${yyyy} ${hh}:${min}`;
    }
  }

  async loadMonthlyReports() {
    const mPicker = document.getElementById("report-month-picker");
    const mVal = mPicker ? mPicker.value : "";
    const url = mVal ? `/api/reports/monthly?month=${mVal}` : `/api/reports/monthly`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      this.completedJobs = data.jobs || [];
      this.renderCompletedJobsTable();
      this.renderTrendChart();
    }
  }

  async loadUsers() {
    const res = await fetch("/api/users");
    if (res.ok) {
      this.users = await res.json();
      this.renderUsersTable();
      const pendingCnt = this.users.filter(u => u.status === "pending").length;
      const bPending = document.getElementById("badge-pending-users");
      if (bPending) {
        bPending.style.display = pendingCnt > 0 ? "inline-block" : "none";
        bPending.textContent = pendingCnt;
      }
      this.populateStaffDropdowns();
    }
  }

  // --- UI Module Navigation ---
  switchModule(modName) {
    this.activeModule = modName;
    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    const navBtn = document.getElementById(`nav-${modName}`);
    if (navBtn) navBtn.classList.add("active");

    ["frontoffice", "backoffice", "customers", "dashboard", "users"].forEach(m => {
      const sec = document.getElementById(`module-${m}`);
      if (sec) sec.style.display = (m === modName) ? "block" : "none";
    });

    if (modName === "backoffice") this.loadBackOfficeJobs();
    if (modName === "customers") this.renderCustomersTable();
    if (modName === "dashboard") {
      this.loadDashboardKPIs();
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
    } else if (tabName === "contract") {
      this.populateBookingDropdowns();
      this.populateStaffDropdowns();
      this.populateWalkinDropdowns();
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

  // --- Duration & Filter Engine ---
  calcDuration() {
    const sDate = document.getElementById("filter-start-date")?.value;
    const sTime = document.getElementById("filter-start-time")?.value || "10:00";
    const eDate = document.getElementById("filter-end-date")?.value;
    const eTime = document.getElementById("filter-end-time")?.value || "10:00";

    if (!sDate || !eDate) return { days: 1, text: "1 วัน" };

    const start = new Date(`${sDate}T${sTime}`);
    const end = new Date(`${eDate}T${eTime}`);
    if (end <= start) return { days: 1, text: "1 วัน (ขั้นต่ำ)" };

    const diffMs = end - start;
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const remMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const baseDays = Math.floor(totalHours / 24);
    const extraHours = totalHours % 24;

    let billableDays = baseDays;
    let desc = "";

    if (extraHours > 4 || (extraHours === 4 && remMins > 0)) {
      billableDays = baseDays + 1;
      desc = `${baseDays} วัน + เกินเวลา ${extraHours} ชม. ${remMins} น. (เกิน 4 ชม. ปรับเป็น 1 วัน ➔ คิด ${billableDays} วัน)`;
    } else {
      billableDays = Math.max(1, baseDays);
      if (extraHours > 0 || remMins > 0) {
        desc = `${baseDays} วัน + เกินเวลา ${extraHours} ชม. (อนุโลมไม่เกิน 4 ชม. ไม่คิดวันเพิ่ม ➔ คิด ${billableDays} วัน)`;
      } else {
        desc = `${billableDays} วันตรง (${billableDays * 24} ชั่วโมง)`;
      }
    }

    return { days: billableDays, text: desc };
  }

  onFilterChange() {
    const dur = this.calcDuration();
    const durTxt = document.getElementById("calc-duration-text");
    if (durTxt) durTxt.textContent = dur.text;

    this.renderFleetCards();
  }

  // --- Rate Engine for Daily, Weekly, Monthly ---
  getCarRates(car) {
    const c = car || {};
    const priceDay = parseFloat(c.price_day !== undefined ? c.price_day : (c.daily_rate || 1000));
    const rawWeek = parseFloat(c.price_week || 0);
    const rawMonth = parseFloat(c.price_month || 0);
    const priceWeek = rawWeek > 0 ? rawWeek : (priceDay * 6);
    const priceMonth = rawMonth > 0 ? rawMonth : (priceDay * 20);
    return { priceDay, priceWeek, priceMonth };
  }

  calculateCarRentalPrice(car, days, contractType = "รายวัน") {
    const { priceDay, priceWeek, priceMonth } = this.getCarRates(car);
    const billableDays = Math.max(1, parseInt(days, 10) || 1);
    let basePrice = 0;
    let breakdownText = "";

    if (contractType === "รายสัปดาห์") {
      if (billableDays <= 7) {
        basePrice = priceWeek;
        breakdownText = `เรทรายสัปดาห์ (1 สัปดาห์): ฿${priceWeek.toLocaleString()} / สัปดาห์`;
      } else {
        const weeks = Math.floor(billableDays / 7);
        const remDays = billableDays % 7;
        basePrice = (weeks * priceWeek) + (remDays * priceDay);
        if (remDays === 0) {
          breakdownText = `เรทรายสัปดาห์: ${weeks} สัปดาห์ (${billableDays} วัน) × ฿${priceWeek.toLocaleString()}`;
        } else {
          breakdownText = `เรทรายสัปดาห์: ${weeks} สัปดาห์ (฿${(weeks * priceWeek).toLocaleString()}) + เศษ ${remDays} วัน (฿${(remDays * priceDay).toLocaleString()})`;
        }
      }
    } else if (contractType === "รายเดือน") {
      if (billableDays <= 30) {
        basePrice = priceMonth;
        breakdownText = `เรทรายเดือน (1 เดือน): ฿${priceMonth.toLocaleString()} / เดือน`;
      } else {
        const months = Math.floor(billableDays / 30);
        const remDays = billableDays % 30;
        basePrice = (months * priceMonth) + (remDays * priceDay);
        if (remDays === 0) {
          breakdownText = `เรทรายเดือน: ${months} เดือน (${billableDays} วัน) × ฿${priceMonth.toLocaleString()}`;
        } else {
          breakdownText = `เรทรายเดือน: ${months} เดือน (฿${(months * priceMonth).toLocaleString()}) + เศษ ${remDays} วัน (฿${(remDays * priceDay).toLocaleString()})`;
        }
      }
    } else {
      // รายวัน (Daily)
      basePrice = billableDays * priceDay;
      breakdownText = `เรทรายวัน: ${billableDays} วัน × ฿${priceDay.toLocaleString()}/วัน = ฿${basePrice.toLocaleString()}`;
    }

    return { basePrice, breakdownText, priceDay, priceWeek, priceMonth };
  }

  // --- Rendering: Fleet Cards ---
  renderFleetCards() {
    const container = document.getElementById("fleet-cards-container");
    if (!container) return;

    const groupFilter = document.getElementById("filter-group")?.value || "ทั้งหมด";
    const brandFilter = document.getElementById("filter-brand")?.value || "ทั้งหมด";
    const companyFilter = document.getElementById("filter-company")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("filter-status")?.value || "ทั้งหมด";
    const dur = this.calcDuration();
    const kw = (this.sidebarSearchKw || "").toLowerCase().trim();

    const filtered = this.cars.filter(c => {
      // 1. Group filter
      if (groupFilter !== "ทั้งหมด") {
        const cg = (c.car_group || "").toLowerCase();
        if (!cg.includes(groupFilter.toLowerCase())) return false;
      }

      // 2. Brand filter
      if (brandFilter !== "ทั้งหมด") {
        if ((c.brand || "").toLowerCase() !== brandFilter.toLowerCase()) return false;
      }

      // 3. Company filter
      if (companyFilter !== "ทั้งหมด") {
        if ((c.company || "").trim() !== companyFilter.trim()) return false;
      }

      // 4. Status filter (matching app.py exactly)
      if (statusFilter.startsWith("ว่างไม่มีการจอง")) {
        if (c.fleet_status_key !== "available") return false;
      } else if (statusFilter.startsWith("มีการจองล่วงหน้าไว้")) {
        if (c.fleet_status_key !== "reserved") return false;
      } else if (statusFilter.startsWith("ไม่ว่างในวันที่เลือก")) {
        if (c.fleet_status_key !== "unavailable") return false;
      } else if (statusFilter.startsWith("สถานะซ่อมบำรุง") || statusFilter === "ซ่อมบำรุง") {
        if (c.fleet_status_key !== "maintenance") return false;
      } else if (statusFilter.startsWith("ว่างพร้อมใช้งาน")) {
        if (c.fleet_status_key !== "available" && c.fleet_status_key !== "reserved") return false;
      } else if (statusFilter === "กำลังเช่า") {
        if (c.status !== "กำลังเช่า" && c.fleet_status_key !== "unavailable") return false;
      } else if (statusFilter === "ติดจอง") {
        if (c.status !== "ติดจอง" && c.fleet_status_key !== "reserved") return false;
      }

      // 5. Sidebar Search keyword
      if (kw) {
        const target = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.car_group || ''} ${c.company || ''} ${c.color || ''}`.toLowerCase();
        const targetClean = target.replace(/[- ]/g, '');
        const kwClean = kw.replace(/[- ]/g, '');
        if (!target.includes(kw) && !targetClean.includes(kwClean)) return false;
      }

      return true;
    });

    const countTxt = document.getElementById("calc-cars-count");
    if (countTxt) {
      const availCount = filtered.filter(c => c.fleet_status_key === "available" || c.fleet_status_key === "reserved").length;
      countTxt.textContent = `พบรถว่างพร้อมให้บริการ: ${availCount} / ${filtered.length} คัน`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B;">🔍 ไม่พบรถยนต์ตามเงื่อนไขที่เลือก</div>`;
      return;
    }

    container.innerHTML = filtered.map(c => {
      const isAvail = c.fleet_status_key === "available" || c.fleet_status_key === "reserved";
      const autoType = dur.days >= 30 ? "รายเดือน" : (dur.days >= 7 ? "รายสัปดาห์" : "รายวัน");
      const { basePrice, priceDay, priceWeek, priceMonth } = this.calculateCarRentalPrice(c, dur.days, autoType);
      const defImg = "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500";
      const carImg = c.image || defImg;
      const safePlate = String(c.plate || "").replace(/'/g, "\\'");

      return `
        <div class="car-card">
          <div class="car-image-container" style="position:relative;">
            <img src="${carImg}" alt="${c.brand} ${c.model}" class="car-image" onerror="this.src='${defImg}'">
            <span class="car-status-pill" style="background:${c.status_bg}; color:${c.status_color}; border:1px solid ${c.status_border};">
              ${c.fleet_status_desc}
            </span>
            <button type="button" onclick="app.triggerCarPhotoUpload('${safePlate}')" title="อัปโหลดรูปรถคันนี้ใหม่" style="position:absolute; bottom:8px; right:8px; background:rgba(255,255,255,0.92); color:#1F2937; border:1px solid #CBD5E1; border-radius:20px; padding:4px 10px; font-size:11.5px; font-weight:700; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.18); display:flex; align-items:center; gap:4px;">
              📸 อัปโหลดรูป
            </button>
          </div>
          <div class="car-body">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
              <div>
                <div class="car-title">${c.brand} ${c.model}</div>
                <div class="car-plate">🚘 ${c.plate}</div>
              </div>
              <button type="button" onclick="app.openEditCarModal('${safePlate}')" class="btn btn-sm btn-secondary" style="padding:3px 8px; font-size:11.5px; background:#FAF7F2; border:1px solid #D1D5DB; color:#374151; white-space:nowrap;" title="แก้ไขรายละเอียดรถและรูปรถ">
                ✏️ แก้ไขรถ
              </button>
            </div>
            <div class="car-specs">
              <span>💺 ${c.car_group || 'รถยนต์'}</span>
              <span>⛽ ${c.fuel_type || 'เบนซิน'}</span>
              <span>⚙️ ${c.engine_cc || '1500'} cc</span>
              <span>🏢 ${c.company || 'Sawasdee'}</span>
            </div>
            <div class="car-pricing">
              <div>
                <div style="font-size:11px; color:#64748B;">ค่าเช่า (${dur.days} วัน):</div>
                <div class="price-main">฿${basePrice.toLocaleString()}</div>
                <div style="font-size:10.5px; color:#64748B; margin-top:2px;" title="อัตราค่าเช่าที่ตั้งค่าไว้">
                  ฿${priceDay.toLocaleString()}/ว | ฿${priceWeek.toLocaleString()}/ส | ฿${priceMonth.toLocaleString()}/ด
                </div>
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <button onclick="app.openBookModal('${safePlate}')" class="btn btn-sm ${isAvail ? 'btn-primary' : 'btn-secondary'}" ${!isAvail ? 'title="รถคันนี้ติดจอง แต่สามารถคลิกดูรายละเอียดหรือจองคิวต่อได้"' : ''}>
                  ${isAvail ? '⚡ จองทันที' : '📅 จองคิว'}
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  // --- Quick Car Photo Upload & Edit Car Modal ---
  triggerCarPhotoUpload(plate) {
    this.quickUploadTargetPlate = plate;
    const inp = document.getElementById("quick-car-photo-input");
    if (inp) {
      inp.value = "";
      inp.click();
    }
  }

  async onQuickCarPhotoSelected(input) {
    if (!input.files || input.files.length === 0 || !this.quickUploadTargetPlate) return;
    const plate = this.quickUploadTargetPlate;
    const file = input.files[0];
    const car = this.cars.find(c => c.plate === plate);
    if (!car) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      this.showToast(`⏳ กำลังอัปโหลดรูปภาพสำหรับรถทะเบียน ${plate}...`, "info");
      const upRes = await fetch("/api/upload-photo", { method: "POST", body: formData });
      const upData = await upRes.json();
      if (!upData.success || !upData.url) {
        throw new Error(upData.detail || "อัปโหลดรูปภาพไม่สำเร็จ");
      }

      const payload = Object.assign({}, car, { plate: plate, image: upData.url });
      const saveRes = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const saveData = await saveRes.json();
      if (saveData.success) {
        this.showToast(`✅ อัปเดตรูปภาพรถทะเบียน ${plate} เรียบร้อยแล้ว!`, "success");
        await this.loadCars();
      }
    } catch (e) {
      this.showToast("❌ อัปโหลดรูปรถไม่สำเร็จ: " + e.message, "danger");
    }
  }

  normalizePlate(plate) {
    if (!plate) return "";
    return String(plate).replace(/[\s\-\.]+/g, "").toLowerCase();
  },

  checkDuplicatePlate(val) {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const warnEl = document.getElementById("edit-car-plate-warn");
    const clean = this.normalizePlate(val);
    if (!clean) {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
    const origClean = this.normalizePlate(origPlate);
    const dup = this.cars.find(c => {
      const cClean = this.normalizePlate(c.plate);
      if (origClean && cClean === origClean) return false;
      return cClean === clean;
    });
    if (dup) {
      if (warnEl) {
        warnEl.textContent = `⚠️ ทะเบียน '${val}' ซ้ำกับ '${dup.brand} ${dup.model}' (ทะเบียน ${dup.plate}) ในระบบแล้ว`;
        warnEl.style.display = "block";
      }
      return true;
    } else {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
  },

  openEditCarModal(plate) {
    const isNew = !plate;
    const car = (!isNew && this.cars.find(c => c.plate === plate)) || {};
    const defImg = "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500";

    const titleEl = document.getElementById("modal-edit-car-title");
    if (titleEl) {
      titleEl.textContent = isNew
        ? "➕ เพิ่มรถยนต์ใหม่เข้าสู่ระบบ (Add New Vehicle)"
        : `✏️ แก้ไขข้อมูลรถยนต์ & อัปโหลดรูปรถ (${plate})`;
    }

    const origPlateEl = document.getElementById("edit-car-original-plate");
    if (origPlateEl) origPlateEl.value = isNew ? "" : (car.plate || plate);

    const warnEl = document.getElementById("edit-car-plate-warn");
    if (warnEl) warnEl.style.display = "none";

    const delBtn = document.getElementById("btn-modal-car-delete");
    if (delBtn) delBtn.style.display = isNew ? "none" : "inline-flex";

    const plateEl = document.getElementById("edit-car-plate");
    if (plateEl) {
      plateEl.value = car.plate || "";
      plateEl.readOnly = false;
      plateEl.style.background = "#FFFFFF";
    }

    const previewEl = document.getElementById("edit-car-img-preview");
    if (previewEl) previewEl.src = car.image || defImg;

    const urlEl = document.getElementById("edit-car-image-url");
    if (urlEl) urlEl.value = car.image || "";

    const fileEl = document.getElementById("edit-car-photo-file");
    if (fileEl) fileEl.value = "";

    document.getElementById("edit-car-brand").value = car.brand || "Toyota";
    document.getElementById("edit-car-model").value = car.model || "";
    document.getElementById("edit-car-group").value = car.car_group || "รถเก๋ง (Sedan/Hatchback)";
    document.getElementById("edit-car-fuel").value = car.fuel_type || "เบนซิน";
    document.getElementById("edit-car-cc").value = car.engine_cc || "1200";
    document.getElementById("edit-car-company").value = car.company || "Sawasdee Rent A Car";
    document.getElementById("edit-car-color").value = car.color || "";
    document.getElementById("edit-car-mileage").value = car.mileage || "0";
    document.getElementById("edit-car-pday").value = car.price_day !== undefined ? car.price_day : 1000;
    document.getElementById("edit-car-pweek").value = car.price_week !== undefined ? car.price_week : 6000;
    document.getElementById("edit-car-pmonth").value = car.price_month !== undefined ? car.price_month : 20000;
    document.getElementById("edit-car-vin").value = car.chassis_no || "-";
    document.getElementById("edit-car-act").value = car.act_expiry || "-";
    document.getElementById("edit-car-ins").value = car.ins_expiry || "-";
    document.getElementById("edit-car-status").value = car.status || "ว่างพร้อมใช้งาน";

    this.openModal("modal-edit-car");
  },

  async onEditCarModalPhotoSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    try {
      this.showToast(`⏳ กำลังอัปโหลดรูปภาพ ${file.name}...`, "info");
      const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        const previewEl = document.getElementById("edit-car-img-preview");
        const urlEl = document.getElementById("edit-car-image-url");
        if (previewEl) previewEl.src = data.url;
        if (urlEl) urlEl.value = data.url;
        this.showToast("📸 อัปโหลดรูปภาพสำเร็จ! กดบันทึกข้อมูลรถยนต์เพื่อยืนยัน", "success");
      } else {
        this.showToast("❌ อัปโหลดรูปไม่สำเร็จ", "danger");
      }
    } catch (e) {
      this.showToast("❌ อัปโหลดรูปไม่สำเร็จ: " + e.message, "danger");
    }
  },

  async submitEditCar() {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const plate = (document.getElementById("edit-car-plate")?.value || "").trim();
    const brand = (document.getElementById("edit-car-brand")?.value || "").trim();
    const model = (document.getElementById("edit-car-model")?.value || "").trim();
    if (!plate) {
      this.showToast("⚠️ กรุณาระบุเลขทะเบียนรถ", "warning");
      return;
    }
    if (!brand || !model) {
      this.showToast("⚠️ กรุณาระบุยี่ห้อและรุ่นรถยนต์", "warning");
      return;
    }

    if (this.checkDuplicatePlate(plate)) {
      this.showToast(`⚠️ เลขทะเบียนรถ '${plate}' ซ้ำกับรถคันอื่นในระบบแล้ว`, "danger");
      return;
    }

    const existing = this.cars.find(c => c.plate === (origPlate || plate)) || {};
    const imgUrl = (document.getElementById("edit-car-image-url")?.value || "").trim() || existing.image || "";

    const payload = {
      original_plate: origPlate || plate,
      plate: plate,
      brand: brand,
      model: model,
      car_group: document.getElementById("edit-car-group")?.value || "รถเก๋ง (Sedan/Hatchback)",
      fuel_type: document.getElementById("edit-car-fuel")?.value || "เบนซิน",
      engine_cc: (document.getElementById("edit-car-cc")?.value || "1200").trim(),
      company: (document.getElementById("edit-car-company")?.value || "Sawasdee Rent A Car").trim(),
      color: (document.getElementById("edit-car-color")?.value || "-").trim(),
      mileage: (document.getElementById("edit-car-mileage")?.value || "0").trim(),
      price_day: parseInt(document.getElementById("edit-car-pday")?.value || "1000", 10),
      price_week: parseInt(document.getElementById("edit-car-pweek")?.value || "6000", 10),
      price_month: parseInt(document.getElementById("edit-car-pmonth")?.value || "20000", 10),
      chassis_no: (document.getElementById("edit-car-vin")?.value || "-").trim(),
      act_expiry: (document.getElementById("edit-car-act")?.value || "-").trim(),
      ins_expiry: (document.getElementById("edit-car-ins")?.value || "-").trim(),
      status: document.getElementById("edit-car-status")?.value || "ว่างพร้อมใช้งาน",
      image: imgUrl
    };

    try {
      const res = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-edit-car");
        if (origPlate && origPlate !== plate) {
          const oldIdx = this.cars.findIndex(c => c.plate === origPlate);
          if (oldIdx >= 0) this.cars.splice(oldIdx, 1);
        }
        const idx = this.cars.findIndex(c => c.plate === plate);
        if (idx >= 0) {
          Object.assign(this.cars[idx], payload);
        } else {
          this.cars.unshift(payload);
        }
        this.renderFleetCards();
        this.renderFleetOverviewTable();
        this.populateFleetDropdowns();
        this.showToast(`✅ บันทึกข้อมูลรถยนต์ทะเบียน ${plate} เรียบร้อยแล้ว!`, "success");
        await this.loadCars();
      } else {
        this.showToast("❌ บันทึกไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  },

  async deleteCurrentEditingCar() {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const plate = (document.getElementById("edit-car-plate")?.value || "").trim();
    const target = origPlate || plate;
    if (!target) return;
    const ok = await this.deleteCarByPlate(target);
    if (ok) {
      this.closeModal("modal-edit-car");
    }
  },

  async deleteCarByPlate(plate) {
    if (!plate) return false;
    const car = this.cars.find(c => c.plate === plate) || {};
    const label = car.brand && car.model ? `${car.brand} ${car.model} (${plate})` : plate;
    const conf = confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบรถยนต์ "${label}" ออกจากระบบ?\n\n⚠️ คำเตือน: ระบบจะไม่อนุญาตให้ลบหากมีรายการจองหรือสัญญาที่ยังไม่เสร็จสิ้น`);
    if (!conf) return false;

    try {
      this.showToast(`⏳ กำลังลบข้อมูลรถยนต์ ${plate}...`, "info");
      const res = await fetch(`/api/cars/${encodeURIComponent(plate)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const norm = this.normalizePlate(plate);
        this.cars = this.cars.filter(c => c.plate !== plate && this.normalizePlate(c.plate) !== norm);
        this.renderFleetCards();
        this.renderFleetOverviewTable();
        this.populateFleetDropdowns();
        this.showToast(`🗑️ ลบข้อมูลรถยนต์ทะเบียน ${plate} เรียบร้อยแล้ว!`, "success");
        await this.loadCars();
        return true;
      } else {
        alert("❌ ไม่สามารถลบรถยนต์คันนี้ได้:\n" + (data.detail || "เกิดข้อผิดพลาดในการลบ"));
        this.showToast("❌ ลบไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
        return false;
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
      return false;
    }
  },

  // --- Modal: Book Car ---
  openBookModal(plate) {
    const car = this.cars.find(c => c.plate === plate);
    if (!car) return;

    document.getElementById("book-car-plate").value = plate;
    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    const fSDate = document.getElementById("filter-start-date")?.value || thNow.date;
    const fSTime = document.getElementById("filter-start-time")?.value || thNow.time;
    const fEDate = document.getElementById("filter-end-date")?.value || thNext3.date;
    const fETime = document.getElementById("filter-end-time")?.value || thNow.time;

    const mSDate = document.getElementById("book-modal-start-date");
    const mSTime = document.getElementById("book-modal-start-time");
    const mEDate = document.getElementById("book-modal-end-date");
    const mETime = document.getElementById("book-modal-end-time");

    if (mSDate) mSDate.value = fSDate;
    if (mSTime) mSTime.value = fSTime;
    if (mEDate) mEDate.value = fEDate;
    if (mETime) mETime.value = fETime;

    document.getElementById("book-discount-input").value = 0;
    this.recalcBookingModalFromDates(true);

    this.populateCustomerDropdowns(this.lastAddedCustomerName || null);
    this.openModal("modal-book-car");
  }

  setBookingModalDurationDays(targetDays) {
    const sDateInput = document.getElementById("book-modal-start-date");
    const eDateInput = document.getElementById("book-modal-end-date");
    if (!sDateInput || !eDateInput || !sDateInput.value) return;

    const [y, m, d] = sDateInput.value.split("-").map(n => parseInt(n, 10));
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
    const sDate = document.getElementById("book-modal-start-date")?.value || thNow.date;
    const sTime = document.getElementById("book-modal-start-time")?.value || thNow.time;
    const eDate = document.getElementById("book-modal-end-date")?.value || thNow.date;
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
            <span style="font-size:13.5px; font-weight:700; color:#1E293B;">🗓️ จำนวนวันเช่ารวม:</span>
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

    // 2. Render Top Car Preview Box (Screenshots 2 & 3: แสดงราคาตรงตามข้อมูลที่ลงไว้)
    const preview = document.getElementById("book-car-preview");
    if (preview) {
      const activeStyle = "background:#FFFBEB; color:#B45309; border:1.5px solid #F59E0B; font-weight:800;";
      const inactiveStyle = "background:#F1F5F9; color:#475569; border:1px solid #E2E8F0;";

      preview.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
          <div>
            <b style="font-size:15px; color:#1E293B;">${car.brand || ''} ${car.model || ''}</b> | ทะเบียน: <b style="color:#D97706;">${car.plate}</b><br/>
            <span style="font-size:12px; color:#64748B;">🏷️ กลุ่ม: ${car.car_group || 'รถยนต์'} | ⛽ ${car.fuel_type || 'เบนซิน'} | 🏢 ${car.company || '-'}</span>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:#64748B; margin-bottom:3px;">💰 อัตราค่าเช่าที่ตั้งค่าไว้:</div>
            <div style="display:flex; gap:4px; font-size:11.5px; justify-content:flex-end; flex-wrap:wrap;">
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายวัน' ? activeStyle : inactiveStyle}">฿${priceDay.toLocaleString()}/วัน</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายสัปดาห์' ? activeStyle : inactiveStyle}">฿${priceWeek.toLocaleString()}/สัปดาห์</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายเดือน' ? activeStyle : inactiveStyle}">฿${priceMonth.toLocaleString()}/เดือน</span>
            </div>
          </div>
        </div>
        <div style="margin-top:7px; padding-top:6px; border-top:1px dashed #E2E8F0; font-size:12px; color:#475569;">
          💡 <b>คำนวณราคาประเภท ${cType}:</b> <span style="color:#D97706; font-weight:700;">${breakdownText}</span>
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
      const data = await res.json();
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
      this.showToast("เกิดข้อผิดพลาดในการสร้างการจอง: " + e.message, "danger");
    }
  }

  // --- Tab 2: Deposit & Settle Logic ---
  populateBookingDropdowns() {
    const depSel = document.getElementById("deposit-sel-booking");
    const assignDispSel = document.getElementById("assign-disp-bk");
    const assignRetSel = document.getElementById("assign-ret-bk");
    const contractSel = document.getElementById("contract-sel-bk");

    const activeBks = this.bookings.filter(b => b.status !== "ยกเลิก" && b.status !== "เสร็จสิ้น");
    const allValidBks = this.bookings.filter(b => b.status !== "ยกเลิก");

    const renderOpts = (bks) => `
      <option value="">-- กรุณาเลือกรายการจอง --</option>
      ${bks.map(b => {
        const sFmt = b.start_date_formatted || b.start_date || "-";
        const eFmt = b.end_date_formatted || b.end_date || "-";
        return `<option value="${b.booking_id}">${b.booking_id} | ${b.car_id} (${b.customer}) 📅 ${sFmt} - ${eFmt} [สถานะ: ${b.status}]</option>`;
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
    const bkId = document.getElementById("deposit-sel-booking").value;
    const summary = document.getElementById("deposit-booking-summary");
    const actionSec = document.getElementById("deposit-action-section");
    const btnSettle = document.getElementById("btn-settle-rental");
    const btnDlDep = document.getElementById("btn-dl-dep-receipt");
    const btnDlRent = document.getElementById("btn-dl-rent-receipt");
    const btnDlContract = document.getElementById("btn-dl-contract-from-dep");

    if (!bkId) {
      if (summary) summary.style.display = "none";
      if (actionSec) actionSec.style.display = "none";
      return;
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) return;

    this.currentSelectedBooking = b;
    summary.style.display = "block";
    actionSec.style.display = "block";

    const isDep = b.deposit_paid;
    const isRent = b.rental_paid;
    const netP = parseFloat(b.net_price || 0);

    summary.innerHTML = `
      <div style="font-size:13px; line-height:1.6;">
        <b style="color:#92400E; font-size:14px;">รหัส: ${b.booking_id}</b> | ทะเบียน: <b>${b.car_id}</b><br/>
        👤 ลูกค้า: <b>${b.customer}</b> (📞 ${b.customer_phone || '-'})<br/>
        📅 ระยะเวลา: ${b.start_date_formatted} ถึง ${b.end_date_formatted}<br/>
        💰 ค่าเช่าสุทธิ: <b style="color:#D97706; font-size:15px;">฿${netP.toLocaleString()}</b> |
        🛡️ มัดจำ: <b style="color:${isDep ? '#059669' : '#DC2626'};">${isDep ? 'ชำระแล้ว' : 'รอมัดจำ'}</b>
      </div>
    `;

    if (btnSettle) btnSettle.style.display = (!isRent && isDep) ? "inline-flex" : "none";
    if (btnDlDep) btnDlDep.style.display = isDep ? "inline-flex" : "none";
    if (btnDlRent) btnDlRent.style.display = isRent ? "inline-flex" : "none";
    if (btnDlContract) btnDlContract.style.display = "inline-flex";
  }

  async submitDeposit() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depAmt = parseFloat(document.getElementById("deposit-amount-input").value);
    const depMethod = document.getElementById("deposit-method-input").value;
    const alsoRent = document.getElementById("deposit-also-rent").checked;

    try {
      const res = await fetch(`/api/bookings/${bkId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposit_amount: depAmt,
          payment_method: depMethod,
          also_pay_rental: alsoRent
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ บันทึกรับเงินมัดจำ ${bkId} เรียบร้อย! กำลังพาไปหน้าออกใบงานส่ง/รับรถ...`, "success");
        await this.loadBookings();
        await this.loadCars();
        this.onSelectDepositBooking();
        await this.goToTabWithBooking("assign", bkId);
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async submitSettle() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depMethod = document.getElementById("deposit-method-input").value;

    try {
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method: depMethod })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 บันทึกชำระค่าเช่าคงเหลือ ${bkId} ครบถ้วน!`, "success");
        await this.loadBookings();
        this.onSelectDepositBooking();
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Tab 3: Dispatch & Return Assign ---
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
    } else if (tabName === "contract") {
      const sel = document.getElementById("contract-sel-bk");
      if (sel) {
        sel.value = bkId;
        this.onSelectContractBooking();
      }
    }
  }

  onSelectAssignDispBooking() {
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

      if (bannerEl) {
        const isDep = Boolean(b.deposit_paid);
        const isRent = Boolean(b.rental_paid);
        const netP = parseFloat(b.net_price || 0);
        const wDel = String(b.worker_delivery || "").trim();
        const hasDriver = wDel && wDel !== "Wait" && wDel !== "-";
        const sFmt = b.start_date_formatted || sVal;
        const eFmt = b.end_date_formatted || eVal;

        let html = `
          <div style="background:#FAF7F2; border:1px solid #E5E7EB; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#1F2937;">
            📅 <b>กำหนดส่งมอบรถ:</b> <span style="color:#EA580C; font-weight:700;">${sFmt} (${b.start_time || '10:00'} น.)</span> &nbsp;|&nbsp; <b>กำหนดคืนรถ:</b> <span style="font-weight:700;">${eFmt} (${b.end_time || '10:00'} น.)</span>
          </div>
        `;
        if (!isDep) {
          html += `
            <div style="background:#FFFBEB; border:1px solid #F59E0B; border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#92400E;"><b>🟡 สถานะการจอง: รอชำระเงินมัดจำ</b> (สามารถมอบหมายคนขับล่วงหน้าได้)</div>
              <button type="button" onclick="app.goToTabWithBooking('deposit', '${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 ไปรับมัดจำ</button>
            </div>
          `;
        }
        if (isRent) {
          html += `
            <div style="background:#ECFDF5; border:1px solid #10B981; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#065F46; font-weight:700;">
              ✅ ชำระค่าเช่ารถครบถ้วนแล้ว (฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})})
            </div>
          `;
        } else {
          html += `
            <div style="background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#1E40AF;">⏳ <b>รอชำระค่าเช่าวันรับรถ:</b> ฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
              <button type="button" onclick="app.goToTabWithBooking('deposit', '${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 กดจ่ายเงินค่าเช่า</button>
            </div>
          `;
        }
        if (hasDriver) {
          html += `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#166534;">
              🚚 <b>มอบหมายพนักงานจัดส่งแล้ว:</b> ${wDel} (วันที่ ${sFmt} เวลา ${b.start_time || '10:00'} น.)
            </div>
          `;
        }
        bannerEl.innerHTML = html;
      }
    }
  }

  onSelectAssignRetBooking() {
    const bkId = document.getElementById("assign-ret-bk")?.value;
    const form = document.getElementById("assign-ret-form");
    if (!bkId) {
      if (form) form.style.display = "none";
      return;
    }
    if (form) form.style.display = "block";
    this.populateStaffDropdowns();
    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
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

      if (bannerEl) {
        const wRet = String(b.worker_return || "").trim();
        const hasDriver = wRet && wRet !== "Wait" && wRet !== "-";
        const sFmt = b.start_date_formatted || sVal;
        const eFmt = b.end_date_formatted || eVal;
        let html = `
          <div style="background:#FAF7F2; border:1px solid #E5E7EB; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#1F2937;">
            📅 <b>กำหนดรับรถคืน:</b> <span style="color:#EA580C; font-weight:700;">${eFmt} (${b.end_time || '10:00'} น.)</span> &nbsp;|&nbsp; <b>วันเริ่มเช่า:</b> <span>${sFmt}</span>
          </div>
        `;
        if (hasDriver) {
          html += `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#166534;">
              🔙 <b>มอบหมายพนักงานรับรถคืนแล้ว:</b> ${wRet} (วันที่ ${eFmt} เวลา ${b.end_time || '10:00'} น.)
            </div>
          `;
        }
        bannerEl.innerHTML = html;
      }
    }
  }

  async submitAssign(jobType) {
    const isDisp = jobType === "Dispatch";
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk").value;
    const worker = document.getElementById(isDisp ? "assign-disp-worker" : "assign-ret-worker").value;
    const loc = document.getElementById(isDisp ? "assign-disp-loc" : "assign-ret-loc").value;
    const tVal = document.getElementById(isDisp ? "assign-disp-time" : "assign-ret-time").value;
    const sDate = (isDisp ? document.getElementById("assign-disp-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-start-date" : "assign-ret-start-date")?.value || "";
    const eDate = (!isDisp ? document.getElementById("assign-ret-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-end-date" : "assign-ret-end-date")?.value || "";

    try {
      const res = await fetch(`/api/bookings/${bkId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_type: jobType,
          worker: worker,
          location: loc,
          time: tVal,
          start_date: sDate,
          end_date: eDate
        })
      });
      const data = await res.json();
      if (data.success) {
        this.confirmedAssignSides = this.confirmedAssignSides || {};
        if (!this.confirmedAssignSides[bkId]) {
          this.confirmedAssignSides[bkId] = { Dispatch: false, Return: false };
        }
        this.confirmedAssignSides[bkId][jobType] = true;

        await this.loadBookings();
        await this.loadBackOfficeJobs();
        if (isDisp) this.onSelectAssignDispBooking();
        else this.onSelectAssignRetBooking();

        const updatedBk = this.bookings.find(x => x.booking_id === bkId) || data.booking || {};
        const wDel = String(updatedBk.worker_delivery || "").trim();
        const wRet = String(updatedBk.worker_return || "").trim();
        const hasDel = Boolean(wDel && wDel !== "Wait" && wDel !== "-");
        const hasRet = Boolean(wRet && wRet !== "Wait" && wRet !== "-");
        const bothClicked = Boolean(this.confirmedAssignSides[bkId].Dispatch && this.confirmedAssignSides[bkId].Return);

        if (bothClicked || (hasDel && hasRet)) {
          this.showToast(`🎉 ออกใบงานครบทั้งส่งรถและรับรถคืน (${bkId}) เรียบร้อย! กำลังพาไปหน้าจัดทำสัญญาเช่า...`, "success");
          await this.goToTabWithBooking("contract", bkId);
        } else {
          const nextSideLabel = isDisp ? "ออกใบงานรับรถคืน (ฝั่งขวา)" : "ออกใบงานส่งรถ (ฝั่งซ้าย)";
          this.showToast(`✅ บันทึกมอบหมายงาน ${isDisp ? 'ส่งรถ' : 'รับรถคืน'} และแจ้งเตือน LINE เรียบร้อย! (กรุณากดยืนยัน ${nextSideLabel} ต่อ)`, "success");
        }
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Tab 4: Contract Formulation & Document Center ---
  onSelectContractBooking() {
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

    // Header with badges
    const header = document.getElementById("contract-header-info");
    if (header) {
      const isIssued = !!b.contract_issued;
      header.innerHTML = `
        <div>
          <span style="font-size:18px; font-weight:800; color:#1E3A8A; letter-spacing:0.5px;">📄 สัญญาเช่ารหัส: ${b.booking_id}</span>
          <span style="margin-left:8px;" class="badge ${isIssued ? 'badge-success' : 'badge-warning'}">
            ${isIssued ? '✅ ออกสัญญาเรียบร้อยแล้ว' : '⏳ รอยืนยันออกสัญญา'}
          </span>
          <span style="margin-left:4px;" class="badge badge-info">${b.status}</span>
        </div>
        <div style="font-size:12px; color:#64748B;">
          📅 จัดทำ: ${b.start_date_formatted || b.start_date} | ผู้บันทึก: ${b.created_by || 'Admin'}
        </div>
      `;
    }

    // Customer
    const custEl = document.getElementById("contract-cust-info");
    if (custEl) {
      custEl.innerHTML = `
        • <b>ชื่อผู้เช่า:</b> ${b.customer}<br/>
        • <b>Passport / เลขบัตร:</b> ${cust.passport_id || b.customer_id_card || '-'}<br/>
        • <b>เบอร์ติดต่อ:</b> ${b.customer_phone || cust.contact_no || '-'}<br/>
        • <b>ใบขับขี่:</b> ${cust.licence_no || '-'}<br/>
        • <b>สัญชาติ:</b> ${cust.nationality || 'THAI'}
      `;
    }

    // Car
    const carEl = document.getElementById("contract-car-info");
    if (carEl) {
      carEl.innerHTML = `
        • <b>หมายเลขทะเบียน:</b> <b style="color:#D97706;">${b.car_id}</b><br/>
        • <b>ยี่ห้อ/รุ่น:</b> ${car.brand || b.car_brand || ''} ${car.model || b.car_model || ''}<br/>
        • <b>กลุ่มรถ/สี:</b> ${car.car_group || '-'} / ${car.color || '-'}<br/>
        • <b>บริษัทสังกัด:</b> ${car.company || '-'}<br/>
        • <b>สถานะรถ:</b> ${car.fleet_status_desc || car.status || 'พร้อมใช้งาน'}
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
      const curLoc = b.loc_delivery || 'หน้าร้าน / สาขา';

      schedEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div>
            • <b>เริ่มสัญญา (Pick-up เวลาไทย):</b>
            <div style="display:flex; gap:6px; margin-top:3px;">
              <input type="date" id="contract-edit-start-date" class="form-control" style="padding:4px 8px; font-size:12.5px;" value="${curSDate}">
              <input type="time" id="contract-edit-start-time" class="form-control" style="padding:4px 8px; font-size:12.5px; max-width:115px;" value="${curSTime}">
            </div>
          </div>
          <div>
            • <b>สิ้นสุดสัญญา (Return เวลาไทย):</b>
            <div style="display:flex; gap:6px; margin-top:3px;">
              <input type="date" id="contract-edit-end-date" class="form-control" style="padding:4px 8px; font-size:12.5px;" value="${curEDate}">
              <input type="time" id="contract-edit-end-time" class="form-control" style="padding:4px 8px; font-size:12.5px; max-width:115px;" value="${curETime}">
            </div>
          </div>
          <div>
            • <b>สถานที่ส่งมอบ:</b>
            <input type="text" id="contract-edit-loc" class="form-control" style="padding:4px 8px; font-size:12.5px; margin-top:3px;" value="${curLoc}">
          </div>
          <div>• <b>พนักงานส่งมอบ:</b> ${b.worker_delivery || 'ยังไม่ได้มอบหมาย'}</div>
          <div style="display:flex; gap:6px; margin-top:4px; flex-wrap:wrap;">
            <button type="button" onclick="app.setContractToCurrentThaiTime()" class="btn btn-outline btn-sm" style="font-size:11.5px; padding:4px 10px;">
              🕒 ใช้เวลาไทยปัจจุบัน
            </button>
            <button type="button" onclick="app.saveContractSchedule()" class="btn btn-primary btn-sm" style="font-size:11.5px; padding:4px 10px;">
              💾 บันทึกวัน-เวลาสัญญา
            </button>
          </div>
        </div>
      `;
    }

    // Financial
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const isDep = !!b.deposit_paid;
    const isRent = !!b.rental_paid;
    const remP = isRent ? 0 : parseFloat(b.remaining_rental || netP);

    const netEl = document.getElementById("contract-net-price");
    if (netEl) netEl.textContent = `฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const depEl = document.getElementById("contract-dep-status");
    if (depEl) {
      depEl.innerHTML = isDep 
        ? `<span style="color:#059669;">ชำระแล้ว (฿${depAmt.toLocaleString()})</span>`
        : `<span style="color:#DC2626;">รอมัดจำ (฿${depAmt.toLocaleString()})</span>`;
    }

    const remEl = document.getElementById("contract-rem-price");
    if (remEl) {
      remEl.innerHTML = isRent 
        ? `<span style="color:#059669;">฿0.00 (ชำระครบแล้ว)</span>`
        : `<span style="color:#E85826;">฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>`;
    }

    // Status pill
    const pill = document.getElementById("contract-issued-status-pill");
    if (pill) {
      if (b.contract_issued) {
        pill.innerHTML = `
          <span class="badge badge-success" style="font-size:13px; padding:6px 14px;">
            ✅ ออกสัญญาเรียบร้อยแล้ว
          </span>
        `;
      } else {
        pill.innerHTML = `
          <button onclick="app.markContractIssued()" class="btn btn-success">
            ✅ ยืนยันออกสัญญาเรียบร้อย
          </button>
        `;
      }
    }
  }

  async setContractToCurrentThaiTime() {
    const thNow = this.getThaiDateTime(0);
    const sTimeEl = document.getElementById("contract-edit-start-time");
    const eTimeEl = document.getElementById("contract-edit-end-time");
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
      if (data.success) {
        if (!silent) {
          this.showToast("✅ บันทึกวัน-เวลาสัญญาเช่า (เวลาประเทศไทย) เรียบร้อย!", "success");
        }
        await this.loadBookings();
        this.onSelectContractBooking();
      }
    } catch (e) {
      if (!silent) this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
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
      }
    } catch (e) {
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

  // --- Document Center & PDF Download Handlers ---
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
    this.showToast(`📝 กำลังดาวน์โหลดสัญญาเช่า PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/contract/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
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

  // --- Walk-in Direct Contract Formulation Logic ---
  populateWalkinDropdowns() {
    // 1. Car select
    const carSel = document.getElementById("walkin-car-select");
    if (carSel) {
      const curVal = carSel.value;
      const opts = this.cars.map(c => {
        const { priceDay, priceWeek, priceMonth } = this.getCarRates(c);
        return `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (฿${priceDay.toLocaleString()}/ว | ฿${priceWeek.toLocaleString()}/ส | ฿${priceMonth.toLocaleString()}/ด)</option>`;
      }).join("");
      carSel.innerHTML = '<option value="">-- เลือกรถยนต์จากฝูงรถ --</option>' + opts;
      if (curVal) carSel.value = curVal;
    }

    // 2. Customer select
    const custSel = document.getElementById("walkin-cust-select");
    if (custSel) {
      const curVal = custSel.value;
      const opts = this.customers.map(c => 
        `<option value="${c.full_name}">${c.full_name} (📞 ${c.contact_no || '-'})</option>`
      ).join("");
      custSel.innerHTML = '<option value="">-- เลือกลูกค้าผู้เช่า --</option>' + opts;
      if (curVal) custSel.value = curVal;
    }

    // 3. Worker select
    const workerSel = document.getElementById("walkin-worker-select");
    if (workerSel) {
      const curVal = workerSel.value;
      const approved = this.users.filter(u => u.status === "approved");
      const opts = approved.map(u => `<option value="${u.username}">${u.name || u.username} (${u.role})</option>`).join("");
      workerSel.innerHTML = opts || `<option value="admin">ผู้ดูแลระบบ (admin)</option>`;
      if (curVal) workerSel.value = curVal;
    }

    // 4. Default dates & times in Thailand timezone if empty
    const sDate = document.getElementById("walkin-start-date");
    const eDate = document.getElementById("walkin-end-date");
    const sTime = document.getElementById("walkin-start-time");
    const eTime = document.getElementById("walkin-end-time");
    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    if (sDate && !sDate.value) sDate.value = thNow.dateStr;
    if (eDate && !eDate.value) eDate.value = thNext3.dateStr;
    if (sTime && !sTime.value) sTime.value = thNow.timeStr;
    if (eTime && !eTime.value) eTime.value = thNow.timeStr;

    this.recalcWalkinPrice(true);
  }

  calcWalkinDuration() {
    const thNow = this.getThaiDateTime(0);
    const sDate = document.getElementById("walkin-start-date")?.value;
    const sTime = document.getElementById("walkin-start-time")?.value || thNow.timeStr;
    const eDate = document.getElementById("walkin-end-date")?.value;
    const eTime = document.getElementById("walkin-end-time")?.value || thNow.timeStr;

    if (!sDate || !eDate) return { days: 1, text: "1 วัน" };

    const start = new Date(`${sDate}T${sTime}`);
    const end = new Date(`${eDate}T${eTime}`);
    if (end <= start) return { days: 1, text: "1 วัน (ขั้นต่ำ)" };

    const diffMs = end - start;
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const remMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const baseDays = Math.floor(totalHours / 24);
    const extraHours = totalHours % 24;

    let billableDays = baseDays;
    let desc = "";

    if (extraHours > 4 || (extraHours === 4 && remMins > 0)) {
      billableDays = baseDays + 1;
      desc = `${baseDays} วัน + เกินเวลา ${extraHours} ชม. ${remMins} น. (เกิน 4 ชม. ปรับเป็น 1 วัน ➔ คิด ${billableDays} วัน)`;
    } else if (extraHours > 0 || remMins > 0) {
      desc = `${baseDays} วัน + เศษ ${extraHours} ชม. ${remMins} น. (ไม่เกิน 4 ชม. ➔ คิด ${billableDays} วัน)`;
    } else {
      desc = `${baseDays} วัน (พอดี)`;
    }
    if (billableDays < 1) billableDays = 1;

    return { days: billableDays, text: desc };
  }

  recalcWalkinPrice(fromDateChange = false) {
    const carSel = document.getElementById("walkin-car-select");
    const carPlate = carSel?.value;
    const car = this.cars.find(c => c.plate === carPlate) || {};
    const discInput = document.getElementById("walkin-discount");
    const summaryBox = document.getElementById("walkin-price-summary");
    const discount = discInput ? parseFloat(discInput.value || 0) : 0;

    const dur = this.calcWalkinDuration();
    const cTypeEl = document.getElementById("walkin-contract-type");

    if (fromDateChange && cTypeEl) {
      if (dur.days >= 30) cTypeEl.value = "รายเดือน";
      else if (dur.days >= 7) cTypeEl.value = "รายสัปดาห์";
      else cTypeEl.value = "รายวัน";
    }

    const cType = cTypeEl?.value || "รายวัน";
    const { basePrice, breakdownText } = this.calculateCarRentalPrice(car, dur.days, cType);
    const netPrice = Math.max(0, basePrice - discount);

    if (summaryBox) {
      summaryBox.innerHTML = `
        <div style="line-height:1.7;">
          ⏱️ <b>ระยะเวลาคำนวณ:</b> <span style="color:#D97706; font-weight:700;">${dur.text}</span> (${dur.days} วัน)<br/>
          💡 <b>เรทราคา (${cType}):</b> <span style="color:#2563EB;">${breakdownText}</span><br/>
          💰 <b>ค่าเช่าก่อนลด:</b> ฿${basePrice.toLocaleString('th-TH', {minimumFractionDigits: 2})} 
          | 🏷️ <b>ส่วนลด:</b> ฿${discount.toLocaleString('th-TH', {minimumFractionDigits: 2})}<br/>
          💵 <b>ยอดค่าเช่าสุทธิ:</b> <b style="color:#B45309; font-size:16px;">฿${netPrice.toLocaleString('th-TH', {minimumFractionDigits: 2})}</b> 
          | 🛡️ <b>มัดจำประกันสัญญา:</b> <b style="color:#059669;">฿5,000.00</b>
        </div>
      `;
    }

    return { basePrice, discount, netPrice, durationDays: dur.days };
  }

  async submitWalkinContract() {
    const thNow = this.getThaiDateTime(0);
    const carId = document.getElementById("walkin-car-select")?.value;
    const cust = document.getElementById("walkin-cust-select")?.value;
    const sDate = document.getElementById("walkin-start-date")?.value;
    const sTime = document.getElementById("walkin-start-time")?.value || thNow.timeStr;
    const eDate = document.getElementById("walkin-end-date")?.value;
    const eTime = document.getElementById("walkin-end-time")?.value || thNow.timeStr;
    const cType = document.getElementById("walkin-contract-type")?.value || "รายวัน";
    const worker = document.getElementById("walkin-worker-select")?.value || "admin";
    const loc = document.getElementById("walkin-loc")?.value || "หน้าร้านสาขา";
    const discount = parseFloat(document.getElementById("walkin-discount")?.value || 0);

    if (!carId) {
      this.showToast("⚠️ กรุณาเลือกรถยนต์สำหรับทำสัญญา", "warning");
      return;
    }
    if (!cust) {
      this.showToast("⚠️ กรุณาเลือกลูกค้าผู้เช่า", "warning");
      return;
    }
    if (!sDate || !eDate) {
      this.showToast("⚠️ กรุณาระบุวันรับรถและวันคืนรถ", "warning");
      return;
    }

    const { basePrice } = this.recalcWalkinPrice();

    const payload = {
      car_id: carId,
      customer: cust,
      contract_type: cType,
      start_date: sDate,
      end_date: eDate,
      start_time: sTime,
      end_time: eTime,
      base_price: basePrice,
      discount: discount,
      deposit_amount: 5000.0,
      worker_delivery: worker,
      loc_delivery: loc,
      created_by: this.user ? this.user.username : "admin"
    };

    try {
      this.showToast("⏳ กำลังสร้างสัญญาเช่า Walk-in และเตรียมเอกสาร PDF...", "info");
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 ออกสัญญาเช่า Walk-in ${data.booking_id} เรียบร้อย!`, "success");
        await this.loadBookings();
        await this.loadCars();

        // Select the newly created booking in Tab 4 dropdown
        const contractSel = document.getElementById("contract-sel-bk");
        if (contractSel) {
          contractSel.value = data.booking_id;
          this.onSelectContractBooking();
        }

        // Open official Rental Agreement PDF immediately in new tab
        window.open(`/api/pdf/contract/${data.booking_id}`, "_blank");
      } else {
        this.showToast("❌ สร้างสัญญาไม่สำเร็จ: " + (data.error || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Tab 5: Bookings Table ---
  renderBookingsTable() {
    const tbody = document.getElementById("bookings-table-body");
    if (!tbody) return;

    const kw = (document.getElementById("bks-search-input")?.value || "").toLowerCase().trim();
    const stFilter = document.getElementById("bks-status-filter")?.value || "ทั้งหมด";

    const filtered = this.bookings.filter(b => {
      if (stFilter !== "ทั้งหมด" && b.status !== stFilter) return false;
      if (kw) {
        const s = `${b.booking_id} ${b.car_id} ${b.customer} ${b.status}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748B;">ไม่พบรายการจอง</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(b => {
      const isDep = b.deposit_paid;
      const isRent = b.rental_paid;
      const netP = parseFloat(b.net_price || 0);

      let depBadge = isDep ? '<span class="badge badge-success">มัดจำแล้ว</span>' : '<span class="badge badge-warning">รอมัดจำ</span>';
      let rentBadge = isRent ? '<span class="badge badge-success">จ่ายครบ</span>' : '<span class="badge badge-danger">ค้างชำระ</span>';

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
            ถึง ${b.end_date_formatted} (${b.end_time || '10:00'})
          </td>
          <td style="font-weight:700; color:#1E293B;">
            ฿${netP.toLocaleString()}
          </td>
          <td>
            ${depBadge} ${rentBadge}
          </td>
          <td>
            <span class="badge badge-info">${b.status}</span>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/contract/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="สัญญาเช่า (Rental Agreement PDF)">📝</a>
            <a href="/api/pdf/deposit-receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="ใบเสร็จมัดจำ (Deposit Receipt PDF)">🛡️</a>
            <a href="/api/pdf/receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="ใบเสร็จค่าเช่า (Rental Receipt PDF)">🧾</a>
            <a href="/api/pdf/job/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="ใบตรวจสภาพรถ (Checklist PDF)">📋</a>
            <button onclick="app.deleteBooking('${b.booking_id}')" class="btn btn-sm btn-danger" title="ลบรายการจอง">🗑️</button>
          </td>
        </tr>
      `;
    }).join("");
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

  // --- Back Office Rendering ---
  renderBackOfficeJobs() {
    const tbody = document.getElementById("backoffice-jobs-tbody");
    if (!tbody) return;

    const boKw = (document.getElementById("bo-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();
    const kw = boKw || sbKw;

    const filtered = this.backofficeJobs.filter(j => {
      if (kw) {
        const s = `${j.booking_id} ${j.car_id} ${j.customer} ${j.job_type} ${j.worker || ''} ${j.location || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748B;">📋 ไม่มีใบงานในระบบขณะนี้</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(j => {
      const isDisp = j.job_type === "Dispatch";
      const typeBadge = isDisp ? '<span class="badge badge-info">🚚 ส่งมอบรถ (Dispatch)</span>' : '<span class="badge badge-warning">🔙 รับรถคืน (Return)</span>';

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
          <td><span class="badge badge-gray">${j.status}</span></td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="ใบตรวจสภาพ PDF">📋</a>
            <button onclick="app.openHandoverModal('${j.booking_id}', '${j.job_type}')" class="btn btn-sm btn-primary" ${j.is_locked ? 'disabled title="ต้องปิดงานส่งมอบก่อน"' : ''}>
              🔍 ตรวจรับส่ง & ปิดงาน
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // --- Modal: Handover Inspection ---
  openHandoverModal(bkId, jobType) {
    document.getElementById("insp-bk-id").value = bkId;
    document.getElementById("insp-job-type").value = jobType;
    document.getElementById("modal-handover-title").textContent = jobType === "Dispatch"
      ? `🚚 ตรวจสภาพและส่งมอบรถ (Dispatch - ${bkId})`
      : `🔙 ตรวจสภาพและรับรถคืน (Return - ${bkId})`;

    this.uploadedPhotos = [];
    document.getElementById("insp-uploaded-photos").innerHTML = "";
    this.openModal("modal-handover");
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

  async submitInspection() {
    const bkId = document.getElementById("insp-bk-id").value;
    const jobType = document.getElementById("insp-job-type").value;
    const fuel = document.getElementById("insp-fuel-select").value;
    const mileage = document.getElementById("insp-mileage-input").value;
    const notes = document.getElementById("insp-notes-input").value;

    const payload = {
      fuel_level: fuel,
      mileage: mileage,
      notes: notes,
      photos: this.uploadedPhotos
    };

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
        this.showToast(`🎉 ปิดงาน ${jobType} สำหรับ ${bkId} สมบูรณ์!`, "success");
        await this.loadBackOfficeJobs();
        await this.loadBookings();
        await this.loadCars();
        if (jobType === "Return") await this.loadDashboardKPIs();
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Customers Table & Add/Edit/Delete Operations ---
  renderCustomersTable() {
    const tbody = document.getElementById("customers-table-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("cust-search-input")?.value || "").toLowerCase().trim();
    const filtered = this.customers.filter(c => {
      if (kw) {
        const s = `${c.full_name} ${c.contact_no} ${c.passport_id} ${c.licence_no}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    tbody.innerHTML = filtered.map(c => {
      const safeName = String(c.full_name || '').replace(/'/g, "\\'");
      const isDefault = c.full_name === "ลูกค้าทั่วไป (Walk-in)";
      return `
        <tr>
          <td><b>${c.full_name}</b></td>
          <td>
            📞 ${c.contact_no || '-'}<br/>
            ${c.whatsapp && c.whatsapp !== '-' ? `<span style="font-size:11px; color:#10B981;">WA: ${c.whatsapp}</span>` : ''}
          </td>
          <td>${c.passport_id || '-'}</td>
          <td>${c.licence_no || '-'}</td>
          <td>${c.nationality || 'THAI'}</td>
          <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${c.thai_address}">${c.thai_address || '-'}</td>
          <td style="text-align:center; white-space:nowrap;">
            <button type="button" onclick="app.openEditCustomerModal('${safeName}')" class="btn btn-sm btn-secondary" title="ดู/แก้ไขข้อมูลลูกค้า" style="padding:3px 8px; font-size:12px; margin-right:4px;">
              ✏️
            </button>
            ${!isDefault ? `
              <button type="button" onclick="app.deleteCustomer('${safeName}')" class="btn btn-sm btn-danger" title="ลบข้อมูลลูกค้านี้" style="padding:3px 8px; font-size:12px;">
                🗑️
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join("");
  }

  populateCustomerDropdowns(preferredName = null) {
    if (preferredName) {
      this.lastAddedCustomerName = preferredName;
    }
    const sel = document.getElementById("book-cust-select");
    if (sel) {
      const curVal = preferredName || this.lastAddedCustomerName || sel.value || "";
      sel.innerHTML = this.customers.map(c => `<option value="${c.full_name}">${c.full_name} (📞 ${c.contact_no || '-'})</option>`).join("");
      if (curVal && Array.from(sel.options).some(o => o.value === curVal)) {
        sel.value = curVal;
      }
      this.onSelectBookingCustomer();
    }
    const walkinSel = document.getElementById("walkin-cust-select");
    if (walkinSel) {
      const curVal = preferredName || this.lastAddedCustomerName || walkinSel.value || "";
      walkinSel.innerHTML = '<option value="">-- เลือกลูกค้าผู้เช่า --</option>' +
        this.customers.map(c => `<option value="${c.full_name}">${c.full_name} (📞 ${c.contact_no || '-'})</option>`).join("");
      if (curVal && Array.from(walkinSel.options).some(o => o.value === curVal)) {
        walkinSel.value = curVal;
      }
      this.onSelectWalkinCustomer();
    }
  }

  onSelectBookingCustomer() {
    const sel = document.getElementById("book-cust-select");
    const badge = document.getElementById("book-cust-info-badge");
    if (!sel || !badge) return;
    const name = sel.value;
    const cust = this.customers.find(c => c.full_name === name);
    if (!cust) {
      badge.style.display = "none";
      return;
    }
    badge.style.display = "block";
    badge.innerHTML = `
      <div style="line-height:1.5;">
        👤 <b>${cust.full_name}</b> | 📞 <b>${cust.contact_no || '-'}</b> | 🪪 เลขบัตร/Passport: <b style="color:#2563EB;">${cust.passport_id || '-'}</b> | 🚗 ใบขับขี่: <b>${cust.licence_no || '-'}</b><br/>
        📍 ที่อยู่: <span style="color:#64748B;">${cust.thai_address || cust.home_address || '-'}</span>
      </div>
    `;
  }

  onSelectWalkinCustomer() {
    const sel = document.getElementById("walkin-cust-select");
    const badge = document.getElementById("walkin-cust-info-badge");
    if (!sel || !badge) return;
    const name = sel.value;
    const cust = this.customers.find(c => c.full_name === name);
    if (!cust) {
      badge.style.display = "none";
      return;
    }
    badge.style.display = "block";
    badge.innerHTML = `
      <div style="line-height:1.5;">
        👤 <b>${cust.full_name}</b> | 📞 <b>${cust.contact_no || '-'}</b> | 🪪 เลขบัตร/Passport: <b style="color:#2563EB;">${cust.passport_id || '-'}</b> | 🚗 ใบขับขี่: <b>${cust.licence_no || '-'}</b>
      </div>
    `;
  }

  openEditCustomerModal(customerName) {
    const cust = this.customers.find(c => c.full_name === customerName);
    if (!cust) {
      this.showToast("⚠️ ไม่พบข้อมูลลูกค้าที่ต้องการแก้ไข", "warning");
      return;
    }
    document.getElementById("cust-original-name").value = cust.full_name;
    document.getElementById("cust-name-in").value = cust.full_name || "";
    document.getElementById("cust-phone-in").value = cust.contact_no !== "-" ? (cust.contact_no || "") : "";
    document.getElementById("cust-pass-in").value = cust.passport_id !== "-" ? (cust.passport_id || "") : "";
    document.getElementById("cust-lic-in").value = cust.licence_no !== "-" ? (cust.licence_no || "") : "";
    document.getElementById("cust-nat-in").value = cust.nationality || "THAI";
    document.getElementById("cust-wa-in").value = cust.whatsapp !== "-" ? (cust.whatsapp || "") : "";
    document.getElementById("cust-dob-in").value = cust.dob || "1990-01-01";
    document.getElementById("cust-licexp-in").value = cust.licence_expiry || "2030-01-01";
    document.getElementById("cust-home-in").value = cust.home_address !== "-" ? (cust.home_address || "") : "";
    document.getElementById("cust-thai-in").value = cust.thai_address !== "-" ? (cust.thai_address || "") : "";

    document.getElementById("modal-cust-title").textContent = `✏️ ดูและแก้ไขข้อมูลลูกค้า (${cust.full_name})`;
    const btnSave = document.getElementById("btn-modal-cust-save");
    if (btnSave) btnSave.textContent = "💾 บันทึกการแก้ไข";

    const btnDel = document.getElementById("btn-modal-cust-delete");
    if (btnDel) {
      btnDel.style.display = cust.full_name === "ลูกค้าทั่วไป (Walk-in)" ? "none" : "inline-flex";
    }

    const warnPhone = document.getElementById("cust-phone-warn");
    if (warnPhone) { warnPhone.style.display = "none"; warnPhone.textContent = ""; }
    const warnPass = document.getElementById("cust-pass-warn");
    if (warnPass) { warnPass.style.display = "none"; warnPass.textContent = ""; }

    this.openModal("modal-add-customer");
    setTimeout(() => document.getElementById("cust-phone-in")?.focus(), 80);
  }

  openEditSelectedCustomerModal(context = 'book') {
    const selId = context === 'book' ? "book-cust-select" : "walkin-cust-select";
    const name = document.getElementById(selId)?.value;
    if (!name) {
      this.showToast("⚠️ กรุณาเลือกลูกค้าก่อนกดแก้ไข", "warning");
      return;
    }
    this.openEditCustomerModal(name);
  }

  async deleteSelectedCustomer(context = 'book') {
    const selId = context === 'book' ? "book-cust-select" : "walkin-cust-select";
    const name = document.getElementById(selId)?.value;
    if (!name) {
      this.showToast("⚠️ กรุณาเลือกลูกค้าก่อนกดลบ", "warning");
      return;
    }
    if (name === "ลูกค้าทั่วไป (Walk-in)") {
      this.showToast("⚠️ ไม่สามารถลบ 'ลูกค้าทั่วไป (Walk-in)' ได้", "warning");
      return;
    }
    await this.deleteCustomer(name);
  }

  async deleteCurrentEditingCustomer() {
    const origName = document.getElementById("cust-original-name")?.value || document.getElementById("cust-name-in")?.value;
    if (!origName) return;
    this.closeModal("modal-add-customer");
    await this.deleteCustomer(origName);
  }

  checkDuplicatePhone(val) {
    const warnEl = document.getElementById("cust-phone-warn");
    if (!warnEl) return;
    const cleanDigits = String(val || "").replace(/\D/g, "");
    if (!cleanDigits || cleanDigits.length < 9) {
      warnEl.style.display = "none";
      warnEl.textContent = "";
      return;
    }
    const normPhone = cleanDigits.startsWith("66") ? "0" + cleanDigits.slice(2) : cleanDigits;
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();
    const currentName = (document.getElementById("cust-name-in")?.value || "").trim();

    const dup = (this.customers || []).find(c => {
      if (c.full_name === currentName || (origName && c.full_name === origName)) return false;
      const existPhone = String(c.contact_no || "").replace(/\D/g, "");
      if (!existPhone || existPhone.length < 9) return false;
      const existNorm = existPhone.startsWith("66") ? "0" + existPhone.slice(2) : existPhone;
      return existNorm === normPhone;
    });

    if (dup) {
      warnEl.style.display = "block";
      warnEl.innerHTML = `⚠️ เบอร์โทรศัพท์นี้ซ้ำกับลูกค้า: <b>${dup.full_name}</b> (เลขบัตร/Passport: ${dup.passport_id || '-'}) ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
    } else {
      warnEl.style.display = "none";
      warnEl.textContent = "";
    }
  }

  checkDuplicatePassport(val) {
    const warnEl = document.getElementById("cust-pass-warn");
    if (!warnEl) return;
    const clean = String(val || "").replace(/[\s-]/g, "").toLowerCase();
    if (!clean || clean === "-" || clean === "none") {
      warnEl.style.display = "none";
      warnEl.textContent = "";
      return;
    }
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();
    const currentName = (document.getElementById("cust-name-in")?.value || "").trim();

    const dup = (this.customers || []).find(c => {
      if (c.full_name === currentName || (origName && c.full_name === origName)) return false;
      const existPass = String(c.passport_id || "").replace(/[\s-]/g, "").toLowerCase();
      return existPass && existPass !== "-" && existPass !== "none" && existPass === clean;
    });

    if (dup) {
      warnEl.style.display = "block";
      warnEl.innerHTML = `⚠️ หมายเลขบัตร ปชช. / พาสปอร์ตนี้ซ้ำกับลูกค้า: <b>${dup.full_name}</b> (📞 ${dup.contact_no || '-'}) ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
    } else {
      warnEl.style.display = "none";
      warnEl.textContent = "";
    }
  }

  openAddCustomerModal() {
    const origEl = document.getElementById("cust-original-name");
    if (origEl) origEl.value = "";
    ["cust-name-in", "cust-phone-in", "cust-pass-in", "cust-lic-in", "cust-wa-in", "cust-home-in", "cust-thai-in"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const titleEl = document.getElementById("modal-cust-title");
    if (titleEl) titleEl.textContent = "➕ เพิ่มข้อมูลลูกค้าใหม่ (Add New Customer)";
    const btnSave = document.getElementById("btn-modal-cust-save");
    if (btnSave) btnSave.textContent = "💾 บันทึกข้อมูลลูกค้า";
    const btnDel = document.getElementById("btn-modal-cust-delete");
    if (btnDel) btnDel.style.display = "none";

    const warnPhone = document.getElementById("cust-phone-warn");
    if (warnPhone) { warnPhone.style.display = "none"; warnPhone.textContent = ""; }
    const warnPass = document.getElementById("cust-pass-warn");
    if (warnPass) { warnPass.style.display = "none"; warnPass.textContent = ""; }

    const natEl = document.getElementById("cust-nat-in");
    if (natEl) natEl.value = "THAI";
    const dobEl = document.getElementById("cust-dob-in");
    if (dobEl) dobEl.value = "1990-01-01";
    const licExpEl = document.getElementById("cust-licexp-in");
    if (licExpEl) licExpEl.value = "2030-01-01";

    this.openModal("modal-add-customer");
    setTimeout(() => document.getElementById("cust-name-in")?.focus(), 80);
  }

  async submitNewCustomer() {
    const name = (document.getElementById("cust-name-in")?.value || "").trim();
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();

    if (!name) {
      alert("กรุณาระบุชื่อ-นามสกุลลูกค้า");
      return;
    }

    // 1. Phone number duplicate check
    const phone = (document.getElementById("cust-phone-in")?.value || "").trim();
    if (phone && phone !== "-" && phone.toLowerCase() !== "none") {
      const cleanDigits = phone.replace(/\D/g, "");
      if (cleanDigits.length >= 9) {
        const normPhone = cleanDigits.startsWith("66") ? "0" + cleanDigits.slice(2) : cleanDigits;
        const dupPhone = (this.customers || []).find(c => {
          if (c.full_name === name || (origName && c.full_name === origName)) return false;
          const existPhone = String(c.contact_no || "").replace(/\D/g, "");
          if (!existPhone || existPhone.length < 9) return false;
          const existNorm = existPhone.startsWith("66") ? "0" + existPhone.slice(2) : existPhone;
          return existNorm === normPhone;
        });
        if (dupPhone) {
          this.showToast(`❌ ไม่อนุญาตให้ใช้เบอร์โทรศัพท์ซ้ำกับ '${dupPhone.full_name}'`, "danger");
          alert(`❌ ระบบไม่อนุญาตให้ใช้เบอร์โทรศัพท์ซ้ำ!\n\nเบอร์ '${phone}' ซ้ำกับข้อมูลของลูกค้า '${dupPhone.full_name}' ที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบ`);
          const warnEl = document.getElementById("cust-phone-warn");
          if (warnEl) {
            warnEl.style.display = "block";
            warnEl.innerHTML = `⚠️ เบอร์โทรศัพท์นี้ซ้ำกับลูกค้า: <b>${dupPhone.full_name}</b> ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
          }
          document.getElementById("cust-phone-in")?.focus();
          return;
        }
      }
    }

    // 2. Citizen ID / Passport duplicate check
    const passId = (document.getElementById("cust-pass-in")?.value || "").trim();
    if (passId && passId !== "-" && passId.toLowerCase() !== "none") {
      const cleanPass = passId.replace(/[\s-]/g, "").toLowerCase();
      const duplicate = (this.customers || []).find(c => {
        if (c.full_name === name || (origName && c.full_name === origName)) return false;
        const existPass = String(c.passport_id || "").trim();
        if (!existPass || existPass === "-" || existPass.toLowerCase() === "none") return false;
        return existPass.replace(/[\s-]/g, "").toLowerCase() === cleanPass;
      });
      if (duplicate) {
        this.showToast(`❌ ไม่อนุญาตให้ใช้เลขบัตร/พาสปอร์ตซ้ำกับ '${duplicate.full_name}'`, "danger");
        alert(`❌ ระบบไม่อนุญาตให้ใช้เลขบัตรประชาชนหรือพาสปอร์ตซ้ำ!\n\nหมายเลข '${passId}' ซ้ำกับข้อมูลของลูกค้า '${duplicate.full_name}' ที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบ`);
        const warnEl = document.getElementById("cust-pass-warn");
        if (warnEl) {
          warnEl.style.display = "block";
          warnEl.innerHTML = `⚠️ หมายเลขบัตร ปชช. / พาสปอร์ตนี้ซ้ำกับลูกค้า: <b>${duplicate.full_name}</b> ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
        }
        document.getElementById("cust-pass-in")?.focus();
        return;
      }
    }

    const payload = {
      full_name: name,
      original_name: origName || name,
      contact_no: phone || "-",
      passport_id: passId || "-",
      licence_no: document.getElementById("cust-lic-in")?.value.trim() || "-",
      nationality: document.getElementById("cust-nat-in")?.value.trim() || "THAI",
      whatsapp: document.getElementById("cust-wa-in")?.value.trim() || "-",
      dob: document.getElementById("cust-dob-in")?.value || "1990-01-01",
      licence_expiry: document.getElementById("cust-licexp-in")?.value || "2030-01-01",
      home_address: document.getElementById("cust-home-in")?.value.trim() || "-",
      thai_address: document.getElementById("cust-thai-in")?.value.trim() || "-"
    };

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const errMsg = data.detail || data.error || "เกิดข้อผิดพลาดในการบันทึกข้อมูล";
        this.showToast("❌ บันทึกไม่สำเร็จ: " + errMsg, "danger");
        alert("❌ บันทึกไม่สำเร็จ: " + errMsg);
        return;
      }
      this.lastAddedCustomerName = name;
      if (origName && origName !== name) {
        this.customers = this.customers.filter(c => c.full_name !== origName);
      }
      const existIdx = this.customers.findIndex(c => c.full_name === name);
      if (existIdx >= 0) {
        this.customers[existIdx] = payload;
      } else {
        this.customers.unshift(payload);
      }
      this.populateCustomerDropdowns(name);
      this.closeModal("modal-add-customer");
      this.showToast(`🎉 บันทึกข้อมูลลูกค้า '${name}' เรียบร้อย!`, "success");
      await this.loadCustomers();
      this.populateCustomerDropdowns(name);
      this.renderCustomersTable();
    } catch (e) {
      this.showToast("บันทึกไม่สำเร็จ: " + e.message, "danger");
    }
  }

  async deleteCustomer(name) {
    if (name === "ลูกค้าทั่วไป (Walk-in)") {
      this.showToast("⚠️ ไม่สามารถลบ 'ลูกค้าทั่วไป (Walk-in)' ได้", "warning");
      return;
    }
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลลูกค้า '${name}' ออกจากระบบ? (กรณีบันทึกผิดหรือข้อมูลซ้ำ)`)) return;
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🗑️ ลบข้อมูลลูกค้า '${name}' เรียบร้อยแล้ว`, "success");
        this.customers = this.customers.filter(c => c.full_name !== name);
        if (this.lastAddedCustomerName === name) {
          this.lastAddedCustomerName = null;
        }
        await this.loadCustomers();
        this.populateCustomerDropdowns();
        this.renderCustomersTable();
      } else {
        this.showToast("ลบไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("ลบไม่สำเร็จ: " + e.message, "danger");
    }
  }

  // --- Executive Dashboard Rendering ---
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
    const labelType = field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย";

    let badgeHtml = `<span style="color:#64748B;">${info.formatted}</span>`;
    if (info.valid) {
      if (info.daysLeft < 0) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#991B1B; background:#FEE2E2; border:1px solid #FECACA; padding:2px 8px; border-radius:12px; font-size:11.5px;">
            🔴 ${info.formatted} (หมดอายุ ${Math.abs(info.daysLeft)} วัน)
          </span>`;
      } else if (info.daysLeft === 0) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#991B1B; background:#FEE2E2; border:1px solid #FECACA; padding:2px 8px; border-radius:12px; font-size:11.5px;">
            🔴 ${info.formatted} (หมดอายุวันนี้!)
          </span>`;
      } else if (info.daysLeft <= 30) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#B45309; background:#FEF3C7; border:1px solid #FDE68A; padding:2px 8px; border-radius:12px; font-size:11.5px;">
            🟡 ${info.formatted} (เหลือ ${info.daysLeft} วัน)
          </span>`;
      } else {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:600; color:#065F46; background:#ECFDF5; border:1px solid #A7F3D0; padding:2px 8px; border-radius:12px; font-size:11.5px;">
            🟢 ${info.formatted}
          </span>`;
      }
    }

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:nowrap;">
        <div>${badgeHtml}</div>
        <div style="display:inline-flex; align-items:center; gap:4px; flex-shrink:0;">
          <button type="button" onclick="app.quickRenewCarExpiry('${safePlate}', '${field}')" title="ต่ออายุ ${labelType} ทันที (+1 ปี)" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; border-radius:6px; padding:2px 6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
            🔄 +1ปี
          </button>
          <button type="button" onclick="app.openExpiryModal('${safePlate}', '${field}')" title="ระบุ/แก้ไขวันหมดอายุ ${labelType}" style="background:#F8FAFC; color:#334155; border:1px solid #CBD5E1; border-radius:6px; padding:2px 6px; font-size:11px; cursor:pointer;">
            📅
          </button>
        </div>
      </div>
    `;
  }

  renderFleetOverviewTable() {
    const tbody = document.getElementById("fleet-overview-tbody");
    if (!tbody) return;

    const summaryEl = document.getElementById("dash-fleet-expiry-summary");
    const sortMode = document.getElementById("dash-fleet-sort-select")?.value || "expiry_asc";
    const localKw = (document.getElementById("dash-fleet-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();
    const scopeVal = document.getElementById("dash-company-scope")?.value || "ทั้งหมด";

    // 1. Filter by Company Scope first (matching app.py)
    const scopedCars = (this.cars || []).filter(c => this.matchesCompanyScope(c.company, scopeVal));

    let expiredCount = 0;
    let warningCount = 0;
    let normalCount = 0;

    const enrichedCars = scopedCars.map(c => {
      const actInfo = this.parseExpiryDateInfo(c.act_expiry);
      const insInfo = this.parseExpiryDateInfo(c.ins_expiry);
      const minDays = Math.min(actInfo.daysLeft, insInfo.daysLeft);
      const maxDays = Math.max(actInfo.daysLeft, insInfo.daysLeft);

      if (minDays < 0) expiredCount++;
      else if (minDays <= 30) warningCount++;
      else normalCount++;

      return {
        car: c,
        actInfo,
        insInfo,
        minDays,
        maxDays
      };
    });

    if (summaryEl) {
      summaryEl.innerHTML = `
        <span style="background:#FEE2E2; color:#991B1B; border:1px solid #FECACA; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🔴 หมดอายุ: ${expiredCount} คัน
        </span>
        <span style="background:#FEF3C7; color:#B45309; border:1px solid #FDE68A; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🟡 ใกล้หมด (≤30 วัน): ${warningCount} คัน
        </span>
        <span style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🟢 ปกติ: ${normalCount} คัน
        </span>
      `;
    }

    // 2. Filter by search keyword (local search or sidebar search)
    let filtered = enrichedCars.filter(item => {
      const c = item.car;
      const target = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.company || ''} ${c.color || ''} ${c.status || ''} ${c.act_expiry || ''} ${c.ins_expiry || ''}`.toLowerCase();
      if (localKw && !target.includes(localKw)) return false;
      if (sbKw && !target.includes(sbKw)) return false;
      return true;
    });

    // 3. Sort according to selected sort mode (Default: earliest expiry of ACT & Insurance first)
    filtered.sort((a, b) => {
      if (sortMode === "act_asc") {
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
        // Default: expiry_asc (earliest expiry date first; if tied on minDays, compare maxDays so updating 1 column immediately drops it below cars where both are unrenewed)
        if (a.minDays !== b.minDays) return a.minDays - b.minDays;
        if (a.maxDays !== b.maxDays) return a.maxDays - b.maxDays;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      }
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:28px; color:#64748B;">ไม่พบข้อมูลรถยนต์ที่ค้นหา</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const c = item.car;
      const safePlate = String(c.plate || "").replace(/'/g, "\\'");
      const rowBg = item.minDays < 0 ? "background:#FEF2F2;" : (item.minDays <= 30 ? "background:#FFFBEB;" : "");

      return `
        <tr style="${rowBg} transition: background 0.25s ease;">
          <td style="white-space:nowrap;"><b>🚘 ${c.plate}</b></td>
          <td><b>${c.brand || ''}</b> ${c.model || ''}</td>
          <td>${c.color || '-'}</td>
          <td>${c.company || 'Sawasdee'}</td>
          <td>
            <span class="badge" style="background:${c.status_bg}; color:${c.status_color}; border:1px solid ${c.status_border};">
              ${c.fleet_status_desc || c.status}
            </span>
          </td>
          <td>${this.formatExpiryStatusCell(c.plate, 'act_expiry', c.act_expiry)}</td>
          <td>${this.formatExpiryStatusCell(c.plate, 'ins_expiry', c.ins_expiry)}</td>
          <td style="white-space:nowrap;">${c.mileage || '15,000'} km</td>
          <td style="text-align:center; white-space:nowrap;">
            <button type="button" onclick="app.quickRenewBothExpiry('${safePlate}')" class="btn btn-sm" style="padding:3px 7px; font-size:11px; font-weight:700; background:#ECFDF5; color:#047857; border:1px solid #6EE7B7;" title="ต่ออายุทั้ง พ.ร.บ. และ ประกันภัย (+1 ปี) พร้อมกัน">
              🔄 ต่อคู่
            </button>
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

  async quickRenewCarExpiry(plate, field) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const labelType = field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย";
    const newDateStr = this.computeRenewedDateStr(car[field]);

    await this.saveCarExpiryUpdate(plate, field, newDateStr, labelType);
  }

  async quickRenewBothExpiry(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const newAct = this.computeRenewedDateStr(car.act_expiry);
    const newIns = this.computeRenewedDateStr(car.ins_expiry);

    // Update locally right away so table re-sorts immediately
    car.act_expiry = newAct;
    car.ins_expiry = newIns;
    this.renderFleetOverviewTable();

    const payload = Object.assign({}, car, {
      plate: plate,
      act_expiry: newAct,
      ins_expiry: newIns
    });

    try {
      const res = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ ต่ออายุทั้ง พ.ร.บ. (${newAct}) และ ประกันภัย (${newIns}) ทะเบียน ${plate} เรียบร้อย! (เลื่อนลำดับตามวันหมดอายุใหม่แล้ว)`, "success");
        await this.loadCars();
      } else {
        this.showToast("❌ อัปเดตไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  openExpiryModal(plate, field) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const labelType = field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย";
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
    const labelType = field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย";

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

  toggleExpander(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const header = card.querySelector(".expander-header");
    const body = card.querySelector(".expander-body");
    const indicator = card.querySelector(".expander-indicator span");

    const isVisible = body && body.style.display !== "none";
    if (isVisible) {
      if (body) body.style.display = "none";
      if (header) header.classList.remove("open");
      if (indicator) indicator.textContent = "▼ คลิกเพื่อขยาย";
    } else {
      if (body) body.style.display = "block";
      if (header) header.classList.add("open");
      if (indicator) indicator.textContent = "▲ คลิกเพื่อพับเก็บ";
    }
  }

  toggleFleetTableCollapse() {
    this.toggleExpander("expander-fleet");
  }

  // --- Dashboard Charts Engine (Chart.js) ---
  renderDashboardCharts() {
    this.renderDonutCharts();
    this.renderTrendChart();
  }

  setDonutMode(mode) {
    this.donutMode = mode;
    const btnStatus = document.getElementById("btn-donut-status");
    const btnCompare = document.getElementById("btn-donut-compare");
    if (mode === "compare") {
      if (btnCompare) { btnCompare.style.background = "#E85826"; btnCompare.style.color = "#FFFFFF"; }
      if (btnStatus) { btnStatus.style.background = "transparent"; btnStatus.style.color = "#6B7280"; }
    } else {
      if (btnStatus) { btnStatus.style.background = "#E85826"; btnStatus.style.color = "#FFFFFF"; }
      if (btnCompare) { btnCompare.style.background = "transparent"; btnCompare.style.color = "#6B7280"; }
    }
    this.renderDonutCharts();
  }

  renderDonutCharts() {
    const container = document.getElementById("dashboard-donuts-container");
    if (!container || !this.cars || this.cars.length === 0) return;

    const compList = ["Sawasdee Rent A Car", "P.D.P. Co., Ltd.", "Sawasdee Car Rent"];
    const compPalette = ["#E85826", "#10B981", "#3B82F6"];
    const compIcons = {
      "Sawasdee Rent A Car": "🚙",
      "P.D.P. Co., Ltd.": "🚗",
      "Sawasdee Car Rent": "🚐"
    };

    const compMap = {
      "Sawasdee Rent A Car": { total: 0, avail: 0, rent: 0, maint: 0, color: "#E85826" },
      "P.D.P. Co., Ltd.": { total: 0, avail: 0, rent: 0, maint: 0, color: "#10B981" },
      "Sawasdee Car Rent": { total: 0, avail: 0, rent: 0, maint: 0, color: "#3B82F6" }
    };

    const hasExactScr = this.cars.some(c => (c.company || "").trim() === "Sawasdee Car Rent");

    this.cars.forEach(c => {
      const rawComp = (c.company || "").trim();
      let targetComp = null;
      if (rawComp === "Sawasdee Rent A Car" || rawComp.includes("สวัสดี เรนทัล") || rawComp.includes("Sawasdee Rental")) {
        targetComp = "Sawasdee Rent A Car";
      } else if (rawComp === "P.D.P. Co., Ltd." || rawComp.includes("P.D.P") || rawComp.includes("พี.ดี.พี")) {
        targetComp = "P.D.P. Co., Ltd.";
      } else if (rawComp === "Sawasdee Car Rent" || (!hasExactScr && rawComp.includes("บี คลิ๊ก"))) {
        targetComp = "Sawasdee Car Rent";
      }

      if (!targetComp) return;

      compMap[targetComp].total++;
      if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง") {
        compMap[targetComp].maint++;
      } else if (c.fleet_status_key === "unavailable" || ["กำลังเช่า", "ติดจอง", "เตรียมส่งมอบ", "เตรียมรับคืน", "รอส่งมอบ"].includes(c.status)) {
        compMap[targetComp].rent++;
      } else {
        compMap[targetComp].avail++;
      }
    });

    const mode = this.donutMode || "status";

    if (mode === "compare") {
      // Compare 3 companies across: 1) Total Fleet, 2) Rented/Reserved, 3) Available
      const metrics = [
        { key: "total", title: "🚗 กองยานพาหนะรวม", sub: "สัดส่วนจำนวนรถทั้งหมดที่ถือครอง", badgeColor: "#E85826" },
        { key: "rent", title: "🔑 รถกำลังเช่า/ติดจอง", sub: "สัดส่วนรถที่ติดสัญญาเช่าและล็อกคิว", badgeColor: "#E85826" },
        { key: "avail", title: "✨ รถว่างพร้อมให้บริการ", sub: "สัดส่วนรถว่างที่พร้อมปล่อยเช่าได้ทันที", badgeColor: "#10B981" }
      ];

      container.innerHTML = metrics.map((m, idx) => {
        const canvasId = `donut-chart-canvas-${idx}`;
        const tot = compList.reduce((acc, cName) => acc + compMap[cName][m.key], 0);
        const rowsHtml = compList.map((cName, cIdx) => {
          const val = compMap[cName][m.key];
          const pct = tot > 0 ? ((val / tot) * 100).toFixed(1) : "0.0";
          return `
            <div class="donut-stat-row">
              <span><span style="color:${compPalette[cIdx]}; font-size:13px;">●</span> ${cName}</span>
              <b>${val} คัน (${pct}%)</b>
            </div>
          `;
        }).join("");

        return `
          <div class="donut-card">
            <div class="donut-header">
              <span>${m.title}</span>
              <span style="font-size:12px; font-weight:800; color:${m.badgeColor}; background:#FFF7ED; padding:2px 8px; border-radius:12px; border:1px solid #FED7AA;">
                ${tot} คัน
              </span>
            </div>
            <div class="donut-sub">${m.sub}</div>
            <div style="position:relative; height:150px; margin-bottom:12px;">
              <canvas id="${canvasId}"></canvas>
            </div>
            <div>${rowsHtml}</div>
          </div>
        `;
      }).join("");

      if (typeof Chart === "undefined") return;

      metrics.forEach((m, idx) => {
        const canvasId = `donut-chart-canvas-${idx}`;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        if (this.donutCharts[canvasId]) this.donutCharts[canvasId].destroy();

        const vals = compList.map(cName => compMap[cName][m.key]);
        const tot = vals.reduce((a, b) => a + b, 0);

        this.donutCharts[canvasId] = new Chart(canvas, {
          type: 'doughnut',
          data: {
            labels: compList,
            datasets: [{
              data: tot > 0 ? vals : [1, 1, 1],
              backgroundColor: tot > 0 ? compPalette : ['#E5E7EB', '#E5E7EB', '#E5E7EB'],
              borderWidth: 2,
              borderColor: '#FFFFFF'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    const val = tot > 0 ? (ctx.raw || 0) : 0;
                    const pct = tot > 0 ? ((val / tot) * 100).toFixed(1) : "0.0";
                    return ` ${ctx.label}: ${val} คัน (${pct}%)`;
                  }
                }
              }
            }
          }
        });
      });
    } else {
      // Default: 3 cards for the 3 main companies showing status breakdown
      container.innerHTML = compList.map((compName, idx) => {
        const data = compMap[compName];
        const icon = compIcons[compName] || "🏢";
        const canvasId = `donut-chart-canvas-${idx}`;
        const availPct = data.total > 0 ? ((data.avail / data.total) * 100).toFixed(1) : "0.0";
        const rentPct = data.total > 0 ? ((data.rent / data.total) * 100).toFixed(1) : "0.0";
        const maintPct = data.total > 0 ? ((data.maint / data.total) * 100).toFixed(1) : "0.0";

        return `
          <div class="donut-card">
            <div class="donut-header">
              <span>${icon} ${compName}</span>
              <span style="font-size:12px; font-weight:800; color:${data.color}; background:#FFF7ED; padding:2px 8px; border-radius:12px; border:1px solid #FED7AA;">
                ${data.total} คัน
              </span>
            </div>
            <div class="donut-sub">สัดส่วนสถานะรถภายในองค์กร</div>
            <div style="position:relative; height:150px; margin-bottom:12px;">
              <canvas id="${canvasId}"></canvas>
            </div>
            <div>
              <div class="donut-stat-row">
                <span><span style="color:#10B981; font-size:13px;">●</span> ว่างพร้อมใช้งาน</span>
                <b>${data.avail} คัน (${availPct}%)</b>
              </div>
              <div class="donut-stat-row">
                <span><span style="color:#E85826; font-size:13px;">●</span> กำลังเช่า/ติดจอง</span>
                <b>${data.rent} คัน (${rentPct}%)</b>
              </div>
              <div class="donut-stat-row">
                <span><span style="color:#EF4444; font-size:13px;">●</span> ซ่อมบำรุง</span>
                <b>${data.maint} คัน (${maintPct}%)</b>
              </div>
            </div>
          </div>
        `;
      }).join("");

      if (typeof Chart === "undefined") return;

      compList.forEach((compName, idx) => {
        const data = compMap[compName];
        const canvasId = `donut-chart-canvas-${idx}`;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        if (this.donutCharts[canvasId]) {
          this.donutCharts[canvasId].destroy();
        }

        const hasData = data.total > 0;
        this.donutCharts[canvasId] = new Chart(canvas, {
          type: 'doughnut',
          data: {
            labels: ['ว่างพร้อมใช้งาน', 'กำลังเช่า/ติดจอง', 'ซ่อมบำรุง'],
            datasets: [{
              data: hasData ? [data.avail, data.rent, data.maint] : [1],
              backgroundColor: hasData ? ['#10B981', '#E85826', '#EF4444'] : ['#E5E7EB'],
              borderWidth: 2,
              borderColor: '#FFFFFF'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    if (!hasData) return ' ยังไม่มีข้อมูลรถ';
                    const val = ctx.raw || 0;
                    const total = data.total || 1;
                    const pct = ((val / total) * 100).toFixed(1);
                    return ` ${ctx.label}: ${val} คัน (${pct}%)`;
                  }
                }
              }
            }
          }
        });
      });
    }
  }

  setTrendMetric(metric) {
    this.trendMetric = metric;
    const btnRev = document.getElementById("btn-trend-rev");
    const btnJobs = document.getElementById("btn-trend-jobs");

    if (metric === "rev") {
      if (btnRev) {
        btnRev.style.background = "#E85826";
        btnRev.style.color = "#FFFFFF";
      }
      if (btnJobs) {
        btnJobs.style.background = "transparent";
        btnJobs.style.color = "#6B7280";
      }
    } else {
      if (btnJobs) {
        btnJobs.style.background = "#E85826";
        btnJobs.style.color = "#FFFFFF";
      }
      if (btnRev) {
        btnRev.style.background = "transparent";
        btnRev.style.color = "#6B7280";
      }
    }

    this.renderTrendChart();
  }

  renderTrendChart() {
    const canvas = document.getElementById("chart-revenue-trend");
    if (!canvas || typeof Chart === "undefined") return;

    const months = ["1. พ.ค.", "2. มิ.ย.", "3. ก.ค.", "4. ส.ค.", "5. ก.ย.", "6. ต.ค."];
    const monthNums = [5, 6, 7, 8, 9, 10];
    const baseTrend = {
      "Sawasdee Rent A Car": {
        rev: [120000, 145000, 160000, 140000, 150000, 190000],
        jobs: [8, 10, 11, 9, 10, 13],
        color: "#E85826"
      },
      "P.D.P. Co., Ltd.": {
        rev: [80000, 95000, 110000, 100000, 110000, 135000],
        jobs: [5, 6, 7, 6, 7, 9],
        color: "#10B981"
      },
      "Sawasdee Car Rent": {
        rev: [50000, 60000, 75000, 65000, 70000, 90000],
        jobs: [3, 4, 5, 4, 4, 6],
        color: "#3B82F6"
      }
    };

    // Dynamically incorporate completedJobs into baseTrend (matching app.py lines 7054-7068)
    (this.completedJobs || []).forEach(item => {
      const dStr = String(item.completed_date || item.end_date || "");
      let mNum = null;
      if (dStr.includes("-")) {
        const parts = dStr.split("-");
        if (parts.length >= 2) mNum = parseInt(parts[1], 10);
      } else if (dStr.includes("/")) {
        const parts = dStr.split("/");
        if (parts.length >= 2) mNum = parseInt(parts[1], 10);
      }
      const mIdx = monthNums.indexOf(mNum);
      if (mIdx !== -1) {
        let comp = item.company || "Sawasdee Rent A Car";
        if (this.matchesCompanyScope(comp, "Sawasdee Rent A Car")) comp = "Sawasdee Rent A Car";
        else if (this.matchesCompanyScope(comp, "P.D.P. Co., Ltd.")) comp = "P.D.P. Co., Ltd.";
        else if (this.matchesCompanyScope(comp, "Sawasdee Car Rent")) comp = "Sawasdee Car Rent";
        if (baseTrend[comp]) {
          baseTrend[comp].rev[mIdx] += parseFloat(item.net_price || 0);
          baseTrend[comp].jobs[mIdx] += 1;
        }
      }
    });

    // Render company selector checkboxes if empty
    const togglesContainer = document.getElementById("trend-company-toggles");
    if (togglesContainer && togglesContainer.children.length === 0) {
      togglesContainer.innerHTML = Object.keys(baseTrend).map(cName => {
        const checked = this.selectedTrendCompanies.includes(cName) ? "checked" : "";
        return `
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="checkbox" value="${cName}" ${checked} onchange="app.onTrendCompanyToggle(this)" style="cursor:pointer; accent-color:#E85826;">
            <span>${cName}</span>
          </label>
        `;
      }).join("");
    }

    const datasets = [];
    Object.keys(baseTrend).forEach(cName => {
      if (!this.selectedTrendCompanies.includes(cName)) return;
      const compData = baseTrend[cName];
      const dataArr = this.trendMetric === "rev" ? compData.rev : compData.jobs;

      datasets.push({
        label: cName,
        data: dataArr,
        borderColor: compData.color,
        backgroundColor: compData.color,
        fill: false,
        tension: 0.35,
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 6
      });
    });

    if (this.trendChart) {
      this.trendChart.destroy();
    }

    const isRev = this.trendMetric === "rev";
    this.trendChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: months,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 14,
              font: { weight: '600' }
            }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const val = ctx.raw || 0;
                if (isRev) {
                  return ` ${ctx.dataset.label}: ฿${val.toLocaleString()} บาท`;
                } else {
                  return ` ${ctx.dataset.label}: ${val} งาน`;
                }
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(val) {
                if (isRev) {
                  return '฿' + (val >= 1000 ? (val/1000) + 'k' : val);
                } else {
                  return val + ' งาน';
                }
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

  onTrendCompanyToggle(el) {
    const val = el.value;
    if (el.checked) {
      if (!this.selectedTrendCompanies.includes(val)) this.selectedTrendCompanies.push(val);
    } else {
      this.selectedTrendCompanies = this.selectedTrendCompanies.filter(c => c !== val);
    }
    this.renderTrendChart();
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
    const titleEl = document.getElementById("title-expander-completed");
    if (titleEl) {
      titleEl.textContent = `คลังประวัติงานเสร็จสิ้น & รีพอร์ตรายเดือน (Completed Jobs Archive) — (${filtered.length} รายการ)`;
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

    if (elJobs) elJobs.innerHTML = `${totalJobsCnt} <span style="font-size:13px; font-weight:500;">งาน</span>`;
    if (elRev) elRev.textContent = `฿${totalRevSum.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elCars) elCars.innerHTML = `${uniqueCarsCnt} <span style="font-size:13px; font-weight:500;">คัน</span>`;
    if (elCusts) elCusts.innerHTML = `${uniqueCustCnt} <span style="font-size:13px; font-weight:500;">ราย</span>`;

    const photosContainer = document.getElementById("completed-jobs-photos-container");

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:30px; color:#64748B;">ไม่มีข้อมูลงานที่เสร็จสิ้นตรงกับเงื่อนไขที่เลือก</td></tr>`;
      if (photosContainer) photosContainer.innerHTML = "";
      return;
    }

    tbody.innerHTML = filtered.map(j => {
      const custObj = (this.customers || []).find(c => c.full_name === j.customer) || {};
      const phone = custObj.contact_no && custObj.contact_no !== "-" ? `<div style="font-size:11px; color:#64748B;">📞 ${custObj.contact_no}</div>` : "";
      const locStr = j.loc_return || j.loc_delivery || "-";
      const photos = Array.isArray(j.inspection_photos) ? j.inspection_photos : [];
      const pBadge = photos.length > 0
        ? `<span style="background:#E0E7FF; color:#4338CA; padding:2px 7px; border-radius:10px; font-size:11px; font-weight:700; margin-left:4px;">📸 ${photos.length} รูป</span>`
        : "";
      const notes = j.inspection_notes || "ตรวจสภาพปกติ";

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
          <td><span class="badge badge-gray">${j.contract_type || 'รายวัน'}</span></td>
          <td style="text-align:right; font-weight:700; color:#E85826;">฿${parseFloat(j.net_price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
          <td style="font-size:12px;">${j.worker_delivery || '-'} / ${j.worker_return || '-'}</td>
          <td style="font-size:12px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${locStr}">${locStr}</td>
          <td>
            <div style="font-size:12px; white-space:nowrap;"><b>${j.fuel_level || '⛽ เต็มถัง (100%)'}</b>${pBadge}</div>
            <div style="font-size:11px; color:#64748B; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${notes}">${notes}</div>
          </td>
          <td><span class="badge badge-success">เสร็จสิ้น</span></td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/contract/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="โหลดสัญญาเช่า PDF">📝</a>
            <a href="/api/pdf/receipt/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="โหลดใบเสร็จ PDF">🧾</a>
            <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="โหลดลิสต์ตรวจเช็ครถ PDF">📋</a>
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
            const cap = typeof p === "object" && p.name ? p.name : "ภาพสภาพรถ";
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
                🚘 ${j.car_id} | รหัส: ${j.booking_id} (${j.customer}) — ระดับน้ำมัน: ${j.fuel_level || '-'}
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
              📸 คลังรูปภาพสภาพรถ & เกจ์น้ำมันตอนส่งงานปิดจ๊อบ (${totalPhotoCnt} รูป) — คลิกเพื่อดูภาพหลักฐาน
            </summary>
            <div style="margin-top:12px;">
              ${galleryItems}
            </div>
          </details>
        `;
      }
    }
  }

  async triggerLineExpiryCheck() {
    this.showToast("📲 กำลังตรวจสอบวันหมดอายุ พ.ร.บ./ประกันภัย และส่ง LINE...", "info");
    try {
      const res = await fetch("/api/line/check-expiry", { method: "POST" });
      const data = await res.json();
      if (data.sent) {
        this.showToast(`🚨 ส่งการแจ้งเตือนทาง LINE สำเร็จ: ${data.count} รายการ!`, "success");
      } else {
        this.showToast(data.message || "ไม่มีรายการครบกำหนดแจ้งเตือนในวันนี้", "info");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Admin Users Rendering ---
  renderUsersTable() {
    const tbody = document.getElementById("users-table-tbody");
    if (!tbody) return;

    tbody.innerHTML = this.users.map(u => {
      const isPending = u.status === "pending";
      return `
        <tr>
          <td><b>${u.username}</b></td>
          <td>${u.name || '-'}</td>
          <td><span class="badge badge-info">${u.role || 'Staff'}</span></td>
          <td>
            <span class="badge ${isPending ? 'badge-danger' : 'badge-success'}">
              ${isPending ? '⏳ รออนุมัติ' : '✅ ใช้งานได้'}
            </span>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${isPending ? `<button onclick="app.approveUser('${u.username}')" class="btn btn-sm btn-success">อนุมัติ</button>` : `<button onclick="app.rejectUser('${u.username}')" class="btn btn-sm btn-secondary">ระงับ</button>`}
            ${u.username !== 'admin' ? `<button onclick="app.deleteUser('${u.username}')" class="btn btn-sm btn-danger">ลบ</button>` : ''}
          </td>
        </tr>
      `;
    }).join("");
  }

  async approveUser(un) {
    await fetch(`/api/users/${un}/approve`, { method: "POST" });
    this.showToast(`อนุมัติผู้ใช้ ${un} เรียบร้อย`, "success");
    await this.loadUsers();
  }

  async rejectUser(un) {
    await fetch(`/api/users/${un}/reject`, { method: "POST" });
    this.showToast(`ระงับสิทธิ์ ${un} เรียบร้อย`, "info");
    await this.loadUsers();
  }

  async deleteUser(un) {
    if (!confirm(`ต้องการลบบัญชี ${un}?`)) return;
    await fetch(`/api/users/${un}`, { method: "DELETE" });
    this.showToast(`ลบบัญชี ${un} เรียบร้อย`, "success");
    await this.loadUsers();
  }

  // --- Authentication Gate & Session Management ---
  setGateMode(mode) {
    const loginBox = document.getElementById("gate-mode-login");
    const regBox = document.getElementById("gate-mode-register");
    const forgotBox = document.getElementById("gate-mode-forgot");
    if (loginBox) loginBox.style.display = mode === "login" ? "block" : "none";
    if (regBox) regBox.style.display = mode === "register" ? "block" : "none";
    if (forgotBox) forgotBox.style.display = mode === "forgot" ? "block" : "none";

    ["login", "reg", "forgot"].forEach(m => {
      const el = document.getElementById(`gate-${m}-alert`);
      if (el) { el.style.display = "none"; el.textContent = ""; }
    });
  }

  showGateAlert(mode, type, msg) {
    const el = document.getElementById(`gate-${mode}-alert`);
    if (!el) return;
    el.className = `gate-alert ${type}`;
    el.textContent = msg;
    el.style.display = "block";
  }

  async submitGateLogin() {
    const unInput = document.getElementById("gate-login-username");
    const pwInput = document.getElementById("gate-login-password");
    const btn = document.getElementById("btn-gate-submit-login");
    const un = (unInput?.value || "").trim();
    const pw = (pwInput?.value || "").trim();

    if (!un || !pw) {
      this.showGateAlert("login", "error", "กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ กำลังเข้าสู่ระบบ...";
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, password: pw })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }

      this.user = data.user;
      localStorage.setItem("sawasdee_user", JSON.stringify(this.user));
      this.updateAuthUI();
      this.showToast(`เข้าสู่ระบบสำเร็จในฐานะ: ${this.user.name || this.user.username} ☁️`, "success");

      // Load all data after login
      await this.fetchInitialData();
      this.startLiveSyncPoller();
    } catch (err) {
      this.showGateAlert("login", "error", "❌ " + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "⚡ เข้าสู่ระบบ (Supabase Auth)";
      }
    }
  }

  async submitGateRegister() {
    const un = (document.getElementById("gate-reg-username")?.value || "").trim();
    const fn = (document.getElementById("gate-reg-fullname")?.value || "").trim();
    const p1 = (document.getElementById("gate-reg-password")?.value || "").trim();
    const p2 = (document.getElementById("gate-reg-password2")?.value || "").trim();

    if (!un) {
      this.showGateAlert("reg", "error", "กรุณากรอกชื่อผู้ใช้งาน");
      return;
    }
    if (p1 !== p2) {
      this.showGateAlert("reg", "error", "รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    if (p1.length < 6) {
      this.showGateAlert("reg", "error", "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, name: fn, password: p1 })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ไม่สามารถลงทะเบียนได้");
      }
      this.showGateAlert("reg", "success", "✅ " + (data.message || "ลงทะเบียนสำเร็จ รอ Admin อนุมัติ"));
      setTimeout(() => {
        this.setGateMode("login");
        const uInp = document.getElementById("gate-login-username");
        if (uInp) uInp.value = un;
      }, 1500);
    } catch (err) {
      this.showGateAlert("reg", "error", "❌ " + err.message);
    }
  }

  async submitGateForgot() {
    const un = (document.getElementById("gate-forgot-username")?.value || "").trim();
    const oldP = (document.getElementById("gate-forgot-old-password")?.value || "").trim();
    const newP = (document.getElementById("gate-forgot-new-password")?.value || "").trim();

    if (!un || !newP) {
      this.showGateAlert("forgot", "error", "กรุณากรอกข้อมูลให้ครบถ้วน");
      return;
    }
    if (newP.length < 6) {
      this.showGateAlert("forgot", "error", "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, old_password: oldP, new_password: newP })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ไม่สามารถเปลี่ยนรหัสผ่านได้");
      }
      this.showGateAlert("forgot", "success", "✅ เปลี่ยนรหัสผ่านสำเร็จเรียบร้อย กรุณาเข้าสู่ระบบใหม่");
      setTimeout(() => {
        this.setGateMode("login");
      }, 1500);
    } catch (err) {
      this.showGateAlert("forgot", "error", "❌ " + err.message);
    }
  }

  handleSidebarSearch(kw) {
    this.sidebarSearchKw = (kw || "").trim().toLowerCase();
    this.renderFleetCards();
    if (this.activeModule === "backoffice") {
      this.renderBackOfficeJobs();
    }
  }

  logout() {
    this.user = null;
    localStorage.removeItem("sawasdee_user");
    this.updateAuthUI();
    this.showToast("ออกจากระบบเรียบร้อย", "info");
  }

  // --- Modal & Toast Helpers ---
  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
      this.modalZIndex = (this.modalZIndex || 2000) + 10;
      m.style.zIndex = String(this.modalZIndex);
      m.classList.add("open");
    }
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove("open");
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
